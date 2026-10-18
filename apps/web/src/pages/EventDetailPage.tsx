import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { AttemptTimeline } from '../components/AttemptTimeline';
import { PayloadViewer } from '../components/PayloadViewer';
import { StatusBadge } from '../components/StatusBadge';
import { formatDate, formatMs } from '../format';

export function EventDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { data: event, isLoading, error } = useQuery({ queryKey: ['event', id], queryFn: () => api.getEvent(id) });

  const reprocess = useMutation({
    mutationFn: () => api.reprocess(id),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  if (isLoading) return <p className="muted">Carregando…</p>;
  if (error || !event) return <p className="error">Evento não encontrado. <Link to="/">Voltar</Link></p>;

  const latency = event.processedAt ? new Date(event.processedAt).getTime() - new Date(event.receivedAt).getTime() : null;

  return (
    <>
      <Link to="/" className="back">
        ← Eventos
      </Link>
      <section className="panel">
        <div className="detail-head">
          <div>
            <h1 className="mono">{event.eventId}</h1>
            <p className="muted">
              {event.source} · <span className="mono">{event.type}</span> · id interno <span className="mono">{event.id}</span>
            </p>
          </div>
          <div className="detail-actions">
            <StatusBadge status={event.status} />
            {event.status === 'dead' && (
              <button className="btn btn-primary" disabled={reprocess.isPending} onClick={() => reprocess.mutate()}>
                {reprocess.isPending ? 'Reenfileirando…' : 'Reprocessar'}
              </button>
            )}
          </div>
        </div>
        {reprocess.error && <p className="error">{(reprocess.error as Error).message}</p>}

        <dl className="facts">
          <div>
            <dt>Recebido</dt>
            <dd>{formatDate(event.receivedAt)}</dd>
          </div>
          <div>
            <dt>Processado</dt>
            <dd>{formatDate(event.processedAt)}</dd>
          </div>
          <div>
            <dt>Latência total</dt>
            <dd>{formatMs(latency)}</dd>
          </div>
          <div>
            <dt>Tentativas</dt>
            <dd>{event.attempts}</dd>
          </div>
        </dl>

        {event.lastError && event.status !== 'processed' && (
          <div className="last-error">
            <h2>Último erro</h2>
            <pre className="stack">{event.lastError}</pre>
          </div>
        )}
      </section>

      <div className="detail-grid">
        <section className="panel">
          <h2>Histórico de tentativas</h2>
          <AttemptTimeline attempts={event.attemptHistory} />
        </section>
        <section className="panel">
          <h2>Payload</h2>
          <PayloadViewer payload={event.payload} />
        </section>
      </div>
    </>
  );
}
