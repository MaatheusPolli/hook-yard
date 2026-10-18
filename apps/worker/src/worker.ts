import { UnrecoverableError, Worker, type ConnectionOptions } from 'bullmq';
import {
  EVENT_QUEUE_NAME,
  computeDelay,
  type BackoffOptions,
  type EventJobData,
  type Logger,
} from '@hookyard/shared';
import type { EventHandler } from './handlers/event.handler.js';

export interface EventWorkerOptions {
  connection: ConnectionOptions;
  prefix?: string;
  handler: EventHandler;
  logger: Logger;
  maxAttempts: number;
  concurrency: number;
  backoff: Partial<BackoffOptions>;
  random?: () => number;
}

/** Adaptador BullMQ → handler: `retry` vira exceção (com backoff), `dead` vira falha final. */
export function createEventWorker(options: EventWorkerOptions): Worker<EventJobData> {
  const worker = new Worker<EventJobData>(
    EVENT_QUEUE_NAME,
    async (job) => {
      const result = await options.handler({
        id: job.data.eventId,
        jobAttempt: job.attemptsMade + 1,
        maxAttempts: options.maxAttempts,
      });
      if (result.outcome === 'retry') throw result.error;
      if (result.outcome === 'dead') {
        // Não tenta de novo, mas mantém o job no conjunto `failed` do BullMQ.
        throw new UnrecoverableError(result.error instanceof Error ? result.error.message : String(result.error));
      }
      return undefined;
    },
    {
      connection: options.connection,
      prefix: options.prefix,
      concurrency: options.concurrency,
      settings: {
        backoffStrategy: (attemptsMade: number) => computeDelay(attemptsMade, options.backoff, options.random),
      },
    },
  );
  // Evita "Unhandled error event" do EventEmitter; erros de conexão são logados.
  worker.on('error', (err) => options.logger.error({ err }, 'erro no worker'));
  return worker;
}
