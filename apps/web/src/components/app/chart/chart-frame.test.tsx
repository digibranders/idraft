import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChartFrame } from './chart-frame';
import * as chartPng from './chart-png';
import type { LegendItem } from './chart-legend';
import type { CategorySeries } from '@/lib/charts/category-chart';
import * as csvWrite from '@/lib/csv/csv-write';
import * as readTokens from '@/lib/design/read-tokens';
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
// The image is drawn by `chart-png.ts`, which the frame loads only when Download PNG is picked
vi.mock('./chart-png', () => ({
  renderChartPng: vi.fn(() => Promise.resolve(new Blob(['png'], { type: 'image/png' }))),
  echartBody: vi.fn(() => vi.fn()),
}));
// Nothing is downloaded: the call is what the tests read
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof csvWrite>()),
  downloadBlob: vi.fn(),
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

  it('draws the inspector variant as a level 3 title without the panel border and padding', async () => {
    const { container, rerender } = renderWithProviders(frame());
    const panel = container.querySelector('section');
    expect(panel).toHaveClass('border', 'p-4');
    expect(screen.getByRole('heading', { level: 2, name: 'Search volume by month' })).toBeInTheDocument();

    rerender(
      <ChartFrame
        title="Search volume by month"
        variant="inspector"
        kind="line"
        categories={['Jul', 'Aug', 'Sep']}
        categoryHeader="Month"
        series={SERIES}
        formatValue={(value) => String(value)}
        height={180}
        summary="Searches."
        status="ready"
      />,
    );
    expect(await screen.findByTestId('echart-canvas')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Search volume by month' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    const inspector = container.querySelector('section');
    expect(inspector).not.toHaveClass('border');
    expect(inspector).not.toHaveClass('p-4');
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

const CATEGORY_BASE = {
  title: 'Search volume by month',
  variant: 'panel' as const,
  meta: 'Last 3 months',
  kind: 'line' as const,
  categories: ['Jul', 'Aug', 'Sep'],
  categoryHeader: 'Month',
  series: SERIES,
  formatValue: (value: number): string => String(value),
  height: 180 as const,
  summary: 'Searches rose from 8,100 in July to 9,900 in September.',
};

const LEGEND: LegendItem[] = [
  { id: 'chatgpt', name: 'ChatGPT', role: { kind: 'brand' }, pressed: true },
  { id: 'previous', name: 'Previous period', role: { kind: 'reference' }, pressed: true },
];

const HTML_BASE = {
  title: 'Mention rate by engine',
  variant: 'panel' as const,
  kind: 'html' as const,
  height: 180 as const,
  summary: 'ChatGPT mentions the brand in 47 percent of answers.',
  legend: LEGEND,
  body: <div data-testid="html-body">Bars</div>,
  table: <div data-testid="html-table">Rows</div>,
};

describe('ChartFrame loadingHeight', () => {
  // The loading body is the box around the skeleton block
  const reserved = (container: HTMLElement): HTMLElement | null =>
    container.querySelector('[data-slot="skeleton"]')?.parentElement ?? null;

  it('reserves the chart height while loading when loadingHeight is not given', () => {
    const { container } = renderWithProviders(<ChartFrame {...HTML_BASE} status="loading" />);
    expect(reserved(container)).toHaveStyle({ height: '180px' });
  });

  it('reserves loadingHeight instead of the chart height while loading, for an html and a category chart', () => {
    const html = renderWithProviders(<ChartFrame {...HTML_BASE} loadingHeight={352} status="loading" />);
    expect(reserved(html.container)).toHaveStyle({ height: '352px' });
    html.unmount();
    const category = renderWithProviders(<ChartFrame {...CATEGORY_BASE} loadingHeight={300} status="loading" />);
    expect(reserved(category.container)).toHaveStyle({ height: '300px' });
  });

  it('never reserves less than the chart height while loading', () => {
    const { container } = renderWithProviders(<ChartFrame {...HTML_BASE} loadingHeight={100} status="loading" />);
    expect(reserved(container)).toHaveStyle({ height: '180px' });
  });

  it('renders a slim empty state without forcing the tall chart height, and leaves error at chart height', () => {
    const empty = renderWithProviders(
      <ChartFrame
        {...HTML_BASE}
        loadingHeight={352}
        status="empty"
        empty={{ title: 'No answers yet', reason: 'The first run is on Thursday.' }}
      />,
    );
    expect(empty.container.querySelector('[data-slot="chart-state"]')).not.toHaveStyle({ minHeight: '180px' });
    expect(empty.container.querySelector('section')).toHaveClass('py-3');
    empty.unmount();
    const error = renderWithProviders(
      <ChartFrame
        {...HTML_BASE}
        loadingHeight={352}
        status="error"
        error={{
          title: 'Could not load',
          reason: 'The read failed.',
          errorId: null,
          onRetry: vi.fn(),
          retrying: false,
          retryLabel: 'Try again',
        }}
      />,
    );
    expect(error.container.querySelector('[data-slot="chart-state"]')).toHaveStyle({ minHeight: '180px' });
  });

  it('does not reserve loadingHeight once the chart is ready', () => {
    const { container } = renderWithProviders(<ChartFrame {...HTML_BASE} loadingHeight={352} status="ready" />);
    expect(reserved(container)).toBeNull();
    expect(screen.getByTestId('html-body').parentElement).toHaveStyle({ minHeight: '180px' });
  });
});

describe('ChartFrame html kind', () => {
  it('draws the title, the legend and the body, and the table in place of the body on Table', async () => {
    const { user } = renderWithProviders(<ChartFrame {...HTML_BASE} status="ready" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Mention rate by engine' })).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: 'Series in Mention rate by engine' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['ChatGPT', 'Previous period']);
    expect(screen.getByTestId('html-body')).toBeInTheDocument();
    expect(screen.getByText('ChatGPT mentions the brand in 47 percent of answers.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByTestId('html-table')).toBeInTheDocument();
    expect(screen.queryByTestId('html-body')).toBeNull();
  });

  it('gives a body written as a function the Patterns state', async () => {
    const { user } = renderWithProviders(
      <ChartFrame
        {...HTML_BASE}
        patterns
        body={({ patterns }) => <div data-testid="html-body">{patterns ? 'hatched' : 'plain'}</div>}
        status="ready"
      />,
    );
    expect(screen.getByTestId('html-body')).toHaveTextContent('plain');
    await user.click(screen.getByRole('button', { name: 'Patterns' }));
    expect(screen.getByTestId('html-body')).toHaveTextContent('hatched');
  });

  it('calls onLegendToggle with the id of the item that was pressed', async () => {
    const onLegendToggle = vi.fn();
    const { user } = renderWithProviders(<ChartFrame {...HTML_BASE} onLegendToggle={onLegendToggle} status="ready" />);
    await user.click(screen.getByRole('button', { name: 'ChatGPT' }));
    expect(onLegendToggle).toHaveBeenCalledExactlyOnceWith('chatgpt');
  });
});

describe('ChartFrame states', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says what is missing and what changes it when empty, in a slim state', () => {
    const { container } = renderWithProviders(
      <ChartFrame
        {...HTML_BASE}
        menu={{ fileName: 'mention-rate', link: 'https://app.test/x' }}
        status="empty"
        empty={{
          title: 'No answers yet',
          reason: 'The first run is on Thursday.',
          action: <button type="button">Run now</button>,
        }}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Mention rate by engine' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'No answers yet' })).toBeInTheDocument();
    expect(screen.getByText('The first run is on Thursday.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run now' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
    expect(container.querySelector('[data-slot="chart-state"]')).not.toHaveStyle({ minHeight: '180px' });
    expect(container.querySelector('section')).toHaveClass('py-3');
  });

  it('replaces the chart with the error and its retry, which shows it is running', async () => {
    const onRetry = vi.fn();
    const error = {
      title: 'Could not load the chart',
      reason: 'The server returned an error.',
      errorId: null,
      onRetry,
      retrying: false,
      retryLabel: 'Try again',
    };
    const { user, rerender } = renderWithProviders(<ChartFrame {...HTML_BASE} status="error" error={error} />);
    expect(screen.getByText('Could not load the chart')).toBeInTheDocument();
    expect(screen.getByText('The server returned an error.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    rerender(<ChartFrame {...HTML_BASE} status="error" error={{ ...error, retrying: true }} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps the chart while it refetches, with a bar at once and "Updating" after 400 ms', () => {
    vi.useFakeTimers();
    const { container } = renderWithProviders(<ChartFrame {...CATEGORY_BASE} status="refetching" />);
    expect(container.querySelector('section')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Search volume by month' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(screen.queryByText('Updating')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('Updating')).toBeInTheDocument();
  });

  it('shows a stale or partial notice at the end of the meta line', () => {
    renderWithProviders(
      <ChartFrame
        {...CATEGORY_BASE}
        notice={{ kind: 'stale', text: 'Stale: last collected Sep 27, 18:30 CEST' }}
        status="ready"
      />,
    );
    const meta = screen.getByText('Last 3 months').parentElement;
    expect(meta).toHaveTextContent('Stale: last collected Sep 27, 18:30 CEST');
  });

  it('keeps the chart in full opacity while it refetches', () => {
    renderWithProviders(<ChartFrame {...CATEGORY_BASE} status="refetching" />);
    const wrapper = screen.getByRole('img', { name: 'Search volume by month' }).parentElement;
    expect(wrapper?.className).not.toMatch(/opacity-/);
  });

  it('hides the Table and More buttons while loading', () => {
    renderWithProviders(
      <ChartFrame {...HTML_BASE} menu={{ fileName: 'mention-rate', link: 'https://app.test/x' }} status="loading" />,
    );
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
  });

  it('hides the Table and More buttons on error', () => {
    renderWithProviders(
      <ChartFrame
        {...HTML_BASE}
        menu={{ fileName: 'mention-rate', link: 'https://app.test/x' }}
        status="error"
        error={{
          title: 'Could not load the chart',
          reason: 'The server returned an error.',
          errorId: null,
          onRetry: vi.fn(),
          retrying: false,
          retryLabel: 'Try again',
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
  });
});

describe('ChartFrame overflow menu', () => {
  const MENU = { fileName: 'volume', png: true, csv: true, link: 'https://app.test/x' } as const;
  const TRIGGER = { name: 'More actions for Search volume by month' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Opens the menu the way a keyboard does: focus the trigger, press Enter. */
  async function open(user: ReturnType<typeof renderWithProviders>['user']): Promise<HTMLElement> {
    const trigger = screen.getByRole('button', TRIGGER);
    trigger.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menu');
    return trigger;
  }

  it('has no More button when the chart gives no menu', () => {
    renderWithProviders(<ChartFrame {...CATEGORY_BASE} status="ready" />);
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
  });

  it('opens by keyboard, lists the three actions, and closes on Escape with focus back on the trigger', async () => {
    const { user } = renderWithProviders(<ChartFrame {...CATEGORY_BASE} menu={MENU} status="ready" />);
    const trigger = await open(user);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Download PNG',
      'Download CSV',
      'Copy link',
    ]);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('downloads the series as CSV with the byte order mark, the header and a gap as an empty cell', async () => {
    const { user } = renderWithProviders(<ChartFrame {...CATEGORY_BASE} menu={MENU} status="ready" />);
    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'Download CSV' }));
    const [blob, name] = vi.mocked(csvWrite.downloadBlob).mock.calls[0] ?? [];
    expect(name).toBe('volume.csv');
    if (!(blob instanceof Blob)) throw new Error('No file was downloaded');
    // Reading text drops the byte order mark, so the bytes are read: EF BB BF
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const text = await blob.text();
    expect(text.startsWith('Month,Search volume,Previous year')).toBe(true);
    expect(text).toContain('Jul,8100,7400');
    expect(text).toContain('Aug,,7100');
  });

  it('downloads the chart as PNG from the title, meta, visible legend and footnote it shows', async () => {
    const { user } = renderWithProviders(
      <ChartFrame {...CATEGORY_BASE} footnote="Source: Google Ads" menu={MENU} status="ready" />,
    );
    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'Download PNG' }));
    await waitFor(() => expect(csvWrite.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'volume.png'));
    expect(chartPng.renderChartPng).toHaveBeenCalledExactlyOnceWith({
      frame: {
        title: 'Search volume by month',
        meta: 'Last 3 months',
        legend: [
          { name: 'Search volume', color: expect.any(String), dash: 'solid' },
          { name: 'Previous year', color: expect.any(String), dash: 'dashed' },
        ],
        footnote: 'Source: Google Ads',
      },
      colors: expect.anything(),
      width: expect.any(Number),
      body: expect.anything(),
    });
  });

  it('carries the stale or partial notice into the image, after the meta', async () => {
    const { user } = renderWithProviders(
      <ChartFrame
        {...CATEGORY_BASE}
        notice={{ kind: 'partial', text: 'Partial data: 612 of 1,000 prompts asked' }}
        menu={MENU}
        status="ready"
      />,
    );
    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'Download PNG' }));
    await waitFor(() => expect(chartPng.renderChartPng).toHaveBeenCalledOnce());
    const [input] = vi.mocked(chartPng.renderChartPng).mock.calls[0] ?? [];
    expect(input?.frame.meta).toBe('Last 3 months, Partial data: 612 of 1,000 prompts asked');
  });

  it('uses the notice as the meta line of the image when the chart has no meta', async () => {
    const { user } = renderWithProviders(
      <ChartFrame
        {...CATEGORY_BASE}
        meta={null}
        notice={{ kind: 'stale', text: 'Stale: last collected Sep 27, 18:30 CEST' }}
        menu={MENU}
        status="ready"
      />,
    );
    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'Download PNG' }));
    await waitFor(() => expect(chartPng.renderChartPng).toHaveBeenCalledOnce());
    const [input] = vi.mocked(chartPng.renderChartPng).mock.calls[0] ?? [];
    expect(input?.frame.meta).toBe('Stale: last collected Sep 27, 18:30 CEST');
  });

  it('hands the image the light colours, read once, while the dark theme is on screen', async () => {
    const root = document.documentElement;
    root.classList.add('dark');
    const chartTokens = (name: string): readTokens.ChartTokens => ({
      palette: [`${name}-1`],
      other: `${name}-other`,
      reference: `${name}-reference`,
      grid: name,
      axis: name,
      label: name,
      band: name,
      rankBandNone: name,
      surfaceElevated: name,
      border: name,
      borderStrong: name,
      foreground: name,
      foregroundSecondary: name,
      foregroundMuted: name,
      fontFamily: 'sans-serif',
    });
    const readChart = vi
      .spyOn(readTokens, 'readChartTokens')
      .mockImplementation(() => chartTokens(root.classList.contains('dark') ? 'dark' : 'light'));
    const readColor = vi
      .spyOn(readTokens, 'readColorToken')
      .mockImplementation(() => (root.classList.contains('dark') ? 'dark-surface' : 'light-surface'));
    try {
      const { user } = renderWithProviders(<ChartFrame {...CATEGORY_BASE} menu={MENU} status="ready" />);
      await open(user);
      await user.click(screen.getByRole('menuitem', { name: 'Download PNG' }));
      await waitFor(() => expect(chartPng.renderChartPng).toHaveBeenCalledOnce());
      const [input] = vi.mocked(chartPng.renderChartPng).mock.calls[0] ?? [];
      expect(input?.frame.legend.map((entry) => entry.color)).toEqual(['light-1', 'light-reference']);
      expect(input?.colors).toEqual({ chart: chartTokens('light'), surface: 'light-surface' });
      expect(readChart).toHaveBeenCalledOnce();
      expect(root.classList.contains('dark')).toBe(true);
    } finally {
      readChart.mockRestore();
      readColor.mockRestore();
      root.classList.remove('dark');
    }
  });

  it('downloads the table a caller gave in place of the series, for a line or bar chart', async () => {
    const csv = { header: ['Engine', 'Rate'], rows: [['ChatGPT', 0.47]] };
    const { user } = renderWithProviders(
      <ChartFrame {...CATEGORY_BASE} menu={{ fileName: 'rate', csv }} status="ready" />,
    );
    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'Download CSV' }));
    const [blob, name] = vi.mocked(csvWrite.downloadBlob).mock.calls[0] ?? [];
    expect(name).toBe('rate.csv');
    if (!(blob instanceof Blob)) throw new Error('No file was downloaded');
    const text = await blob.text();
    expect(text).toContain('Engine,Rate');
    expect(text).toContain('ChatGPT,0.47');
    expect(text).not.toContain('Month');
  });

  it('downloads the table an html chart gives', async () => {
    const csv = { header: ['Engine', 'Rate'], rows: [['ChatGPT', 0.47]] };
    const { user } = renderWithProviders(
      <ChartFrame {...HTML_BASE} menu={{ fileName: 'mention-rate', csv }} status="ready" />,
    );
    screen.getByRole('button', { name: 'More actions for Mention rate by engine' }).focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('menuitem', { name: 'Download CSV' }));
    const [blob, name] = vi.mocked(csvWrite.downloadBlob).mock.calls[0] ?? [];
    expect(name).toBe('mention-rate.csv');
    if (!(blob instanceof Blob)) throw new Error('No file was downloaded');
    expect(await blob.text()).toContain('Engine,Rate\r\nChatGPT,0.47');
  });

  it('leaves a series that the legend turned off out of the image', async () => {
    const { user } = renderWithProviders(<ChartFrame {...CATEGORY_BASE} menu={MENU} status="ready" />);
    await user.click(screen.getByRole('button', { name: 'Previous year' }));
    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'Download PNG' }));
    await waitFor(() => expect(chartPng.renderChartPng).toHaveBeenCalledOnce());
    const [input] = vi.mocked(chartPng.renderChartPng).mock.calls[0] ?? [];
    expect(input?.frame.legend.map((entry) => entry.name)).toEqual(['Search volume']);
  });

  it('shows a toast and downloads nothing when the image cannot be made', async () => {
    vi.mocked(chartPng.renderChartPng).mockRejectedValueOnce(new Error('no canvas'));
    const { user } = renderWithProviders(<ChartFrame {...CATEGORY_BASE} menu={MENU} status="ready" />);
    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'Download PNG' }));
    expect((await screen.findAllByText('Could not make the image of the chart')).length).toBeGreaterThan(0);
    expect(csvWrite.downloadBlob).not.toHaveBeenCalled();
  });

  it('draws the body of an html chart into the image through the function the caller gave', async () => {
    const png = vi.fn();
    const { user } = renderWithProviders(
      <ChartFrame {...HTML_BASE} menu={{ fileName: 'mention-rate', png }} status="ready" />,
    );
    const trigger = screen.getByRole('button', { name: 'More actions for Mention rate by engine' });
    trigger.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('menuitem', { name: 'Download PNG' }));
    await waitFor(() => expect(chartPng.renderChartPng).toHaveBeenCalledOnce());
    const [input] = vi.mocked(chartPng.renderChartPng).mock.calls[0] ?? [];
    expect(input?.body).toBe(png);
  });
});

