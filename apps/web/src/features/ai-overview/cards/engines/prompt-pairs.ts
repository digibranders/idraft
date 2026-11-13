import type { EngineCode, PromptSummaryRow } from '@/lib/api/types';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * The prompts of two windows joined by `prompt_id`: what the cards that say what changed per prompt are made from
 * (CH-37's gained and lost prompts, CH-09's movers and CH-13's waterfall). Pure, with no rate arithmetic: it holds
 * the counts of each prompt on each asked engine in both windows, and leaves the judgement (4 or more valid answers,
 * named or not, detectable or not) to the caller, so that one reading of a prompt is shared by every card.
 *
 * - `pairPrompts(now, before, engines)` joins the two lists of prompt rows.
 * - `engineCounts(row, code)` is one prompt's counts on one engine (`null` where the prompt has no cell of it, which
 *   a caller counts as 0 valid answers). A mention rate is `mentioned` over `valid`; a citation rate is `cited` over
 *   `citedValid`, the denominator of the citation cell.
 * - `hasEnoughAnswers(counts)` and `rateOf(k, n)` are the shared reading: a rate needs `MIN_OBSERVATIONS` valid
 *   answers, and no valid answer is a missing rate, never 0. `hasEnoughAnswers` reads the mention denominator.
 */

/** What one prompt has on one engine in one window: valid answers, all answers, and how many of the valid ones count. */
export interface EngineCounts {
  /** Valid answers of the mention cell: the denominator of `mentioned` and of the mention rate. */
  valid: number;
  /** Valid answers of the citation cell: the denominator of `cited` and of the citation rate (it can differ from `valid`). */
  citedValid: number;
  /** Every answer, valid or not. */
  observations: number;
  /** Valid answers that name the brand. */
  mentioned: number;
  /** Valid answers that cite the brand's own domain. */
  cited: number;
}

/**
 * The counts of one prompt on one engine in the window and in the one before. A window where the prompt has no cell
 * of the engine (no row, or no cell on that engine) is `null`: a caller counts it as 0 valid answers, never as a
 * missing prompt that is skipped.
 */
export interface EnginePair {
  now: EngineCounts | null;
  before: EngineCounts | null;
}

/** In both windows, only in this one (`nowOnly`: added), or only in the one before (`beforeOnly`: left). */
export type PromptPresence = 'both' | 'nowOnly' | 'beforeOnly';

export interface PairedPrompt {
  promptId: string;
  /** The text of the newer window, else the one before. */
  text: string;
  presence: PromptPresence;
  /** One pair for each engine asked, in the order asked. */
  engines: Readonly<Partial<Record<EngineCode, EnginePair>>>;
}

export interface PromptPairs {
  /** The prompts of the window in its order, then those only in the window before in theirs. */
  prompts: readonly PairedPrompt[];
  presence: Readonly<Record<PromptPresence, number>>;
}

/** One prompt's counts on one engine; `null` when the prompt row has no cell of that engine. */
export function engineCounts(row: PromptSummaryRow, code: EngineCode): EngineCounts | null {
  const cells = row.engines.find((engine) => engine.engine_code === code);
  if (cells === undefined) return null;
  return {
    valid: cells.mentioned.denominator,
    citedValid: cells.cited.denominator,
    observations: cells.mentioned.n_observations,
    mentioned: cells.mentioned.numerator,
    cited: cells.cited.numerator,
  };
}

/** A rate needs `MIN_OBSERVATIONS` valid answers; fewer, or no cell, is no rate. */
export const hasEnoughAnswers = (counts: EngineCounts | null): counts is EngineCounts =>
  counts !== null && counts.valid >= MIN_OBSERVATIONS;

/** `k` of `n` valid answers as a rate; `null` with no valid answer, never 0. */
export const rateOf = (k: number, n: number): number | null => (n > 0 ? k / n : null);

/**
 * Joins the prompt rows of the window (`now`) and of the window before by `prompt_id`, for the engines asked.
 * A prompt of one window only is kept, marked `nowOnly` or `beforeOnly`; an engine not in `engines` has no pair.
 */
export function pairPrompts(
  now: readonly PromptSummaryRow[],
  before: readonly PromptSummaryRow[],
  engines: readonly EngineCode[],
): PromptPairs {
  const earlier = new Map(before.map((row) => [row.prompt_id, row]));
  const seen = new Set<string>();
  const pairOf = (current: PromptSummaryRow | undefined, previous: PromptSummaryRow | undefined): PairedPrompt => {
    const row = current ?? previous;
    if (row === undefined) throw new Error('A prompt pair needs a row in at least one window');
    return {
      promptId: row.prompt_id,
      text: row.text,
      presence: current === undefined ? 'beforeOnly' : previous === undefined ? 'nowOnly' : 'both',
      engines: Object.fromEntries(
        engines.map((code) => [
          code,
          {
            now: current === undefined ? null : engineCounts(current, code),
            before: previous === undefined ? null : engineCounts(previous, code),
          } satisfies EnginePair,
        ]),
      ),
    };
  };
  const joined: PairedPrompt[] = [];
  for (const row of now) {
    // A prompt row listed twice is read once
    if (seen.has(row.prompt_id)) continue;
    seen.add(row.prompt_id);
    joined.push(pairOf(row, earlier.get(row.prompt_id)));
  }
  for (const row of before) {
    if (seen.has(row.prompt_id)) continue;
    seen.add(row.prompt_id);
    joined.push(pairOf(undefined, row));
  }
  const presence: Record<PromptPresence, number> = { both: 0, nowOnly: 0, beforeOnly: 0 };
  for (const prompt of joined) presence[prompt.presence] += 1;
  return { prompts: joined, presence };
}
