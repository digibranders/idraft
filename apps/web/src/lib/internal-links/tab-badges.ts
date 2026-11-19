import type { ChangesSummary } from './types';

/** The count on the Changes tab: the links of the open alert. Only worked out changes count (mock `alertsFor`). */
export function changesBadge(summary: Pick<ChangesSummary, 'state' | 'alert'> | undefined): number | null {
  if (summary === undefined || summary.state !== 'ready' || summary.alert === null) return null;
  return summary.alert.lost_links > 0 ? summary.alert.lost_links : null;
}

/** The count on the Opportunities tab: the open suggestions. */
export function opportunitiesBadge(open: number | undefined): number | null {
  return open !== undefined && open > 0 ? open : null;
}
