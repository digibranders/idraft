import { tierPosition } from './tiers';
import type { TierStat } from './types';

export interface ContextInput {
  tiers: readonly TierStat[];
  /** Pages no link reaches plus pages no editorial link reaches (the worklist counts). */
  noEditorial: number;
  /** Editorial links lost to the important tiers since the previous crawl; 0 when none or not known. */
  lostToTop: number;
}

export interface ContextStats {
  tiered: { tiered: number; total: number; untiered: number };
  t1Pages: number;
  /** Average click depth of the T1 pages; `null` when T1 has no pages or none is reached. */
  t1Depth: number | null;
  noEditorial: number;
  /** The lost editorial links to the important tiers; `null` when there are none. */
  lost: number | null;
}

/** The numbers of the context line (mock `statItems`), from the tier strip and the worklist and summary counts. */
export function contextStats({ tiers, noEditorial, lostToTop }: ContextInput): ContextStats {
  const total = tiers.reduce((sum, stat) => sum + stat.pages, 0);
  const untiered = tiers.filter((stat) => stat.tier === null).reduce((sum, stat) => sum + stat.pages, 0);
  const t1 = tiers.find((stat) => stat.tier !== null && tierPosition(stat.tier) === 1);
  return {
    tiered: { tiered: total - untiered, total, untiered },
    t1Pages: t1?.pages ?? 0,
    t1Depth: t1 === undefined || t1.pages === 0 ? null : t1.average_depth,
    noEditorial,
    lost: lostToTop > 0 ? lostToTop : null,
  };
}
