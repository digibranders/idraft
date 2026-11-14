import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useTrendColumn } from './trend-column';
import type { EngineSummary, MetricCell, ProjectEngine, WeekCells } from '@/lib/api/types';
import { renderWithProviders } from '@/test/render';

// The props the cell gives the sparkline are what is read here: its drawing is the sparkline's own
vi.mock('@/components/app/sparkline/sparkline-cell', () => ({
  SparklineCell: (props: { label: string; tone?: string; minSpan?: number; values: readonly (number | null)[] }) => (
    <span
      role="img"
      aria-label={props.label}
      data-tone={props.tone ?? 'default'}
      data-min-span={String(props.minSpan)}
      data-values={props.values.join(',')}
    />
  ),
}));

const cell = (value: number): MetricCell => ({ value, numerator: value * 8, denominator: 8, n_observations: 8 });
const week = (weekStart: string, value: number): WeekCells => ({
  week_start: weekStart,
  prompts: 1,
  is_pooled: false,
  mentioned: cell(value),
  cited: cell(0),
  share_of_voice: cell(0),
});
const ROW = {
  cells: [
    {
      engine_code: 'chatgpt_web',
      mentioned: cell(0.5),
      cited: cell(0.5),
      share_of_voice: cell(0.5),
      // A line that climbs from 10% to 90%: the colors a direction would take are not the line's
      series: [week('2026-10-12', 0.1), week('2026-10-19', 0.3), week('2026-10-26', 0.6), week('2026-11-02', 0.9)],
    },
  ] as unknown as readonly EngineSummary[],
};
interface Row {
  cells: readonly EngineSummary[];
}
const cellsOf = (row: Row): readonly EngineSummary[] => row.cells;
const ENGINES = [{ engine: { engine_code: 'chatgpt_web', label: 'ChatGPT' } }] as unknown as ProjectEngine[];

function Cell(): ReactElement {
  const column = useTrendColumn<Row>(ENGINES, cellsOf);
  return <div>{column.cell(ROW)}</div>;
}

describe('the sparkline of the Trend cell', () => {
  it('is never red or green, whichever way the rate went: the line is the reference gray', () => {
    renderWithProviders(<Cell />);
    expect(screen.getByRole('img')).toHaveAttribute('data-tone', 'reference');
  });

  it('draws a rate on a span of at least 20 points, so a point or two stays flat', () => {
    renderWithProviders(<Cell />);
    expect(screen.getByRole('img')).toHaveAttribute('data-min-span', '0.2');
  });

  it('gives the sparkline the rate of each week, a gap as nothing', () => {
    renderWithProviders(<Cell />);
    expect(screen.getByRole('img')).toHaveAttribute('data-values', '0.1,0.3,0.6,0.9');
  });
});
