import type { CategorySeries, CategoryValue } from '@/lib/charts/category-chart';
import type { EventFamily, EventMark } from '@/lib/charts/rank-chart';
import type { HistoryEvent, HistoryPoint, RankHistory } from '@/lib/api/types';
import { formatIsoDate } from '@/lib/format';

export interface RankHistoryBand {
  from: number;
  to: number;
  depth: number;
}

export interface RankHistorySummary {
  checks: number;
  ranked: number;
  beyond: number;
  failed: number;
}

export interface RankHistoryModel {
  categories: string[];
  series: CategorySeries[];
  depthMax: number;
  bands: RankHistoryBand[];
  summary: RankHistorySummary;
  empty: boolean;
  /** Own checks deeper than the standard depth that `deep: 'hide'` left out of the drawing. */
  deepHidden: number;
  /** The categories whose own check looked deeper than the standard depth (a failed check did not look). */
  deepIndices: number[];
  /** The check of each category, in the order of `categories`: where an event finds its place on the chart. */
  slots: CheckSlot[];
}

/** `auto` follows the deepest check (the inspector); `hide` keeps the axis at the standard depth; `show` extends it. */
export type DeepChecks = 'auto' | 'hide' | 'show';

export interface RankHistoryModelOptions {
  ownName: (name: string) => string;
  deep?: DeepChecks;
  /** Adds the own site's absolute rank (organic result plus the features above it) as a dashed reference series. */
  absolute?: boolean;
  absoluteName?: (name: string) => string;
  /** The competitors to draw, in this order; null or absent draws every competitor the history holds. */
  competitorIds?: readonly string[] | null;
}

/** The depth of an ordinary check. A check or a rank beyond it belongs to a deep check (15 section 7). */
export const STANDARD_DEPTH = 20;

const PALETTE_INDICES = [2, 3, 4, 5, 6] as const;
type PaletteIndex = (typeof PALETTE_INDICES)[number];

const isPaletteIndex = (value: number | null | undefined): value is PaletteIndex =>
  typeof value === 'number' && PALETTE_INDICES.includes(value as PaletteIndex);

/**
 * The chart colour (chart 2 to 6; chart 1 is the own site) of each competitor: the one the entity has, else
 * the lowest slot no competitor has, so up to five competitors get five different colours. Past five, slots
 * are reused in order. The list is every competitor of the keyword, not those drawn, so a colour does not
 * change when another competitor is added to the chart or taken off it.
 */
export function competitorPalette(
  competitors: readonly { id: string; colorIndex: number | null }[],
): Map<string, PaletteIndex> {
  const palette = new Map<string, PaletteIndex>();
  const taken = new Set<PaletteIndex>();
  for (const { id, colorIndex } of competitors) {
    if (isPaletteIndex(colorIndex)) {
      palette.set(id, colorIndex);
      taken.add(colorIndex);
    }
  }
  let uncoloured = 0;
  for (const { id } of competitors) {
    if (palette.has(id)) continue;
    const free = PALETTE_INDICES.find((slot) => !taken.has(slot));
    const slot = free ?? PALETTE_INDICES[uncoloured % PALETTE_INDICES.length] ?? 2;
    if (free === undefined) uncoloured += 1;
    else taken.add(free);
    palette.set(id, slot);
  }
  return palette;
}

/** One check of the chart, one category of its x axis: the project local day and the instant of the check. */
export interface CheckSlot {
  key: string;
  date: string;
  observedAt: string | null;
}

/** A check that looked deeper than the standard depth and found the site only below it, or nowhere: `hide` leaves it out. */
export const isHiddenDeepCheck = (point: HistoryPoint): boolean =>
  point.state !== 'failed' &&
  (point.depth_requested ?? STANDARD_DEPTH) > STANDARD_DEPTH &&
  (point.rank === null || point.rank > STANDARD_DEPTH);

