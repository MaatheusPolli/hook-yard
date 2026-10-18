import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { EventAttempt, WebhookEvent } from '../domain/event.js';
import { EVENT_STATUSES, type EventStatus } from '../domain/status.js';
import type { Db } from './client.js';
import type { EventAttemptRow, EventRow } from './schema.js';

export interface NewEventInput {
  source: string;
  eventId: string;
  type: string;
  payload: unknown;
}

export interface ListEventsFilter {
  status?: EventStatus;
  source?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface AttemptInput {
  eventId: string;
  attempt: number;
  startedAt: Date;
  finishedAt: Date;
  success: boolean;
  error: string | null;
}

export interface EventStats {
  byStatus: Record<EventStatus, number>;
  total: number;
  latencyMs: { avg: number | null; p95: number | null };
}

/** Evento como é armazenado + momento em que passou a `received` (compõe o jobId). */
export type StoredEvent = WebhookEvent & { updatedAt: Date };

export function toEvent(row: EventRow): StoredEvent {
  return {
    id: row.id,
    source: row.source,
    eventId: row.event_id,
    type: row.type,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
    updatedAt: row.updated_at,
  };
}

function toAttempt(row: EventAttemptRow): EventAttempt {
  return {
    id: row.id,
    eventId: row.event_id,
    attempt: row.attempt,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    success: row.success,
    error: row.error,
  };
}

/**
 * jobId determinístico por "geração" de enfileiramento: o mesmo evento no mesmo
 * estado `received` sempre gera o mesmo id (BullMQ ignora duplicatas), e um
 * reprocessamento gera um id novo porque `updated_at` muda.
 */
export function jobIdFor(event: Pick<StoredEvent, 'id' | 'updatedAt'>): string {
  return `${event.id}-${event.updatedAt.getTime()}`;
}

export class EventRepository {
  constructor(private readonly db: Db) {}

  /**
   * Insere o evento; se `(source, event_id)` já existir, devolve o existente.
   * O índice único torna a operação segura mesmo com requisições concorrentes.
   */
  async insertIfAbsent(input: NewEventInput): Promise<{ event: StoredEvent; created: boolean }> {
    const inserted = await this.db
      .insertInto('event')
      .values({
        id: randomUUID(),
        source: input.source,
        event_id: input.eventId,
        type: input.type,
        payload: JSON.stringify(input.payload),
        status: 'received',
      })
      .onConflict((oc) => oc.columns(['source', 'event_id']).doNothing())
      .returningAll()
      .executeTakeFirst();

    if (inserted) return { event: toEvent(inserted), created: true };

    const existing = await this.db
      .selectFrom('event')
      .selectAll()
      .where('source', '=', input.source)
      .where('event_id', '=', input.eventId)
      .executeTakeFirstOrThrow();
    return { event: toEvent(existing), created: false };
  }

  async findById(id: string): Promise<StoredEvent | undefined> {
    const row = await this.db.selectFrom('event').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? toEvent(row) : undefined;
  }

  async list(filter: ListEventsFilter = {}): Promise<{ items: StoredEvent[]; total: number }> {
    let query = this.db.selectFrom('event');
    if (filter.status) query = query.where('status', '=', filter.status);
    if (filter.source) query = query.where('source', '=', filter.source);
    if (filter.from) query = query.where('received_at', '>=', filter.from);
    if (filter.to) query = query.where('received_at', '<=', filter.to);

    const [rows, count] = await Promise.all([
      query
        .selectAll()
        .orderBy('received_at', 'desc')
        .orderBy('id')
        .limit(filter.limit ?? 50)
        .offset(filter.offset ?? 0)
        .execute(),
      query.select((eb) => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow(),
    ]);
    return { items: rows.map(toEvent), total: Number(count.total) };
  }

  async listAttempts(eventId: string): Promise<EventAttempt[]> {
    const rows = await this.db
      .selectFrom('event_attempt')
      .selectAll()
      .where('event_id', '=', eventId)
      .orderBy('started_at')
      .execute();
    return rows.map(toAttempt);
  }

  /**
   * Transição atômica para `processing`, incrementando `attempts`.
   * Retorna `undefined` se o evento não estiver num estado processável
   * (ex.: já `processed`) — é aqui que a idempotência do worker é garantida.
   */
  async markProcessing(id: string): Promise<StoredEvent | undefined> {
    const row = await this.db
      .updateTable('event')
      .set((eb) => ({
        status: 'processing',
        attempts: eb('attempts', '+', 1),
        updated_at: sql`now()`,
      }))
      .where('id', '=', id)
      .where('status', 'in', ['received', 'processing', 'failed'])
      .returningAll()
      .executeTakeFirst();
    return row ? toEvent(row) : undefined;
  }

  async markProcessed(id: string): Promise<void> {
    await this.db
      .updateTable('event')
      .set({ status: 'processed', processed_at: sql`now()`, updated_at: sql`now()` })
      .where('id', '=', id)
      .execute();
  }

  async markFailed(id: string, error: string, final: boolean): Promise<void> {
    await this.db
      .updateTable('event')
      .set({ status: final ? 'dead' : 'failed', last_error: error, updated_at: sql`now()` })
      .where('id', '=', id)
      .execute();
  }

  async recordAttempt(input: AttemptInput): Promise<void> {
    await this.db
      .insertInto('event_attempt')
      .values({
        event_id: input.eventId,
        attempt: input.attempt,
        started_at: input.startedAt,
        finished_at: input.finishedAt,
        duration_ms: Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime()),
        success: input.success,
        error: input.error,
      })
      .execute();
  }

  /** Devolve um evento da DLQ para `received`. Só age sobre eventos `dead`. */
  async resetForReprocess(id: string): Promise<StoredEvent | undefined> {
    const row = await this.db
      .updateTable('event')
      .set({ status: 'received', updated_at: sql`clock_timestamp()` })
      .where('id', '=', id)
      .where('status', '=', 'dead')
      .returningAll()
      .executeTakeFirst();
    return row ? toEvent(row) : undefined;
  }

  /** Eventos `received` parados há mais de `olderThan` — candidatos a job órfão. */
  async findStaleReceived(olderThan: Date, limit = 100): Promise<StoredEvent[]> {
    const rows = await this.db
      .selectFrom('event')
      .selectAll()
      .where('status', '=', 'received')
      .where('updated_at', '<', olderThan)
      .orderBy('updated_at')
      .limit(limit)
      .execute();
    return rows.map(toEvent);
  }

  async stats(): Promise<EventStats> {
    const [counts, latency] = await Promise.all([
      this.db
        .selectFrom('event')
        .select(['status', (eb) => eb.fn.countAll<number>().as('count')])
        .groupBy('status')
        .execute(),
      this.db
        .selectFrom('event')
        .select([
          sql<number | null>`avg(extract(epoch from processed_at - received_at) * 1000)`.as('avg'),
          sql<number | null>`percentile_cont(0.95) within group (order by extract(epoch from processed_at - received_at) * 1000)`.as(
            'p95',
          ),
        ])
        .where('status', '=', 'processed')
        .where('processed_at', '>', sql<Date>`now() - interval '1 hour'`)
        .executeTakeFirstOrThrow(),
    ]);

    const byStatus = Object.fromEntries(EVENT_STATUSES.map((s) => [s, 0])) as Record<EventStatus, number>;
    for (const row of counts) byStatus[row.status] = Number(row.count);
    const round = (v: number | string | null) => (v === null ? null : Math.round(Number(v)));
    return {
      byStatus,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      latencyMs: { avg: round(latency.avg), p95: round(latency.p95) },
    };
  }
}
