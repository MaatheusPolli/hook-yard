import {
  PermanentProcessingError,
  decideIdempotency,
  serializeError,
  type EventRepository,
  type Logger,
  type Metrics,
} from '@hookyard/shared';
import type { EventProcessor } from '../processor/types.js';

export type HandleOutcome =
  | { outcome: 'processed' }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'retry'; error: unknown }
  | { outcome: 'dead'; error: unknown };

export interface HandlerDeps {
  repository: EventRepository;
  processor: EventProcessor;
  metrics: Metrics;
  logger: Logger;
  now?: () => Date;
}

export interface HandleInput {
  /** id interno (UUID) do evento. */
  id: string;
  /** Tentativa atual do job (1-based). */
  jobAttempt: number;
  maxAttempts: number;
}

/**
 * Processa um evento. Independente do BullMQ: devolve a decisão e deixa o
 * adaptador da fila traduzir `retry` em exceção (backoff) e `dead` em falha final.
 */
export function createEventHandler(deps: HandlerDeps) {
  const now = deps.now ?? (() => new Date());

  return async function handle({ id, jobAttempt, maxAttempts }: HandleInput): Promise<HandleOutcome> {
    const current = await deps.repository.findById(id);
    if (decideIdempotency(current?.status) === 'skip') {
      deps.logger.info({ id, status: current?.status }, 'evento ignorado (idempotência)');
      return { outcome: 'skipped', reason: current ? `status=${current.status}` : 'inexistente' };
    }

    // Transição atômica no banco: protege contra corrida entre duas entregas do mesmo job.
    const event = await deps.repository.markProcessing(id);
    if (!event) return { outcome: 'skipped', reason: 'status mudou concorrentemente' };

    const log = deps.logger.child({ eventId: event.eventId, type: event.type, source: event.source, attempt: event.attempts });
    const startedAt = now();
    const timer = deps.metrics.processingDuration.startTimer({ source: event.source });

    try {
      await deps.processor.process(event, { attempt: event.attempts });
      const finishedAt = now();
      await deps.repository.recordAttempt({ eventId: id, attempt: event.attempts, startedAt, finishedAt, success: true, error: null });
      await deps.repository.markProcessed(id);
      timer({ outcome: 'success' });
      deps.metrics.processed.inc({ source: event.source });
      deps.metrics.endToEndLatency.observe({ source: event.source }, (finishedAt.getTime() - event.receivedAt.getTime()) / 1000);
      log.info('evento processado');
      return { outcome: 'processed' };
    } catch (error) {
      const finishedAt = now();
      const serialized = serializeError(error);
      const final = jobAttempt >= maxAttempts || error instanceof PermanentProcessingError;
      await deps.repository.recordAttempt({ eventId: id, attempt: event.attempts, startedAt, finishedAt, success: false, error: serialized });
      await deps.repository.markFailed(id, serialized, final);
      timer({ outcome: 'failure' });
      deps.metrics.failed.inc({ source: event.source });

      if (final) {
        deps.metrics.dead.inc({ source: event.source });
        log.error({ err: error, jobAttempt, maxAttempts }, 'evento movido para a DLQ');
        return { outcome: 'dead', error };
      }
      log.warn({ err: error, jobAttempt, maxAttempts }, 'falha no processamento; nova tentativa agendada');
      return { outcome: 'retry', error };
    }
  };
}

export type EventHandler = ReturnType<typeof createEventHandler>;
