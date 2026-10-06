import type { ApiProblem } from '@/lib/api/problem';

/** What the one sentence about the plan's keyword limit (`common.quota`) is made of. */
export interface QuotaFacts {
  /** Active keywords the plan still has room for. */
  room: number;
  used: number;
  limit: number;
  /** How many the change would add. */
  requested: number;
}

/**
 * The facts of a `quota_exceeded` problem (19-api-specification.md section 2.7). `requested` is what the
 * caller knows the change adds, for a problem that does not say.
 */
export function quotaFacts(error: ApiProblem, requested: number): QuotaFacts {
  const limit = error.number('limit') ?? 0;
  const used = error.number('used') ?? 0;
  return { room: Math.max(limit - used, 0), used, limit, requested: error.number('requested') ?? requested };
}
