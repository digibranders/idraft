import { entityTotals } from './entity-totals';
import { UNREAD, type CoMentionCell, type CoMentionRead, type EntityFigures, type TrackedSet } from './types';
import type { PromptsSummary } from '@/lib/api/types';
import { rateState } from '@/lib/stats';

/** The matrix draws the own brand and the seven with the highest mention rate (D-7). */
const MAX_ENTITIES = 8;

/** One key for a pair, whichever way round it is written: the API lists each pair once with `a < b`. */
const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

function byMentionRate(a: EntityFigures, b: EntityFigures): number {
  if (a.entity.role !== b.entity.role) return a.entity.role === 'own' ? -1 : 1;
  const rateA = a.mention.value;
  const rateB = b.mention.value;
  if (rateA !== null && rateB !== null && rateA !== rateB) return rateB - rateA;
  if ((rateA === null) !== (rateB === null)) return rateA === null ? 1 : -1;
  return a.entity.name.localeCompare(b.entity.name);
}

/**
 * The share of answers that name two brands together, on one engine (CH-38), as a full symmetric matrix of the
 * top 8 tracked brands, you first. An off diagonal cell is the pair's answers over the engine's valid answers; a
 * pair absent from `pairs` is a real 0 of that total. The diagonal is the brand's own mention count (pooled
 * successes over trials), and is n/a when its trials are not the engine's valid answers. With fewer than 4 valid
 * answers every cell is insufficient and keeps its counts. `unread` without the engine in `co_mentions` or
 * without the entity cells.
 */
export function coMentionMatrix(summary: PromptsSummary, engineCode: string, set: TrackedSet): CoMentionRead {
  const entry = summary.co_mentions?.find((candidate) => candidate.engine_code === engineCode);
  const totals = entityTotals(summary, engineCode, set);
  if (entry === undefined || totals.status === 'unread') return UNREAD;
  const answers = entry.answers;
  const state = rateState(answers);
  const pairs = new Map(entry.pairs.map((pair) => [pairKey(pair.a, pair.b), pair.answers]));
  const shown = [...totals.entities].sort(byMentionRate).slice(0, MAX_ENTITIES);

  const cells = shown.map((row) =>
    shown.map((column): CoMentionCell => {
      const ids = { rowId: row.entity.entityId, columnId: column.entity.entityId };
      if (row === column) {
        const { k, n } = row.mention;
        const matches = n === answers;
        return { ...ids, state: matches ? state : 'none', value: matches && state === 'ok' ? k / n : null, k, n };
      }
      const k = pairs.get(pairKey(ids.rowId, ids.columnId)) ?? 0;
      return { ...ids, state, value: state === 'ok' ? k / answers : null, k, n: answers };
    }),
  );
  return {
    status: 'read',
    engineCode,
    answers,
    entities: shown.map((figures) => figures.entity),
    omitted: totals.entities.length - shown.length,
    cells,
  };
}
