import type { CategorySeries, CategoryValue } from '@/lib/charts/category-chart';
import type { HistoryPoint, RankHistory } from '@/lib/api/types';

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
}

export interface RankHistoryOptions {
  ownName: (name: string) => string;
}

const PALETTE_INDICES = [2, 3, 4, 5, 6] as const;
type PaletteIndex = (typeof PALETTE_INDICES)[number];

const isPaletteIndex = (value: number | null | undefined): value is PaletteIndex =>
  typeof value === 'number' && PALETTE_INDICES.includes(value as PaletteIndex);

interface CheckSlot {
  key: string;
  date: string;
  observedAt: string | null;
}

/**
 * Transforms an API RankHistory response into chart-ready categories, series, and bands.
 */
export function rankHistoryChart(history: RankHistory, options: RankHistoryOptions): RankHistoryModel {
  const allSeries = history.series ?? [];
  const ownRaw = allSeries.find((s) => s.entity.role === 'own') ?? allSeries[0];
  const competitorsRaw = ownRaw ? allSeries.filter((s) => s !== ownRaw) : allSeries;

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

  const allPoints = allSeries.flatMap((s) => s.points);
  const allDepths = allPoints.map((p) => p.depth_requested ?? 20);
  const allRanks = allPoints.map((p) => p.rank).filter((r): r is number => typeof r === 'number');
  const maxNeeded = Math.max(20, ...allDepths, ...allRanks);
  const depthMax = maxNeeded <= 20 ? 20 : maxNeeded <= 50 ? 50 : maxNeeded <= 100 ? 100 : maxNeeded;

  const extractValues = (points: readonly HistoryPoint[]): CategoryValue[] => {
    const pointByKey = new Map<string, HistoryPoint>();
    const dateCounts = new Map<string, number>();
    for (const point of points) {
      const count = dateCounts.get(point.date) ?? 0;
      dateCounts.set(point.date, count + 1);
      const key = point.observed_at ?? `${point.date}#${String(count)}`;
      pointByKey.set(key, point);
    }
    return sortedSlots.map((slot) => {
      const point = pointByKey.get(slot.key);
      if (point === undefined) return null;
      if (point.state === 'failed') return 'failed';
      if (point.state === 'ranked') return point.rank;
      return null;
    });
  };

  const series: CategorySeries[] = [];
  if (ownRaw) {
    series.push({
      id: ownRaw.entity.entity_id,
      name: options.ownName(ownRaw.entity.canonical_name),
      role: { kind: 'brand' },
      values: extractValues(ownRaw.points),
    });
  }

  competitorsRaw.forEach((comp, index) => {
    const paletteIndex: PaletteIndex = isPaletteIndex(comp.entity.color_index)
      ? comp.entity.color_index
      : (PALETTE_INDICES[index % PALETTE_INDICES.length] ?? 2);

    series.push({
      id: comp.entity.entity_id,
      name: comp.entity.canonical_name,
      role: { kind: 'palette', index: paletteIndex },
      values: extractValues(comp.points),
    });
  });

  const ownEntityId = ownRaw?.entity.entity_id;
  const bands: RankHistoryBand[] = (history.bands ?? [])
    .filter((band) => ownEntityId !== undefined && band.entity_id === ownEntityId)
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
    empty: history.summary.checks === 0,
  };
}
