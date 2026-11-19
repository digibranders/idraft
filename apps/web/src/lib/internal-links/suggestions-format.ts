import { formatInteger } from '@/lib/format';

import type { SuggestionGscState, TierSuggestionRow } from './types';

export interface ReasonWords {
  clicks: (count: string) => string;
  rank: (rank: string, keyword: string, volume: string) => string;
}

/** One reason of a suggestion in words; `null` when its numbers are missing, so a zero is never made up. */
export function reasonText(reason: TierSuggestionRow['reasons'][number], words: ReasonWords): string | null {
  if (reason.kind === 'clicks') return reason.clicks === null ? null : words.clicks(formatInteger(reason.clicks));
  if (reason.rank === null || reason.keyword === null || reason.volume === null) return null;
  return words.rank(formatInteger(reason.rank), reason.keyword, formatInteger(reason.volume));
}

export type GscNote = 'clicks_used' | 'ranks_only_pending' | 'ranks_only_not_connected';

/** Which note goes over the suggestions: whether Search Console clicks were used with the ranks. */
export const gscNote = (state: SuggestionGscState): GscNote =>
  state === 'ok' ? 'clicks_used' : state === 'pending' ? 'ranks_only_pending' : 'ranks_only_not_connected';
