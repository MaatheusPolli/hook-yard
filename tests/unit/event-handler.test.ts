import { describe, expect, it, vi } from 'vitest';
import { PermanentProcessingError, createLogger, createMetrics, type EventRepository, type StoredEvent } from '@hookyard/shared';
import { createEventHandler, type EventProcessor } from '@hookyard/worker';

function fakeRepository(initial: Partial<StoredEvent> = {}) {
  const event: StoredEvent = {
    id: 'e1',
    source: 'marketplace',
    eventId: 'evt_1',
    type: 'order.created',
    payload: {},
    status: 'received',
    attempts: 0,
    lastError: null,
    receivedAt: new Date(0),
    processedAt: null,
    updatedAt: new Date(0),
    ...initial,
  };
  const attempts: unknown[] = [];
  const repo = {
    findById: vi.fn(async () => (event.id ? { ...event } : undefined)),
    markProcessing: vi.fn(async () => {
      if (!['received', 'processing', 'failed'].includes(event.status)) return undefined;
      event.status = 'processing';
      event.attempts += 1;
      return { ...event };
    }),
    markProcessed: vi.fn(async () => {
      event.status = 'processed';
    }),
    markFailed: vi.fn(async (_id: string, error: string, final: boolean) => {
      event.status = final ? 'dead' : 'failed';
      event.lastError = error;
    }),
    recordAttempt: vi.fn(async (a: unknown) => {
      attempts.push(a);
    }),
  };
  return { repo: repo as unknown as EventRepository, raw: repo, event, attempts };
}

const logger = createLogger('test', { level: 'silent' });
const ok: EventProcessor = { name: 'ok', process: async () => undefined };
const boom = (err: Error = new Error('ERP fora')): EventProcessor => ({
  name: 'boom',
  process: async () => {
    throw err;
  },
});

describe('createEventHandler', () => {
  it('processa com sucesso e registra a tentativa', async () => {
    const { repo, event, attempts } = fakeRepository();
    const metrics = createMetrics();
    const handle = createEventHandler({ repository: repo, processor: ok, metrics, logger });

    await expect(handle({ id: 'e1', jobAttempt: 1, maxAttempts: 3 })).resolves.toEqual({ outcome: 'processed' });
    expect(event.status).toBe('processed');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ attempt: 1, success: true, error: null });
    expect((await metrics.processed.get()).values[0]?.value).toBe(1);
  });

  it.each(['processed', 'dead'] as const)('ignora evento já %s (idempotência) sem chamar o processador', async (status) => {
    const { repo, raw } = fakeRepository({ status });
    const processor = { name: 'spy', process: vi.fn(async () => undefined) };
    const handle = createEventHandler({ repository: repo, processor, metrics: createMetrics(), logger });

    const result = await handle({ id: 'e1', jobAttempt: 1, maxAttempts: 3 });
    expect(result).toEqual({ outcome: 'skipped', reason: `status=${status}` });
    expect(processor.process).not.toHaveBeenCalled();
    expect(raw.markProcessing).not.toHaveBeenCalled();
  });

  it('ignora evento inexistente', async () => {
    const { repo } = fakeRepository({ id: '' });
    const handle = createEventHandler({ repository: repo, processor: ok, metrics: createMetrics(), logger });
    await expect(handle({ id: 'x', jobAttempt: 1, maxAttempts: 3 })).resolves.toMatchObject({ outcome: 'skipped', reason: 'inexistente' });
  });

  it('ignora quando outro consumidor mudou o status entre a leitura e a transição', async () => {
    const { repo, raw } = fakeRepository();
    raw.markProcessing.mockResolvedValueOnce(undefined);
    const handle = createEventHandler({ repository: repo, processor: ok, metrics: createMetrics(), logger });
    await expect(handle({ id: 'e1', jobAttempt: 1, maxAttempts: 3 })).resolves.toMatchObject({ outcome: 'skipped' });
  });

  it('pede retry enquanto houver tentativas e guarda stack do erro', async () => {
    const { repo, event, attempts } = fakeRepository();
    const handle = createEventHandler({ repository: repo, processor: boom(), metrics: createMetrics(), logger });

    const result = await handle({ id: 'e1', jobAttempt: 1, maxAttempts: 3 });
    expect(result.outcome).toBe('retry');
    expect(event.status).toBe('failed');
    expect(event.lastError).toContain('ERP fora');
    expect(event.lastError).toContain('at '); // stack trace
    expect(attempts[0]).toMatchObject({ success: false });
  });

  it('move para dead na última tentativa', async () => {
    const { repo, event } = fakeRepository({ status: 'failed', attempts: 2 });
    const metrics = createMetrics();
    const handle = createEventHandler({ repository: repo, processor: boom(), metrics, logger });

    await expect(handle({ id: 'e1', jobAttempt: 3, maxAttempts: 3 })).resolves.toMatchObject({ outcome: 'dead' });
    expect(event.status).toBe('dead');
    expect(event.attempts).toBe(3);
    expect((await metrics.dead.get()).values[0]?.value).toBe(1);
  });

  it('erro permanente vai direto para a DLQ', async () => {
    const { repo, event } = fakeRepository();
    const handle = createEventHandler({ repository: repo, processor: boom(new PermanentProcessingError('422')), metrics: createMetrics(), logger });
    await expect(handle({ id: 'e1', jobAttempt: 1, maxAttempts: 5 })).resolves.toMatchObject({ outcome: 'dead' });
    expect(event.status).toBe('dead');
  });

  it('passa o número acumulado de tentativas ao processador', async () => {
    const { repo } = fakeRepository({ status: 'received', attempts: 5 });
    const processor = { name: 'spy', process: vi.fn(async () => undefined) };
    const handle = createEventHandler({ repository: repo, processor, metrics: createMetrics(), logger });
    await handle({ id: 'e1', jobAttempt: 1, maxAttempts: 5 });
    expect(processor.process).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), { attempt: 6 });
  });
});
