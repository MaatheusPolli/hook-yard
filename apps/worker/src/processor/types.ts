import type { WebhookEvent } from '@hookyard/shared';

export interface ProcessingContext {
  /** Número acumulado da tentativa deste evento (1-based; continua contando após reprocessar). */
  attempt: number;
}

/**
 * Strategy: o worker não sabe se está falando com um ERP real ou com um simulador.
 * Implementações devem ser idempotentes do lado do destino sempre que possível
 * (o `event.id` é estável entre tentativas e serve como idempotency key).
 */
export interface EventProcessor {
  readonly name: string;
  process(event: WebhookEvent, context: ProcessingContext): Promise<void>;
}
