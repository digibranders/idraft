import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { UrlUpdateEvent } from 'nuqs/adapters/testing';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RunsScreen } from './runs-screen';
import type { Role } from '@/lib/api/types';
import { monthInstants } from '@/lib/format/month';
import { PermissionProvider } from '@/lib/permissions';
import { runDetailView, runView } from '@/mocks/factories/operations';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { MOCK_RUNS } from '@/mocks/operations-fixtures';
import type { StoredRun } from '@/mocks/operations-state';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/ops/runs',
}));

const W = '/api/v1/workspaces/{workspace_id}';
const RUNS = `${W}/projects/{project_id}/runs`;
const RUN = `${RUNS}/{run_id}`;
const CANCEL = `${RUN}/cancel`;

/** The fixture runs sit in the summer of 2026, the newest on 30 September at 16:41 UTC; this is that evening. */
const NOW = new Date('2026-09-30T23:00:00Z');

const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');
const projects = MOCK_PROJECTS.map((project) => ({
  id: project.project_id,
  slug: project.slug,
  name: project.name,
  timeZone: project.timezone,
}));

/** The fixture runs of Fynix in September 2026 (UTC), as the list should show them. */
const SEPTEMBER = monthInstants('2026-09');
const septemberRuns = MOCK_RUNS.filter(
  (run) =>
    run.created_at >= SEPTEMBER.from.replace('Z', '.000Z') && run.created_at < SEPTEMBER.to.replace('Z', '.000Z'),
);

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
  server.events.removeAllListeners();
});

/** The Runs page for a signed-in member of `role`, who may open `shown` projects. */
function runsAs(role: Role, shown: readonly (typeof projects)[number][] = projects): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <RunsScreen workspaceId={MOCK_WORKSPACE.workspace_id} workspaceSlug={MOCK_WORKSPACE.slug} projects={shown} />
      </Suspense>
    </PermissionProvider>
  );
}

interface Asked {
  path: string;
  query: URLSearchParams;
}

/** Every request of the page to a route, in order: its path and its query. */
function recordRequests(pathEnd: string): Asked[] {
  const asked: Asked[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith(pathEnd)) asked.push({ path: url.pathname, query: url.searchParams });
  });
  return asked;
}

/** The query strings the page wrote to the URL, newest last. */
function urlWrites(): { onUrlUpdate: (event: UrlUpdateEvent) => void; latest: () => URLSearchParams } {
  const writes: string[] = [];
  return {
    onUrlUpdate: (event) => writes.push(event.queryString),
    latest: () => new URLSearchParams(writes.at(-1) ?? ''),
  };
}

const serverError = (): Response =>
  HttpResponse.json({ code: 'internal_error', title: 'Internal error', status: 500 }, { status: 500 });

const grid = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Runs' });
const bodyRows = (table: HTMLElement): HTMLElement[] =>
  within(table)
    .getAllByRole('rowheader')
    .flatMap((cell) => {
      const row = cell.closest('tr');
      return row === null ? [] : [row];
    });

// Runs that are still open: a fixed clock keeps them so, since the mock ends a run 15 seconds after it starts
const OPEN_AT = new Date(NOW.getTime() - 5_000).toISOString();
const store = (over: Partial<StoredRun> & Pick<StoredRun, 'run_id'>): StoredRun => ({
  project_id: fynix.project_id,
  schedule_id: null,
  workload: 'keyword_metrics',
  trigger: 'schedule',
  created_at: OPEN_AT,
  created_by: null,
  tasks_total: 100,
  tasks_failed: 0,
  calls: 2,
  keyword_count: null,
  stale_days: 25,
  ending: 'completed',
  status_reason: null,
  blocked_by_budget_id: null,
  cancelled_at: null,
  cancel_reason: null,
  ...over,
});
const uuid = (n: number): string => `0192d1a8-0000-7000-8000-${String(n).padStart(12, '0')}`;

/**
 * Answers the list, a run and Cancel from `runs`, which Cancel changes: the way to have runs that are still
 * open, which the fixtures have none of. Returns the runs and what was asked.
 */
function serveRuns(runs: StoredRun[]): { cancels: string[]; lists: () => number } {
  const cancels: string[] = [];
  let lists = 0;
  const view = (run: StoredRun) => runView(MOCK_WORKSPACE.workspace_id, [], run, Date.now());
  server.use(
    http.get(mswPath(RUNS), () => {
      lists += 1;
      return HttpResponse.json({
        data: runs.map(view),
        page: { has_more: false, next_cursor: null, limit: 200 },
        meta: { manual_runs_today: { used: 3, limit: 20 } },
      });
    }),
    http.get(mswPath(RUN), ({ params, request }) => {
      const run = runs.find((candidate) => candidate.run_id === params.run_id);
      return run === undefined
        ? problem(request, 'not_found')
        : HttpResponse.json({ data: runDetailView(MOCK_WORKSPACE.workspace_id, [], run, Date.now()) });
    }),
    http.post(mswPath(CANCEL), ({ params }) => {
      const at = runs.findIndex((candidate) => candidate.run_id === params.run_id);
      const run = runs[at];
      if (run === undefined) return HttpResponse.json({}, { status: 404 });
      cancels.push(run.run_id);
      const cancelled = { ...run, cancelled_at: new Date(Date.now()).toISOString() };
      runs.splice(at, 1, cancelled);
      return HttpResponse.json({ data: view(cancelled) });
    }),
  );
  return { cancels, lists: () => lists };
}

