import {
  UNREAD,
  type EngineEntityTotals,
  type EntityFigures,
  type EntityTotals,
  type MentionFigure,
  type ShareFigure,
  type TrackedEntity,
  type TrackedSet,
} from './types';
import type { EngineSummary, EntityCells, MetricCell, PromptsSummary } from '@/lib/api/types';
import { pooledCounts, promptWeightedRate, rateState } from '@/lib/stats';

/**
 * What one engine says of every tracked brand in one window (WP-35 plan section 3.1). The source is the `total`
 * block when the read carries it (the real server), else a sum over the prompt rows. With neither, the engine is
 * `unread`: unknown is never zero.
 */

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/** No figure at all: a brand with no cell on an engine that was read. `state` says so; the zeros are not a reading. */
const NO_SHARE = (answers: number): ShareFigure => ({ state: 'none', value: null, numerator: 0, answers });
const NO_MENTION: MentionFigure = { state: 'none', value: null, k: 0, n: 0, prompts: 0 };

/** Share of voice from its sum of shares over the answers that name a tracked brand. */
export function shareFigureOf(numerator: number, answers: number): ShareFigure {
  const state = rateState(answers);
  return { state, value: state === 'ok' ? numerator / answers : null, numerator, answers };
}

/**
 * Mentioned from one prompt weighted cell (a total or a weekly point): `k` and `n` are the pooled successes and
 * trials, because the cell's own numerator and denominator are a sum of rates over prompts. A cell without `pooled`
 * counts answers itself.
 */
export function mentionFigureOf(cell: MetricCell | undefined): MentionFigure {
  if (cell === undefined) return NO_MENTION;
  const k = cell.pooled?.successes ?? cell.numerator;
  const n = cell.pooled?.trials ?? cell.denominator;
  const state = rateState(n);
  const pooled = cell.pooled !== undefined && cell.pooled !== null;
  return {
    state,
    value: state === 'ok' ? cell.value : null,
    k,
    n,
    prompts: pooled ? cell.denominator : Number(n >= 1),
  };
}

/** Mentioned over prompt rows: the mean of each prompt's own rate, the counts pooled, as the strip does. */
function mentionFigureOfRows(cells: readonly MetricCell[]): MentionFigure {
  if (cells.length === 0) return NO_MENTION;
  const counts = cells.map((cell) => ({ k: cell.numerator, n: cell.denominator }));
  const { k, n } = pooledCounts(counts);
  const state = rateState(n);
  return {
    state,
    value: state === 'ok' ? promptWeightedRate(counts) : null,
    k,
    n,
    prompts: counts.filter((count) => count.n >= 1).length,
  };
}

/** An engine entry that carries the entity cells (the read asked for `include=entities`). */
export function hasEntities(engine: EngineSummary): engine is EngineSummary & { entities: EntityCells[] } {
  return engine.entities !== undefined && engine.entities !== null;
}

/** The entries of one engine over the prompt rows of the summary, one per prompt that lists it. */
export function engineRows(summary: PromptsSummary, engineCode: string): EngineSummary[] {
  return summary.prompts.flatMap((prompt) => prompt.engines.filter((engine) => engine.engine_code === engineCode));
}

function figuresOf(entity: TrackedEntity, share: ShareFigure, mention: MentionFigure): EntityFigures {
  return { entity, share, mention };
}

function fromTotal(engine: EngineSummary, cells: readonly EntityCells[], set: TrackedSet): EngineEntityTotals {
  const answersNamingTracked = engine.share_of_voice.denominator;
  return {
    status: 'read',
    engineCode: engine.engine_code,
    validAnswers: engine.mentioned.pooled?.trials ?? engine.mentioned.denominator,
    answersNamingTracked,
    state: rateState(answersNamingTracked),
    entities: set.entities.map((entity) => {
      const cell = cells.find((candidate) => candidate.entity_id === entity.entityId);
      return cell === undefined
        ? figuresOf(entity, NO_SHARE(answersNamingTracked), NO_MENTION)
        : figuresOf(
            entity,
            shareFigureOf(cell.share_of_voice.numerator, answersNamingTracked),
            mentionFigureOf(cell.mentioned),
          );
    }),
  };
}

function fromRows(rows: readonly (EngineSummary & { entities: EntityCells[] })[], set: TrackedSet): EngineEntityTotals {
  const answersNamingTracked = sum(rows.map((row) => row.share_of_voice.denominator));
  const entityCells = (entityId: string): EntityCells[] =>
    rows.flatMap((row) => row.entities.filter((cell) => cell.entity_id === entityId));
  return {
    status: 'read',
    engineCode: rows[0]?.engine_code ?? '',
    validAnswers: sum(rows.map((row) => row.mentioned.denominator)),
    answersNamingTracked,
    state: rateState(answersNamingTracked),
    entities: set.entities.map((entity) => {
      const cells = entityCells(entity.entityId);
      return cells.length === 0
        ? figuresOf(entity, NO_SHARE(answersNamingTracked), NO_MENTION)
        : figuresOf(
            entity,
            shareFigureOf(sum(cells.map((cell) => cell.share_of_voice.numerator)), answersNamingTracked),
            mentionFigureOfRows(cells.map((cell) => cell.mentioned)),
          );
    }),
  };
}

/**
 * Per tracked brand, one engine, one window: share of voice (the sum of numerators over the sum of denominators,
 * so one answer is one weight whatever its prompt) and Mentioned (`k` of `n` from the pooled counts). Fewer than 4
 * answers naming a tracked brand is `insufficient` with no value. An engine the summary does not list, or lists
 * without entity cells, is `unread`.
 */
export function entityTotals(summary: PromptsSummary, engineCode: string, set: TrackedSet): EntityTotals {
  const total = summary.total?.engines.find((engine) => engine.engine_code === engineCode);
  if (total !== undefined && hasEntities(total)) return fromTotal(total, total.entities, set);
  const rows = engineRows(summary, engineCode).filter(hasEntities);
  return rows.length === 0 ? UNREAD : fromRows(rows, set);
}

/**
 * The same figures of the window before. `null` when there is no previous read, when it does not list the engine
 * and when it has no valid answer there: no data is not a rate of 0, so no change is drawn.
 */
export function previousEntityTotals(
  previous: PromptsSummary | null,
  engineCode: string,
  set: TrackedSet,
): EngineEntityTotals | null {
  if (previous === null) return null;
  const totals = entityTotals(previous, engineCode, set);
  return totals.status === 'read' && totals.validAnswers > 0 ? totals : null;
}
