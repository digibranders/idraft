import { screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DomainDetailRead } from './domain-reads';
import { ShareTrend, type ShareTrendProps } from './share-trend';
import type { DomainEngineWeek, EngineCode, SourceDomainDetailData } from '@/lib/citations/types';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { readChartTokens } from '@/lib/design/read-tokens';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// jsdom has no canvas: the option the frame gives the chart is what these tests read
const drawn = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));
vi.mock('@/components/app/chart/echart', () => ({
  EChart: ({ option }: { option: (tokens: ChartTokens) => Record<string, unknown> }) => {
    drawn.options.push(option(readChartTokens()));
    return <div data-testid="echart-canvas" />;
  },
}));

const ENGINES: readonly { code: EngineCode; label: string }[] = [
  { code: 'chatgpt_web', label: 'ChatGPT' },
  { code: 'gemini_web', label: 'Gemini' },
  { code: 'google_ai_mode', label: 'AI Mode' },
];

const weeks = (units: number, all: number): DomainEngineWeek[] => [
  { week_start: '2026-10-12', citation_units: 0, observations: 0, all_citation_units: 0, answers: 0 },
  { week_start: '2026-10-19', citation_units: units, observations: units / 2, all_citation_units: all, answers: 100 },
];
const dataOf = (engines: SourceDomainDetailData['engines'] | undefined = undefined): SourceDomainDetailData => ({
  registrable_domain: 'g2.com',
  rows: [],
  engines: engines ?? [
    { engine_code: 'chatgpt_web', series: weeks(700, 7000) },
    { engine_code: 'gemini_web', series: weeks(540, 6000) },
    { engine_code: 'google_ai_mode', series: weeks(672, 5420) },
  ],
  top_pages: [],
  prompts: [],
  cited_with: [],
});

const onRetry = vi.fn();
const read = (
  over: Partial<Pick<DomainDetailRead, 'status' | 'errorId' | 'retrying'>> = {},
): ShareTrendProps['read'] => ({
  status: 'ready',
  errorId: null,
  retry: onRetry,
  retrying: false,
  ...over,
});

function Trend(props: Partial<ShareTrendProps> = {}): ReactElement {
  return (
    <ShareTrend
      domain="g2.com"
      data={dataOf()}
      range={{ from: '2026-10-16', to: '2026-11-12' }}
      engines={ENGINES}
      read={read()}
      refetching={false}
      {...props}
    />
  );
}

const lastOption = (): Record<string, unknown> => drawn.options.at(-1) ?? {};
const tipOf = (index: number, label: string): string => {
  const { tooltip } = lastOption() as { tooltip: { formatter: (params: unknown[]) => string } };
  return tooltip.formatter([{ dataIndex: index, axisValueLabel: label }]);
};

beforeEach(() => {
  drawn.options.length = 0;
  onRetry.mockReset();
});

describe('the share trend', () => {
  it('draws a chart with its title, its meta line and its summary', async () => {
    renderWithProviders(<Trend />);
    await screen.findByTestId('echart-canvas');
    const chart = screen.getByRole('img', { name: 'Share of citations by engine' });
    expect(screen.getByRole('heading', { level: 3, name: 'Share of citations by engine' })).toBeInTheDocument();
    expect(screen.getByText('Weekly, Oct 16 to Nov 12, 2026')).toBeInTheDocument();
    expect(document.getElementById(chart.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
      'Weekly share of the citation units on each engine that cite g2.com, 2 weeks, one line for each of 3 engines.',
    );
    expect(screen.getByText('A gap is a week with no citation on that engine.')).toBeInTheDocument();
  });

  it('draws one line for each engine, never one pooled line, with a gap for a week with no unit', async () => {
    renderWithProviders(<Trend />);
    await screen.findByTestId('echart-canvas');
    const lines = (lastOption().series as { name: string; data: (number | null)[] }[]).filter(
      (entry) => entry.name !== undefined,
    );
    expect(lines.map((line) => line.name)).toEqual(['ChatGPT', 'Gemini', 'AI Mode']);
    expect(lines[0]?.data).toEqual([null, 0.1]);
    expect(lines[1]?.data).toEqual([null, 0.09]);
  });

  it('lists the numbers, each with its count, in the Table view', async () => {
    const { user } = renderWithProviders(<Trend />);
    await screen.findByTestId('echart-canvas');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('table', { name: 'Share of citations by engine' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Week of', 'ChatGPT', 'Gemini', 'AI Mode']);
    expect(within(table).getByText('10.0%, 700 of 7,000 units')).toBeInTheDocument();
    expect(within(table).getByText('9.0%, 540 of 6,000 units')).toBeInTheDocument();
    expect(within(table).getByText('12.4%, 672 of 5,420 units')).toBeInTheDocument();
    // The week with no unit on the engines is a gap, said as such, not 0%
    expect(within(table).getAllByText('No data')).toHaveLength(3);
    expect(within(table).queryByText(/^0/)).toBeNull();
  });

  it('says the count of every point in the tooltip, best share first', async () => {
    renderWithProviders(<Trend />);
    await screen.findByTestId('echart-canvas');
    const tip = tipOf(1, 'Oct 19');
    expect(tip).toContain('Oct 19');
    expect(tip).toContain('12.4%, 672 of 5,420 units');
    expect(tip).toContain('10.0%, 700 of 7,000 units');
    expect(tip).toContain('9.0%, 540 of 6,000 units');
    expect(tip.indexOf('AI Mode')).toBeLessThan(tip.indexOf('ChatGPT'));
    expect(tip.indexOf('ChatGPT')).toBeLessThan(tip.indexOf('Gemini'));
    // The week with no unit has no row, so no engine claims 0%
    expect(tipOf(0, 'Oct 12')).not.toContain('%');
  });

  it('gives the empty state when the engines have no weekly figure', () => {
    renderWithProviders(<Trend data={dataOf([])} />);
    expect(screen.getByText('No weekly figures')).toBeInTheDocument();
    expect(screen.getByText('The engines have no citation in this window.')).toBeInTheDocument();
    expect(screen.queryByTestId('echart-canvas')).toBeNull();
  });

  it('shows an error with Retry in its own card and leaves the other sections', async () => {
    const { user } = renderWithProviders(
      <>
        <Trend data={null} read={read({ status: 'error' })} />
        <p>Another section</p>
      </>,
    );
    expect(screen.getByText('This domain could not be loaded.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Another section')).toBeInTheDocument();
  });

  it('shows a skeleton while the read has nothing, with the title kept', () => {
    renderWithProviders(<Trend data={null} read={read({ status: 'loading' })} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Share of citations by engine' })).toBeInTheDocument();
    expect(screen.queryByTestId('echart-canvas')).toBeNull();
    expect(screen.getByRole('heading', { level: 3 }).closest('section')).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps the chart while a refetch is on its way, marked busy', async () => {
    const { container } = renderWithProviders(<Trend refetching />);
    await screen.findByTestId('echart-canvas');
    expect(container.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Share of citations by engine' }).closest('section')).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('has no accessibility violations', async () => {
    const { container, user } = renderWithProviders(<Trend />);
    await screen.findByTestId('echart-canvas');
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
