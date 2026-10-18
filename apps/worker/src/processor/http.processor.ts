import { PermanentProcessingError, type WebhookEvent } from '@hookyard/shared';
import type { EventProcessor, ProcessingContext } from './types.js';

export interface HttpProcessorOptions {
  url: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

/** Entrega o evento a um endpoint HTTP (ex.: ERP). 5xx/timeout → retry; 4xx → DLQ direto. */
export class HttpProcessor implements EventProcessor {
  readonly name = 'http';
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpProcessorOptions) {
    this.fetchFn = options.fetch ?? fetch;
  }

  async process(event: WebhookEvent, { attempt }: ProcessingContext): Promise<void> {
    const response = await this.fetchFn(this.options.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': event.id,
        'x-hookyard-attempt': String(attempt),
      },
      body: JSON.stringify({ id: event.id, source: event.source, eventId: event.eventId, type: event.type, payload: event.payload }),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });

    if (response.ok) return;
    const detail = `${this.options.url} respondeu ${response.status}`;
    // 408 e 429 são transitórios apesar de serem 4xx.
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
      throw new PermanentProcessingError(detail);
    }
    throw new Error(detail);
  }
}
