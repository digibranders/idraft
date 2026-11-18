import { formatPercent } from '@/lib/format';
import { wholePercents } from '@/lib/stats';

/**
 * The shares of one platform as whole percents that add up to 100, which the notes of these cards say they do
 * (largest remainder, so printing them never adds up to 99 or 101). The bars keep the exact shares and the counts
 * stay exact.
 */
export const percentTexts = (shares: readonly number[]): string[] =>
  wholePercents(shares).map((percent) => formatPercent(percent / 100, { decimals: 0 }));
