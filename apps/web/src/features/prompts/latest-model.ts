import type { ObservationSummary } from '@/lib/api/types';

/**
 * The Latest tab of the prompt inspector (parity spec G93): which answer of each engine it shows. Plain data;
 * the tab puts words and cells to it.
 */

/** An answer counts in the rates when its facts are read and say it is valid (a failed or refused one has none). */
export const isValidAnswer = (answer: ObservationSummary): boolean => answer.facts?.is_valid === true;

export interface LatestPick {
  engineCode: string;
  /** The newest valid answer; when none is valid the newest of any status (so its failure can be said); `null` when there is none. */
  observation: ObservationSummary | null;
  valid: boolean;
}

/**
 * The newest valid answer of each engine in `engineCodes`, in that order. An engine with no valid answer gets its
 * newest answer of any status, which tells why it has none, and one with no answer at all gets `null`. The list is
 * sorted here (newest first), so the order the API gives it in does not matter.
 */
export function latestPerEngine(
  observations: readonly ObservationSummary[],
  engineCodes: readonly string[],
): LatestPick[] {
  const newestFirst = [...observations].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
  return engineCodes.map((engineCode) => {
    const ofEngine = newestFirst.filter((answer) => answer.engine_code === engineCode);
    const valid = ofEngine.find(isValidAnswer);
    return { engineCode, observation: valid ?? ofEngine[0] ?? null, valid: valid !== undefined };
  });
}

/** The key of how an answer's mention order is said ("first mentioned", "mentioned third"); past the third, a number. */
export const mentionOrderKey = (order: number): 'first' | 'second' | 'third' | 'other' =>
  order === 1 ? 'first' : order === 2 ? 'second' : order === 3 ? 'third' : 'other';