/** The clock the polling tests freeze their runs at: a run created five seconds before it is still running. */
const FROZEN = NOW.getTime();

interface PagedRuns {
  /** The run on the first page, and the clock the mock reads its state at. */
  run: StoredRun;
  now: number;
}

/**
 * Answers the list in two pages (the run first, an older one after it) and the run's detail, and counts what
 * is asked. A poll for the open runs is answered from the run's state at `paged.now`, after `hold` if one is set.
 */
function servePaged(paged: PagedRuns): {
  lists: () => URLSearchParams[];
  follows: () => number;
  details: () => number;
  hold: () => () => void;
} {
  const older = store({ run_id: uuid(2), created_at: '2026-09-02T10:00:00.000Z' });
  const lists: URLSearchParams[] = [];
  let details = 0;
  let held: Promise<void> = Promise.resolve();
  const view = (run: StoredRun) => runView(MOCK_WORKSPACE.workspace_id, [], run, paged.now);
  const meta = { manual_runs_today: { used: 3, limit: 20 } };
  server.use(
    http.get(mswPath(RUNS), async ({ request }) => {
      const query = new URL(request.url).searchParams;
      lists.push(query);
      if (query.get('filter[status_in]') === 'planned,running') {
        await held;
        const open = [view(paged.run)].filter((row) => row.status === 'planned' || row.status === 'running');
        return HttpResponse.json({ data: open, page: { has_more: false, next_cursor: null, limit: 200 }, meta });
      }
      const second = query.get('cursor') === 'next';
      return HttpResponse.json({
        data: [view(second ? older : paged.run)],
        page: { has_more: !second, next_cursor: second ? null : 'next', limit: 200 },
        meta,
      });
    }),
    http.get(mswPath(RUN), () => {
      details += 1;
      return HttpResponse.json({ data: runDetailView(MOCK_WORKSPACE.workspace_id, [], paged.run, paged.now) });
    }),
  );
  return {
    lists: () => lists,
    follows: () => lists.filter((query) => query.get('filter[status_in]') === 'planned,running').length,
    details: () => details,
    hold: () => {
      let release = (): void => undefined;
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

describe('Runs while a run is open', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
  });

  it('follows the open runs alone: no busy table, no other page, and the run it hears of is updated', async () => {
    const paged: PagedRuns = { run: store({ run_id: uuid(1) }), now: FROZEN };
    const served = servePaged(paged);
    renderWithProviders(runsAs('admin'));
    const table = await grid();
    await waitFor(() => expect(bodyRows(table)).toHaveLength(2));
    // The list's two pages, and the poll's first look at the open runs
    await waitFor(() => expect(served.follows()).toBe(1));
    expect(bodyRows(table)[0]).toHaveTextContent('of 100 done');

    // The next answer of the poll is held, and says the run has more tasks than the list did
    const release = served.hold();
    paged.run = { ...paged.run, tasks_total: 200 };
    await vi.advanceTimersByTimeAsync(10_000);
    await waitFor(() => expect(served.follows()).toBe(2));
    await vi.advanceTimersByTimeAsync(1_000);
    // A poll is not a reload: no progress bar, no busy state, no "Updating"
    expect(table).not.toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Updating')).toBeNull();
    release();
    await waitFor(() => expect(bodyRows(table)[0]).toHaveTextContent('of 200 done'));
    expect(table).not.toHaveAttribute('aria-busy', 'true');
    expect(bodyRows(table)).toHaveLength(2);

    // The polls ask for the open runs of the month alone, never for a later page; the list's pages were read once each
    const follow = served.lists().find((query) => query.get('filter[status_in]') === 'planned,running');
    expect(follow?.get('from')).toBe('2026-09-01T00:00:00Z');
    expect(follow?.has('cursor')).toBe(false);
    expect(served.lists().filter((query) => query.has('cursor'))).toHaveLength(1);
    expect(served.lists().filter((query) => query.get('filter[status_in]') !== 'planned,running')).toHaveLength(2);
  });

  it('keeps a status filter of the person in the poll, and asks nothing when it leaves out the open ones', async () => {
    const paged: PagedRuns = { run: store({ run_id: uuid(1) }), now: FROZEN };
    const served = servePaged(paged);
    renderWithProviders(runsAs('admin'), { searchParams: '?status=completed,failed' });
    await grid();
    await waitFor(() => expect(served.lists().length).toBeGreaterThan(0));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(served.follows()).toBe(0);
  });

  it('does not poll a month whose runs have all ended', async () => {
    const paged: PagedRuns = { run: store({ run_id: uuid(1), created_at: '2026-09-28T09:00:00.000Z' }), now: FROZEN };
    const served = servePaged(paged);
    renderWithProviders(runsAs('admin'));
    const table = await grid();
    await waitFor(() => expect(bodyRows(table)).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(served.follows()).toBe(0);
    expect(served.lists()).toHaveLength(2);
  });

  it('reads the list again once, quietly, when a run it followed has ended, and then stops', async () => {
    const paged: PagedRuns = { run: store({ run_id: uuid(1) }), now: FROZEN };
    const served = servePaged(paged);
    renderWithProviders(runsAs('admin'));
    const table = await grid();
    await waitFor(() => expect(bodyRows(table)).toHaveLength(2));
    expect(bodyRows(table)[0]).toHaveTextContent('Running');
    await waitFor(() => expect(served.follows()).toBe(1));

    // The run ends: the open runs no longer hold it, and the list says how it ended
    paged.now = FROZEN + 60_000;
    await vi.advanceTimersByTimeAsync(10_000);
    await waitFor(() => expect(bodyRows(table)[0]).toHaveTextContent('Completed'));
    expect(table).not.toHaveAttribute('aria-busy', 'true');
    const polls = served.follows();
    const reads = served.lists().length;
    expect(polls).toBe(2);
    // The two pages of the list were read again, and nothing else
    await vi.advanceTimersByTimeAsync(60_000);
    expect(served.follows()).toBe(polls);
    expect(served.lists()).toHaveLength(reads);
  });

  describe('when the list cannot be read again to tell what ended', () => {
    /**
     * A month of 2,000 runs (ten full pages, the first run open) that the list is cut at; the poll for the
     * open runs answers from the run's state at `paged.now`, with `pollHasMore` as its own `has_more`.
     */
    function serveCapped(paged: PagedRuns, pollHasMore = false): { follows: () => number; byId: () => number } {
      let follows = 0;
      let byId = 0;
      const meta = { manual_runs_today: { used: 3, limit: 20 } };
      const view = (run: StoredRun) => runView(MOCK_WORKSPACE.workspace_id, [], run, paged.now);
      server.use(
        http.get(mswPath(RUNS), ({ request }) => {
          const query = new URL(request.url).searchParams;
          if (query.get('filter[status_in]') === 'planned,running') {
            follows += 1;
            const open = [view(paged.run)].filter((row) => row.status === 'planned' || row.status === 'running');
            return HttpResponse.json({
              data: open,
              page: { has_more: pollHasMore, next_cursor: pollHasMore ? 'later' : null, limit: 200 },
              meta,
            });
          }
          const cursor = query.get('cursor');
          const page = cursor === null ? 0 : Number(cursor.replace('page-', ''));
          const data = Array.from({ length: 200 }, (_, at) =>
            page === 0 && at === 0
              ? view(paged.run)
              : view(
                  store({
                    run_id: uuid(page * 200 + at + 1),
                    // Long ended: a run is open only for 15 seconds in the mock
                    created_at: new Date(Date.parse('2026-09-20T00:00:00Z') - (page * 200 + at) * 60_000).toISOString(),
                  }),
                ),
          );
          return HttpResponse.json({
            data,
            page: { has_more: true, next_cursor: `page-${String(page + 1)}`, limit: 200 },
            meta,
          });
        }),
        http.get(mswPath(RUN), () => {
          byId += 1;
          return HttpResponse.json({ data: runDetailView(MOCK_WORKSPACE.workspace_id, [], paged.run, paged.now) });
        }),
      );
      return { follows: () => follows, byId: () => byId };
    }

    it('shows a run that ended as ended, and stops polling, at the 2,000 runs the list is cut at', async () => {
      const paged: PagedRuns = { run: store({ run_id: uuid(1) }), now: FROZEN };
      const served = serveCapped(paged);
      renderWithProviders(runsAs('admin'));
      const table = await grid();
      await screen.findByText('Showing the newest 2,000 runs of the month. Narrow the filters to see older ones.');
      await waitFor(() => expect(bodyRows(table)[0]).toHaveTextContent('Running'));
      await waitFor(() => expect(served.follows()).toBeGreaterThanOrEqual(1));

      // The run ends: the open runs no longer name it, and the list is not read again, so the run is read itself
      paged.now = FROZEN + 60_000;
      await vi.advanceTimersByTimeAsync(10_000);
      await waitFor(() => expect(bodyRows(table)[0]).toHaveTextContent('Completed'));
      expect(served.byId()).toBe(1);
      const polls = served.follows();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(served.follows()).toBe(polls);
      expect(served.byId()).toBe(1);
    });

    it('does the same when more than one page of runs is open and the poll cannot say which ended', async () => {
      const paged: PagedRuns = { run: store({ run_id: uuid(1) }), now: FROZEN };
      const served = serveCapped(paged, true);
      renderWithProviders(runsAs('admin'));
      const table = await grid();
      await waitFor(() => expect(bodyRows(table)[0]).toHaveTextContent('Running'));
      await waitFor(() => expect(served.follows()).toBeGreaterThanOrEqual(1));
      paged.now = FROZEN + 60_000;
      await vi.advanceTimersByTimeAsync(10_000);
      await waitFor(() => expect(bodyRows(table)[0]).toHaveTextContent('Completed'));
      const polls = served.follows();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(served.follows()).toBe(polls);
    });
  });

  it('keeps the tasks it showed, with a note, when one poll of the open run fails', async () => {
    const paged: PagedRuns = { run: store({ run_id: uuid(1) }), now: FROZEN };
    servePaged(paged);
    let fail = false;
    server.use(
      http.get(mswPath(RUN), () =>
        fail
          ? serverError()
          : HttpResponse.json({ data: runDetailView(MOCK_WORKSPACE.workspace_id, [], paged.run, paged.now) }),
      ),
    );
    renderWithProviders(runsAs('admin'), { searchParams: `?inspect=run:${uuid(1)}` });
    const panel = await screen.findByRole('complementary');
    expect(await within(panel).findByText('Pending', { selector: 'dt' })).toBeInTheDocument();
    expect(within(panel).queryByText(/Could not refresh/)).toBeNull();

    fail = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await within(panel).findByText('Could not refresh. These are the last figures read.')).toBeInTheDocument();
    // What was on screen stays; the error view is for a first read that fails
    expect(within(panel).getByText('Pending', { selector: 'dt' })).toBeInTheDocument();
    expect(within(panel).getByText('Ingested', { selector: 'dt' })).toBeInTheDocument();
    expect(within(panel).queryByText('This run did not load')).toBeNull();

    // The next poll that works takes the note away
    fail = false;
    await vi.advanceTimersByTimeAsync(10_000);
    await waitFor(() => expect(within(panel).queryByText(/Could not refresh/)).toBeNull());
  });

  it('gives a run that did not load a reason that is about the run, not about filters', async () => {
    server.use(http.get(mswPath(RUN), () => serverError()));
    renderWithProviders(runsAs('admin'), { searchParams: `?inspect=run:${uuid(999)}` });
    const panel = await screen.findByRole('complementary');
    expect(await within(panel).findAllByText('This run did not load')).not.toHaveLength(0);
    expect(within(panel).getAllByText('The server did not answer. Try again in a moment.').length).toBeGreaterThan(0);
    expect(within(panel).queryByText(/filters are unchanged/)).toBeNull();
  });

  it('stops reading the open run once its inspector is closed', async () => {
    const paged: PagedRuns = { run: store({ run_id: uuid(1) }), now: FROZEN };
    const served = servePaged(paged);
    renderWithProviders(runsAs('admin'), { searchParams: `?inspect=run:${uuid(1)}` });
    expect(await screen.findByText('Tasks by status')).toBeInTheDocument();
    await waitFor(() => expect(served.details()).toBe(1));
    await vi.advanceTimersByTimeAsync(10_000);
    await waitFor(() => expect(served.details()).toBe(2));

    act(() => screen.getByRole('button', { name: 'Close' }).click());
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(served.details()).toBe(2);
  });
});

