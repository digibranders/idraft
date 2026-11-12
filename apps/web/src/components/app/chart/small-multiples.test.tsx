import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  rateCeilingOf,
  smallMultipleOption,
  SmallMultiples,
  type SmallMultiplePanel,
  type SmallMultiplesProps,
} from './small-multiples';
import { announce } from '@/lib/a11y/announcer';
import type { RateBandPoint } from '@/lib/charts/rate-band-chart';
import * as csvWrite from '@/lib/csv/csv-write';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// Names stand in for colours: a test reads which value went where, not how it looks
const TOKENS: ChartTokens = {
  palette: ['#c1', '#c2', '#c3', '#c4', '#c5', '#c6'],
  axis: '#axis',
  label: '#label',
  fontFamily: 'Inter',
  other: '#other',
  reference: '#reference',
  grid: '#grid',
  band: '#band',
  rankBandNone: '#none',
  surfaceElevated: '#elevated',
  border: '#border',
  borderStrong: '#strong',
  foreground: '#fg',
  foregroundSecondary: '#fg2',
  foregroundMuted: '#muted',
};

// The options each canvas was given, by the id of its first series; jsdom has no canvas
const built = vi.hoisted(() => ({ options: new Map<string, Record<string, unknown>>() }));
vi.mock('./echart', () => ({
  EChart: ({
    option,
    height,
    group,
  }: {
    option: (tokens: ChartTokens) => Record<string, unknown>;
    height: number;
    group?: string;
  }) => {
    const drawn = option(TOKENS);
    const first = (drawn.series as { id: string }[])[0];
    if (first !== undefined) built.options.set(first.id, drawn);
    return <div data-testid="echart-canvas" data-group={group} data-height={height} />;
  },
}));
// Nothing is downloaded: the call is what the test reads
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof csvWrite>()),
  downloadBlob: vi.fn(),
}));
// The real announcer, watched
vi.mock('@/lib/a11y/announcer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/a11y/announcer')>();
  return { ...actual, announce: vi.fn(actual.announce) };
});

interface SeriesOut {
  id: string;
  type: string;
  data: unknown[];
  connectNulls?: boolean;
  lineStyle?: { type?: unknown };
  markLine?: { data: { xAxis: string }[] };
}
const seriesOf = (option: Record<string, unknown>): SeriesOut[] => option.series as SeriesOut[];
const axisOf = (
  option: Record<string, unknown>,
  name: 'xAxis' | 'yAxis',
): { max?: number; axisLabel?: { show?: boolean } } => option[name] as { max?: number; axisLabel?: { show?: boolean } };
const optionOf = (id: string): Record<string, unknown> => {
  const option = built.options.get(id);
  if (option === undefined) throw new Error(`No canvas was drawn for ${id}`);
  return option;
};

const WEEKS = ['Oct 12', 'Oct 19', 'Oct 26', 'Nov 2'];

const point = (value: number, tip: string, half = 0.04): RateBandPoint => ({
  value,
  band: { low: value - half, high: value + half },
  thin: false,
  tip,
});
const THIN: RateBandPoint = { value: 0.4, band: null, thin: true, tip: '3 answers, fewer than 4' };

const CHATGPT: SmallMultiplePanel = {
  id: 'chatgpt',
  name: 'ChatGPT',
  role: { kind: 'brand' },
  points: [point(0.31, '31%, 25 of 81 answers'), point(0.28, '28%, 23 of 82 answers'), THIN, null],
  cellText: ['31%, 25 of 81 answers', '28%, 23 of 82 answers', '3 answers, fewer than 4', null],
};
const GEMINI: SmallMultiplePanel = {
  id: 'gemini',
  name: 'Gemini',
  role: { kind: 'palette', index: 2 },
  points: [
    point(0.62, '62%, 50 of 81 answers', 0.04),
    point(0.55, '55%, 45 of 82 answers'),
    point(0.6, '60%, 48 of 80 answers'),
    point(0.58, '58%, 46 of 79 answers'),
  ],
  previous: [0.5, null, 0.55, 0.52],
  cellText: ['62%, 50 of 81 answers', '55%, 45 of 82 answers', '60%, 48 of 80 answers', '58%, 46 of 79 answers'],
};
const AI_MODE: SmallMultiplePanel = {
  id: 'ai-mode',
  name: 'AI Mode',
  role: { kind: 'palette', index: 3 },
  points: [
    point(0.2, '20%, 16 of 80 answers'),
    null,
    point(0.25, '25%, 20 of 80 answers'),
    point(0.22, '22%, 18 of 81 answers'),
  ],
  cellText: ['20%, 16 of 80 answers', null, '25%, 20 of 80 answers', '22%, 18 of 81 answers'],
};
const PANELS: readonly SmallMultiplePanel[] = [CHATGPT, GEMINI, AI_MODE];

