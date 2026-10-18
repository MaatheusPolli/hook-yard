import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { inject } from 'vitest';
import type { Worker } from 'bullmq';
import { buildApp, createContainer, sign, SIGNATURE_HEADER, type ApiConfig, type ApiContainer } from '@hookyard/api';
import { createEventHandler, createEventWorker, type EventProcessor } from '@hookyard/worker';
import { createLogger, createMetrics, redisConnection, type BackoffOptions, type Metrics } from '@hookyard/shared';

export const SOURCE = 'marketplace';
export const SECRET = 'segredo-de-teste';

export const silentLogger = createLogger('test', { level: 'silent' });

export interface HarnessOptions {
  maxAttempts?: number;
}

export interface WorkerOptions {
  processor: EventProcessor;
  backoff?: Partial<BackoffOptions>;
  concurrency?: number;
  random?: () => number;
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;

export async function createHarness(options: HarnessOptions = {}) {
  const config: ApiConfig = {
    port: 0,
    host: '127.0.0.1',
    databaseUrl: inject('databaseUrl'),
    redisUrl: inject('redisUrl'),
    maxAttempts: options.maxAttempts ?? 3,
    // Prefixo exclusivo: cada harness tem sua própria fila no Redis compartilhado.
    queuePrefix: `test-${randomUUID()}`,
    bodyLimit: 1024 * 1024,
    webhookSecrets: { [SOURCE]: SECRET },
  };
  const metrics = createMetrics();
  const container: ApiContainer = createContainer(config, { logger: silentLogger, metrics });
  const app = buildApp(container);
  await app.ready();
  await sql`truncate table event cascade`.execute(container.db);

  const workers: Worker[] = [];

  function startWorker(opts: WorkerOptions, workerMetrics: Metrics = metrics) {
    const worker = createEventWorker({
      connection: redisConnection(config.redisUrl),
      prefix: config.queuePrefix,
      handler: createEventHandler({ repository: container.repository, processor: opts.processor, metrics: workerMetrics, logger: silentLogger }),
      logger: silentLogger,
      maxAttempts: config.maxAttempts,
      concurrency: opts.concurrency ?? 1,
      backoff: opts.backoff ?? { baseMs: 20, factor: 2, jitter: 0 },
      random: opts.random,
    });
    workers.push(worker);
    return worker;
  }

  async function postWebhook(body: unknown, init: { source?: string; secret?: string; signature?: string | null } = {}) {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (init.signature !== null) headers[SIGNATURE_HEADER] = init.signature ?? sign(payload, init.secret ?? SECRET);
    return app.inject({ method: 'POST', url: `/webhooks/${init.source ?? SOURCE}`, headers, payload });
  }

  async function close() {
    await Promise.all(workers.map((w) => w.close()));
    await app.close();
    await container.queue.obliterate({ force: true }).catch(() => undefined);
    await container.close();
  }

  return { app, config, container, repository: container.repository, queue: container.queue, metrics, startWorker, postWebhook, close };
}

/** Espera até `predicate` retornar valor truthy (polling), ou falha após `timeoutMs`. */
export async function waitFor<T>(predicate: () => Promise<T | undefined | null | false>, timeoutMs = 10_000, intervalMs = 25): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor: condição não satisfeita em ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Processador de teste: falha nas `failTimes` primeiras chamadas, registra cada chamada. */
export function scriptedProcessor(behavior: { failTimes?: number; delayMs?: number; error?: () => Error } = {}) {
  const calls: Array<{ eventId: string; attempt: number; at: number }> = [];
  const processor: EventProcessor = {
    name: 'scripted',
    async process(event, { attempt }) {
      calls.push({ eventId: event.id, attempt, at: Date.now() });
      if (behavior.delayMs) await new Promise((r) => setTimeout(r, behavior.delayMs));
      if (calls.filter((c) => c.eventId === event.id).length <= (behavior.failTimes ?? 0)) {
        throw behavior.error?.() ?? new Error(`falha programada na tentativa ${attempt}`);
      }
    },
  };
  return { processor, calls };
}

export function orderPayload(id: string = randomUUID(), extra: Record<string, unknown> = {}) {
  return { id, type: 'order.created', data: { orderId: id, total: 199.9 }, ...extra };
}
