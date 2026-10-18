import { describe, expect, it, vi } from 'vitest';
import { PermanentProcessingError, type WebhookEvent } from '@hookyard/shared';
import { HttpProcessor, SimulatedFailure, SimulatedProcessor, createProcessor, loadConfig } from '@hookyard/worker';

const event = (payload: unknown = {}): WebhookEvent => ({
  id: 'e1',
  source: 'marketplace',
  eventId: 'evt_1',
  type: 'order.created',
  payload,
  status: 'processing',
  attempts: 1,
  lastError: null,
  receivedAt: new Date(),
  processedAt: null,
});

describe('SimulatedProcessor', () => {
  const sleep = vi.fn(async () => undefined);

  it('falha conforme a taxa configurada (RNG injetável) e aplica latência', async () => {
    const failing = new SimulatedProcessor({ failureRate: 0.5, latencyMs: 100, random: () => 0.1, sleep });
    await expect(failing.process(event(), { attempt: 1 })).rejects.toBeInstanceOf(SimulatedFailure);
    expect(sleep).toHaveBeenCalledWith(100);

    const passing = new SimulatedProcessor({ failureRate: 0.5, latencyMs: 0, random: () => 0.9, sleep });
    await expect(passing.process(event(), { attempt: 1 })).resolves.toBeUndefined();
  });

  it('respeita simulate.failAttempts do payload', async () => {
    const p = new SimulatedProcessor({ failureRate: 1, latencyMs: 0, sleep });
    const e = event({ simulate: { failAttempts: 2 } });
    await expect(p.process(e, { attempt: 1 })).rejects.toThrow(/programada/);
    await expect(p.process(e, { attempt: 2 })).rejects.toThrow(/programada/);
    await expect(p.process(e, { attempt: 3 })).resolves.toBeUndefined();
  });

  it('respeita simulate.alwaysFail e simulate.latencyMs', async () => {
    const p = new SimulatedProcessor({ failureRate: 0, latencyMs: 0, sleep });
    await expect(p.process(event({ simulate: { alwaysFail: true, latencyMs: 7 } }), { attempt: 9 })).rejects.toThrow(/alwaysFail/);
    expect(sleep).toHaveBeenCalledWith(7);
  });

  it('ignora diretiva malformada', async () => {
    const p = new SimulatedProcessor({ failureRate: 0, latencyMs: 0, sleep });
    await expect(p.process(event({ simulate: 'x' }), { attempt: 1 })).resolves.toBeUndefined();
    await expect(p.process(event(null), { attempt: 1 })).resolves.toBeUndefined();
  });

  it('usa sleep real por padrão', async () => {
    const p = new SimulatedProcessor({ failureRate: 0, latencyMs: 1 });
    await expect(p.process(event(), { attempt: 1 })).resolves.toBeUndefined();
  });
});

describe('HttpProcessor', () => {
  const make = (status: number) => {
    const fetch = vi.fn(async () => new Response(null, { status }));
    return { fetch, processor: new HttpProcessor({ url: 'http://erp.local/pedidos', timeoutMs: 1_000, fetch }) };
  };

  it('envia o evento com idempotency-key e aceita 2xx', async () => {
    const { fetch, processor } = make(204);
    await processor.process(event({ a: 1 }), { attempt: 2 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://erp.local/pedidos');
    expect(init.headers).toMatchObject({ 'idempotency-key': 'e1', 'x-hookyard-attempt': '2' });
    expect(JSON.parse(init.body as string)).toMatchObject({ id: 'e1', payload: { a: 1 } });
  });

  it('5xx, 408 e 429 são transitórios', async () => {
    for (const status of [500, 503, 408, 429]) {
      const err = await make(status).processor.process(event(), { attempt: 1 }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(PermanentProcessingError);
    }
  });

  it('demais 4xx são permanentes', async () => {
    await expect(make(422).processor.process(event(), { attempt: 1 })).rejects.toBeInstanceOf(PermanentProcessingError);
  });
});

describe('worker config / createProcessor', () => {
  const base = { DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x' };

  it('aplica padrões e cria o processador simulado', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({ MAX_ATTEMPTS: 5, BACKOFF_BASE_MS: 1_000, BACKOFF_FACTOR: 4, PROCESSOR: 'simulated' });
    expect(createProcessor(config).name).toBe('simulated');
  });

  it('cria o processador HTTP e exige URL', () => {
    expect(() => loadConfig({ ...base, PROCESSOR: 'http' })).toThrow(/PROCESSOR_HTTP_URL/);
    const config = loadConfig({ ...base, PROCESSOR: 'http', PROCESSOR_HTTP_URL: 'http://erp.local' });
    expect(createProcessor(config).name).toBe('http');
  });
});
