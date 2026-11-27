import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { BreakdownTabs } from './breakdown-tabs';
import type { PanelTab } from './use-panel-state';
import type { BreakdownRow, MetricKey, PageBreakdownAnswer, PageNumbers } from '../types';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const ROUTE = '*/api/v1/workspaces/:w/projects/:p/fp/page-search/:id/breakdown';
const WINDOW = { from: '2026-10-01', to: '2026-10-31', days: 31 };
const COMPARE = { from: '2026-09-01', to: '2026-09-30', days: 30 };

const numbers = (clicks: number, impressions: number, position: number | null = 5): PageNumbers => ({
  clicks,
  impressions,
  ctr: impressions === 0 ? null : clicks / impressions,
  position,
});

const row = (key: string, current: PageNumbers | null, previous: PageNumbers | null): BreakdownRow => ({
  key,
  current,
  previous,
});

function answer(
  data: BreakdownRow[],
  meta: Partial<PageBreakdownAnswer['meta']> = {},
  dimension: 'query' | 'country' | 'device' = 'query',
): PageBreakdownAnswer {
  return {
    data,
    meta: {
      state: 'ok',
      property: 'sc-domain:eventussecurity.com',
      final_through: '2026-11-24',
      window: WINDOW,
      compare_window: COMPARE,
      dimension,
      row_limit: 100,
      truncated: false,
      coverage: 0.88,
      fetched_at: '2026-11-25T08:00:00Z',
      ...meta,
    },
  };
}

const QUERIES = [
  row('small change', numbers(105, 1000), numbers(100, 1000)),
  row('fell a lot', numbers(10, 500), numbers(90, 800)),
  row('grew', numbers(150, 900), numbers(100, 900)),
];

/** Serves one answer per dimension and records the dimensions asked for. */
function serve(build: (dimension: string) => PageBreakdownAnswer | Response): string[] {
  const asked: string[] = [];
  server.use(
    http.get(ROUTE, ({ request }) => {
      const dimension = new URL(request.url).searchParams.get('dimension') ?? '';
      asked.push(dimension);
      const body = build(dimension);
      return body instanceof Response ? body : HttpResponse.json(body);
    }),
  );
  return asked;
}

function Harness({ metric }: { metric: MetricKey }): ReactElement {
  const [tab, setTab] = useState<PanelTab>('queries');
  return (
    <BreakdownTabs
      scope={{ workspaceId: 'w1', projectId: 'p1' }}
      urlId="902"
      period={{ compare: 'previous_period' }}
      metric={metric}
      tab={tab}
      onTabChange={setTab}
    />
  );
}

const render = (metric: MetricKey = 'clicks'): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(<Harness metric={metric} />);

const problem = (status: number, code: string, extra: Record<string, unknown> = {}): Response =>
  HttpResponse.json({ type: 'about:blank', title: code, status, code, request_id: 'req-1', ...extra }, { status });

/** The table once its rows are in: it is drawn, as skeleton rows, while the answer is on its way. */
const loaded = async (): Promise<HTMLElement> => {
  await screen.findAllByRole('rowheader');
  return screen.getByRole('table');
};

const cellsOf = (name: string): string[] => {
  const line = within(screen.getByRole('table')).getByRole('rowheader', { name }).closest('tr');
  return within(line as HTMLElement)
    .getAllByRole('cell')
    .map((cell) => cell.textContent ?? '');
};

