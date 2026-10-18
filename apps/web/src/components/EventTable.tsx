import { Link } from 'react-router-dom';
import type { EventSummary } from '../api';
import { formatDate } from '../format';
import { StatusBadge } from './StatusBadge';

export function EventTable({ events }: { events: EventSummary[] }) {
  if (events.length === 0) return <p className="empty">Nenhum evento encontrado com esses filtros.</p>;
  return (
    <div className="table-wrap">
      <table className="events">
        <thead>
          <tr>
            <th>Status</th>
            <th>Source</th>
            <th>Event ID</th>
            <th>Tipo</th>
            <th className="num">Tentativas</th>
            <th>Recebido</th>
            <th>Processado</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>
                <StatusBadge status={e.status} />
              </td>
              <td>{e.source}</td>
              <td className="mono">
                <Link to={`/eventos/${e.id}`}>{e.eventId}</Link>
              </td>
              <td className="mono">{e.type}</td>
              <td className="num">{e.attempts}</td>
              <td>{formatDate(e.receivedAt)}</td>
              <td>{formatDate(e.processedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
