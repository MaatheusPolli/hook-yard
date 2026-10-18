import type { Attempt } from '../api';
import { formatDate, formatMs } from '../format';

export function AttemptTimeline({ attempts }: { attempts: Attempt[] }) {
  if (attempts.length === 0) return <p className="muted">Nenhuma tentativa ainda.</p>;
  return (
    <ol className="timeline">
      {attempts.map((a, i) => {
        const previous = attempts[i - 1];
        const waited = previous ? new Date(a.startedAt).getTime() - new Date(previous.finishedAt).getTime() : null;
        return (
          <li key={a.id} className={a.success ? 'ok' : 'fail'}>
            <div className="timeline-head">
              <strong>Tentativa {a.attempt}</strong>
              <span className={a.success ? 'text-ok' : 'text-fail'}>{a.success ? 'sucesso' : 'falha'}</span>
              <span className="muted">
                {formatDate(a.startedAt)} · duração {formatMs(a.durationMs)}
                {waited !== null && <> · backoff {formatMs(waited)}</>}
              </span>
            </div>
            {a.error && (
              <details>
                <summary>{a.error.split('\n')[0]}</summary>
                <pre className="stack">{a.error}</pre>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}