/**
 * Transforms an API RankHistory response into chart-ready categories, series, and bands.
 */
export function rankHistoryChart(history: RankHistory, options: RankHistoryModelOptions): RankHistoryModel {
  const allSeries = history.series ?? [];
  const ownRaw = allSeries.find((s) => s.entity.role === 'own') ?? allSeries[0];
  const othersRaw = ownRaw ? allSeries.filter((s) => s !== ownRaw) : allSeries;
  const chosen = options.competitorIds;
  const competitorsRaw =
    chosen === null || chosen === undefined
      ? othersRaw
      : chosen.flatMap((id) => othersRaw.filter((s) => s.entity.entity_id === id));
  const hide = options.deep === 'hide';
  const drawn = ownRaw ? [ownRaw, ...competitorsRaw] : competitorsRaw;

  const slotMap = new Map<string, CheckSlot>();
  for (const s of allSeries) {
    const dateCounts = new Map<string, number>();
    for (const point of s.points) {
      const count = dateCounts.get(point.date) ?? 0;
      dateCounts.set(point.date, count + 1);
      const key = point.observed_at ?? `${point.date}#${String(count)}`;
      if (!slotMap.has(key)) {
        slotMap.set(key, { key, date: point.date, observedAt: point.observed_at });
      }
    }
  }

  const sortedSlots = [...slotMap.values()].sort((a, b) => {
    if (a.observedAt !== null && b.observedAt !== null) {
      return a.observedAt.localeCompare(b.observedAt);
    }
    return a.key.localeCompare(b.key);
  });

  const categories = sortedSlots.map((slot) => slot.date);

  const allPoints = drawn.flatMap((s) => s.points);
  const allDepths = allPoints.map((p) => p.depth_requested ?? STANDARD_DEPTH);
  const allRanks = allPoints
    .flatMap((p) => (options.absolute === true ? [p.rank, p.absolute_rank] : [p.rank]))
    .filter((r): r is number => typeof r === 'number');
  const maxNeeded = Math.max(STANDARD_DEPTH, ...allDepths, ...allRanks);
  const deepestAxis = maxNeeded <= 20 ? 20 : maxNeeded <= 50 ? 50 : maxNeeded <= 100 ? 100 : maxNeeded;
  const depthMax = hide ? STANDARD_DEPTH : deepestAxis;

  // A value deeper than the standard depth is not drawn while deep checks are hidden
  const drawable = (value: number | null): number | null =>
    value !== null && hide && value > STANDARD_DEPTH ? null : value;

  /** The series' points laid on the chart's check slots: a slot the series has no point for is undefined. */
  const pointsBySlot = (points: readonly HistoryPoint[]): (HistoryPoint | undefined)[] => {
    const pointByKey = new Map<string, HistoryPoint>();
    const dateCounts = new Map<string, number>();
    for (const point of points) {
      const count = dateCounts.get(point.date) ?? 0;
      dateCounts.set(point.date, count + 1);
      const key = point.observed_at ?? `${point.date}#${String(count)}`;
      pointByKey.set(key, point);
    }
    return sortedSlots.map((slot) => pointByKey.get(slot.key));
  };

  const extractValues = (
    points: readonly HistoryPoint[],
    valueOf: (point: HistoryPoint) => CategoryValue,
  ): CategoryValue[] => pointsBySlot(points).map((point) => (point === undefined ? null : valueOf(point)));

  const rankOf = (point: HistoryPoint): CategoryValue => {
    if (point.state === 'failed') return 'failed';
    return point.state === 'ranked' ? drawable(point.rank) : null;
  };

  const series: CategorySeries[] = [];
  if (ownRaw) {
    series.push({
      id: ownRaw.entity.entity_id,
      name: options.ownName(ownRaw.entity.canonical_name),
      role: { kind: 'brand' },
      values: extractValues(ownRaw.points, rankOf),
    });
    if (options.absolute === true && options.absoluteName !== undefined) {
      series.push({
        id: `${ownRaw.entity.entity_id}:absolute`,
        name: options.absoluteName(options.ownName(ownRaw.entity.canonical_name)),
        role: { kind: 'reference' },
        values: extractValues(ownRaw.points, (point) =>
          point.state === 'ranked' ? drawable(point.absolute_rank) : null,
        ),
      });
    }
  }

  const palette = competitorPalette(
    othersRaw.map((comp) => ({ id: comp.entity.entity_id, colorIndex: comp.entity.color_index })),
  );
  competitorsRaw.forEach((comp) => {
    series.push({
      id: comp.entity.entity_id,
      name: comp.entity.canonical_name,
      role: { kind: 'palette', index: palette.get(comp.entity.entity_id) ?? 2 },
      values: extractValues(comp.points, rankOf),
    });
  });

  const ownEntityId = ownRaw?.entity.entity_id;
  const bands: RankHistoryBand[] = (history.bands ?? [])
    .filter((band) => ownEntityId !== undefined && band.entity_id === ownEntityId)
    .filter((band) => !hide || band.depth_requested <= STANDARD_DEPTH)
    .map((band) => {
      const from = categories.indexOf(band.from);
      const to = categories.lastIndexOf(band.to);
      return {
        from: from >= 0 ? from : 0,
        to: to >= 0 ? to : Math.max(0, categories.length - 1),
        depth: band.depth_requested,
      };
    });

  const summary: RankHistorySummary = {
    checks: history.summary.checks,
    ranked: history.summary.ranked_checks,
    beyond: history.summary.beyond_depth_checks,
    failed: history.summary.failed_checks,
  };

  return {
    categories,
    series,
    depthMax,
    bands,
    summary,
    empty: history.summary.checks + history.summary.failed_checks === 0,
    deepHidden: hide ? (ownRaw?.points ?? []).filter(isHiddenDeepCheck).length : 0,
    deepIndices: pointsBySlot(ownRaw?.points ?? []).flatMap((point, index) =>
      point !== undefined && point.state !== 'failed' && (point.depth_requested ?? STANDARD_DEPTH) > STANDARD_DEPTH
        ? [index]
        : [],
    ),
    slots: sortedSlots,
  };
}

