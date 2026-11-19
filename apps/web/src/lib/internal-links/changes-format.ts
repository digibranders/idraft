import { TZDate } from '@date-fns/tz';
import { format, parseISO } from 'date-fns';

import { formatInteger, formatSignedInteger } from '@/lib/format';

import type { ChangeAlert, ChangeLink } from './types';

/** The join words of the tier text, from the catalog. */
export interface TierRangeWords {
  tierPair: (first: string, second: string) => string;
  tierRange: (first: string, last: string) => string;
}

/** "T1", "T1 and T2" or "T1 to T4": the tiers an alert setting covers (mock `alertTierText`). A bad number reads as T1. */
export function alertTierText(maxPosition: number, words: TierRangeWords): string {
  if (!Number.isInteger(maxPosition) || maxPosition <= 1) return 'T1';
  return maxPosition === 2 ? words.tierPair('T1', 'T2') : words.tierRange('T1', `T${String(maxPosition)}`);
}

export type Tone = 'negative' | 'warning' | 'positive' | 'neutral';

/** A pair that is still linked another way (the menu, say) is a smaller loss (mock `priorityBadge`). */
export function priorityTone(priority: ChangeLink['priority'], stillLinkedBy: ChangeLink['still_linked_by']): Tone {
  if (priority === 'lost_to_t1') return stillLinkedBy === null ? 'negative' : 'warning';
  if (priority === 'lost_to_t2') return 'warning';
  return 'neutral';
}

/** `in` is a count of linking pages; `depth` is clicks from the start page, where deeper is worse. */
export type DeltaKind = 'in' | 'depth';

/** A change with its sign and tone; `null` for no change or no earlier number. Equity is never formatted here. */
export function formatDelta(value: number | null, kind: DeltaKind): { text: string; tone: Tone } | null {
  if (value === null || !Number.isFinite(value) || value === 0) return null;
  const good = kind === 'depth' ? value < 0 : value > 0;
  const text = value > 0 ? `+${formatInteger(value)}` : formatSignedInteger(value);
  return { text, tone: good ? 'positive' : 'negative' };
}

/** The size of a depth change in levels; a page that became reachable or unreachable has none. */
export const depthMove = (change: { depth_state: 'lost' | 'found' | null; depth_delta: number | null }): number =>
  change.depth_state === null && change.depth_delta !== null ? Math.abs(change.depth_delta) : 0;

/** "7 Nov": the date a comparison starts, in the project's time zone; `null` when there is none or it is not a date. */
export function sinceText(iso: string | null, timeZone: string): string | null {
  if (iso === null) return null;
  const date = parseISO(iso);
  if (Number.isNaN(date.getTime())) return null;
  const zoned = new TZDate(date.getTime(), timeZone);
  return Number.isNaN(zoned.getTime()) ? null : format(zoned, 'd MMM');
}

export interface AlertWords extends TierRangeWords {
  none: () => string;
  lost: (count: string, tiers: string) => string;
}

/** The alert in words: how many links to the important tiers were lost; the callbacks carry the plural forms. */
export function alertText(alert: Pick<ChangeAlert, 'lost_links' | 'max_position'>, words: AlertWords): string {
  if (alert.lost_links <= 0) return words.none();
  return words.lost(formatInteger(alert.lost_links), alertTierText(alert.max_position, words));
}
