import { brandMentionRead, entityMentions, type BrandMentionRead } from './brand-mentions';
import type { EngineSummary, EntityCells, MetricCell, PromptsSummary, WeekCells } from '@/lib/api/types';

/**
 * Share of voice as the owner decided it (D17, backend request 13): the `share_of_voice` cell of every block holds the
 * brand's mentions over all tracked-brand mentions. The API still sends the old equal split (a sum of shares), so this
 * rewrites the cell where the block carries entity cells, from the `entities[].mentioned` counts, and marks it where it
 * cannot: `share_note` says the counts are not collected or were cut by the cap of 20. Every reader of the cell then
 * reads one definition (`numerator` is x, `denominator` is y), and when the backend sends the count share this file goes
 * and the cell is read as it is. A cell is never a percent without its counts.
 */

/** Why a share of voice cell has no counts. */
export type ShareNote = 'notCollected' | 'capped';

/**
 * A share of voice cell of the web: a `MetricCell` that may say why it has no counts, and keeps the valid answers that name
 * a tracked brand (the denominator of the old cell), which the count share no longer holds.
 */
export type ShareCell = MetricCell & { share_note?: ShareNote; naming_answers?: number };

/** Why the cell has no counts; `undefined` for a cell that has them. */
export const shareNoteOf = (cell: MetricCell): ShareNote | undefined => (cell as ShareCell).share_note;

/**
 * The valid answers that name a tracked brand: what the Lost to competitor card needs to tell a prompt no brand is named
 * in. Without the field (a cell the API sends as it is) it is the cell's denominator, which is the same count until
 * backend request 13 lands and then needs the field of request 24.
 */
export const namingAnswersOf = (cell: MetricCell): number => (cell as ShareCell).naming_answers ?? cell.denominator;

const NOTE_OF = { notCollected: 'notCollected', capped: 'capped' } as const;

/** The share cell of the counts, or an empty one that says why there are none. Keeps the answers the old cell counted. */
function shareCellOf(read: BrandMentionRead, own: number | null, old: MetricCell | undefined): ShareCell {
  // A block of a partial body (an older API, a test double) may hold no old cell: it has no answers to keep
  const naming_answers = old === undefined ? 0 : namingAnswersOf(old);
  const n_observations = old?.n_observations ?? 0;
  if (read.kind !== 'counts') {
    return { numerator: 0, denominator: 0, value: null, n_observations, share_note: NOTE_OF[read.kind], naming_answers };
  }
  const { k, n } = own === null ? read.counts : { k: own, n: read.counts.n };
  return { numerator: k, denominator: n, value: n > 0 ? k / n : null, n_observations, naming_answers };
}

const ownSetOf = (summary: PromptsSummary): ReadonlySet<string> =>
  new Set(summary.entities.filter((entity) => entity.role === 'own').map((entity) => entity.entity_id));

/** One brand's cell of the block: its mentions over every tracked-brand mention of the block. */
function entityCell(cell: EntityCells, read: BrandMentionRead): EntityCells {
  return { ...cell, share_of_voice: shareCellOf(read, read.kind === 'counts' ? entityMentions(cell.mentioned) : null, cell.share_of_voice) };
}

interface Context {
  own: ReadonlySet<string>;
  tracked: number;
}

/** The previous window of an engine, when its entity cells carry it: the same count share over the window before. */
function previousOf(
  engine: EngineSummary,
  source: EngineSummary,
  { own, tracked }: Context,
): NonNullable<EngineSummary['previous']> {
  const previous = engine.previous as NonNullable<EngineSummary['previous']>;
  const cells = source.entities;
  const back = cells?.map((cell) => (cell.previous === undefined || cell.previous === null ? null : cell.previous)) ?? [];
  if (cells === undefined || cells === null || back.some((entry) => entry === null)) {
    return { ...previous, share_of_voice: shareCellOf({ kind: 'notCollected' }, null, previous.share_of_voice) };
  }
  const shown = cells.map((cell, index) => ({ entity_id: cell.entity_id, mentioned: back[index]?.mentioned ?? cell.mentioned }));
  const read = brandMentionRead({ entities: shown as EntityCells[] }, own, tracked);
  return { ...previous, share_of_voice: shareCellOf(read, null, previous.share_of_voice) };
}

