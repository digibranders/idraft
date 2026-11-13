import type { EngineSummary, EntityCells, MetricCell, PointPool, SummaryEntity, WeekCells } from '@/lib/api/types';

/**
 * Builders for the tests of this folder: the cells of the prompts summary written as counts, so a test reads as
 * "3 of 8 answers" and not as a pile of fields.
 */

/** `k` of `n` valid answers, as a prompt's cell counts them; `value` is null with no valid answer. */
export const cell = (k: number, n: number, observations: number = n): MetricCell => ({
  value: n === 0 ? null : k / n,
  numerator: k,
  denominator: n,
  n_observations: observations,
  pooled: null,
});

/**
 * A topic's prompt weighted cell: `k` of `n` valid answers behind it, `prompts` prompts weighted. Its numerator is
 * the sum of the prompts' rates, so it is not whole in general (`weighted(1, 3, 2)` has numerator 2/3).
 */
export const weighted = (k: number, n: number, prompts: number, observations: number = n): MetricCell => ({
  value: n === 0 ? null : k / n,
  numerator: n === 0 ? 0 : (k / n) * prompts,
  denominator: prompts,
  n_observations: observations,
  pooled: { successes: k, trials: n },
});

const NO_CELL = cell(0, 0);

export interface EngineCells {
  mentioned?: MetricCell;
  cited?: MetricCell;
  share_of_voice?: MetricCell;
  series?: WeekCells[] | null;
  entities?: EntityCells[] | null;
}

/** An engine's summary; a metric left out has no answer at all. */
export const engine = (code: string, cells: EngineCells = {}): EngineSummary => ({
  engine_code: code,
  mentioned: cells.mentioned ?? NO_CELL,
  cited: cells.cited ?? NO_CELL,
  share_of_voice: cells.share_of_voice ?? NO_CELL,
  outcomes: { mentioned_and_cited: NO_CELL, mentioned_only: NO_CELL, cited_only: NO_CELL, neither: NO_CELL },
  ...(cells.series === undefined ? {} : { series: cells.series }),
  ...(cells.entities === undefined ? {} : { entities: cells.entities }),
});

/** A tracked entity's cells: its Mentioned and its share of voice. */
export const entityCells = (entityId: string, mentioned: MetricCell, share: MetricCell = NO_CELL): EntityCells => ({
  entity_id: entityId,
  mentioned,
  share_of_voice: share,
});

export const own = (entityId: string, name: string = 'Acme'): SummaryEntity => ({
  entity_id: entityId,
  name,
  role: 'own',
});

export const competitor = (entityId: string, name: string): SummaryEntity => ({
  entity_id: entityId,
  name,
  role: 'competitor',
});

/** What a pooled point holds: `weeks` weeks ending in the window `from` to `to`. */
export const pool = (weeks: number, from: string, to: string): PointPool => ({
  below_prompts: 10,
  reason: 'few_prompts',
  weeks,
  window: { from, to, timezone: 'UTC' },
});

export interface WeekCellsInput {
  mentioned?: MetricCell;
  cited?: MetricCell;
  share_of_voice?: MetricCell;
  prompts?: number;
  /** Present: the point is pooled. */
  pool?: PointPool;
  entities?: EntityCells[] | null;
}

/** One weekly point of a series. */
export const week = (weekStart: string, input: WeekCellsInput = {}): WeekCells => ({
  week_start: weekStart,
  prompts: input.prompts ?? 0,
  is_pooled: input.pool !== undefined,
  ...(input.pool === undefined ? {} : { pool: input.pool }),
  mentioned: input.mentioned ?? NO_CELL,
  cited: input.cited ?? NO_CELL,
  share_of_voice: input.share_of_voice ?? NO_CELL,
  ...(input.entities === undefined ? {} : { entities: input.entities }),
});
