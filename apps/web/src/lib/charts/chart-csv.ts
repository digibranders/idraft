import type { CategorySeries } from './category-chart';
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';

export interface ChartCsvInput {
  categoryHeader: string;
  categories: readonly string[];
  series: readonly CategorySeries[];
  /** The Table view's words for a point ("40%, 4 of 10 answers"), so the export carries the counts (R1). */
  cellText?: ((seriesId: string, index: number) => string | null) | undefined;
  /** The word for a failed point (`chart.failed`). */
  failedText: string;
}

/** A row per category, a column per series (hidden ones included); a gap is an empty cell, never 0 (R6). */
export function chartCsv({ categoryHeader, categories, series, cellText, failedText }: ChartCsvInput): CsvTable {
  const cell = (entry: CategorySeries, index: number): CsvCell => {
    const value = entry.values[index];
    if (value === 'failed') return failedText;
    if (value === null || value === undefined) return null;
    const words = cellText?.(entry.id, index) ?? null;
    return words === null ? value : safeText(words);
  };
  return {
    header: [categoryHeader, ...series.map((entry) => entry.name)].map(safeText),
    rows: categories.map((category, index) => [safeText(category), ...series.map((entry) => cell(entry, index))]),
  };
}
