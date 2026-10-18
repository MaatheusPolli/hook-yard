import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';
import type { EventStatus } from '../domain/status.js';

export interface EventTable {
  id: string;
  source: string;
  event_id: string;
  type: string;
  payload: ColumnType<unknown, string, string>;
  status: EventStatus;
  attempts: Generated<number>;
  last_error: string | null;
  received_at: ColumnType<Date, Date | string | undefined, Date | string>;
  processed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface EventAttemptTable {
  id: Generated<string>;
  event_id: string;
  attempt: number;
  started_at: ColumnType<Date, Date | string, never>;
  finished_at: ColumnType<Date, Date | string, never>;
  duration_ms: number;
  success: boolean;
  error: string | null;
}

export interface Database {
  event: EventTable;
  event_attempt: EventAttemptTable;
}

export type EventRow = Selectable<EventTable>;
export type NewEventRow = Insertable<EventTable>;
export type EventAttemptRow = Selectable<EventAttemptTable>;
