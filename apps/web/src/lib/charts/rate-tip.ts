import { tipRowHtml } from './tooltip-row';
import type { ChartTokens } from '@/lib/design/read-tokens';
import type { Interval } from '@/lib/stats';

/**
 * What a rate says in a tooltip, one anatomy for every chart (15-data-visualization.md section 4, rules R1, R2,
 * R6 and R7 of the AI visibility inventory): never a percent without the answers behind it, a thin point says its
 * answers instead of a percent and a band, and an unknown value is never written as 0.
 */
export interface RateTipValue {
  value: number | null;
  k: number | null;
  n: number;
  /** A prompt-weighted rate also says how many prompts, each counted once (R1). */
  prompts?: number | undefined;
  band: Interval | null;
  /** Fewer than `MIN_OBSERVATIONS` valid answers (R2). */
  thin: boolean;
  /** A pooled point says over how many weeks (R7). */
  pooledWeeks?: number | undefined;
}

export interface RateTipInput extends RateTipValue {
  name: string;
  color: string;
}

/** The words, from `chart.tip` and `@/lib/format`, made by `useRateTipWords()`. */
export interface RateTipWords {
  value: (ratio: number) => string;
  answers: (k: number, n: number) => string;
  interval: (band: Interval) => string;
  prompts: (count: number) => string;
  thin: (n: number) => string;
  pooled: (weeks: number) => string;
  noAnswers: string;
}

/** Plain text, not escaped: "34.0%, 612 of 1,800 answers, 28% to 41%, 250 prompts, each counts once". */
export function rateTipText(input: RateTipValue, words: RateTipWords): string {
  const { value, k, n, prompts, band, thin, pooledWeeks } = input;
  if (n === 0) return words.noAnswers;
  if (thin) return words.thin(n);
  // R1: a percent and its interval are written only beside the answers they come from
  const counted = k !== null;
  return [
    counted && value !== null ? words.value(value) : null,
    counted ? words.answers(k, n) : null,
    counted && band !== null ? words.interval(band) : null,
    prompts === undefined ? null : words.prompts(prompts),
    pooledWeeks === undefined ? null : words.pooled(pooledWeeks),
  ]
    .filter((part): part is string => part !== null)
    .join(', ');
}

/** One escaped tooltip row: the dot, the name and the text above. */
export function rateTipRow(input: RateTipInput, words: RateTipWords, tokens: ChartTokens): string {
  return tipRowHtml(input.color, input.name, rateTipText(input, words), tokens);
}
