import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChartFrame } from './chart-frame';
import type { CategorySeries } from '@/lib/charts/category-chart';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// jsdom has no canvas: the frame is tested with a stand-in for the ECharts canvas
const latestOption = vi.fn<(opt: Record<string, unknown>) => void>();
vi.mock('./echart', () => ({
  EChart: ({ option }: { option: (tokens: unknown) => Record<string, unknown> }) => {
    latestOption(option({ palette: [] }));
    return <div data-testid="echart-canvas" />;
  },
}));

const SERIES: CategorySeries[] = [
  { id: 'volume', name: 'Search volume', role: { kind: 'brand' }, values: [8100, null, 9900] },
  { id: 'previous', name: 'Previous year', role: { kind: 'reference' }, values: [7400, 7100, 8800] },
];

function frame(kind: 'line' | 'bar' = 'line', controls?: React.ReactNode): React.ReactElement {
  return (
    <ChartFrame
      controls={controls}
      title="Search volume by month"
      variant="panel"
      meta="Last 3 months"
      kind={kind}
      categories={['Jul', 'Aug', 'Sep']}
      categoryHeader="Month"
      series={SERIES}
      formatValue={(value) => value.toLocaleString('en-US')}
      height={180}
      summary="Searches rose from 8,100 in July to 9,900 in September."
      status="ready"
    />
  );
}

describe('ChartFrame', () => {
  it('names the canvas by its title and describes it by its summary', async () => {
    const { container } = renderWithProviders(frame());
    expect(await screen.findByTestId('echart-canvas')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Search volume by month' })).toHaveAccessibleDescription(
      'Searches rose from 8,100 in July to 9,900 in September.',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Search volume by month' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('puts the words a caller gives for a point in the table view, in place of the bare value', async () => {
    const { user } = renderWithProviders(
      <ChartFrame
        title="Search volume by month"
        variant="panel"
        kind="line"
        categories={['Jul', 'Aug', 'Sep']}
        categoryHeader="Month"
        series={SERIES}
        formatValue={(value) => String(value)}
        cellText={(seriesId, index) => (seriesId === 'volume' && index === 0 ? '8100, 7000 to 9000' : null)}
        height={180}
        summary="Searches."
        status="ready"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('table', { name: 'Search volume by month' });
    expect(within(table).getByText('8100, 7000 to 9000')).toBeInTheDocument();
    // A point the caller says nothing of keeps its value
    expect(within(table).getByText('9900')).toBeInTheDocument();
  });

  it('toggles a series from the legend', async () => {
    const { user } = renderWithProviders(frame());
    const legend = screen.getByRole('list', { name: 'Series in Search volume by month' });
    const previous = within(legend).getByRole('button', { name: 'Previous year' });
    expect(previous).toHaveAttribute('aria-pressed', 'true');
    await user.click(previous);
    expect(previous).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the same numbers as a table, with a word for a missing value', async () => {
    const { user } = renderWithProviders(frame());
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('table', { name: 'Search volume by month' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Month', 'Search volume', 'Previous year']);
    expect(within(table).getByRole('row', { name: /Aug/ })).toHaveTextContent('AugNo data7,100');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('draws the controls it is given above the chart, and keeps them in the table view', async () => {
    const { user } = renderWithProviders(frame('line', <button type="button">Last 30 days</button>));
    const control = screen.getByRole('button', { name: 'Last 30 days' });
    const canvas = screen.getByRole('img', { name: 'Search volume by month' });
    expect(control.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Search volume by month' })).toBeInTheDocument();
  });

  it('puts the view toggle in the row of the controls when there are controls, and in the header when there are none', async () => {
    const { unmount } = renderWithProviders(frame('line', <button type="button">Last 30 days</button>));
    const control = screen.getByRole('button', { name: 'Last 30 days' });
    const views = screen.getByRole('group', { name: 'Search volume by month view' });
    // Siblings in one row: the controls and the views
    expect(views.parentElement).toBe(control.parentElement);
    unmount();
    renderWithProviders(frame('line'));
    const header = screen.getByRole('heading', { level: 2 }).closest('div[class*="flex-wrap"]');
    expect(header?.contains(screen.getByRole('group', { name: 'Search volume by month view' }))).toBe(true);
  });

  it('makes the scrolling table a named region that the keyboard can reach', async () => {
    const { user } = renderWithProviders(frame());
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const region = screen.getByRole('region', { name: 'Table of Search volume by month' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(within(region).getByRole('table', { name: 'Search volume by month' })).toBeInTheDocument();
  });

  it('offers patterns for bars only', () => {
    const { rerender } = renderWithProviders(frame('line'));
    expect(screen.queryByRole('button', { name: 'Patterns' })).toBeNull();
    rerender(frame('bar'));
    expect(screen.getByRole('button', { name: 'Patterns' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('passes extended option to EChart when extendOption is provided', async () => {
    renderWithProviders(
      <ChartFrame
        title="Search volume by month"
        variant="panel"
        kind="line"
        categories={['Jul', 'Aug', 'Sep']}
        categoryHeader="Month"
        series={SERIES}
        formatValue={(value) => value.toLocaleString('en-US')}
        height={180}
        summary="Summary"
        status="ready"
        extendOption={(opt) => ({ ...opt, marker: true })}
      />,
    );
    expect(await screen.findByTestId('echart-canvas')).toBeInTheDocument();
    expect(latestOption).toHaveBeenCalledWith(expect.objectContaining({ marker: true }));
  });
});