const BASE: Omit<SmallMultiplesProps, 'status' | 'empty' | 'error'> & { status: 'ready' } = {
  status: 'ready',
  title: 'Mention rate by engine',
  variant: 'panel',
  meta: 'Last 4 weeks',
  categories: WEEKS,
  categoryHeader: 'Week',
  titles: WEEKS.map((week) => `Week of ${week}, 2026`),
  panels: PANELS,
  height: 140,
  summary: 'Mention rate of three engines over four weeks.',
};

const canvases = (): HTMLElement[] => screen.queryAllByTestId('echart-canvas');

beforeEach(() => {
  built.options.clear();
  vi.mocked(announce).mockClear();
  vi.mocked(csvWrite.downloadBlob).mockClear();
});
afterEach(() => {
  document.documentElement.classList.remove('dark');
});

const optionInput = (panel: SmallMultiplePanel, extra: Partial<Parameters<typeof smallMultipleOption>[0]> = {}) => ({
  panel,
  categories: WEEKS,
  boundaries: [],
  ceiling: 0.7,
  showXLabels: true,
  formatValue: (value: number): string => `${String(Math.round(value * 100))}%`,
  ...extra,
});

describe('rateCeilingOf', () => {
  it('is the next tenth above the highest value or band of every panel, between 0.1 and 1', () => {
    expect(rateCeilingOf(PANELS)).toBe(0.7);
    expect(rateCeilingOf([{ ...CHATGPT, points: [null, null], previous: undefined }])).toBe(0.1);
    expect(rateCeilingOf([{ ...CHATGPT, points: [point(0.3, 't', 0)], previous: undefined }])).toBe(0.3);
    expect(rateCeilingOf([{ ...CHATGPT, points: [point(0.98, 't', 0.02)], previous: undefined }])).toBe(1);
  });

  it('counts the previous period too, so its line is never cut off', () => {
    expect(rateCeilingOf([{ ...CHATGPT, points: [point(0.2, 't', 0)], previous: [0.85] }])).toBe(0.9);
  });
});

