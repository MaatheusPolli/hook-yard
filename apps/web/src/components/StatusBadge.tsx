import type { EventStatus } from '../api';
import { STATUS_LABEL } from '../format';

export function StatusBadge({ status }: { status: EventStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}
