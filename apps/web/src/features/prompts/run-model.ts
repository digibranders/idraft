import { asksIn, fitsEngine } from './prompt-model';
import type { BulkRunAnswer } from './prompt-queries';
import { isApiProblem, retryMinutes } from '@/lib/api/problem';
import type { EngineCode, ProjectEngine, Prompt, RunSkip } from '@/lib/api/types';
import { money } from '@/lib/format/money';
import type { Country } from '@/lib/locations/countries';

/**
 * Run now for many prompts (parity spec G26, G47, G27). The API takes up to 150 prompts in one request
 * (`POST {P}/ai/runs`), which it makes ONE manual run of the project's 20 a day; more prompts than that are split
 * into requests of 150, each a run of its own. The API leaves out the prompt and engine pairs it cannot ask and
 * says which; the rest runs.
 */

/** The manual runs a project may make a day, shared with keyword refreshes (`manual_run_limit`). */
export const MANUAL_RUN_CAP = 20;
/** The prompts one bulk run takes (the API's `prompt_ids` maximum). */
export const BULK_RUN_MAX = 150;

/** `ids` in runs of at most `size`, in order. */
export function chunkIds(ids: readonly string[], size: number = BULK_RUN_MAX): string[][] {
  const runs: string[][] = [];
  for (let at = 0; at < ids.length; at += size) runs.push(ids.slice(at, at + size));
  return runs;
}

export type RunBlock = 'no_engine' | 'too_long' | 'no_location';

export interface RunPlan {
  /** The prompts that can be asked, with the engines each is asked on. */
  runnable: { promptId: string; engineCodes: EngineCode[] }[];
  /** The prompts no enabled engine can ask, and why. */
  blocked: { promptId: string; reason: RunBlock }[];
}

/**
 * Each prompt on the engines that take its length and have a location in its country, as Run now of one prompt
 * sends it (the API refuses the whole run when one engine asked cannot ask the prompt), and what the bulk bar reads
 * to say that no chosen prompt can be asked at all. `countries` is `null` while they are not known: the locations
 * are then left to the API.
 */
export function planRuns(
  prompts: readonly Prompt[],
  engines: readonly ProjectEngine[],
  countries: readonly Country[] | null,
): RunPlan {
  const plan: RunPlan = { runnable: [], blocked: [] };
  for (const prompt of prompts) {
    const fits = engines.filter((engine) => fitsEngine(prompt.current_version.text, engine));
    const asked = fits.filter((engine) => countries === null || asksIn(engine, countries, prompt.country_iso));
    if (asked.length > 0) {
      plan.runnable.push({ promptId: prompt.prompt_id, engineCodes: asked.map((engine) => engine.engine.engine_code) });
    } else {
      plan.blocked.push({
        promptId: prompt.prompt_id,
        reason: engines.length === 0 ? 'no_engine' : fits.length === 0 ? 'too_long' : 'no_location',
      });
    }
  }
  return plan;
}

/** Why a prompt and engine pair was left out, in the words a person has for it. */
export type SkipWhy = 'tooLong' | 'noLocation' | 'pending';
/** Pairs left out, by reason. */
export type SkipCounts = Record<SkipWhy, number>;

const SKIP_WHY: Readonly<Record<RunSkip['reason'], SkipWhy>> = {
  prompt_too_long: 'tooLong',
  location_not_enabled: 'noLocation',
  check_pending: 'pending',
  prompt_pending: 'pending',
};

/** The pairs left out by reason: an answer on its way is one whether it is the pair's or the prompt's. */
export function skipCounts(skipped: readonly RunSkip[]): SkipCounts {
  const counts: SkipCounts = { tooLong: 0, noLocation: 0, pending: 0 };
  for (const entry of skipped) counts[SKIP_WHY[entry.reason]] += 1;
  return counts;
}

/** The skipped list of a refusal's body, read defensively: a member that is not an entry is left out. */
function skipsOf(value: unknown): RunSkip[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is RunSkip =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { reason?: unknown }).reason === 'string' &&
      (entry as { reason: string }).reason in SKIP_WHY,
  );
}

/** Why an engine is refused (`422 validation_failed`, one item for each engine, or `422 price_unavailable`). */
export type EngineRefusal = 'engine_not_enabled' | 'prompt_too_long' | 'location_not_enabled' | 'price_unavailable';
const REFUSALS: ReadonlySet<string> = new Set<EngineRefusal>([
  'engine_not_enabled',
  'prompt_too_long',
  'location_not_enabled',
  'price_unavailable',
]);
const isRefusal = (code: string): code is EngineRefusal => REFUSALS.has(code);

/** What a refused run means, for a sentence: the numbers are `null` when the API did not send them. */
export type RunProblem =
  | { kind: 'provider_paused'; minutes: number }
  | { kind: 'rate_limited'; minutes: number }
  | { kind: 'manual_run_limit'; limit: number | null }
  | { kind: 'quota_exceeded'; limit: number | null; used: number | null; requested: number | null }
  /** Some prompt asked is archived, deleted or not the project's. */
  | { kind: 'prompt_unknown' }
  /** The engines refused, by reason; an empty list stands for every engine asked (a missing price is the run's). */
  | { kind: 'engines_refused'; refused: Partial<Record<EngineRefusal, string[]>> }
  | { kind: 'nothing_to_run'; skips: SkipCounts }
  /** Every prompt has an answer on its way; `engines` are named by Run now of one prompt. */
  | { kind: 'check_pending'; engines: string[]; skips: SkipCounts }
  | { kind: 'forbidden' }
  | { kind: 'gone' }
  | { kind: 'failed' };

