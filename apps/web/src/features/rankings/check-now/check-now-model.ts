import type { ActionScope } from '@/components/app/data-table/types';
import { isApiProblem } from '@/lib/api/problem';
import { quotaFacts } from '@/lib/keywords/quota';

/** The route takes at most this many tracked keywords (`CheckNow.tracked_keyword_ids`). */
export const MAX_CHECK_NOW = 100;

export type CheckNowTarget =
  { kind: 'ids'; ids: string[] } | { kind: 'blocked'; reason: 'allMatching' | 'tooMany' | 'none' | 'archived' };

/** What Check now sends for a selection: ids only, since the route takes no filter. */
export function checkNowTarget(chosen: ActionScope, archived: boolean): CheckNowTarget {
  if (archived) return { kind: 'blocked', reason: 'archived' };
  if (chosen.allMatching) return { kind: 'blocked', reason: 'allMatching' };
  if (chosen.ids.size === 0) return { kind: 'blocked', reason: 'none' };
  if (chosen.ids.size > MAX_CHECK_NOW) return { kind: 'blocked', reason: 'tooMany' };
  return { kind: 'ids', ids: [...chosen.ids].sort() };
}

export type CheckNowRefusal =
  | { kind: 'limit'; limit: number | null }
  | { kind: 'quota'; limit: number; used: number; requested: number }
  | { kind: 'paused' }
  | { kind: 'unknownKeyword' }
  | { kind: 'other' };

/** The refusal behind a failed Check now (`POST {P}/seo/check-now`, backend `runs.py check_now`). */
export function checkNowRefusal(error: unknown, requested = 0): CheckNowRefusal {
  if (isApiProblem(error, 'manual_run_limit')) return { kind: 'limit', limit: error.number('limit') };
  if (isApiProblem(error, 'quota_exceeded')) {
    const facts = quotaFacts(error, requested);
    return { kind: 'quota', limit: facts.limit, used: facts.used, requested: facts.requested };
  }
  if (isApiProblem(error, 'provider_paused')) return { kind: 'paused' };
  if (isApiProblem(error, 'validation_failed') && error.errors.some((item) => item.code === 'keyword_unknown')) {
    return { kind: 'unknownKeyword' };
  }
  return { kind: 'other' };
}
