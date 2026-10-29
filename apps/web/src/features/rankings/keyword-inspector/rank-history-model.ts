import type { CategorySeries } from '@/lib/charts/category-chart';
import type { RankHistory } from '@/lib/api/types';

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

/**
 * Transforms an API RankHistory response into chart-ready categories, series, and bands.
 */
export function rankHistoryChart(history: RankHistory, options: RankHistoryOptions): RankHistoryModel {
  const allSeries = history.series ?? [];
  const ownRaw = allSeries.find((s) => s.entity.role === 'own') ?? allSeries[0];
  const competitorsRaw = ownRaw ? allSeries.filter((s) => s !== ownRaw) : allSeries;

  const dateSet = new Set<string>();
  for (const s of allSeries) {
    for (const point of s.points) {
      dateSet.add(point.date);
    }
  }
  const categories = [...dateSet].sort((a, b) => a.localeCompare(b));

  let depthMax = 20;
  if (ownRaw) {
    const ownDepths = ownRaw.points.map((p) => p.depth_requested ?? 20);
    const maxRequested = ownDepths.length > 0 ? Math.max(...ownDepths) : 20;
    depthMax = maxRequested <= 20 ? 20 : Math.min(100, Math.max(20, maxRequested));
  }

  const series: CategorySeries[] = [];
  if (ownRaw) {
    const pointByDate = new Map(ownRaw.points.map((p) => [p.date, p]));
    const values = categories.map((cat) => {
      const point = pointByDate.get(cat);
      return point?.state === 'ranked' ? point.rank : null;
    });
    series.push({
      id: ownRaw.entity.entity_id,
      name: options.ownName(ownRaw.entity.canonical_name),
      role: { kind: 'brand' },
      values,
    });
  }

  competitorsRaw.forEach((comp, index) => {
    const pointByDate = new Map(comp.points.map((p) => [p.date, p]));
    const values = categories.map((cat) => {
      const point = pointByDate.get(cat);
      return point?.state === 'ranked' ? point.rank : null;
    });

    const paletteIndex: PaletteIndex = isPaletteIndex(comp.entity.color_index)
      ? comp.entity.color_index
      : (PALETTE_INDICES[index % PALETTE_INDICES.length] ?? 2);

    series.push({
      id: comp.entity.entity_id,
      name: comp.entity.canonical_name,
      role: { kind: 'palette', index: paletteIndex },
      values,
    });
  });

  const ownEntityId = ownRaw?.entity.entity_id;
  const bands: RankHistoryBand[] = (history.bands ?? [])
    .filter((band) => ownEntityId !== undefined && band.entity_id === ownEntityId)
    .map((band) => {
      const from = categories.indexOf(band.from);
      const to = categories.indexOf(band.to);
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
