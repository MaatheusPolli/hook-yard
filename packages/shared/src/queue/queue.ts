import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import type { EventJobData } from '../domain/event.js';

export const EVENT_QUEUE_NAME = 'events';
/** Nome da estratégia registrada no Worker (settings.backoffStrategy). */
export const BACKOFF_STRATEGY = 'hookyard-exponential-jitter';

export type EventQueue = Queue<EventJobData, void, 'process-event'>;

export function redisConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined,
    // Exigido pelo BullMQ para workers com comandos bloqueantes.
    maxRetriesPerRequest: null,
  };
}

export function createEventQueue(connection: ConnectionOptions, prefix?: string): EventQueue {
  return new Queue<EventJobData, void, 'process-event'>(EVENT_QUEUE_NAME, { connection, prefix });
}

export function jobOptions(maxAttempts: number): JobsOptions {
  return {
    attempts: maxAttempts,
    backoff: { type: BACKOFF_STRATEGY },
    removeOnComplete: { count: 1_000 },
    removeOnFail: { count: 5_000 },
  };
}

/**
 * Enfileira o processamento de um evento. O jobId padrão é o próprio id do evento,
 * então enfileirar duas vezes o mesmo evento (ex.: reconciliador) não duplica o job.
 */
export async function enqueueEvent(
  queue: EventQueue,
  eventId: string,
  maxAttempts: number,
  jobId: string = eventId,
): Promise<void> {
  await queue.add('process-event', { eventId }, { ...jobOptions(maxAttempts), jobId });
}
