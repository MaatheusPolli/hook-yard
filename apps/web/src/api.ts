export type EventStatus = 'received' | 'processing' | 'processed' | 'failed' | 'dead';
export const STATUSES: EventStatus[] = ['received', 'processing', 'processed', 'failed', 'dead'];

export interface EventSummary {
  id: string;
  source: string;
  eventId: string;
  type: string;
  payload: unknown;
  status: EventStatus;
  attempts: number;
  lastError: string | null;
  receivedAt: string;
  processedAt: string | null;
  updatedAt: string;
}

export interface Attempt {
  id: string;
  attempt: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  success: boolean;
  error: string | null;
}

export interface EventDetail extends EventSummary {
  attemptHistory: Attempt[];
}

export interface EventList {
  items: EventSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface Summary {
  events: {
    byStatus: Record<EventStatus, number>;
    total: number;
    latencyMs: { avg: number | null; p95: number | null };
  };
  queue: Record<string, number>;
}

export interface EventFilters {
  status?: string;
  source?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : undefined;
  if (!res.ok) throw new Error(body?.message ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  listEvents(filters: EventFilters) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === '') continue;
      // datetime-local → ISO com fuso do navegador
      params.set(key, key === 'from' || key === 'to' ? new Date(String(value)).toISOString() : String(value));
    }
    return request<EventList>(`/eventos?${params}`);
  },
  getEvent: (id: string) => request<EventDetail>(`/eventos/${id}`),
  reprocess: (id: string) => request<EventSummary>(`/eventos/${id}/reprocessar`, { method: 'POST' }),
  summary: () => request<Summary>('/metrics/summary'),
};
