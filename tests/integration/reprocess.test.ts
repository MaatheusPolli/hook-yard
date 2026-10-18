import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, orderPayload, scriptedProcessor, waitFor, type Harness } from '../helpers/harness.js';

describe('POST /eventos/:id/reprocessar', () => {
  let h: Harness;
  afterEach(async () => {
    await h.close();
  });

  it('reenfileira item da DLQ e conclui com sucesso', async () => {
    h = await createHarness({ maxAttempts: 2 });
    // Falha 2x (esgota), depois o "ERP volta" e a 3ª chamada sucede.
    const { processor, calls } = scriptedProcessor({ failTimes: 2 });
    h.startWorker({ processor });

    const { id } = (await h.postWebhook(orderPayload())).json();
    await waitFor(async () => (await h.repository.findById(id))?.status === 'dead');

    const res = await h.app.inject({ method: 'POST', url: `/eventos/${id}/reprocessar` });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ id, status: 'received' });

    const event = await waitFor(async () => {
      const e = await h.repository.findById(id);
      return e?.status === 'processed' ? e : undefined;
    });
    // Tentativas são acumuladas no histórico: 2 da primeira rodada + 1 após reprocessar.
    expect(event.attempts).toBe(3);
    expect(calls.map((c) => c.attempt)).toEqual([1, 2, 3]);
    const history = await h.repository.listAttempts(id);
    expect(history.map((a) => a.success)).toEqual([false, false, true]);
  });

  it('409 para evento que não está na DLQ', async () => {
    h = await createHarness();
    const { id } = (await h.postWebhook(orderPayload())).json();
    const res = await h.app.inject({ method: 'POST', url: `/eventos/${id}/reprocessar` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'CONFLICT' });
  });

  it('404 para evento inexistente e 400 para id inválido', async () => {
    h = await createHarness();
    expect((await h.app.inject({ method: 'POST', url: `/eventos/${randomUUID()}/reprocessar` })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'POST', url: '/eventos/nao-e-uuid/reprocessar' })).statusCode).toBe(400);
  });
});