/** The event types the chart draws, and the family (shape) of each (15 section 7 rule 6). */
const CHART_FAMILY: Readonly<Record<string, EventFamily>> = {
  url_changed: 'url',
  entered_top_10: 'rank',
  lost_top_10: 'rank',
  aio_appeared: 'aio',
  aio_disappeared: 'aio',
};

/**
 * The events of the own site that the chart marks, each on a check. The event of a check carries the instant
 * of that check; one that does not goes on the last check of its project local day. An event of another
 * entity, of a type the chart does not draw, or on a day without a check in the window is left out.
 * `labelOf` words an event type; the marks come back in the order of the checks.
 */
export function eventMarksOf(
  events: readonly HistoryEvent[],
  slots: readonly CheckSlot[],
  ownEntityId: string,
  labelOf: (type: string) => string,
  timeZone = 'UTC',
): EventMark[] {
  const marks: EventMark[] = [];
  for (const event of events) {
    const family = CHART_FAMILY[event.event_type];
    if (family === undefined || event.entity_id !== ownEntityId) continue;
    const at = Date.parse(event.occurred_at);
    let index = slots.findIndex((slot) => slot.observedAt !== null && Date.parse(slot.observedAt) === at);
    if (index === -1) {
      const date = formatIsoDate(event.occurred_at, timeZone);
      index = slots.reduce((last, slot, position) => (slot.date === date ? position : last), -1);
    }
    if (index === -1) continue;
    marks.push({ index, family, label: labelOf(event.event_type) });
  }
  // The sort is stable: events of one check keep the order they came in
  return marks.sort((a, b) => a.index - b.index);
}
