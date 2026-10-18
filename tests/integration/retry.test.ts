import { afterEach, describe, expect, it } from 'vitest';
import { computeDelay } from '@hookyard/shared';
import { createHarness, orderPayload, scriptedProcessor, waitFor, type Harness } from '../helpers/harness.js';

describe('retry com backoff exponencial', () => {
  let h: Harness;
  afterEach(async () => {
    await h.close();
  });

  it('processador falha 2x e sucede na 3ª, respeitando os delays do backoff', async () => {
    h = await createHarness({ maxAttempts: 5 });
    const backoff = { baseMs: 150, factor: 2, jitter: 0 };
    const { processor, calls } = scriptedProcessor({ failTimes: 2 });
    h.startWorker({ processor, backoff });

    const { id } = (await h.postWebhook(orderPayload())).json();
    const event = await waitFor(async () => {
      const e = await h.repository.findById(id);
      return e?.status === 'processed' ? e : undefined;
    });

    expect(event.attempts).toBe(3);
    expect(event.lastError).toContain('falha programada na tentativa 2');
    expect(event.processedAt).toBeInstanceOf(Date);
    expect(calls.map((c) => c.attempt)).toEqual([1, 2, 3]);

    // Intervalo entre tentativas ≥ delay calculado (150ms, 300ms).
    const gaps = [calls[1]!.at - calls[0]!.at, calls[2]!.at - calls[1]!.at];
    expect(gaps[0]).toBeGreaterThanOrEqual(computeDelay(1, backoff) - 10);
    expect(gaps[1]).toBeGreaterThanOrEqual(computeDelay(2, backoff) - 10);
    expect(gaps[1]).toBeGreaterThan(gaps[0]!);

    const history = await h.repository.listAttempts(id);
    expect(history.map((a) => [a.attempt, a.success])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    expect(history[0]!.error).toContain('falha programada');
    expect(history.every((a) => a.durationMs >= 0)).toBe(true);
  });

  it('usa o jitter injetado no cálculo do delay', async () => {
    h = await createHarness({ maxAttempts: 2 });
    const { processor, calls } = scriptedProcessor({ failTimes: 1 });
    // random() = 0.999 → +jitter máximo: 100ms * 1.5 ≈ 150ms
    h.startWorker({ processor, backoff: { baseMs: 100, factor: 2, jitter: 0.5 }, random: () => 0.999 });

    const { id } = (await h.postWebhook(orderPayload())).json();
    await waitFor(async () => (await h.repository.findById(id))?.status === 'processed');
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(140);
  });

  it('eventos independentes são processados em paralelo com concorrência > 1', async () => {
    h = await createHarness();
    const { processor, calls } = scriptedProcessor({ delayMs: 200 });
    h.startWorker({ processor, concurrency: 5 });

    const started = Date.now();
    const ids = await Promise.all(Array.from({ length: 5 }, async () => (await h.postWebhook(orderPayload())).json().id as string));
    await waitFor(async () => (await h.repository.list({ status: 'processed' })).total === 5);
    expect(calls).toHaveLength(5);
    expect(new Set(calls.map((c) => c.eventId))).toEqual(new Set(ids));
    expect(Date.now() - started).toBeLessThan(900);
  });
});
