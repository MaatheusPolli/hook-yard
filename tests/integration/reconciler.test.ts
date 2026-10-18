import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enqueueEvent, jobIdFor } from '@hookyard/shared';
import { Reconciler } from '@hookyard/worker';
import { createHarness, orderPayload, scriptedProcessor, silentLogger, waitFor, type Harness } from '../helpers/harness.js';

describe('reconciliador (outbox)', () => {
  let h: Harness;
  let reconciler: Reconciler;

  beforeEach(async () => {
    h = await createHarness();
    reconciler = new Reconciler({
      repository: h.repository,
      queue: h.queue,
      logger: silentLogger,
      maxAttempts: h.config.maxAttempts,
      minAgeMs: 0,
      // "Agora" um pouco no futuro para que eventos recém-criados já contem como parados.
      now: () => new Date(Date.now() + 1_000),
    });
  });
  afterEach(async () => {
    await reconciler.stop();
    await h.close();
  });

  it('reenfileira evento received sem job e o worker conclui', async () => {
    // Simula crash entre persistir e enfileirar: grava direto no banco, sem job.
    const { event } = await h.repository.insertIfAbsent({ source: 'marketplace', eventId: 'orfao-1', type: 'order.created', payload: orderPayload('orfao-1') });
    expect(await h.queue.getJob(jobIdFor(event))).toBeUndefined();

    expect(await reconciler.runOnce()).toBe(1);
    expect(await h.queue.getJob(jobIdFor(event))).toBeDefined();

    const { processor } = scriptedProcessor();
    h.startWorker({ processor });
    await waitFor(async () => (await h.repository.findById(event.id))?.status === 'processed');
  });

  it('não duplica job de evento que já está na fila', async () => {
    const { id } = (await h.postWebhook(orderPayload())).json();
    expect(await reconciler.runOnce()).toBe(0);
    const event = await h.repository.findById(id);
    await enqueueEvent(h.queue, id, 3, jobIdFor(event!)); // jobId repetido é ignorado pelo BullMQ
    expect(await h.queue.getJobCounts('waiting')).toMatchObject({ waiting: 1 });
  });

  it('ignora eventos recentes (minAge) e eventos que não estão received', async () => {
    const strict = new Reconciler({ repository: h.repository, queue: h.queue, logger: silentLogger, maxAttempts: 3, minAgeMs: 60_000 });
    await h.repository.insertIfAbsent({ source: 'marketplace', eventId: 'novo', type: 't', payload: {} });
    expect(await strict.runOnce()).toBe(0);

    const { event } = await h.repository.insertIfAbsent({ source: 'marketplace', eventId: 'feito', type: 't', payload: {} });
    await h.repository.markProcessed(event.id);
    expect(await reconciler.runOnce()).toBe(1); // só o 'novo'
  });

  it('recupera o evento aceito com a fila fora do ar, periodicamente', async () => {
    const queue = h.queue;
    // Fila "fora": a API grava mas não consegue enfileirar.
    const add = queue.add.bind(queue);
    queue.add = (async () => {
      throw new Error('ECONNREFUSED redis');
    }) as typeof queue.add;
    const { id } = (await h.postWebhook(orderPayload('fila-caiu'))).json();
    queue.add = add;

    const { processor } = scriptedProcessor();
    h.startWorker({ processor });
    reconciler.start(100);
    await waitFor(async () => (await h.repository.findById(id))?.status === 'processed');
  });

  it('loga e continua quando uma rodada falha', async () => {
    const broken = new Reconciler({
      repository: { findStaleReceived: async () => Promise.reject(new Error('db fora')) } as never,
      queue: h.queue,
      logger: silentLogger,
      maxAttempts: 3,
      minAgeMs: 0,
    });
    broken.start(20);
    await new Promise((r) => setTimeout(r, 80));
    await broken.stop();
  });
});
