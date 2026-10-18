import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { formatMs } from '../format';

export function SummaryCards() {
  const { data } = useQuery({ queryKey: ['summary'], queryFn: api.summary });
  const s = data?.events.byStatus;
  const q = data?.queue;
  const cards = [
    { label: 'Recebidos', value: data?.events.total },
    { label: 'Processados', value: s?.processed, tone: 'ok' },
    { label: 'Aguardando retry', value: s?.failed, tone: 'warn' },
    { label: 'DLQ', value: s?.dead, tone: 'fail' },
    { label: 'Na fila', value: q ? (q.waiting ?? 0) + (q.delayed ?? 0) + (q.active ?? 0) : undefined, hint: q ? `${q.active ?? 0} ativos · ${q.delayed ?? 0} em backoff` : undefined },
    { label: 'Latência p95 (1h)', value: data ? formatMs(data.events.latencyMs.p95) : undefined, hint: data ? `média ${formatMs(data.events.latencyMs.avg)}` : undefined },
  ];
  return (
    <section className="cards">
      {cards.map((c) => (
        <div key={c.label} className={`card ${c.tone ? `card-${c.tone}` : ''}`}>
          <span className="card-label">{c.label}</span>
          <span className="card-value">{c.value ?? '—'}</span>
          {c.hint && <span className="card-hint">{c.hint}</span>}
        </div>
      ))}
    </section>
  );
}
