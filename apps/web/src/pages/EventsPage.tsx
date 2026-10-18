import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { STATUSES, api } from '../api';
import { EventTable } from '../components/EventTable';
import { SummaryCards } from '../components/SummaryCards';
import { STATUS_LABEL } from '../format';

const PAGE_SIZE = 25;

export function EventsPage() {
  // Filtros na URL: dá para compartilhar o link de "todos os dead da shopee".
  const [params, setParams] = useSearchParams();
  const filters = {
    status: params.get('status') ?? '',
    source: params.get('source') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  };
  const offset = Number(params.get('offset') ?? 0);

  const { data, isLoading, error } = useQuery({
    queryKey: ['events', filters, offset],
    queryFn: () => api.listEvents({ ...filters, limit: PAGE_SIZE, offset }),
    placeholderData: keepPreviousData,
  });

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('offset');
    setParams(next);
  }

  function goTo(newOffset: number) {
    const next = new URLSearchParams(params);
    next.set('offset', String(newOffset));
    setParams(next);
  }

  return (
    <>
      <SummaryCards />
      <section className="panel">
        <form className="filters" onSubmit={(e) => e.preventDefault()}>
          <label>
            Status
            <select value={filters.status} onChange={(e) => update('status', e.target.value)}>
              <option value="">Todos</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Source
            <input value={filters.source} placeholder="ex.: mercadolivre" onChange={(e) => update('source', e.target.value.trim())} />
          </label>
          <label>
            De
            <input type="datetime-local" value={filters.from} onChange={(e) => update('from', e.target.value)} />
          </label>
          <label>
            Até
            <input type="datetime-local" value={filters.to} onChange={(e) => update('to', e.target.value)} />
          </label>
          {params.size > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => setParams({})}>
              Limpar filtros
            </button>
          )}
        </form>

        {error && <p className="error">Erro ao carregar eventos: {(error as Error).message}</p>}
        {isLoading ? <p className="muted">Carregando…</p> : data && <EventTable events={data.items} />}

        {data && data.total > PAGE_SIZE && (
          <nav className="pager">
            <button className="btn btn-ghost" disabled={offset === 0} onClick={() => goTo(Math.max(0, offset - PAGE_SIZE))}>
              ← Anterior
            </button>
            <span className="muted">
              {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} de {data.total}
            </span>
            <button className="btn btn-ghost" disabled={offset + PAGE_SIZE >= data.total} onClick={() => goTo(offset + PAGE_SIZE)}>
              Próxima →
            </button>
          </nav>
        )}
      </section>
    </>
  );
}
