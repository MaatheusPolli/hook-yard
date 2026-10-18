import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, orderPayload, scriptedProcessor, waitFor, type Harness } from '../helpers/harness.js';

describe('graceful shutdown', () => {
  let h: Harness;
  afterEach(async () => {
    await h.close();
  });

  it('worker.close() aguarda o job em andamento terminar antes de sair', async () => {
    h = await createHarness();
    const { processor, calls } = scriptedProcessor({ delayMs: 800 });
    const worker = h.startWorker({ processor });

    const { id } = (await h.postWebhook(orderPayload())).json();
    await waitFor(async () => calls.length === 1);
    expect((await h.repository.findById(id))?.status).toBe('processing');

    // Mesmo caminho do handler de SIGTERM.
    const started = Date.now();
    await worker.close();
    expect(Date.now() - started).toBeGreaterThan(300);

    const event = await h.repository.findById(id);
    expect(event?.status).toBe('processed');
    expect(await h.queue.getJobCounts('active')).toMatchObject({ active: 0 });
  });

  it('após fechar, o worker não pega jobs novos', async () => {
    h = await createHarness();
    const { processor, calls } = scriptedProcessor();
    const worker = h.startWorker({ processor });
    await worker.close();

    const { id } = (await h.postWebhook(orderPayload())).json();
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toHaveLength(0);
    expect((await h.repository.findById(id))?.status).toBe('received');
  });
});
