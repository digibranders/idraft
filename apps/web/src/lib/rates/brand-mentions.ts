import type { EngineSummary, MetricCell } from '@/lib/api/types';
import { rateState, type Counts } from '@/lib/stats';

/**
 * Share of voice as the owner decided it (D17): the brand's mentions over all tracked-brand mentions, always written "x of
 * y brand mentions" beside the percent. The counts are the entity cells of an engine (`include=entities`): each tracked
 * brand's cell counts the valid answers that name it, and the answers of a topic or the total count in `pooled`.
 */

/** The mentions of one entity cell: the answers that name it (the pooled successes of a prompt weighted cell). */
const mentionsOf = (cell: MetricCell): number => cell.pooled?.successes ?? cell.numerator;

/** The mentions of one entity cell, for a figure that needs one brand's count. */
export const entityMentions = mentionsOf;

/** The API lists the entity cells of an engine for at most this many tracked brands, the own ones first (backend request 14). */
export const ENTITY_CELL_CAP = 20;

/**
 * What the entity cells of one engine say of the brand mentions: the counts, or why there are none. `notCollected`: the
 * read carries no entity cells, or none of them is the own brand's. `capped`: the cells are at the cap and the read
 * names more tracked brands than they hold, so y would be too small (the API states no total, request 14).
 */
export type BrandMentionRead = { kind: 'counts'; counts: Counts } | { kind: 'notCollected' } | { kind: 'capped' };

/**
 * x of y brand mentions of one engine: x is the mentions of the own brand (its entities), y those of every tracked brand
 * with a cell. `tracked` is how many brands the read's tracked set holds (`summary.entities`), to tell a cut list from a
 * whole one; left out, the cap is not checked.
 */
export function brandMentionRead(
  engine: Pick<EngineSummary, 'entities'> | undefined,
  ownIds: ReadonlySet<string>,
  tracked?: number,
): BrandMentionRead {
  const cells = engine?.entities;
  if (cells === undefined || cells === null || !cells.some((cell) => ownIds.has(cell.entity_id))) {
    return { kind: 'notCollected' };
  }
  if (tracked !== undefined && cells.length >= ENTITY_CELL_CAP && tracked > cells.length) return { kind: 'capped' };
  const all = cells.reduce((total, cell) => total + mentionsOf(cell.mentioned), 0);
  const own = cells.reduce((total, cell) => total + (ownIds.has(cell.entity_id) ? mentionsOf(cell.mentioned) : 0), 0);
  return { kind: 'counts', counts: { k: own, n: all } };
}

/**
 * The counts of `brandMentionRead`, `null` where there are none (not collected, or cut by the cap): a share is then never
 * drawn from the old sum-of-shares cell (backend request 13).
 */
export function brandMentionCounts(
  engine: Pick<EngineSummary, 'entities'> | undefined,
  ownIds: ReadonlySet<string>,
  tracked?: number,
): Counts | null {
  const read = brandMentionRead(engine, ownIds, tracked);
  return read.kind === 'counts' ? read.counts : null;
}

/** The share of voice of those counts, or `null` under 4 brand mentions (R2). */
export const shareOfCounts = (counts: Counts): number | null =>
  rateState(counts.n) === 'ok' ? counts.k / counts.n : null;

/**
 * x of y brand mentions of one engine over several prompts (the strip): the prompts' counts added up, one mention one
 * weight. `{ k: 0, n: 0 }` when no prompt has the engine (no answers), `null` when one has it without entity cells.
 */
export function brandMentionCountsOver(
  prompts: readonly { engines: readonly EngineSummary[] }[],
  engineCode: string,
  ownIds: ReadonlySet<string>,
  tracked?: number,
): Counts | null {
  const cells = prompts.flatMap((prompt) => prompt.engines.filter((engine) => engine.engine_code === engineCode));
  const counts = cells.map((cell) => brandMentionCounts(cell, ownIds, tracked));
  if (counts.some((entry) => entry === null)) return null;
  return counts.reduce<Counts>((total, entry) => ({ k: total.k + (entry?.k ?? 0), n: total.n + (entry?.n ?? 0) }), {
    k: 0,
    n: 0,
  });
}
