import type { EngineSummary, MetricCell } from '@/lib/api/types';
import { rateState, type Counts } from '@/lib/stats';

/**
 * Share of voice as the owner decided it (D17): the brand's mentions over all tracked-brand mentions, always written "x of
 * y brand mentions" beside the percent. The counts are the entity cells of an engine (`include=entities`): each tracked
 * brand's cell counts the valid answers that name it, and the answers of a topic or the total count in `pooled`.
 */

/** The mentions of one entity cell: the answers that name it (the pooled successes of a prompt weighted cell). */
const mentionsOf = (cell: MetricCell): number => cell.pooled?.successes ?? cell.numerator;

/**
 * x of y brand mentions of one engine: x is the mentions of the own brand (its entities), y those of every tracked brand
 * with a cell. `null` where the engine carries no entity cells or none of them is the own brand's: the counts are not
 * collected, and a share is then never drawn from the old sum-of-shares cell (backend request 13).
 */
export function brandMentionCounts(engine: EngineSummary | undefined, ownIds: ReadonlySet<string>): Counts | null {
  const cells = engine?.entities;
  if (cells === undefined || cells === null || !cells.some((cell) => ownIds.has(cell.entity_id))) return null;
  const all = cells.reduce((total, cell) => total + mentionsOf(cell.mentioned), 0);
  const own = cells.reduce((total, cell) => total + (ownIds.has(cell.entity_id) ? mentionsOf(cell.mentioned) : 0), 0);
  return { k: own, n: all };
}

/** The share of voice of those counts, or `null` under 4 brand mentions (R2). */
export const shareOfCounts = (counts: Counts): number | null =>
  rateState(counts.n) === 'ok' ? counts.k / counts.n : null;
