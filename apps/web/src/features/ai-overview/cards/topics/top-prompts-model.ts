import type { EngineValue } from './engine-values';
import { promptEngineRows } from './prompt-rows';
import { attachPrevious } from './topic-change';
import type { PromptSummaryRow } from '@/lib/api/types';
import { averageChangeOf, engineChangeOf, type RateChange } from '@/lib/compare/change-model';
import { safeText, type CsvCell } from '@/lib/csv/csv-write';
import { sortByKeys, type AverageRate, type CellMetric } from '@/lib/rates/rate-model';

/**
 * The model of "prompts to look at" (`ai.top_prompts`): the prompts named most or least, or the ones whose rate moved
 * most between two windows. Plain data: a prompt without a rate (or without a change) is counted apart and never
 * ranked as 0.
 */

/** The catalog offers no metric for this card: it is the mention rate. */
export const TOP_PROMPTS_METRIC: CellMetric = 'mentioned';

export type PromptShow = 'most_named' | 'least_named' | 'largest_change';

export interface TopPromptsOptions {
  show: PromptShow;
  /** The prompts listed, taken after the order is applied. */
  rows: number;
}

export interface TopPromptsInput {
  prompts: readonly PromptSummaryRow[];
  /** The window before, joined to the prompts by id; `null` when there is none (the change is then unknown). */
  previousPrompts: readonly PromptSummaryRow[] | null;
  /** The asked engines. */
  codes: readonly string[];
}

export interface PromptRank {
  /** The prompt id. */
  id: string;
  prompt: PromptSummaryRow;
  /** One per asked engine: the counts behind the average and the tip. */
  values: EngineValue[];
  /** The equal weight average over the engines that show a rate now. */
  average: AverageRate;
  /** Largest change only: over the engines with a rate in BOTH windows; `null` when there is none. */
  change: RateChange | null;
  /** Largest change only: the codes of the engines that took part in `change`, in the order asked. */
  took: string[];
}

export interface TopPromptsModel {
  /** The prompts shown: ordered, then cut to `rows`. */
  listed: PromptRank[];
  /** Every prompt that has a rate (or a change), ordered, before the cut. */
  ranked: PromptRank[];
  /** The prompts with none: too few answers, or not in both windows. Counted, never ranked as 0. */
  left: PromptRank[];
  /** Some prompt has an answer, valid or not, on some engine. */
  answered: boolean;
  /** The codes of the asked engines that have no valid answer for any prompt. */
  unanswered: string[];
}

/** Two rates are one when they differ by no more than the float noise of the sums that made them. */
const SAME = 1e-9;

/** Detectable changes first, then the larger move, then the prompt text: the same input is always the same order. */
function byMove(a: PromptRank, b: PromptRank): number {
  const rank = (row: PromptRank): number => (row.change?.detectable === true ? 0 : 1);
  const gap = Math.abs(b.change?.points ?? 0) - Math.abs(a.change?.points ?? 0);
  return rank(a) - rank(b) || (Math.abs(gap) > SAME ? gap : 0) || a.prompt.text.localeCompare(b.prompt.text);
}

export function topPromptsModel(
  { prompts, previousPrompts, codes }: TopPromptsInput,
  { show, rows }: TopPromptsOptions,
): TopPromptsModel {
  const before = new Map((previousPrompts ?? []).map((prompt) => [prompt.prompt_id, prompt] as const));
  const all = promptEngineRows(prompts, codes, TOP_PROMPTS_METRIC, []).map((row): PromptRank => {
    const earlier = show === 'largest_change' ? before.get(row.prompt.prompt_id) : undefined;
    // The previous cells are laid onto the current ones, so the arithmetic is the Topics tab's. A prompt that is not
    // in the window before has no change: that is not a move from 0
    const joined = earlier === undefined ? undefined : attachPrevious(row.prompt.engines, earlier.engines);
    return {
      id: row.prompt.prompt_id,
      prompt: row.prompt,
      values: row.values,
      average: row.average,
      change: joined === undefined ? null : averageChangeOf(joined, codes, TOP_PROMPTS_METRIC),
      took:
        joined === undefined ? [] : codes.filter((code) => engineChangeOf(joined, code, TOP_PROMPTS_METRIC) !== null),
    };
  });
  const has = (row: PromptRank): boolean =>
    show === 'largest_change' ? row.change !== null : row.average.state === 'ok';
  const ranked =
    show === 'largest_change'
      ? all.filter(has).sort(byMove)
      : sortByKeys(
          all.filter(has),
          [{ id: 'rate', desc: show === 'most_named' }],
          (row) => row.average.value,
          (row) => row.prompt.text,
        );
  return {
    listed: ranked.slice(0, rows),
    ranked,
    left: all.filter((row) => !has(row)),
    answered: all.some((row) => row.values.some((value) => value.state !== 'none')),
    unanswered: codes.filter((code) =>
      all.every((row) => row.values.find((value) => value.code === code)?.state === 'none'),
    ),
  };
}

/** The name of the file the card's menu downloads, without its extension. */
export const topPromptsFileName = (show: PromptShow): string => `prompts-to-look-at-${show}`;

const NAMED_EXPORT_HEADER = ['prompt', 'rate_percent', 'engines', 'answers', 'status'];
const CHANGE_EXPORT_HEADER = [
  'prompt',
  'now_rate_percent',
  'before_rate_percent',
  'change_points',
  'engines',
  'reading',
];

const percentNumber = (rate: number): number => Math.round(rate * 10000) / 100;

/** How the export names the verdict of a change. */
const readingOf = (change: RateChange): 'detectable' | 'within' | 'untested' =>
  change.detectable === null ? 'untested' : change.detectable ? 'detectable' : 'within';

/**
 * The export block of the card: every prompt, the ranked ones in their order and then the ones left out, so the file
 * says why a prompt has no rate (or no change) with an empty cell and a status, never 0.
 */
export function topPromptsExport(model: TopPromptsModel, show: PromptShow): { header: string[]; rows: CsvCell[][] } {
  const everyone = [...model.ranked, ...model.left];
  if (show !== 'largest_change') {
    return {
      header: NAMED_EXPORT_HEADER,
      rows: everyone.map(({ prompt, average }): CsvCell[] => [
        safeText(prompt.text),
        average.state === 'ok' && average.value !== null ? percentNumber(average.value) : null,
        average.engines,
        average.answers,
        average.state,
      ]),
    };
  }
  return {
    header: CHANGE_EXPORT_HEADER,
    rows: everyone.map(({ prompt, change }): CsvCell[] =>
      change === null
        ? [safeText(prompt.text), null, null, null, 0, 'not_compared']
        : [
            safeText(prompt.text),
            percentNumber(change.now.value),
            percentNumber(change.before.value),
            percentNumber(change.points),
            change.engines,
            readingOf(change),
          ],
    ),
  };
}
