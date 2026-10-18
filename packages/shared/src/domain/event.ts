import type { EventStatus } from './status.js';

export interface WebhookEvent {
  id: string;
  source: string;
  eventId: string;
  type: string;
  payload: unknown;
  status: EventStatus;
  attempts: number;
  lastError: string | null;
  receivedAt: Date;
  processedAt: Date | null;
}

export interface EventAttempt {
  id: string;
  eventId: string;
  attempt: number;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  success: boolean;
  error: string | null;
}

/** Job enfileirado: carrega apenas a referência, nunca o payload. */
export interface EventJobData {
  eventId: string;
}

export type IdempotencyDecision = 'process' | 'skip';

/**
 * Decide se um job deve ser processado a partir do status persistido.
 * O banco é a fonte da verdade: um evento já `processed` nunca roda de novo,
 * mesmo que o job seja entregue mais de uma vez (at-least-once).
 */
export function decideIdempotency(status: EventStatus | undefined): IdempotencyDecision {
  if (status === undefined) return 'skip';
  if (status === 'processed' || status === 'dead') return 'skip';
  return 'process';
}