describe('Runs', () => {
  it("lists the first project's runs of the month, the newest first, with what the plan names", async () => {
    const asked = recordRequests('/runs');
    const { container } = renderWithProviders(runsAs('admin'));
    const table = await grid();
    await waitFor(() => expect(bodyRows(table)).toHaveLength(septemberRuns.length));
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveTextContent('Fynix');
    for (const name of [
      'Workload',
      'Status',
      'Started',
      'Trigger',
      'Tasks',
      'Actual',
      'Estimate',
      'Window',
      'Finished',
    ]) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(name) })).toBeInTheDocument();
    }
    // The newest fixture run is the failed one of the three keywords added yesterday
    expect(bodyRows(table)[0]).toHaveTextContent('Failed');
    expect(bodyRows(table)[0]).toHaveTextContent('Keyword metrics');
    expect(within(table).getByRole('columnheader', { name: /Started/ })).toHaveAttribute('aria-sort', 'descending');
    // One request to the project's list for the UTC month, with no filter left in as an empty parameter
    const first = asked[0];
    expect(first?.path).toContain(`/projects/${fynix.project_id}/runs`);
    expect(first?.query.get('from')).toBe('2026-09-01T00:00:00Z');
    expect(first?.query.get('to')).toBe('2026-10-01T00:00:00Z');
    expect(asked.every((request) => [...request.query.keys()].every((name) => !name.startsWith('filter[')))).toBe(true);
    expect(screen.getByText(/Fynix, September 2026\. \d+ of 20 manual runs used today/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('asks for the other project and writes it to the URL, closing the run that was open', async () => {
    const asked = recordRequests('/runs');
    const url = urlWrites();
    const open = septemberRuns[0]?.run_id ?? '';
    const { user } = renderWithProviders(runsAs('admin'), {
      searchParams: `?inspect=run:${open}`,
      onUrlUpdate: url.onUrlUpdate,
    });
    expect(await screen.findByRole('heading', { name: 'Keyword metrics' })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Project' }));
    await user.click(await screen.findByRole('option', { name: 'Cleanstart' }));
    await waitFor(() => expect(url.latest().get('project')).toBe('cleanstart'));
    expect(url.latest().has('inspect')).toBe(false);
    await waitFor(() => expect(asked.some((request) => request.path.includes(cleanstart.project_id))).toBe(true));
    // Cleanstart has no runs, and none of Fynix's stay on screen
    expect(await screen.findByText('No runs in September 2026')).toBeInTheDocument();
    expect(screen.queryByRole('rowheader')).toBeNull();
    // The first project is the default, so choosing it again leaves `project` out
    await user.click(screen.getByRole('combobox', { name: 'Project' }));
    await user.click(await screen.findByRole('option', { name: 'Fynix' }));
    await waitFor(() => expect(url.latest().has('project')).toBe(false));
  });

  it('reads the project from the URL, and falls back to the first for one that is not offered', async () => {
    const asked = recordRequests('/runs');
    renderWithProviders(runsAs('admin'), { searchParams: '?project=nowhere&month=1999-01' });
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked.every((request) => request.path.includes(fynix.project_id))).toBe(true);
    expect(asked.every((request) => request.query.get('from') === '2026-09-01T00:00:00Z')).toBe(true);
  });

  it('opens on the project of the link the project switcher gives, the slug in `project`', async () => {
    const asked = recordRequests('/runs');
    renderWithProviders(runsAs('admin'), { searchParams: '?project=cleanstart' });
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked.every((request) => request.path.includes(cleanstart.project_id))).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveTextContent('Cleanstart');
  });

  it('names the time zone of the times, which is the project’s while the month is counted in UTC', async () => {
    // Late on 30 September in UTC is already 1 October in Berlin: the run belongs to September's list
    const lateRun = store({
      run_id: uuid(1),
      created_at: '2026-09-30T23:30:00.000Z',
      ending: 'completed',
    });
    const asked = recordRequests('/runs');
    server.use(
      http.get(mswPath(RUNS), () =>
        HttpResponse.json({
          data: [runView(MOCK_WORKSPACE.workspace_id, [], lateRun, FROZEN + 3_600_000)],
          page: { has_more: false, next_cursor: null, limit: 200 },
          meta: { manual_runs_today: { used: 3, limit: 20 } },
        }),
      ),
    );
    const berlin = { id: fynix.project_id, slug: fynix.slug, name: fynix.name, timeZone: 'Europe/Berlin' };
    renderWithProviders(runsAs('admin', [berlin]), { searchParams: '?month=2026-09' });
    const table = await grid();
    await waitFor(() => expect(bodyRows(table)).toHaveLength(1));
    expect(asked[0]?.query.get('from')).toBe('2026-09-01T00:00:00Z');
    expect(asked[0]?.query.get('to')).toBe('2026-10-01T00:00:00Z');
    // 23:30 UTC is 01:30 on 1 October in Berlin, and the page says whose clock that is
    expect(bodyRows(table)[0]).toHaveTextContent(/Oct 1\b/);
    expect(
      screen.getByText('Fynix, September 2026. 3 of 20 manual runs used today. Times in Europe/Berlin.'),
    ).toBeInTheDocument();
  });

  it('asks for the month that is chosen, in UTC, and the next month as its end', async () => {
    const asked = recordRequests('/runs');
    const url = urlWrites();
    const { user } = renderWithProviders(runsAs('admin'), { onUrlUpdate: url.onUrlUpdate });
    await grid();
    await user.click(screen.getByRole('combobox', { name: 'Month' }));
    await user.click(await screen.findByRole('option', { name: 'December 2025' }));
    await waitFor(() => expect(url.latest().get('month')).toBe('2025-12'));
    await waitFor(() =>
      expect(asked.some((request) => request.query.get('from') === '2025-12-01T00:00:00Z')).toBe(true),
    );
    expect(
      asked
        .filter((request) => request.query.get('from') === '2025-12-01T00:00:00Z')
        .every((request) => request.query.get('to') === '2026-01-01T00:00:00Z'),
    ).toBe(true);
    expect(await screen.findByText('No runs in December 2025')).toBeInTheDocument();
  });

  it('sends a status filter from the URL as filter[status_in], and says what the filters leave out', async () => {
    const asked = recordRequests('/runs');
    renderWithProviders(runsAs('admin'), { searchParams: '?status=cancelled' });
    await waitFor(() =>
      expect(asked.some((request) => request.query.get('filter[status_in]') === 'cancelled')).toBe(true),
    );
    expect(await screen.findByText('No runs match these filters in September 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Status: Cancelled. Edit filter' })).toBeInTheDocument();
    expect(
      asked.every((request) => !request.query.has('filter[workload_in]') && !request.query.has('filter[trigger_in]')),
    ).toBe(true);
  });

  it('says a search that finds nothing is a search, with Clear search, and not that filters are on', async () => {
    const url = urlWrites();
    const { user } = renderWithProviders(runsAs('admin'), { onUrlUpdate: url.onUrlUpdate });
    await screen.findAllByRole('rowheader');
    await user.type(screen.getByRole('searchbox', { name: /Search/ }), 'zebra');
    expect(await screen.findByRole('heading', { name: 'No runs match “zebra” in September 2026' })).toBeInTheDocument();
    expect(screen.queryByText(/match these filters/)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Applied filters' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(url.latest().has('q')).toBe(false));
    expect((await screen.findAllByRole('rowheader')).length).toBeGreaterThan(0);
  });

  it('keeps the filters in the empty state of a search that finds nothing while filters are on', async () => {
    renderWithProviders(runsAs('admin'), { searchParams: '?status=completed&q=zebra' });
    expect(await screen.findByRole('heading', { name: 'No runs match “zebra” in September 2026' })).toBeInTheDocument();
    const applied = screen.getByRole('list', { name: 'Applied filters' });
    expect(within(applied).getByText('Status: Completed')).toBeInTheDocument();
  });

  it('opens a run in the inspector with its tasks by status from the detail', async () => {
    const url = urlWrites();
    const { user } = renderWithProviders(runsAs('admin'), { onUrlUpdate: url.onUrlUpdate });
    const table = await grid();
    await waitFor(() => expect(bodyRows(table).length).toBeGreaterThan(0));
    const [row] = bodyRows(table);
    if (row === undefined) throw new Error('no row');
    await user.click(within(row).getByRole('rowheader'));
    await waitFor(() => expect(url.latest().get('inspect')).toMatch(/^run:/));
    const panel = await screen.findByRole('complementary');
    expect(await within(panel).findByText('Tasks by status')).toBeInTheDocument();
    // The newest fixture run failed: its tasks are failed
    expect(await within(panel).findByText('Failed', { selector: 'dt' })).toBeInTheDocument();
    expect(within(panel).getByText('Started by')).toBeInTheDocument();
    expect(within(panel).getByText('Sightline')).toBeInTheDocument();
  });

  it.each([
    ['missed_window', 'The scheduled window passed before the run could be planned, so nothing was collected for it'],
    ['not_planned', 'The run could not be planned, so nothing was collected for it'],
    ['budget_exceeded', 'A budget is used up'],
  ])('puts the reason %s of a run in words, never as the raw code', async (code, words) => {
    const run = store({ run_id: uuid(1), created_at: '2026-09-20T01:00:00.000Z' });
    const ended = (): Record<string, unknown> => ({
      ...runDetailView(MOCK_WORKSPACE.workspace_id, [], run, Date.now()),
      status: 'cancelled',
      status_reason: code,
    });
    server.use(
      http.get(mswPath(RUNS), () =>
        HttpResponse.json({
          data: [ended()],
          page: { has_more: false, next_cursor: null, limit: 200 },
          meta: { manual_runs_today: { used: 0, limit: 20 } },
        }),
      ),
      http.get(mswPath(RUN), () => HttpResponse.json({ data: ended() })),
    );
    renderWithProviders(runsAs('admin'), { searchParams: `?inspect=run:${uuid(1)}&month=2026-09` });
    const panel = await screen.findByRole('complementary');
    expect(await within(panel).findByText(words)).toBeInTheDocument();
    expect(within(panel).queryByText(code)).toBeNull();
  });

  it('says a run does not exist for a link to one the project has not got', async () => {
    renderWithProviders(runsAs('admin'), { searchParams: `?inspect=run:${uuid(999)}` });
    expect(await screen.findByText('This run does not exist or you do not have access to it.')).toBeInTheDocument();
  });

  it('names the inspector of a run that is not known by its type, and focuses that title, never an empty one', async () => {
    renderWithProviders(runsAs('admin'), { searchParams: `?inspect=run:${uuid(999)}` });
    const inspector = await screen.findByRole('complementary', { name: 'Run' });
    expect(within(inspector).getByRole('heading', { level: 2, name: 'Run' })).toHaveFocus();
  });

  it('cancels a run that is still open after asking, and shows it cancelled', async () => {
    const running = store({ run_id: uuid(1) });
    const served = serveRuns([running]);
    const { user } = renderWithProviders(runsAs('admin'));
    const table = await grid();
    await waitFor(() => expect(bodyRows(table)).toHaveLength(1));
    expect(bodyRows(table)[0]).toHaveTextContent('Running');
    await user.click(within(table).getByRole('button', { name: /^Actions for / }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel run' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Cancel this run?')).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Tasks already sent to the provider still finish and are paid/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel run' }));
    expect(await screen.findByText('Run cancelled')).toBeInTheDocument();
    expect(served.cancels).toEqual([running.run_id]);
    // The list was read again: no row keeps saying the run is open
    await waitFor(() => expect(bodyRows(table)[0]).toHaveTextContent('Cancelled'));
    expect(within(table).queryByRole('button', { name: /^Actions for / })).toBeNull();
  });

  it('says in words that a cancelled run was cancelled by a member, whatever free text the mock keeps', async () => {
    serveRuns([
      store({ run_id: uuid(1), cancelled_at: new Date(NOW.getTime() - 1_000).toISOString() }),
      store({
        run_id: uuid(2),
        created_at: new Date(NOW.getTime() - 6_000).toISOString(),
        cancelled_at: new Date(NOW.getTime() - 2_000).toISOString(),
        cancel_reason: 'Started by mistake',
      }),
    ]);
    const { user } = renderWithProviders(runsAs('admin'));
    const table = await grid();
    await waitFor(() => expect(within(table).getAllByText('Cancelled')).toHaveLength(2));
    for (const at of [0, 1]) {
      const row = bodyRows(table)[at];
      if (row === undefined) throw new Error('no row');
      await user.click(within(row).getByRole('rowheader'));
      const panel = await screen.findByRole('complementary');
      expect(await within(panel).findByText('Cancelled by a member')).toBeInTheDocument();
      expect(within(panel).queryByText('Cancelled.')).toBeNull();
      expect(within(panel).queryByText('Started by mistake')).toBeNull();
    }
  });

  it('keeps the run when the question is answered Keep run', async () => {
    const served = serveRuns([store({ run_id: uuid(1) })]);
    const { user } = renderWithProviders(runsAs('admin'));
    const table = await grid();
    await user.click(await within(table).findByRole('button', { name: /^Actions for / }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel run' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Keep run' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(served.cancels).toEqual([]);
  });

  it('puts focus on a cell of the grid when the question closes, after Keep run and after Cancel run', async () => {
    serveRuns([store({ run_id: uuid(1) }), store({ run_id: uuid(2) })]);
    const { user } = renderWithProviders(runsAs('admin'));
    const table = await grid();
    await waitFor(() => expect(within(table).getAllByRole('button', { name: /^Actions for / })).toHaveLength(2));
    const onGridCell = (): boolean =>
      document.activeElement instanceof HTMLElement &&
      table.contains(document.activeElement) &&
      document.activeElement.dataset.cell !== undefined;

    // The menu item that opened the question is gone when it closes: focus must not fall to the page
    await user.click(within(table).getAllByRole('button', { name: /^Actions for / })[0] ?? table);
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel run' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Keep run' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(onGridCell()).toBe(true));

    await user.click(within(table).getAllByRole('button', { name: /^Actions for / })[0] ?? table);
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel run' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel run' }));
    expect(await screen.findByText('Run cancelled')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(onGridCell()).toBe(true));
    expect(document.body).not.toBe(document.activeElement);
  });

  it('offers Cancel to schedules:write on every open run, and to runs:trigger on the manual runs it started', async () => {
    const analyst = mockUser('analyst').user_id;
    const owner = mockUser('owner').user_id;
    const runs = [
      store({ run_id: uuid(1), trigger: 'schedule' }),
      store({ run_id: uuid(2), trigger: 'manual', created_by: analyst }),
      store({ run_id: uuid(3), trigger: 'manual', created_by: owner }),
      // An ended run is never cancelled
      store({ run_id: uuid(4), trigger: 'manual', created_by: analyst, created_at: '2026-09-28T09:00:00.000Z' }),
    ];
    serveRuns(runs);
    const first = renderWithProviders(runsAs('admin'));
    let table = await grid();
    await waitFor(() => expect(bodyRows(table)).toHaveLength(4));
    expect(within(table).getAllByRole('button', { name: /^Actions for / })).toHaveLength(3);
    first.unmount();

    const second = renderWithProviders(runsAs('analyst'));
    table = await grid();
    await waitFor(() => expect(bodyRows(table)).toHaveLength(4));
    const buttons = within(table).getAllByRole('button', { name: /^Actions for / });
    expect(buttons).toHaveLength(1);
    // The one with actions is the open manual run the analyst started, not the schedule's or the owner's
    const row = buttons[0]?.closest('tr');
    expect(row).toHaveTextContent('Manual');
    second.unmount();

    // A viewer cancels nothing: the table has no actions column at all
    renderWithProviders(runsAs('viewer'));
    table = await grid();
    await waitFor(() => expect(bodyRows(table)).toHaveLength(4));
    expect(within(table).queryByRole('button', { name: /^Actions for / })).toBeNull();
  });

  it('says a run has already ended when the API refuses the cancel, and reads the list again', async () => {
    const served = serveRuns([store({ run_id: uuid(1) })]);
    server.use(http.post(mswPath(CANCEL), ({ request }) => problem(request, 'invalid_state_transition')));
    const { user } = renderWithProviders(runsAs('admin'));
    const table = await grid();
    await user.click(await within(table).findByRole('button', { name: /^Actions for / }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel run' }));
    const before = served.lists();
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel run' }));
    expect(await within(dialog).findByText('This run has already ended.')).toBeInTheDocument();
    await waitFor(() => expect(served.lists()).toBeGreaterThan(before));
  });

  it('says it is not allowed when the API answers 403, and fails plainly otherwise', async () => {
    serveRuns([store({ run_id: uuid(1) })]);
    server.use(http.post(mswPath(CANCEL), ({ request }) => problem(request, 'forbidden')));
    const { user } = renderWithProviders(runsAs('admin'));
    const table = await grid();
    await user.click(await within(table).findByRole('button', { name: /^Actions for / }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel run' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel run' }));
    expect(
      await within(dialog).findByText('You do not have permission to cancel this run. Ask an admin of this workspace.'),
    ).toBeInTheDocument();
    server.use(http.post(mswPath(CANCEL), () => serverError()));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel run' }));
    expect(await within(dialog).findByText('The run could not be cancelled. Try again.')).toBeInTheDocument();
  });

  it('stops at 2,000 runs and says these are the newest', async () => {
    const asked: string[] = [];
    server.use(
      http.get(mswPath(RUNS), ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        asked.push(cursor ?? 'first');
        const page = cursor === null ? 0 : Number(cursor.replace('page-', ''));
        const data = Array.from({ length: 200 }, (_, at) =>
          runView(
            MOCK_WORKSPACE.workspace_id,
            [],
            store({
              run_id: uuid(page * 200 + at + 1),
              created_at: new Date(Date.parse('2026-09-20T00:00:00Z') - (page * 200 + at) * 60_000).toISOString(),
            }),
            Date.now() + 3_600_000,
          ),
        );
        return HttpResponse.json({
          data,
          page: { has_more: true, next_cursor: `page-${String(page + 1)}`, limit: 200 },
          meta: { manual_runs_today: null },
        });
      }),
    );
    renderWithProviders(runsAs('admin'));
    expect(
      await screen.findByText('Showing the newest 2,000 runs of the month. Narrow the filters to see older ones.'),
    ).toBeInTheDocument();
    // Ten pages of 200, and no eleventh
    expect(asked).toHaveLength(10);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(asked).toHaveLength(10);
    expect(screen.queryByText(/manual runs used today/)).toBeNull();
  });

  it('says so when a page after the first does not load, and loads it on Try again', async () => {
    let fail = true;
    server.use(
      http.get(mswPath(RUNS), ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        if (cursor === 'next' && fail) return serverError();
        const run = cursor === null ? store({ run_id: uuid(1) }) : store({ run_id: uuid(2) });
        return HttpResponse.json({
          data: [runView(MOCK_WORKSPACE.workspace_id, [], run, Date.now() + 3_600_000)],
          page: { has_more: cursor === null, next_cursor: cursor === null ? 'next' : null, limit: 200 },
          meta: { manual_runs_today: null },
        });
      }),
    );
    const { user } = renderWithProviders(runsAs('admin'));
    expect(await screen.findByText('Showing 1 run. The rest did not load.')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(bodyRows(screen.getByRole('grid', { name: 'Runs' }))).toHaveLength(2));
    expect(screen.queryByText(/The rest did not load/)).toBeNull();
  });

  it('fails in the table with Try again when the first page fails', async () => {
    let fail = true;
    server.use(http.get(mswPath(RUNS), () => (fail ? serverError() : undefined)));
    const { user } = renderWithProviders(runsAs('admin'));
    expect(await screen.findByText('The runs could not be loaded')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(bodyRows(screen.getByRole('grid', { name: 'Runs' })).length).toBeGreaterThan(0));
  });

  it('gives a member without data:read the no-access state, and asks for nothing', async () => {
    const asked = recordRequests('/runs');
    renderWithProviders(runsAs('billing'), { searchParams: `?inspect=run:${uuid(1)}` });
    expect(await screen.findByRole('heading', { name: 'You do not have access to Runs' })).toBeInTheDocument();
    expect(
      screen.getByText('You do not have permission to view runs. Ask an admin of this workspace.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Overview' })).toHaveAttribute('href', '/digibranders');
    expect(screen.getByRole('heading', { level: 1, name: 'Runs' })).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.queryByText('The runs could not be loaded')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(asked).toEqual([]);
  });

  it('says there is nothing to show when the member has no project', async () => {
    const asked = recordRequests('/runs');
    renderWithProviders(runsAs('admin', []));
    expect(await screen.findByText('No projects to show runs for')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All projects' })).toHaveAttribute('href', '/digibranders');
    expect(asked).toEqual([]);
  });
});
