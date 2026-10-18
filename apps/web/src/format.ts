const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

export const formatDate = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : '—');

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

export const STATUS_LABEL: Record<string, string> = {
  received: 'Recebido',
  processing: 'Processando',
  processed: 'Processado',
  failed: 'Aguardando retry',
  dead: 'DLQ',
};
