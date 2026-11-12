import { asksIn, fitsEngine } from './prompt-model';
import { isApiProblem, retryMinutes } from '@/lib/api/problem';
import type { EngineCode, ProjectEngine, Prompt } from '@/lib/api/types';
import type { Country } from '@/lib/locations/countries';

/**
 * Run now for many prompts (parity spec G26, G47, G27). The API runs one prompt a request, and the project may make
 * 20 manual runs a day in all (`429 manual_run_limit`), so a run of many is a loop that asks the prompts one after
 * the other and stops at the first answer that every prompt after it would get too.
 *
 * shortcut: the loop is client side and the cap is the API's; the backend's bulk run (B7) takes one request for the
 * prompts and answers what it queued, and replaces `runInTurn` and the cap text.
 */

/** The manual runs a project may make a day, shared with keyword refreshes (`manual_run_limit`). */
export const MANUAL_RUN_CAP = 20;
/** Above this many prompts the confirm says how many runs a day there are. */
export const CAP_NOTE_ABOVE = 5;

export type RunBlock = 'no_engine' | 'too_long' | 'no_location';

export interface RunPlan {
  /** The prompts that can be asked, with the engines each is asked on. */
  runnable: { promptId: string; engineCodes: EngineCode[] }[];
  /** The prompts no enabled engine can ask, and why. */
  blocked: { promptId: string; reason: RunBlock }[];
}

/**
 * Each prompt on the engines that take its length and have a location in its country, as Run now of the prompt
 * inspector sends it (the API refuses the whole run when one engine asked cannot ask the prompt). `countries` is
 * `null` while they are not known: the locations are then left to the API.
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

/** What ends the loop: the limit, the month's answers, a paused provider, too many requests, or no permission. */
export type StopReason = 'manual_run_limit' | 'quota_exceeded' | 'provider_paused' | 'rate_limited' | 'forbidden';

export interface Stop {
  reason: StopReason;
  limit: number | null;
  used: number | null;
  requested: number | null;
  /** The wait of a paused provider or of too many requests, in whole minutes. */
  retryMinutes: number | null;
}

/** Why one prompt was refused while the others go on. */
export type RefusedWhy = 'pending' | 'engines' | 'gone' | 'failed';

export type RunResult = { kind: 'started' } | { kind: 'refused'; why: RefusedWhy } | { kind: 'stop'; stop: Stop };

const STOPS: ReadonlySet<string> = new Set<StopReason>([
  'manual_run_limit',
  'quota_exceeded',
  'provider_paused',
  'rate_limited',
  'forbidden',
]);

/** What an error of Run now means for the loop: a stop for the refusals every prompt would get, else this prompt's own. */
export function classifyRunError(error: unknown): RunResult {
  if (!isApiProblem(error)) return { kind: 'refused', why: 'failed' };
  // No permission is the status, whatever the problem calls it
  const code = error.status === 403 ? 'forbidden' : error.code;
  if (STOPS.has(code)) {
    const waits = code === 'provider_paused' || code === 'rate_limited';
    return {
      kind: 'stop',
      stop: {
        reason: code as StopReason,
        limit: error.number('limit'),
        used: error.number('used'),
        requested: error.number('requested'),
        retryMinutes: waits ? retryMinutes(error) : null,
      },
    };
  }
  if (error.code === 'check_pending') return { kind: 'refused', why: 'pending' };
  if (error.code === 'validation_failed') return { kind: 'refused', why: 'engines' };
  if (error.status === 404) return { kind: 'refused', why: 'gone' };
  return { kind: 'refused', why: 'failed' };
}

export interface RunOutcome {
  /** The prompts that were asked, in order: each started or refused. */
  results: Exclude<RunResult, { kind: 'stop' }>[];
  /** What ended the loop, or `null` when every prompt was asked. */
  stop: Stop | null;
  /** The prompts after the one that ended it, which were not asked. */
  notTried: number;
}

/**
 * Asks `ids` one after the other through `runOne`, and stops at the first stop. `halted` is read before each prompt
 * (the screen was left, the project changed): the prompts after it are not asked either.
 */
export async function runInTurn(
  ids: readonly string[],
  runOne: (id: string) => Promise<RunResult>,
  halted: () => boolean = () => false,
): Promise<RunOutcome> {
  const results: RunOutcome['results'] = [];
  for (const [at, id] of ids.entries()) {
    if (halted()) return { results, stop: null, notTried: ids.length - at };
    const result = await runOne(id);
    if (result.kind === 'stop') return { results, stop: result.stop, notTried: ids.length - at - 1 };
    results.push(result);
  }
  return { results, stop: null, notTried: 0 };
}

export interface RunTally {
  /** The prompts the person chose. */
  total: number;
  started: number;
  /** Prompts no engine can ask, set aside before the first request. */
  blocked: number;
  refused: Record<RefusedWhy, number>;
  stop: Stop | null;
  notTried: number;
}

/** The count of each thing that happened to the `total` prompts chosen, `blocked` of which were set aside. */
export function tallyRuns(total: number, blocked: number, outcome: RunOutcome): RunTally {
  const refused: Record<RefusedWhy, number> = { pending: 0, engines: 0, gone: 0, failed: 0 };
  let started = 0;
  for (const result of outcome.results) {
    if (result.kind === 'started') started += 1;
    else refused[result.why] += 1;
  }
  return { total, started, blocked, refused, stop: outcome.stop, notTried: outcome.notTried };
}