describe('BreakdownTabs', () => {
  it('reads only the open tab', async () => {
    const asked = serve((dimension) => answer(QUERIES, {}, dimension === 'country' ? 'country' : 'query'));
    const { user } = render();
    await loaded();
    expect(asked).toEqual(['query']);
    await user.click(screen.getByRole('tab', { name: 'Locations' }));
    await waitFor(() => expect(asked).toContain('country'));
    expect(asked).not.toContain('device');
  });

  it('lists rows with now, before and the change of the metric, biggest change first', async () => {
    serve(() => answer(QUERIES));
    render();
    const table = await loaded();
    const names = within(table)
      .getAllByRole('rowheader')
      .map((cell) => cell.textContent);
    expect(names).toEqual(['fell a lot', 'grew', 'small change']);
    // The change uses the typographic minus of the app's formatters
    expect(cellsOf('fell a lot')).toEqual(['10', '90', '−80']);
    expect(cellsOf('grew')).toEqual(['150', '100', '+50']);
  });

  it('writes the change of the position as places improved or slipped', async () => {
    serve(() => answer([row('a', numbers(1, 10, 6.5), numbers(1, 10, 4))]));
    render('position');
    await loaded();
    expect(cellsOf('a')).toEqual(['6.5', '4.0', 'slipped 2.5']);
  });

  it('names locations and devices, and shows a device it does not know as it came', async () => {
    serve((dimension) =>
      dimension === 'country'
        ? answer([row('IND', numbers(9, 90), numbers(5, 50)), row('ZZZ', numbers(1, 9), numbers(1, 9))], {}, 'country')
        : answer([row('MOBILE', numbers(9, 90), numbers(5, 50)), row('WATCH', numbers(1, 9), null)], {}, 'device'),
    );
    const { user } = render();
    await user.click(await screen.findByRole('tab', { name: 'Locations' }));
    expect(await screen.findByRole('rowheader', { name: 'India' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Unknown location' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Devices' }));
    expect(await screen.findByRole('rowheader', { name: 'Mobile' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'WATCH' })).toBeInTheDocument();
  });

  it('shows Not collected yet, never 0, for a side outside the stored rows', async () => {
    serve(() => answer([row('new', numbers(40, 400), null), row('gone', null, numbers(9, 90))]));
    render();
    await loaded();
    expect(cellsOf('new')).toEqual(['40', 'Not collected yet', 'Not collected yet']);
    expect(cellsOf('gone')).toEqual(['Not collected yet', '9', 'Not collected yet']);
  });

  it('names the metric in the column headers', async () => {
    serve(() => answer(QUERIES));
    render('position');
    const table = await loaded();
    for (const name of ['Average position now', 'Average position before', 'Average position change']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    }
  });

  it('drops Before and Change when the period is not compared', async () => {
    serve(() => answer(QUERIES, { compare_window: null }));
    render();
    const table = await loaded();
    expect(within(table).getByRole('columnheader', { name: 'Clicks now' })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Clicks before' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Clicks change' })).not.toBeInTheDocument();
  });

  it('says the change compares totals when the two periods differ in length, for counts only', async () => {
    const note = 'The two periods differ in length, so the change is the difference of the totals.';
    serve(() => answer(QUERIES));
    const first = render();
    await loaded();
    expect(screen.getByText(note)).toBeInTheDocument();
    first.unmount();
    serve(() => answer(QUERIES, { compare_window: { ...COMPARE, days: 31 } }));
    render();
    await loaded();
    expect(screen.queryByText(note)).not.toBeInTheDocument();
  });

  it('does not say it for a ratio metric', async () => {
    serve(() => answer(QUERIES));
    render('ctr');
    await loaded();
    expect(screen.queryByText(/differ in length/)).not.toBeInTheDocument();
  });

  it('shows 25 rows and the rest on Show all', async () => {
    const many = Array.from({ length: 30 }, (_, i) => row(`query ${String(i)}`, numbers(i, 100), numbers(0, 100)));
    serve(() => answer(many));
    const { user } = render();
    const table = await loaded();
    expect(within(table).getAllByRole('rowheader')).toHaveLength(25);
    await user.click(screen.getByRole('button', { name: 'Show all 30' }));
    expect(within(screen.getByRole('table')).getAllByRole('rowheader')).toHaveLength(30);
  });

  it('says how much of the clicks the queries cover, on the Queries tab only', async () => {
    serve((dimension) =>
      dimension === 'country' ? answer(QUERIES, {}, 'country') : answer(QUERIES, { coverage: 0.88 }),
    );
    const { user } = render();
    const sentence = "The queries shown cover 88% of this page's clicks. Google does not report the rest.";
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Locations' }));
    await waitFor(() => expect(screen.queryByText(sentence)).not.toBeInTheDocument());
  });

  it('says nothing about coverage when the answer has none', async () => {
    serve(() => answer(QUERIES, { coverage: null }));
    render();
    await loaded();
    expect(screen.queryByText(/The queries shown cover/)).not.toBeInTheDocument();
  });

  it('shows Google is busy with the seconds and a Retry that asks again, when it answers 429', async () => {
    let busy = true;
    const asked = serve(() => (busy ? problem(429, 'gsc_busy', { retry_after_seconds: 20 }) : answer(QUERIES)));
    const { user } = render();
    expect(await screen.findByText('Google is busy. Try again in 20 s.')).toBeInTheDocument();
    const before = asked.length;
    busy = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(asked.length).toBeGreaterThan(before));
    expect(await loaded()).toBeInTheDocument();
  });

  it('shows the inline error with Retry when it answers 503', async () => {
    serve(() => problem(503, 'google_unavailable'));
    render();
    expect(await screen.findByText('Could not load the search numbers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('says Not collected yet when the answer has no rows', async () => {
    serve(() => answer([], { coverage: null, fetched_at: null }));
    render();
    expect(await screen.findByText('Not collected yet')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    serve(() => answer(QUERIES));
    const { container } = render();
    await loaded();
    expect(await axe(container)).toHaveNoViolations();
  });
});
