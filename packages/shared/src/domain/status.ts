export const EVENT_STATUSES = ['received', 'processing', 'processed', 'failed', 'dead'] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export function isEventStatus(value: unknown): value is EventStatus {
  return typeof value === 'string' && (EVENT_STATUSES as readonly string[]).includes(value);
}

/** Estados a partir dos quais o evento ainda pode ser (re)processado pelo worker. */
export const PROCESSABLE_STATUSES: readonly EventStatus[] = ['received', 'processing', 'failed'];