describe('ChartFrame accessibility', () => {
  it('has no violation for html, empty, error and an open menu', async () => {
    const html = renderWithProviders(<ChartFrame {...HTML_BASE} status="ready" />);
    expect(await axe(html.container)).toHaveNoViolations();
    html.unmount();

    const empty = renderWithProviders(
      <ChartFrame {...HTML_BASE} status="empty" empty={{ title: 'No answers yet', reason: 'Wait for Thursday.' }} />,
    );
    expect(await axe(empty.container)).toHaveNoViolations();
    empty.unmount();

    const failed = renderWithProviders(
      <ChartFrame
        {...HTML_BASE}
        status="error"
        error={{
          title: 'Could not load',
          reason: 'Try again.',
          errorId: null,
          onRetry: vi.fn(),
          retrying: false,
          retryLabel: 'Try again',
        }}
      />,
    );
    expect(await axe(failed.container)).toHaveNoViolations();
    failed.unmount();

    const menu = renderWithProviders(
      <ChartFrame
        {...CATEGORY_BASE}
        menu={{ fileName: 'volume', csv: true, link: 'https://app.test/x' }}
        status="ready"
      />,
    );
    const trigger = screen.getByRole('button', { name: 'More actions for Search volume by month' });
    trigger.focus();
    await menu.user.keyboard('{Enter}');
    await screen.findByRole('menu');
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
