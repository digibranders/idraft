import { leaderOn } from '@/features/prompts/topics-by-engine/leaders';
import type { EngineSummary, EntityCells, MetricCell, SummaryEntity, TopicSummaryRow } from '@/lib/api/types';
import { cellFigure, hasRate } from '@/lib/rates/rate-model';
import type { RateReading } from '@/lib/rates/strip-model';

/**
 * The Competitors tab as plain data (WB-TPE-13): the tracked entities down, the engines across, the chosen value of an
 * entity on an engine with the answers behind it, and the competitor that leads each engine. The tab puts words to it.
 */

/** The tracked set holds at most this many entities with cells (contract C2): the table never lists more. */
export const MAX_ENTITIES = 20;

export type EntityMetric = 'mentioned' | 'share_of_voice';

export interface EntityTableCell {
  engineCode: string;
  /** The entity's cell for the metric; `null` when the read holds none for it, which is no answer and never 0. */
  value: MetricCell | null;
  /** The cell as a rate with the answers behind it; `null` with no cell. */
  figure: RateReading | null;
  /** The competitor that leads the engine by this metric; never the own brand. */
  leads: boolean;
}

export interface EntityTableRow {
  entityId: string;
  name: string;
  role: 'own' | 'competitor';
  cells: EntityTableCell[];
}

/** The cells of `entityId` on an engine of the row, `undefined` when the engine or the entity has none. */
const cellsOf = (engine: EngineSummary | undefined, entityId: string): EntityCells | undefined =>
  engine?.entities?.find((cells) => cells.entity_id === entityId);

/**
 * The entity that leads `engine` by `metric`: by share of voice the rule of `leaderOn` (WB-TPE-08), by Mentioned the
 * competitor with the highest rate over at least `MIN_OBSERVATIONS` valid answers, ties by the order of `tracked`. A
 * competitor at 0 is not named, so it leads nothing.
 */
function leaderId(
  engine: EngineSummary | undefined,
  tracked: readonly SummaryEntity[],
  metric: EntityMetric,
): string | null {
  if (engine === undefined) return null;
  if (metric === 'share_of_voice') return leaderOn(engine, tracked).entityId;
  let best: { id: string; value: number } | null = null;
  for (const entity of tracked) {
    if (entity.role !== 'competitor') continue;
    const cell = cellsOf(engine, entity.entity_id)?.mentioned;
    if (cell === undefined || !hasRate(cell) || cell.value === null || cell.value <= 0) continue;
    if (best === null || cell.value > best.value) best = { id: entity.entity_id, value: cell.value };
  }
  return best?.id ?? null;
}

/**
 * The entity table of a topic: the own brand first, then the competitors in the order the API lists them, at most
 * `MAX_ENTITIES`, with one cell for each engine of `codes`. `row` is the topic's row read with `include=entities`;
 * `undefined` (not read) gives the entities with no cells.
 */
export function entityTable(
  row: TopicSummaryRow | undefined,
  tracked: readonly SummaryEntity[],
  codes: readonly string[],
  metric: EntityMetric,
): EntityTableRow[] {
  const entities = [...tracked]
    .sort((a, b) => Number(a.role !== 'own') - Number(b.role !== 'own'))
    .slice(0, MAX_ENTITIES);
  const leaders = new Map(
    codes.map((code) => [
      code,
      leaderId(
        row?.engines.find((engine) => engine.engine_code === code),
        tracked,
        metric,
      ),
    ]),
  );
  return entities.map((entity) => ({
    entityId: entity.entity_id,
    name: entity.name,
    role: entity.role,
    cells: codes.map((code): EntityTableCell => {
      const engine = row?.engines.find((candidate) => candidate.engine_code === code);
      const cells = cellsOf(engine, entity.entity_id);
      const value = cells?.[metric] ?? null;
      return {
        engineCode: code,
        value,
        // The engine's own cells name why a figure is missing; the entity's cells give the answers behind it
        figure:
          engine === undefined || cells === undefined
            ? null
            : cellFigure({ ...engine, mentioned: cells.mentioned, share_of_voice: cells.share_of_voice }, metric),
        leads: entity.role === 'competitor' && leaders.get(code) === entity.entity_id,
      };
    }),
  }));
}