/** A weekly point: its entity cells, where the read carries them, give its count share. */
function weekOf(point: WeekCells, { own, tracked }: Context): WeekCells {
  const read = brandMentionRead(point, own, tracked);
  return {
    ...point,
    share_of_voice: shareCellOf(read, null, point.share_of_voice),
    ...(point.entities === undefined || point.entities === null
      ? {}
      : { entities: point.entities.map((cell) => entityCell(cell, read)) }),
  };
}

/**
 * One engine block with its share of voice as brand-mention counts. `from` is the block whose entity cells give the
 * counts when the block has none of its own (the same row of the entity read, see `withBrandMentionShare`).
 */
function engineOf(engine: EngineSummary, context: Context, from?: EngineSummary): EngineSummary {
  const source = engine.entities === undefined || engine.entities === null ? (from ?? engine) : engine;
  const read = brandMentionRead(source, context.own, context.tracked);
  // The weekly points with their entity cells: the block's own, else those of the same block of the entity read
  const hasCells = (points: EngineSummary['series']): boolean => points?.some((point) => point.entities) === true;
  const weeks = hasCells(engine.series) || !hasCells(from?.series) ? engine.series : from?.series;
  return {
    ...engine,
    share_of_voice: shareCellOf(read, null, engine.share_of_voice),
    ...(engine.entities === undefined || engine.entities === null
      ? {}
      : { entities: engine.entities.map((cell) => entityCell(cell, read)) }),
    ...(engine.previous === undefined || engine.previous === null
      ? {}
      : { previous: previousOf(engine, source, context) }),
    ...(weeks === undefined || weeks === null ? {} : { series: weeks.map((point) => weekOf(point, context)) }),
  };
}

const enginesOf = (engines: readonly EngineSummary[], context: Context, from?: readonly EngineSummary[]): EngineSummary[] =>
  engines.map((engine) => engineOf(engine, context, from?.find((entry) => entry.engine_code === engine.engine_code)));

/**
 * The summary with the share of voice cells of every block as brand-mention counts. `source` is a read of the same
 * scope with the entity cells (`rows: topics`, `include: entities, total`): a topic row or the total of `summary` that
 * has none of its own takes its counts from the same topic or the total there, and a `summary` with no total block
 * takes the source's. A prompt row or a country row without entity cells has no counts ("not collected"). The same two
 * reads give the same object, so a render that holds them again holds the same summary.
 */
export function withBrandMentionShare(summary: PromptsSummary, source?: PromptsSummary | null): PromptsSummary {
  const bySource = CACHE.get(summary) ?? new WeakMap<object, PromptsSummary>();
  CACHE.set(summary, bySource);
  const key = source ?? NO_SOURCE;
  const held = bySource.get(key);
  if (held !== undefined) return held;
  const made = rewrite(summary, source);
  bySource.set(key, made);
  return made;
}

const CACHE = new WeakMap<PromptsSummary, WeakMap<object, PromptsSummary>>();
const NO_SOURCE = {};

function rewrite(summary: PromptsSummary, source: PromptsSummary | null | undefined): PromptsSummary {
  // A body that holds no tracked set or no rows (an older API, a partial test body) has nothing to count from: as it is
  if (!Array.isArray(summary.entities) || !Array.isArray(summary.prompts) || !Array.isArray(summary.topics)) {
    return summary;
  }
  const context: Context = { own: ownSetOf(summary), tracked: summary.entities.length };
  const topicOf = new Map((source?.topics ?? []).map((topic) => [topic.term_id, topic]));
  const total = summary.total ?? source?.total;
  return {
    ...summary,
    prompts: summary.prompts.map((prompt) => ({ ...prompt, engines: enginesOf(prompt.engines, context) })),
    topics: summary.topics.map((topic) => ({
      ...topic,
      engines: enginesOf(topic.engines, context, topicOf.get(topic.term_id)?.engines),
    })),
    ...(total === undefined || total === null
      ? {}
      : {
          total: {
            ...total,
            engines: enginesOf(total.engines, context, summary.total ? source?.total?.engines : undefined),
          },
        }),
    ...(summary.by_country === undefined || summary.by_country === null
      ? {}
      : { by_country: summary.by_country.map((row) => ({ ...row, engines: enginesOf(row.engines, context) })) }),
  };
}