/** What an error of Run now, of one prompt or of many, means. It never throws, whatever answered. */
export function runProblemOf(error: unknown): RunProblem {
  if (!isApiProblem(error)) return { kind: 'failed' };
  // No permission is the status, whatever the problem calls it
  if (error.status === 403) return { kind: 'forbidden' };
  switch (error.code) {
    case 'provider_paused':
      return { kind: 'provider_paused', minutes: retryMinutes(error) };
    case 'rate_limited':
      return { kind: 'rate_limited', minutes: retryMinutes(error) };
    case 'manual_run_limit':
      return { kind: 'manual_run_limit', limit: error.number('limit') };
    case 'quota_exceeded':
      return {
        kind: 'quota_exceeded',
        limit: error.number('limit'),
        used: error.number('used'),
        requested: error.number('requested'),
      };
    case 'price_unavailable':
      return { kind: 'engines_refused', refused: { price_unavailable: [] } };
    case 'nothing_to_run':
      return { kind: 'nothing_to_run', skips: skipCounts(skipsOf(error.body.skipped)) };
    case 'check_pending': {
      const named = error.body.engine_codes;
      return {
        kind: 'check_pending',
        engines: Array.isArray(named) ? named.filter((code): code is string => typeof code === 'string') : [],
        skips: skipCounts(skipsOf(error.body.skipped)),
      };
    }
    case 'validation_failed': {
      if (error.errors.some((item) => item.code === 'prompt_unknown')) return { kind: 'prompt_unknown' };
      const refused: Partial<Record<EngineRefusal, string[]>> = {};
      for (const item of error.errors) {
        if (!item.path.startsWith('engine_codes') || !isRefusal(item.code)) continue;
        // The API names the engine before the colon of its message ("gemini_web: ..."), except for a missing price
        const named = item.message.includes(':') ? item.message.split(':')[0]?.trim() : undefined;
        const engines = (refused[item.code] ??= []);
        if (named !== undefined && named !== '' && !engines.includes(named)) engines.push(named);
      }
      return Object.keys(refused).length === 0 ? { kind: 'failed' } : { kind: 'engines_refused', refused };
    }
    default:
      return error.status === 404 ? { kind: 'gone' } : { kind: 'failed' };
  }
}

/** One request of a bulk run: the prompts it asked for and what the API answered. */
export interface ChunkAnswer {
  ids: readonly string[];
  meta: BulkRunAnswer['meta'];
}

export interface RunSummary {
  /** The prompts the runs ask (a prompt left out on every engine is not one). */
  prompts: number;
  /** The engines asked in at least one run: one that every prompt was left out on is not. */
  engines: number;
  /** The estimated cost in dollars, or `null` when an estimate is not a price. */
  cost: number | null;
  /** The pairs left out, by reason. */
  skips: SkipCounts;
  /** The prompts asked on at least one engine: the ones a choice lets go of. */
  startedIds: string[];
  /** The day's manual runs after the last request, or `null` when none was queued. */
  manualRuns: { used: number; limit: number } | null;
}

/** What the queued requests of one bulk run came to, over the engines the project has on (`engineCodes`). */
export function summarizeRuns(chunks: readonly ChunkAnswer[], engineCodes: readonly string[]): RunSummary {
  const engines = new Set<string>();
  const startedIds: string[] = [];
  const skips: SkipCounts = { tooLong: 0, noLocation: 0, pending: 0 };
  let prompts = 0;
  let cost: number | null = 0;
  for (const { ids, meta } of chunks) {
    prompts += meta.prompts;
    const price = money(meta.estimated_cost_usd);
    cost = cost === null || price === null ? null : cost + price;
    for (const [why, count] of Object.entries(skipCounts(meta.skipped)) as [SkipWhy, number][]) skips[why] += count;
    // The engines each prompt was left out on
    const leftOut = new Map<string, Set<string>>();
    for (const entry of meta.skipped) {
      leftOut.set(entry.prompt_id, (leftOut.get(entry.prompt_id) ?? new Set<string>()).add(entry.engine_code));
    }
    for (const id of ids) {
      if ((leftOut.get(id)?.size ?? 0) < engineCodes.length) startedIds.push(id);
    }
    for (const code of engineCodes) {
      const skippedOn = meta.skipped.filter((entry) => entry.engine_code === code).length;
      if (skippedOn < ids.length) engines.add(code);
    }
  }
  const last = chunks.at(-1)?.meta.manual_runs_today ?? null;
  return {
    prompts,
    engines: engines.size,
    cost,
    skips,
    startedIds,
    manualRuns: last === null ? null : { used: last.used, limit: last.limit },
  };
}
