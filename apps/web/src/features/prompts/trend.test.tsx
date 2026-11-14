import { screen, waitFor, within } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen } from './prompts-screen';
import { useTrendColumn } from './trend-column';
import type { EngineSummary, MetricCell, ProjectEngine, Role, WeekCells } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreWideScreen();
  server.events.removeAllListeners();
});

const cell = (value: number | null, answers = 4): MetricCell => ({
  value,
  numerator: value === null ? 0 : value * answers,
  denominator: value === null ? 0 : answers,
  n_observations: answers,
});
const week = (weekStart: string, value: number | null, answers = 4): WeekCells => ({
  week_start: weekStart,
  prompts: 1,
  is_pooled: false,
  mentioned: cell(value, answers),
  cited: cell(null),
  share_of_voice: cell(null),
});
const summaryOf = (code: string, series: readonly WeekCells[] | undefined): EngineSummary =>
  ({
    engine_code: code,
    mentioned: cell(0.5),
    cited: cell(0.25),
    share_of_voice: cell(null),
    ...(series === undefined ? {} : { series: [...series] }),
  }) as unknown as EngineSummary;
const engineOf = (code: string): ProjectEngine =>
  ({ engine: { engine_code: code, label: code } }) as unknown as ProjectEngine;

interface TestRow {
  cells: readonly EngineSummary[] | undefined;
}
const cellsOf = (row: TestRow): readonly EngineSummary[] | undefined => row.cells;
const ENGINES = [engineOf('chatgpt_web'), engineOf('gemini_web')];

/** The Trend column's cell and tooltip of a row, as the table draws them. */
function Trend({ row }: { row: TestRow }): ReactElement {
  const column = useTrendColumn<TestRow>(ENGINES, cellsOf);
  const tip = column.cellTip?.(row);
  return (
    <div data-testid="cell">
      <p data-testid="header">{column.header}</p>
      <p data-testid="header-tip">{column.headerTooltip}</p>
      <p data-testid="tip">{tip === undefined ? 'no tip' : `${tip.content} | ${tip.detail ?? ''}`}</p>
      <p data-testid="sortable">{String(column.sortValue !== undefined)}</p>
      {column.cell(row)}
    </div>
  );
}

describe('the Trend cell of a row', () => {
  const FIVE = ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'] as const;
  const fiveWeeks = (rates: readonly (number | null)[], answers = 4): WeekCells[] =>
    FIVE.map((start, at) => week(start, rates[at] ?? null, answers));

  it('draws the weekly mention rate and says it in words: the rate of each week, a gap saying so', () => {
    const rates = [0.3, 0.2, null, 0.6, 0.7];
    renderWithProviders(
      <Trend
        row={{ cells: [summaryOf('chatgpt_web', fiveWeeks(rates)), summaryOf('gemini_web', fiveWeeks(rates))] }}
      />,
    );
    expect(
      screen.getByRole('img', { name: 'Mention rate by week: 30%, 20%, no answers, 60%, 70%' }),
    ).toBeInTheDocument();
    // The first and the last week with a rate, and which way it went between the full weeks, for the keyboard too
    expect(screen.getByTestId('tip')).toHaveTextContent(
      '30% the week of Oct 12, 70% the week of Nov 9 | Going up over the full weeks with enough answers',
    );
  });

  it('says no direction from weeks of one answer each, though it lists their rates', () => {
    renderWithProviders(<Trend row={{ cells: [summaryOf('chatgpt_web', fiveWeeks([0, 1, 0, 1, 0], 1))] }} />);
    expect(screen.getByRole('img', { name: 'Mention rate by week: 0%, 100%, 0%, 100%, 0%' })).toBeInTheDocument();
    expect(screen.getByTestId('tip')).toHaveTextContent('0% the week of Oct 12, 0% the week of Nov 9 |');
    expect(screen.getByTestId('tip')).not.toHaveTextContent(/Going|About the same/);
  });

  it('reads the direction from the weeks inside the window, not from the first and the last, which it cuts', () => {
    renderWithProviders(<Trend row={{ cells: [summaryOf('chatgpt_web', fiveWeeks([0.1, 0.5, 0.5, 0.5, 0.9]))] }} />);
    expect(screen.getByTestId('tip')).toHaveTextContent('About the same over the full weeks with enough answers');
  });

  it('says so, and draws a dashed line, when no week has a rate', () => {
    renderWithProviders(
      <Trend row={{ cells: [summaryOf('chatgpt_web', [week('2026-10-12', null), week('2026-10-19', null)])] }} />,
    );
    expect(screen.getByRole('img', { name: 'Mention rate by week: no answers in this window' })).toBeInTheDocument();
    expect(screen.getByTestId('tip')).toHaveTextContent('No week of this window has a mention rate. |');
  });

  it('names a single week with a rate once', () => {
    renderWithProviders(
      <Trend row={{ cells: [summaryOf('chatgpt_web', [week('2026-10-12', null), week('2026-10-19', 0.4)])] }} />,
    );
    // One week with a rate has nothing to compare with
    expect(screen.getByTestId('tip')).toHaveTextContent('40% the week of Oct 19 |');
    expect(screen.getByTestId('tip')).not.toHaveTextContent(/Going|About the same/);
  });

  it('is blank, and has no tooltip, while the series is not there: not loaded, a failed read, or an older API', () => {
    const { unmount } = renderWithProviders(<Trend row={{ cells: undefined }} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByTestId('tip')).toHaveTextContent('no tip');
    unmount();
    renderWithProviders(<Trend row={{ cells: [summaryOf('chatgpt_web', undefined)] }} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByTestId('tip')).toHaveTextContent('no tip');
  });

  it('is headed Trend, explained in its header tooltip, and does not sort', () => {
    renderWithProviders(<Trend row={{ cells: undefined }} />);
    expect(screen.getByTestId('header')).toHaveTextContent('Trend');
    expect(screen.getByTestId('header-tip')).toHaveTextContent(/for each week of the window/);
    expect(screen.getByTestId('sortable')).toHaveTextContent('false');
  });
});

function promptsAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <PromptsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={{
            id: fynix?.project_id ?? '',
            slug: 'fynix',
            name: 'Fynix',
            timeZone: 'Europe/Berlin',
            defaultLanguage: 'en',
            defaultCountryIso: 'DE',
          }}
        />
      </Suspense>
    </PermissionProvider>
  );
}
const renderOn = (searchParams: string): ProvidedRender => renderWithProviders(promptsAs('viewer'), { searchParams });

describe('the Trend column of the tables', () => {
  it('is on the Topics tab after Top engine, with a sparkline for each topic, from the one summary read that asks for series', async () => {
    const summaries: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (new URL(request.url).pathname.endsWith('/ai/prompts-summary')) summaries.push(request.url);
    });
    renderOn('');
    const tree = await screen.findByRole('treegrid', { name: 'Topics' });
    const headers = (await within(tree).findAllByRole('columnheader')).map((header) => header.textContent);
    expect(headers.indexOf('Trend')).toBe(headers.findIndex((text) => text?.startsWith('Top engine')) + 1);
    await waitFor(() =>
      expect(within(tree).getAllByRole('img', { name: /^Mention rate by week: / }).length).toBeGreaterThan(0),
    );
    // One read of the summary, for the strip and both tables, and it asks for the weeks
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries.every((url) => /[?&]include=series(&|$)/.test(url))).toBe(true);
  });

  it('does not draw the sparklines again when a row is chosen: only a change of the data draws them', async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    const { user } = renderOn('?tab=prompts');
    const grid = await screen.findByRole('grid', { name: 'Prompts' });
    await waitFor(() =>
      expect(within(grid).getAllByRole('img', { name: /^Mention rate by week: / }).length).toBeGreaterThan(0),
    );
    const [, first, second] = within(grid).getAllByRole('checkbox');
    await user.click(first as HTMLElement);
    await waitFor(() => expect(screen.getByRole('group', { name: /^Bulk actions, 1 selected/ })).toBeInTheDocument());
    const drawn = getContext.mock.calls.length;
    await user.click(second as HTMLElement);
    await waitFor(() => expect(screen.getByRole('group', { name: /^Bulk actions, 2 selected/ })).toBeInTheDocument());
    expect(getContext.mock.calls.length).toBe(drawn);
  });

  it('is on the Prompts tab after Citation rate, with a sparkline for each prompt', async () => {
    renderOn('?tab=prompts');
    const grid = await screen.findByRole('grid', { name: 'Prompts' });
    const headers = (await within(grid).findAllByRole('columnheader')).map((header) => header.textContent);
    expect(headers.indexOf('Trend')).toBe(headers.findIndex((text) => text?.startsWith('Citation rate')) + 1);
    await waitFor(() =>
      expect(within(grid).getAllByRole('img', { name: /^Mention rate by week: / }).length).toBeGreaterThan(0),
    );
  });
});
