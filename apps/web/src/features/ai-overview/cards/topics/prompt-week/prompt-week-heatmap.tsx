import type { ReactElement } from 'react';

import { HeatmapGrid, type HeatRow } from '@/components/app/chart/heatmap-grid';
import type { Density } from '@/lib/tables/table-state';

/**
 * What the heat map draws: a column per week, named by its Monday, and a row per prompt with one cell per column
 * (`promptWeekView` builds it, with the words and the links). Each cell says its answers and its weeks in its tip.
 */
export interface PromptWeekView {
  columns: { id: string; label: string }[];
  rows: HeatRow[];
}

export interface PromptWeekHeatmapProps {
  grid: PromptWeekView;
  /** The accessible name of the table. */
  caption: string;
  /** The header of the prompt column. */
  rowHeader: string;
  density: Density;
  /** `table`: the Table view of a frame, each cell printing its words. */
  form?: 'grid' | 'table' | undefined;
}

/**
 * The prompt by week heat map (CH-12): rows are the prompts of one topic, columns are weeks, a cell is the pooled
 * rate of that prompt up to that week on the shared bins. It reads a view and nothing of the Overview, so any screen
 * can render it once it is wired; a week without a valid answer is n/a and a cell under 4 answers is hatched.
 */
export function PromptWeekHeatmap({ grid, caption, rowHeader, density, form }: PromptWeekHeatmapProps): ReactElement {
  return (
    <HeatmapGrid
      caption={caption}
      rowHeader={rowHeader}
      columns={grid.columns}
      rows={grid.rows}
      scale="sequential"
      density={density}
      form={form}
    />
  );
}