describe('SmallMultiples', () => {
  it('gives every panel the same ceiling, so heights compare (guard)', async () => {
    renderWithProviders(<SmallMultiples {...BASE} />);
    expect(await screen.findAllByTestId('echart-canvas')).toHaveLength(3);
    // The highest value is 0.62 and its band reaches 0.66: 0.7 for the quiet panels as well
    for (const panel of PANELS) {
      expect(axisOf(optionOf(panel.id), 'yAxis').max).toBe(0.7);
    }
  });

  it('keeps the ceiling when a panel is turned off', async () => {
    const { user } = renderWithProviders(<SmallMultiples {...BASE} />);
    await screen.findAllByTestId('echart-canvas');
    await user.click(screen.getByRole('button', { name: 'Gemini' }));
    await waitFor(() => expect(canvases()).toHaveLength(2));
    expect(axisOf(optionOf('chatgpt'), 'yAxis').max).toBe(0.7);
  });

  it('draws a thin point hollow with no band, and a point with no value as a gap, never a zero (guard)', () => {
    const option = smallMultipleOption(optionInput(CHATGPT), TOKENS);
    const series = seriesOf(option);
    const line = series.find((entry) => entry.id === 'chatgpt');
    expect(line?.data[0]).toBe(0.31);
    // Hollow: the tooltip surface inside, the series colour as a ring, 5 px
    expect(line?.data[2]).toMatchObject({
      value: 0.4,
      symbolSize: 5,
      itemStyle: { color: TOKENS.surfaceElevated, borderColor: TOKENS.palette[0] },
    });
    // The gap is null in the line and in both band series
    expect(line?.data[3]).toBeNull();
    expect(line?.connectNulls).toBe(false);
    const high = series.find((entry) => entry.id === 'chatgpt:band');
    const low = series.find((entry) => entry.id === 'chatgpt:band-low');
    expect(high?.data[2]).toBeNull();
    expect(low?.data[2]).toBeNull();
    expect(high?.data[3]).toBeNull();
    expect(high?.data[0]).not.toBeNull();
    expect(series.flatMap((entry) => entry.data)).not.toContain(0);
  });

  it('draws the boundaries on every panel and drops one that is not a week of the chart', async () => {
    renderWithProviders(
      <SmallMultiples
        {...BASE}
        boundaries={[
          { at: 'Oct 26', label: 'Extractor v4' },
          { at: 'Sep 1', label: 'Not a week of this chart' },
        ]}
      />,
    );
    await screen.findAllByTestId('echart-canvas');
    for (const panel of PANELS) {
      const boundaries = seriesOf(optionOf(panel.id)).find((entry) => entry.id === 'boundaries');
      expect(boundaries?.markLine?.data.map((mark) => mark.xAxis)).toEqual(['Oct 26']);
    }
  });

  it('connects the crosshair: every panel is in one group, and another chart is not', async () => {
    renderWithProviders(
      <>
        <SmallMultiples {...BASE} />
        <SmallMultiples {...BASE} panels={[CHATGPT, GEMINI]} title="Another chart" />
      </>,
    );
    const groups = (await screen.findAllByTestId('echart-canvas')).map((canvas) => canvas.dataset.group);
    expect(groups[0]).toBeTruthy();
    expect(new Set(groups.slice(0, 3)).size).toBe(1);
    expect(groups[3]).toBeTruthy();
    expect(groups[3]).not.toBe(groups[0]);
    expect(groups[4]).toBe(groups[3]);
  });

  it('puts the x labels on the last visible panel only, and gives it room for them', async () => {
    const { user } = renderWithProviders(<SmallMultiples {...BASE} />);
    await screen.findAllByTestId('echart-canvas');
    expect(axisOf(optionOf('chatgpt'), 'xAxis').axisLabel?.show).toBe(false);
    expect(axisOf(optionOf('gemini'), 'xAxis').axisLabel?.show).toBe(false);
    expect(axisOf(optionOf('ai-mode'), 'xAxis').axisLabel?.show).not.toBe(false);
    const [first, , last] = canvases();
    expect(Number(last?.dataset.height)).toBeGreaterThan(Number(first?.dataset.height));
    // Hide the last panel: the one before it takes the labels
    await user.click(screen.getByRole('button', { name: 'AI Mode' }));
    await waitFor(() => expect(canvases()).toHaveLength(2));
    expect(axisOf(optionOf('gemini'), 'xAxis').axisLabel?.show).not.toBe(false);
    expect(axisOf(optionOf('chatgpt'), 'xAxis').axisLabel?.show).toBe(false);
  });

  it('draws the previous period dashed in the reference colour, with no band of its own', () => {
    const series = seriesOf(smallMultipleOption(optionInput(GEMINI), TOKENS));
    const previous = series.find((entry) => entry.id === 'gemini:previous');
    expect(previous?.data).toEqual([0.5, null, 0.55, 0.52]);
    expect(previous?.lineStyle?.type).toEqual([4, 4]);
    expect(series.map((entry) => entry.id)).not.toContain('gemini:previous:band');
    expect(series.filter((entry) => entry.id.includes('band'))).toHaveLength(2);
    expect(seriesOf(smallMultipleOption(optionInput(CHATGPT), TOKENS)).map((entry) => entry.id)).not.toContain(
      'chatgpt:previous',
    );
  });

  it('names every panel in text with its latest value and counts, and sets the canvas height', async () => {
    renderWithProviders(<SmallMultiples {...BASE} height={180} />);
    await screen.findAllByTestId('echart-canvas');
    const chatgpt = screen.getByRole('img', { name: 'ChatGPT' });
    // The last week has no value: the latest is the week before, with the counts it has
    expect(chatgpt).toHaveAccessibleDescription('Oct 26: 3 answers, fewer than 4');
    expect(screen.getByRole('img', { name: 'Gemini' })).toHaveAccessibleDescription('Nov 2: 58%, 46 of 79 answers');
    expect(canvases()[0]).toHaveAttribute('data-height', '180');
    expect(chatgpt.closest('figure')).toHaveTextContent('ChatGPT');
  });

  it('is one column at a phone width and two from 768 px when more than two panels show', async () => {
    const { container, user } = renderWithProviders(<SmallMultiples {...BASE} />);
    await screen.findAllByTestId('echart-canvas');
    const grid = container.querySelector('figure')?.parentElement;
    expect(grid).toHaveClass('grid-cols-1', 'md:grid-cols-2');
    await user.click(screen.getByRole('button', { name: 'AI Mode' }));
    await waitFor(() => expect(canvases()).toHaveLength(2));
    expect(container.querySelector('figure')?.parentElement).not.toHaveClass('md:grid-cols-2');
  });

  describe('the Table view', () => {
    it('is one table for all the panels, a column each, and a gap says "No data", never 0%', async () => {
      const { user } = renderWithProviders(<SmallMultiples {...BASE} />);
      await screen.findAllByTestId('echart-canvas');
      await user.click(screen.getByRole('button', { name: 'Table' }));
      expect(canvases()).toHaveLength(0);
      const table = screen.getByRole('table', { name: 'Mention rate by engine' });
      expect(screen.getAllByRole('table')).toHaveLength(1);
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((header) => header.textContent),
      ).toEqual(['Week', 'ChatGPT', 'Gemini', 'AI Mode']);
      const rows = within(table).getAllByRole('row');
      expect(rows).toHaveLength(WEEKS.length + 1);
      // Nov 2 has no ChatGPT value; Oct 19 has no AI Mode value
      expect(within(rows[4] as HTMLElement).getAllByRole('cell')[0]).toHaveTextContent('No data');
      expect(within(rows[2] as HTMLElement).getAllByRole('cell')[2]).toHaveTextContent('No data');
      expect(within(rows[1] as HTMLElement).getAllByRole('cell')[0]).toHaveTextContent('31%, 25 of 81 answers');
      expect(table).not.toHaveTextContent(/(^|[^0-9])0%/);
    });

    it('has a column for each panel that is shown', async () => {
      const { user } = renderWithProviders(<SmallMultiples {...BASE} />);
      await screen.findAllByTestId('echart-canvas');
      await user.click(screen.getByRole('button', { name: 'Gemini' }));
      await user.click(screen.getByRole('button', { name: 'Table' }));
      const table = screen.getByRole('table');
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((header) => header.textContent),
      ).toEqual(['Week', 'ChatGPT', 'AI Mode']);
    });

    it('downloads the same rows as CSV with the counts, a gap as an empty cell', async () => {
      const { user } = renderWithProviders(
        <SmallMultiples {...BASE} menu={{ fileName: 'mention-rate-by-engine', link: 'https://app.test/x' }} />,
      );
      await screen.findAllByTestId('echart-canvas');
      await user.click(screen.getByRole('button', { name: 'More actions for Mention rate by engine' }));
      expect(screen.queryByRole('menuitem', { name: 'Download PNG' })).toBeNull();
      expect(screen.getByRole('menuitem', { name: 'Copy link' })).toBeInTheDocument();
      await user.click(screen.getByRole('menuitem', { name: 'Download CSV' }));
      const [blob, name] = vi.mocked(csvWrite.downloadBlob).mock.calls[0] ?? [];
      expect(name).toBe('mention-rate-by-engine.csv');
      if (!(blob instanceof Blob)) throw new Error('No file was downloaded');
      const text = await blob.text();
      expect(text).toContain('Week,ChatGPT,Gemini,AI Mode');
      expect(text).toContain('Oct 12,"31%, 25 of 81 answers","62%, 50 of 81 answers","20%, 16 of 80 answers"');
      expect(text).toContain('Oct 19,"28%, 23 of 82 answers","55%, 45 of 82 answers",');
      expect(text).toContain('Oct 26,"3 answers, fewer than 4"');
      // A gap is empty: ChatGPT on Nov 2
      expect(text).toContain('Nov 2,,"58%, 46 of 79 answers"');
    });

    it('has no menu when the feature gives none', async () => {
      renderWithProviders(<SmallMultiples {...BASE} />);
      await screen.findAllByTestId('echart-canvas');
      expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
    });
  });

  describe('the legend', () => {
    it('turns a panel off and on, and never turns off the last one', async () => {
      const { user } = renderWithProviders(<SmallMultiples {...BASE} />);
      await screen.findAllByTestId('echart-canvas');
      const legend = screen.getByRole('list', { name: 'Series in Mention rate by engine' });
      await user.click(within(legend).getByRole('button', { name: 'ChatGPT' }));
      await waitFor(() => expect(canvases()).toHaveLength(2));
      expect(within(legend).getByRole('button', { name: 'ChatGPT' })).toHaveAttribute('aria-pressed', 'false');
      await user.click(within(legend).getByRole('button', { name: 'Gemini' }));
      await waitFor(() => expect(canvases()).toHaveLength(1));
      // The last one stays, and the person is told so
      await user.click(within(legend).getByRole('button', { name: 'AI Mode' }));
      expect(canvases()).toHaveLength(1);
      expect(within(legend).getByRole('button', { name: 'AI Mode' })).toHaveAttribute('aria-pressed', 'true');
      expect(announce).toHaveBeenCalledWith(
        'AI Mode stays shown: at least one chart must be visible',
        expect.anything(),
      );
      await user.click(within(legend).getByRole('button', { name: 'ChatGPT' }));
      await waitFor(() => expect(canvases()).toHaveLength(2));
    });
  });

  describe('the states, through the frame', () => {
    it('shows a skeleton in the reserved height while loading, and no chart', () => {
      const { container } = renderWithProviders(<SmallMultiples {...BASE} status="loading" />);
      expect(container.querySelector('section')).toHaveAttribute('aria-busy', 'true');
      expect(canvases()).toHaveLength(0);
      expect(screen.getByRole('heading', { level: 2, name: 'Mention rate by engine' })).toBeInTheDocument();
    });

    it('says what is missing and the action that changes it when empty', () => {
      renderWithProviders(
        <SmallMultiples
          {...BASE}
          panels={[]}
          status="empty"
          empty={{
            title: 'No weekly rates yet',
            reason: 'The first weekly run is on Thursday.',
            action: <button type="button">Run now</button>,
          }}
        />,
      );
      expect(screen.getByRole('heading', { level: 3, name: 'No weekly rates yet' })).toBeInTheDocument();
      expect(screen.getByText('The first weekly run is on Thursday.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Run now' })).toBeInTheDocument();
      expect(canvases()).toHaveLength(0);
    });

    it('shows the error with a retry', async () => {
      const onRetry = vi.fn();
      const { user } = renderWithProviders(
        <SmallMultiples
          {...BASE}
          status="error"
          error={{
            title: 'Could not load the weekly rates',
            reason: 'The server returned an error.',
            errorId: null,
            onRetry,
            retrying: false,
            retryLabel: 'Try again',
          }}
        />,
      );
      expect(screen.getByText('Could not load the weekly rates')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(onRetry).toHaveBeenCalledOnce();
    });

    it('keeps the panels while it refetches', async () => {
      const { container } = renderWithProviders(<SmallMultiples {...BASE} status="refetching" />);
      expect(await screen.findAllByTestId('echart-canvas')).toHaveLength(3);
      expect(container.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    });

    it('says stale or partial data on the meta line and keeps the panels', async () => {
      const { rerender } = renderWithProviders(
        <SmallMultiples {...BASE} notice={{ kind: 'stale', text: 'Stale: last collected Nov 9, 18:30 CET' }} />,
      );
      expect(await screen.findAllByTestId('echart-canvas')).toHaveLength(3);
      expect(screen.getByText('Last 4 weeks')).toBeInTheDocument();
      expect(screen.getByText('Stale: last collected Nov 9, 18:30 CET')).toBeInTheDocument();
      rerender(
        <SmallMultiples {...BASE} notice={{ kind: 'partial', text: 'Partial data: 612 of 1,000 prompts asked' }} />,
      );
      expect(screen.getByText('Partial data: 612 of 1,000 prompts asked')).toBeInTheDocument();
      expect(canvases()).toHaveLength(3);
    });
  });

  it.each(['light', 'dark'] as const)('has no axe violations in %s, as a chart and as a table', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { user, container } = renderWithProviders(<SmallMultiples {...BASE} footnote="Each point is one week." />);
    await screen.findAllByTestId('echart-canvas');
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
