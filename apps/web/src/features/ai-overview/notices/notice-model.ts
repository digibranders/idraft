import type { EngineCode } from '@/lib/api/types';

/**
 * What the page says about the state of its data (WP-33 plan section 3.5): one fact at a time, the first that applies
 * in the order of the table. Pure: the reads arrive as values, so every row of the table is a function call. A read
 * that has not answered is `null` and gives no notice, so nothing is said before it is known.
 */

/** The newest valid answer is stale once it is older than this: two missed collections of a twice-weekly schedule. */
export const STALE_AFTER_DAYS = 5;
const DAY_MS = 86_400_000;

/** What the notice needs of one engine: the same counts the numbers read, so there is one denominator. */
export interface EngineCounts {
  engineCode: EngineCode;
  label: string;
  /** Enabled and inside the engine filter. An engine that is not asked is not counted. */
  asked: boolean;
  /** Every answer of the window, valid or not. */
  allAnswers: number;
  validAnswers: number;
}

export interface NoticeInputs {
  /** The engines that are on; `null` while they are unread. */
  enginesOn: number | null;
  /** The most active prompts any enabled engine asks (the prompts of the project); `null` while unread. */
  activePrompts: number | null;
  country: string | null;
  /** The prompts in the scope, once each; `null` while the prompt rows are unread. */
  promptsInScope: number | null;
  /** The AI schedules; `null` while unread. */
  schedule: { nextRunAt: string | null; paused: boolean } | null;
  /**
   * The project's newest answers, whatever the window and the filters; `null` while unread, `'failed'` when the read
   * failed: the notices that need it (first answers, stale) are then left out and the rest are kept.
   */
  freshness: { lastObservedAt: string | null; lastValidAt: string | null } | 'failed' | null;
  /** The engines of the scope's window; `null` while unread. */
  engines: readonly EngineCounts[] | null;
  /** The days of the window, for "in these 28 days". */
  days: number;
  now: Date;
}

export type Notice =
  /** Body states: they replace the page's content. */
  | { kind: 'noEngine' }
  | { kind: 'noPrompts' }
  | { kind: 'noCountryPrompts'; country: string }
  /** Banners. */
  | { kind: 'paused' }
  | { kind: 'firstAnswers'; nextRunAt: string | null }
  | { kind: 'invalid'; engineCode: EngineCode; label: string; invalid: number; total: number; days: number }
  | { kind: 'stale'; days: number };

/**
 * The whole days since the newest valid answer once it is older than 5 days, else `null` (fresh, or no valid answer,
 * which has no age to state). At exactly 5 days it is not stale.
 */
export function staleDaysOf(lastValidAt: string | null, now: Date): number | null {
  if (lastValidAt === null) return null;
  const age = now.getTime() - Date.parse(lastValidAt);
  return Number.isNaN(age) || age <= STALE_AFTER_DAYS * DAY_MS ? null : Math.floor(age / DAY_MS);
}

// threshold chosen by the WP-33 shell, owner to confirm: a few answers not valid are normal for a healthy project
/** The share of an engine's answers that must be not valid before the page says so. */
export const INVALID_SHARE_THRESHOLD = 0.2;
/** And the fewest answers not valid, so a small sample does not raise it. */
export const INVALID_COUNT_MINIMUM = 5;

/**
 * The asked engine with the largest share of its answers not valid, among those at or over both thresholds; `null`
 * when none is. The counts stay in every number's tip, so a project under the thresholds hides nothing.
 */
function worstEngine(engines: readonly EngineCounts[], days: number): Notice | null {
  let worst: { engine: EngineCounts; invalid: number } | null = null;
  for (const engine of engines) {
    const invalid = engine.allAnswers - engine.validAnswers;
    if (!engine.asked || invalid < INVALID_COUNT_MINIMUM || invalid / engine.allAnswers < INVALID_SHARE_THRESHOLD) {
      continue;
    }
    if (worst === null || invalid / engine.allAnswers > worst.invalid / worst.engine.allAnswers) {
      worst = { engine, invalid };
    }
  }
  return worst === null
    ? null
    : {
        kind: 'invalid',
        engineCode: worst.engine.engineCode,
        label: worst.engine.label,
        invalid: worst.invalid,
        total: worst.engine.allAnswers,
        days,
      };
}

/** The one notice that applies, or `null`. */
export function noticeOf(input: NoticeInputs): Notice | null {
  const { enginesOn, activePrompts, country, promptsInScope, schedule, freshness, engines, days, now } = input;
  if (enginesOn === null) return null;
  if (enginesOn === 0) return { kind: 'noEngine' };
  if (activePrompts === 0) return { kind: 'noPrompts' };
  if (country !== null && promptsInScope === 0) return { kind: 'noCountryPrompts', country };
  if (freshness === null || engines === null) return null;
  if (schedule?.paused === true) return { kind: 'paused' };
  if (freshness !== 'failed' && freshness.lastObservedAt === null) {
    // Without the schedule the next run is not known yet, and a notice that then changes would flash
    return schedule === null ? null : { kind: 'firstAnswers', nextRunAt: schedule.nextRunAt };
  }
  const invalid = worstEngine(engines, days);
  if (invalid !== null) return invalid;
  const stale = freshness === 'failed' ? null : staleDaysOf(freshness.lastValidAt, now);
  return stale === null ? null : { kind: 'stale', days: stale };
}
