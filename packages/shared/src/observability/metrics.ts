import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export interface Metrics {
  registry: Registry;
  received: Counter<'source' | 'outcome'>;
  receiveDuration: Histogram<'source'>;
  processed: Counter<'source'>;
  failed: Counter<'source'>;
  dead: Counter<'source'>;
  processingDuration: Histogram<'source' | 'outcome'>;
  endToEndLatency: Histogram<'source'>;
  queueSize: Gauge<'state'>;
  eventsByStatus: Gauge<'status'>;
}

/** Cria um registry isolado (um por processo, e um por teste). */
export function createMetrics(options: { defaultMetrics?: boolean; prefix?: string } = {}): Metrics {
  const registry = new Registry();
  const prefix = options.prefix ?? 'hookyard_';
  if (options.defaultMetrics) collectDefaultMetrics({ register: registry, prefix });

  return {
    registry,
    received: new Counter({
      name: `${prefix}webhooks_received_total`,
      help: 'Webhooks recebidos, por source e resultado (accepted, duplicate, rejected)',
      labelNames: ['source', 'outcome'],
      registers: [registry],
    }),
    receiveDuration: new Histogram({
      name: `${prefix}webhook_receive_duration_seconds`,
      help: 'Tempo para persistir e enfileirar um webhook',
      labelNames: ['source'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
      registers: [registry],
    }),
    processed: new Counter({
      name: `${prefix}events_processed_total`,
      help: 'Eventos processados com sucesso',
      labelNames: ['source'],
      registers: [registry],
    }),
    failed: new Counter({
      name: `${prefix}event_attempts_failed_total`,
      help: 'Tentativas de processamento que falharam',
      labelNames: ['source'],
      registers: [registry],
    }),
    dead: new Counter({
      name: `${prefix}events_dead_total`,
      help: 'Eventos movidos para a DLQ',
      labelNames: ['source'],
      registers: [registry],
    }),
    processingDuration: new Histogram({
      name: `${prefix}event_processing_duration_seconds`,
      help: 'Duração de cada tentativa de processamento',
      labelNames: ['source', 'outcome'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    }),
    endToEndLatency: new Histogram({
      name: `${prefix}event_end_to_end_latency_seconds`,
      help: 'Do recebimento ao processamento bem-sucedido',
      labelNames: ['source'],
      buckets: [0.05, 0.1, 0.5, 1, 5, 15, 60, 300, 1200],
      registers: [registry],
    }),
    queueSize: new Gauge({
      name: `${prefix}queue_jobs`,
      help: 'Jobs na fila por estado',
      labelNames: ['state'],
      registers: [registry],
    }),
    eventsByStatus: new Gauge({
      name: `${prefix}events`,
      help: 'Eventos persistidos por status',
      labelNames: ['status'],
      registers: [registry],
    }),
  };
}
