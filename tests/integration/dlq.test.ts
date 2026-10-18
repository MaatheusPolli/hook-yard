import { afterEach, describe, expect, it } from 'vitest';
import { PermanentProcessingError } from '@hookyard/shared';
import { createHarness, orderPayload, scriptedProcessor, waitFor, type Harness } from '../helpers/harness.js';

describe('dead-letter queue', () => {
  let h: Harness;
  afterEach(async () => {
    await h.close();
  });

  it('esgota as tentativas → status dead com motivo e stack, visível na listagem', async () => {
    h = await createHarness({ maxAttempts: 3 });
    const { processor, calls } = scriptedProcessor({ failTimes: Infinity, error: () => new Error('ERP respondeu 503') });
    h.startWorker({ processor });

    const { id } = (await h.postWebhook(orderPayload('vai-morrer'))).json();
    const event = await waitFor(async () => {
      const e = await h.repository.findById(id);
      return e?.status === 'dead' ? e : undefined;
    });

    expect(event.attempts).toBe(3);
    expect(event.lastError).toContain('ERP respondeu 503');
    expect(event.lastError).toMatch(/\n\s+at /); // stack do último erro
    expect(calls).toHaveLength(3);

    // Não há quarta tentativa.
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toHaveLength(3);

    // Job também fica no conjunto `failed` do BullMQ.
    const failed = await h.queue.getFailed();
    expect(failed.map((j) => j.data.eventId)).toEqual([id]);
    expect(failed[0]!.attemptsMade).toBe(3);

    const res = await h.app.inject({ method: 'GET', url: '/eventos?status=dead' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 1, items: [{ id, status: 'dead', attempts: 3 }] });

    const detail = (await h.app.inject({ method: 'GET', url: `/eventos/${id}` })).json();
    expect(detail.attemptHistory).toHaveLength(3);
    expect(detail.attemptHistory.every((a: { success: boolean }) => !a.success)).toBe(true);
  });

  it('erro permanente vai direto para a DLQ na primeira tentativa', async () => {
    h = await createHarness({ maxAttempts: 5 });
    const { processor, calls } = scriptedProcessor({ failTimes: Infinity, error: () => new PermanentProcessingError('ERP respondeu 422') });
    h.startWorker({ processor });

    const { id } = (await h.postWebhook(orderPayload())).json();
    const event = await waitFor(async () => {
      const e = await h.repository.findById(id);
      return e?.status === 'dead' ? e : undefined;
    });
    expect(event.attempts).toBe(1);
    expect(calls).toHaveLength(1);
  });
});
