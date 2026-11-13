import type { EngineSummary, EntityCells, MetricCell, SummaryEntity } from '@/lib/api/types';
import { SAME_RATE } from './engine-values';
import { validAnswers } from '@/lib/rates/rate-model';
import { rateState } from '@/lib/stats';

/**
 * Which tracked competitor leads an engine of a topic (WB-TPE-08), and which competitors are drawn against the own
 * brand (N3). Plain data: the views put words to it.
 */

/**
 * `leader`: a competitor has the highest share of voice. `none-named`: every tracked competitor is at 0. `too-few`:
 * under `MIN_OBSERVATIONS` answers name a tracked brand, so no share is firm. `unknown`: the entity cells are not
 * there (not read yet, or a read made without them), or no competitor is tracked.
 */
export type LeaderState = 'leader' | 'none-named' | 'too-few' | 'unknown';

export interface EntityLeader {
  engineCode: string;
  state: LeaderState;
  entityId: string | null;
  name: string | null;
  /** The leader's share of voice cell: the value and the answers that name a brand behind it. */
  share: MetricCell | null;
  /** The leader's Mentioned cell. */
  mentioned: MetricCell | null;
  /** The own brand's share of voice cell beside the leader's; `null` when the entity cells hold none for it. */
  own: MetricCell | null;
  /** The names of the other competitors with the same share of voice, in the order of the tracked entities. */
  tiedWith: string[];
}

interface Competitor {
  entity: SummaryEntity;
  cells: EntityCells;
  /** Its place among the tracked entities: the order the API lists them in. */
  order: number;
}

/** The tracked competitors that have cells, in the order of `tracked`; a cell of an entity that is not tracked is left out. */
function competitorsWithCells(entities: readonly EntityCells[], tracked: readonly SummaryEntity[]): Competitor[] {
  return tracked.flatMap((entity, order) => {
    if (entity.role !== 'competitor') return [];
    const cells = entities.find((candidate) => candidate.entity_id === entity.entity_id);
    return cells === undefined ? [] : [{ entity, cells, order }];
  });
}

/** What a rate ranks by: no value is no rate, which ranks below 0. */
const rankOf = (cell: MetricCell): number => cell.value ?? -1;

/**
 * The leader of `engine`: among the tracked competitors (never the own brand) the highest share of voice, a tie going
 * to the higher mention rate and then to the order of `tracked`. A share is only firm over at least
 * `MIN_OBSERVATIONS` answers that name a tracked brand.
 */
export function leaderOn(engine: EngineSummary | undefined, tracked: readonly SummaryEntity[]): EntityLeader {
  const entities = engine?.entities;
  const blank: EntityLeader = {
    engineCode: engine?.engine_code ?? '',
    state: 'unknown',
    entityId: null,
    name: null,
    share: null,
    mentioned: null,
    own: null,
    tiedWith: [],
  };
  // No tracked competitor is no one to lead: unknown, which `none-named` (competitors there, none named) is not
  if (engine === undefined || entities == null || !tracked.some((entity) => entity.role === 'competitor')) return blank;
  const ownId = tracked.find((entity) => entity.role === 'own')?.entity_id;
  const own = entities.find((cells) => cells.entity_id === ownId)?.share_of_voice ?? null;
  if (rateState(validAnswers(engine.share_of_voice)) !== 'ok') return { ...blank, state: 'too-few', own };

  // A share of 0, or none, is not named
  const named = competitorsWithCells(entities, tracked)
    .filter(({ cells }) => (cells.share_of_voice.value ?? 0) > 0)
    .sort((a, b) => {
      const shares = rankOf(b.cells.share_of_voice) - rankOf(a.cells.share_of_voice);
      if (Math.abs(shares) > SAME_RATE) return shares;
      return rankOf(b.cells.mentioned) - rankOf(a.cells.mentioned) || a.order - b.order;
    });
  const top = named[0];
  if (top === undefined) return { ...blank, state: 'none-named', own };
  const topShare = rankOf(top.cells.share_of_voice);
  return {
    ...blank,
    state: 'leader',
    entityId: top.entity.entity_id,
    name: top.entity.name,
    share: top.cells.share_of_voice,
    mentioned: top.cells.mentioned,
    own,
    tiedWith: named
      .slice(1)
      .filter(({ cells }) => Math.abs(rankOf(cells.share_of_voice) - topShare) <= SAME_RATE)
      .sort((a, b) => a.order - b.order)
      .map(({ entity }) => entity.name),
  };
}

/**
 * The ids of the `count` tracked competitors with the highest Mentioned over the window on `engine`, ties by the order
 * of `tracked`. A competitor with no mention is never one of them. Empty without entity cells.
 */
export function topCompetitors(
  engine: EngineSummary | undefined,
  tracked: readonly SummaryEntity[],
  count: number,
): string[] {
  const entities = engine?.entities;
  if (entities == null) return [];
  return competitorsWithCells(entities, tracked)
    .filter(({ cells }) => (cells.mentioned.value ?? 0) > 0)
    .sort((a, b) => rankOf(b.cells.mentioned) - rankOf(a.cells.mentioned) || a.order - b.order)
    .slice(0, count)
    .map(({ entity }) => entity.entity_id);
}
