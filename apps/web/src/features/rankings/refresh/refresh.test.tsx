import { act, screen, waitFor, within } from '@testing-library/react';
import { getResponse, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { Run } from '@/lib/api/types';
import { handlers } from '@/mocks/handlers';
import { invalidField, mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import {
  answerTrackedAsMany,
  fynix,
  loadedGrid,
  rankingsAs as as,
  restoreWideScreen,
  stubWideScreen,
} from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/rankings',
}));

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const RUNS = `${P}/runs`;
const RUN = `${P}/runs/{run_id}`;
const REFRESH = `${P}/keyword-metrics/refresh`;
const TRACKED = `${P}/tracked-keywords`;

const RUN_ID = '0192d1a8-e00b-7a10-8e07-000000000a01';
const OTHER_RUN_ID = '0192d1a8-e00b-7a10-8e07-000000000a02';
const NOW = '2026-10-05T10:00:00.000Z';
const LIST_PAGE = { limit: 20, next_cursor: null, has_more: false };

beforeEach(stubWideScreen);
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
  vi.useRealTimers();
});

/** A manual refresh as the API answers it. */
function run(over: Partial<Run> = {}): Run {
  return {
    run_id: RUN_ID,
    project_id: fynix.project_id,
    schedule_id: null,
    workload: 'keyword_metrics',
    trigger: 'manual',
    status: 'planned',
    status_reason: null,
    window_start: NOW,
    window_end: NOW,
    tasks_total: 0,
    tasks_succeeded: 0,
    tasks_failed: 0,
    estimated_cost_usd: null,
    actual_cost_usd: null,
    blocked_by_budget_id: null,
    created_by: null,
    created_at: NOW,
    completed_at: null,
    operation: {
      kind: 'collection_run',
      status: 'queued',
      started_at: null,
      finished_at: null,
      error: null,
      links: { self: `/api/v1/runs/${RUN_ID}` },
      progress: { done: 0, total: null, unit: 'tasks' },
    },
    ...over,
  };
}

/** A run that is running: `done` of `total` keywords read. */
const running = (done: number, total: number, over: Partial<Run> = {}): Run =>
  run({ status: 'running', tasks_total: total, tasks_succeeded: done, ...over });

interface RunsState {
  /** Manual runs started today, as `meta.manual_runs_today` says. */
  used: number;
  /** The open manual refreshes the list of runs holds. */
  open: Run[];
}

/** The project's runs: the open refreshes a reload resumes, and the day's count. Returns how often it was read. */
function serveRuns(state: RunsState): { reads: () => number } {
  let reads = 0;
  server.use(
    http.get(mswPath(RUNS), () => {
      reads += 1;
      return HttpResponse.json({
        data: state.open,
        page: LIST_PAGE,
        meta: { manual_runs_today: { used: state.used, limit: 20 } },
      });
    }),
  );
  return { reads: () => reads };
}

/** One run by id, as `answer` says it is now; `null` is a run that does not exist. */
function serveRun(answer: (runId: string) => Run | null): { reads: () => number } {
  let reads = 0;
  server.use(
    http.get(mswPath(RUN), ({ params, request }) => {
      reads += 1;
      const found = answer(String(params.run_id));
      return found === null ? problem(request, 'not_found') : HttpResponse.json({ data: found });
    }),
  );
  return { reads: () => reads };
}

/** The refreshes that are asked for: their bodies, in order, answered by `answer` (the mock's own when it gives nothing). */
function serveRefresh(answer: (request: Request) => Response | undefined = () => undefined): { bodies: unknown[] } {
  const bodies: unknown[] = [];
  server.use(
    http.post(mswPath(REFRESH), async ({ request }) => {
      bodies.push(await request.clone().json());
      return answer(request);
    }),
  );
  return { bodies };
}

const accepted = (started: Run): Response => HttpResponse.json({ data: started }, { status: 202 });

const ROWS = z.object({
  data: z.array(
    z
      .object({
        tracked_keyword_id: z.string(),
        keyword: z.object({ keyword_id: z.string(), text: z.string() }).loose(),
        metrics: z.unknown(),
      })
      .loose(),
  ),
  page: z.record(z.string(), z.unknown()),
});

/** Every tracked keyword the screen read, by name, as the list answered it. */
function watchRows(): { ids: (text: string) => { tracked: string; keyword: string }; all: () => string[] } {
  const rows = new Map<string, { tracked: string; keyword: string }>();
  server.events.on('response:mocked', ({ request, response }) => {
    if (request.method !== 'GET' || !new URL(request.url).pathname.endsWith('/tracked-keywords')) return;
    void response
      .clone()
      .json()
      .then((answer: unknown) => {
        const parsed = ROWS.safeParse(answer);
        if (!parsed.success) return;
        for (const row of parsed.data.data) {
          rows.set(row.keyword.text, { tracked: row.tracked_keyword_id, keyword: row.keyword.keyword_id });
        }
      });
  });
  return {
    ids: (text) => {
      const found = rows.get(text);
      if (found === undefined) throw new Error(`${text} was not in the list`);
      return found;
    },
    all: () => [...rows.values()].map((row) => row.keyword),
  };
}

/** How many times the list of keywords (not its poll, not its count) was read. */
function countListReads(): () => number {
  let reads = 0;
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (request.method !== 'GET' || !url.pathname.endsWith('/tracked-keywords')) return;
    if (url.searchParams.get('limit') === '1' || url.searchParams.get('sort') === '-created_at') return;
    reads += 1;
  });
  return () => reads;
}

type User = ReturnType<typeof renderWithProviders>['user'];

async function openMenu(user: User): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  return screen.findByRole('menu');
}

/** Opens the dialog from the menu, once the day's count has been read. */
async function openRefresh(user: User): Promise<HTMLElement> {
  await loadedGrid();
  const menu = await openMenu(user);
  await user.click(await within(menu).findByRole('menuitem', { name: /Refresh metrics/ }));
  return screen.findByRole('dialog', { name: 'Refresh metrics' });
}

const submit = (user: User, dialog: HTMLElement, name: string): Promise<void> =>
  user.click(within(dialog).getByRole('button', { name }));

describe('The Refresh metrics item of More actions', () => {
  it('says how many manual refreshes are left today', async () => {
    serveRuns({ used: 6, open: [] });
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    const menu = await openMenu(user);
    const item = await within(menu).findByRole('menuitem', { name: /Refresh metrics/ });
    await waitFor(() => expect(item).toHaveTextContent('14 of 20 left today'));
    expect(item).not.toHaveAttribute('aria-disabled', 'true');
    // Manage groups stays with it for a member who may write keywords
    expect(within(menu).getByRole('menuitem', { name: 'Manage groups' })).toBeInTheDocument();
  });

  it('is disabled with the reason when none are left, and the menu says when the limit resets', async () => {
    serveRuns({ used: 20, open: [] });
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    const menu = await openMenu(user);
    const item = await within(menu).findByRole('menuitem', { name: /Refresh metrics/ });
    await waitFor(() => expect(item).toHaveAttribute('aria-disabled', 'true'));
    expect(item).toHaveTextContent('0 of 20 left today');
    expect(
      within(menu).getByText('No manual refreshes left today. The limit resets at 00:00 UTC.'),
    ).toBeInTheDocument();
    await user.click(item);
    expect(screen.queryByRole('dialog', { name: 'Refresh metrics' })).toBeNull();
  });

  it('reads the day count again when the menu opens, so another member is counted', async () => {
    const state: RunsState = { used: 6, open: [] };
    const served = serveRuns(state);
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    await waitFor(() => expect(served.reads()).toBeGreaterThan(0));
    state.used = 19;
    const menu = await openMenu(user);
    await waitFor(() =>
      expect(within(menu).getByRole('menuitem', { name: /Refresh metrics/ })).toHaveTextContent('1 of 20 left today'),
    );
  });

  it('is disabled in the Archived view, which no refresh covers', async () => {
    serveRuns({ used: 6, open: [] });
    const { user } = renderWithProviders(as('editor'), { searchParams: '?archived=true' });
    await loadedGrid();
    const menu = await openMenu(user);
    const item = await within(menu).findByRole('menuitem', { name: /Refresh metrics/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveTextContent('Not for archived keywords');
  });
});

describe('Who sees Refresh metrics', () => {
  it('gives an analyst the item without Manage groups, which needs keywords:write', async () => {
    serveRuns({ used: 0, open: [] });
    const { user } = renderWithProviders(as('analyst'));
    await loadedGrid();
    const menu = await openMenu(user);
    expect(await within(menu).findByRole('menuitem', { name: /Refresh metrics/ })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Manage groups' })).toBeNull();
  });

  it('gives an editor both items', async () => {
    serveRuns({ used: 0, open: [] });
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    const menu = await openMenu(user);
    expect(await within(menu).findByRole('menuitem', { name: /Refresh metrics/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Manage groups' })).toBeInTheDocument();
  });

  it('gives a viewer no menu, and asks the API nothing about runs', async () => {
    const served = serveRuns({ used: 0, open: [] });
    renderWithProviders(as('viewer'));
    await loadedGrid();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(served.reads()).toBe(0);
  });

  it('gives the bulk bar of an editor the action, and an analyst, who cannot choose rows, none', async () => {
    serveRuns({ used: 0, open: [] });
    const { user, unmount } = renderWithProviders(as('editor'));
    await loadedGrid();
    await user.click(screen.getByRole('checkbox', { name: 'Select seo agency' }));
    const bar = screen.getByRole('group', { name: /Bulk actions/ });
    const names = within(bar)
      .getAllByRole('button')
      .map((button) => button.textContent);
    // With the other changes, ahead of Archive and Delete
    expect(names.indexOf('Refresh metrics')).toBeGreaterThan(names.indexOf('Set priority'));
    expect(names.indexOf('Refresh metrics')).toBeLessThan(names.indexOf('Archive'));
    unmount();
    renderWithProviders(as('analyst'));
    await loadedGrid();
    expect(screen.queryByRole('checkbox', { name: 'Select seo agency' })).toBeNull();
  });
});

describe('What the dialog refreshes', () => {
  it('starts on the stale keywords when nothing is chosen, and sends stale_days alone', async () => {
    serveRuns({ used: 0, open: [] });
    const sent = serveRefresh(() => accepted(run()));
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openRefresh(user);
    expect(within(dialog).getByRole('radio', { name: 'All keywords with stale metrics' })).toBeChecked();
    expect(
      within(dialog).getByText('Metrics older than 25 days, and keywords without metrics yet.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('20 of 20 manual refreshes left today.')).toBeInTheDocument();
    expect(await axe(dialog)).toHaveNoViolations();
    await submit(user, dialog, 'Refresh metrics');
    await waitFor(() => expect(sent.bodies).toEqual([{ stale_days: 25 }]));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Refresh metrics' })).toBeNull());
  });

  it('gives focus back to More actions when the dialog it opened closes', async () => {
    serveRuns({ used: 0, open: [] });
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openRefresh(user);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Refresh metrics' })).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'More actions' })).toHaveFocus());
  });

  it('sends the keyword ids, not the tracked keyword ids, of the chosen keywords', async () => {
    serveRuns({ used: 0, open: [] });
    const seen = watchRows();
    const sent = serveRefresh(() => accepted(run()));
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    await user.click(screen.getByRole('checkbox', { name: 'Select seo agency' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select backlink checker' }));
    const dialog = await openRefresh(user);
    expect(within(dialog).getByRole('radio', { name: 'The 2 chosen keywords' })).toBeChecked();
    await submit(user, dialog, 'Refresh metrics for 2 keywords');
    const first = seen.ids('seo agency');
    const second = seen.ids('backlink checker');
    await waitFor(() => expect(sent.bodies).toHaveLength(1));
    expect(sent.bodies[0]).toEqual({ keyword_ids: [first.keyword, second.keyword] });
    expect(first.keyword).not.toBe(first.tracked);
    // The choice is kept: the chosen rows stay chosen
    expect(screen.getByRole('checkbox', { name: 'Select seo agency' })).toBeChecked();
  });

  it('opens from the bulk bar for the same keywords', async () => {
    serveRuns({ used: 0, open: [] });
    const seen = watchRows();
    const sent = serveRefresh(() => accepted(run()));
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    await user.click(screen.getByRole('checkbox', { name: 'Select seo agency' }));
    const bar = screen.getByRole('group', { name: /Bulk actions/ });
    await user.click(within(bar).getByRole('button', { name: 'Refresh metrics' }));
    const dialog = await screen.findByRole('dialog', { name: 'Refresh metrics' });
    expect(within(dialog).getByRole('radio', { name: 'The chosen keyword' })).toBeChecked();
    await submit(user, dialog, 'Refresh metrics for 1 keyword');
    await waitFor(() => expect(sent.bodies).toEqual([{ keyword_ids: [seen.ids('seo agency').keyword] }]));
  });

  it('offers the keywords matching the filters, each once, and starts on them', async () => {
    serveRuns({ used: 0, open: [] });
    const seen = watchRows();
    const sent = serveRefresh(() => accepted(run()));
    const { user } = renderWithProviders(as('editor'), { searchParams: '?intent=commercial' });
    await loadedGrid();
    const dialog = await openRefresh(user);
    const label = within(dialog).getByText(/^All \d+ keywords matching the filters$/);
    expect(within(dialog).getByRole('radio', { name: label.textContent ?? '' })).toBeChecked();
    const count = Number(/\d+/.exec(label.textContent ?? '')?.[0]);
    expect(count).toBeGreaterThan(1);
    await submit(user, dialog, `Refresh metrics for ${String(count)} keywords`);
    await waitFor(() => expect(sent.bodies).toHaveLength(1));
    const body = z.object({ keyword_ids: z.array(z.string()) }).parse(sent.bodies[0]);
    expect(body.keyword_ids).toHaveLength(count);
    expect(new Set(body.keyword_ids).size).toBe(count);
    expect(body.keyword_ids.every((id) => seen.all().includes(id))).toBe(true);
  });

  it('leaves the filtered keywords out above 1,000 and says why, offering the stale ones instead', async () => {
    serveRuns({ used: 0, open: [] });
    answerListOf(1_200);
    const sent = serveRefresh(() => accepted(run()));
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openRefresh(user);
    const matching = within(dialog).getByRole('radio', { name: 'All 1,200 keywords in the list' });
    expect(matching).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(dialog).getByText(
        'One refresh takes up to 1,000 keywords. Narrow the list, or refresh all keywords with stale metrics.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'All keywords with stale metrics' })).toBeChecked();
    await submit(user, dialog, 'Refresh metrics');
    await waitFor(() => expect(sent.bodies).toEqual([{ stale_days: 25 }]));
  });

  it('leaves the keywords of a list above 10,000 out too, which it holds one page of', async () => {
    serveRuns({ used: 0, open: [] });
    answerTrackedAsMany({ total: 12_000, pages: 2 });
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openRefresh(user);
    expect(within(dialog).getByRole('radio', { name: 'All 12,000 keywords in the list' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(dialog).getByRole('radio', { name: 'All keywords with stale metrics' })).toBeChecked();
  });

  it('refuses more than 1,000 chosen keywords the same way', async () => {
    serveRuns({ used: 0, open: [] });
    answerListOf(1_200);
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    await user.click(screen.getByRole('checkbox', { name: /^Select all .* keywords loaded$/ }));
    const dialog = await openRefresh(user);
    expect(within(dialog).getByRole('radio', { name: 'The 1,200 chosen keywords' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(dialog).getByRole('radio', { name: 'All keywords with stale metrics' })).toBeChecked();
  });
});

/** The list answered with `count` keywords in one page, the real rows over again with ids of their own. */
function answerListOf(count: number): void {
  server.use(
    http.get(mswPath(TRACKED), async ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get('limit') === '1' || url.searchParams.has('sort', '-created_at')) return undefined;
      const real = await getResponse([...handlers], new Request(url, { headers: request.headers }));
      const body = ROWS.parse(await real?.json());
      const rows = Array.from({ length: count }, (_, index) => {
        const row = body.data[index % body.data.length];
        if (row === undefined) throw new Error('The list has no row to copy');
        const suffix = String(index).padStart(6, '0');
        return {
          ...row,
          tracked_keyword_id: `0192d1a8-0000-7a10-8e07-${suffix}`,
          keyword: { ...row.keyword, keyword_id: `0192d1a8-1111-7a10-8e07-${suffix}` },
        };
      });
      return HttpResponse.json({
        data: rows,
        page: { ...body.page, total: count, has_more: false, next_cursor: null },
      });
    }),
  );
}

describe('When the API does not take the refresh', () => {
  async function failWith(
    answer: (request: Request) => Response,
    runs: RunsState = { used: 6, open: [] },
  ): Promise<ReturnType<typeof renderWithProviders> & { dialog: HTMLElement }> {
    serveRuns(runs);
    serveRefresh(answer);
    const view = renderWithProviders(as('editor'));
    const dialog = await openRefresh(view.user);
    await submit(view.user, dialog, 'Refresh metrics');
    return { ...view, dialog };
  }

  it('tells the limit with its number, keeps the dialog, and takes the count to none left', async () => {
    const state: RunsState = { used: 19, open: [] };
    const { user, dialog } = await failWith((request) => {
      state.used = 20;
      return problem(request, 'manual_run_limit', { limit: 20, used: 20, retry_after_seconds: 3600 });
    }, state);
    expect(
      await within(dialog).findByText(
        'This project has used its 20 manual refreshes for today. The limit resets at 00:00 UTC.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Refresh metrics' })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByText('0 of 20 manual refreshes left today.')).toBeInTheDocument());
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    const menu = await openMenu(user);
    expect(within(menu).getByRole('menuitem', { name: /Refresh metrics/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('tells a keyword that was archived meanwhile, and reads the list again', async () => {
    serveRuns({ used: 6, open: [] });
    serveRefresh((request) =>
      invalidField(request, 'keyword_ids', 'keyword_unknown', 'A keyword is not one this project tracks.'),
    );
    const listReads = countListReads();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openRefresh(user);
    const before = listReads();
    await submit(user, dialog, 'Refresh metrics');
    expect(
      await within(dialog).findByText(
        'A keyword was archived or removed in the meantime. The list is up to date again: choose the keywords once more.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(listReads()).toBeGreaterThan(before));
    expect(screen.getByRole('dialog', { name: 'Refresh metrics' })).toBeInTheDocument();
  });

  it('tells a refusal for lack of permission', async () => {
    const { dialog } = await failWith((request) => problem(request, 'forbidden'));
    expect(
      await within(dialog).findByText('You do not have permission to refresh metrics in this project.'),
    ).toBeInTheDocument();
  });

  it('tells anything else in general words, and lets the person try again', async () => {
    const { user, dialog } = await failWith((request) => problem(request, 'not_found'));
    expect(
      await within(dialog).findByText('The refresh could not be started. Try again in a moment.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Refresh metrics' })).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  });

  it('says a refresh that a used-up budget blocked did not start, and follows nothing', async () => {
    serveRuns({ used: 6, open: [] });
    serveRefresh(() => accepted(run({ status: 'budget_blocked', status_reason: 'A budget is used up' })));
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openRefresh(user);
    await submit(user, dialog, 'Refresh metrics');
    expect(
      await screen.findByText('A budget for keyword research is used up this month. The refresh did not start.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Refresh metrics' })).toBeNull());
    expect(screen.queryByText('Metrics refresh queued')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('A refresh in the header', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it('shows the run queued, then running with its keywords, then ends in one toast and a new read of the list', async () => {
    const state: RunsState = { used: 6, open: [] };
    serveRuns(state);
    let current = run();
    const reads = serveRun(() => current);
    serveRefresh(() => {
      state.used = 7;
      return accepted(current);
    });
    const listReads = countListReads();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openRefresh(user);
    await submit(user, dialog, 'Refresh metrics');

    // Queued at once, from the answer that started it
    expect(await screen.findByText('Metrics refresh queued')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Refresh metrics' })).toBeNull());
    current = running(4, 10);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(await screen.findByText('Refreshing metrics')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Refreshing metrics' });
    expect(bar).toHaveAttribute('aria-valuenow', '4');
    expect(bar).toHaveAttribute('aria-valuetext', '4 of 10 keywords read');

    const before = listReads();
    current = run({ status: 'completed', tasks_total: 10, tasks_succeeded: 10, completed_at: NOW });
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(await screen.findByText('Metrics refreshed for 10 keywords')).toBeInTheDocument();
    expect(screen.getAllByText('Metrics refreshed for 10 keywords')).toHaveLength(1);
    expect(screen.queryByRole('progressbar')).toBeNull();
    await waitFor(() => expect(listReads()).toBeGreaterThan(before));

    // The run is not asked about again once it has ended
    const asked = reads.reads();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(reads.reads()).toBe(asked);
    expect(screen.queryByRole('progressbar')).toBeNull();

    // The count the menu quotes moved on with the run
    const menu = await openMenu(user);
    await waitFor(() =>
      expect(within(menu).getByRole('menuitem', { name: /Refresh metrics/ })).toHaveTextContent('13 of 20 left today'),
    );
  });

  it('asks about the run every 5 seconds while it is open, and not before', async () => {
    serveRuns({ used: 0, open: [] });
    const reads = serveRun(() => run());
    serveRefresh(() => accepted(run()));
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openRefresh(user);
    await submit(user, dialog, 'Refresh metrics');
    await screen.findByText('Metrics refresh queued');
    // The answer that started the run is the first reading; the next is 5 seconds on
    await act(() => vi.advanceTimersByTimeAsync(4_000));
    expect(reads.reads()).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    await waitFor(() => expect(reads.reads()).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    await waitFor(() => expect(reads.reads()).toBe(3));
  });

  it('stops asking about a run when the screen goes away', async () => {
    serveRuns({ used: 0, open: [run({ status: 'running', tasks_total: 10, tasks_succeeded: 2 })] });
    const reads = serveRun(() => running(2, 10));
    const { unmount } = renderWithProviders(as('editor'));
    await loadedGrid();
    await waitFor(() => expect(reads.reads()).toBeGreaterThan(0));
    unmount();
    const asked = reads.reads();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(reads.reads()).toBe(asked);
  });

  interface Ending {
    name: string;
    run: Partial<Run>;
    title: string;
    reason: string | null;
  }
  const ENDINGS: readonly Ending[] = [
    {
      name: 'completed with errors',
      run: { status: 'completed_with_errors', tasks_total: 10, tasks_succeeded: 7, tasks_failed: 3 },
      title: 'Metrics refreshed for 7 of 10 keywords, 3 failed',
      reason: null,
    },
    {
      name: 'completed with nothing to read',
      run: { status: 'completed', tasks_total: 0 },
      title: 'No keyword needed new metrics',
      reason: null,
    },
    {
      name: 'failed',
      run: { status: 'failed', status_reason: 'project_not_collecting' },
      title: 'The metrics refresh failed',
      reason: 'This project no longer collects data.',
    },
    {
      name: 'cancelled for lack of credentials',
      run: { status: 'cancelled', status_reason: 'workload_unavailable' },
      title: 'The metrics refresh was cancelled',
      reason: 'Keyword metrics cannot be collected on this installation.',
    },
    {
      name: 'cancelled for a reason the app has no words for',
      run: { status: 'cancelled', status_reason: 'something new' },
      title: 'The metrics refresh was cancelled',
      reason: null,
    },
    {
      name: 'blocked by a budget',
      run: { status: 'budget_blocked' },
      title: 'The metrics refresh did not start: a budget for keyword research is used up this month',
      reason: null,
    },
  ];

  it.each(ENDINGS)('ends $name in words', async ({ run: over, title, reason }) => {
    serveRuns({ used: 0, open: [run({ status: 'running', tasks_total: 10 })] });
    serveRun(() => run(over));
    renderWithProviders(as('editor'));
    // An error toast is also said aloud, so its title may be on the page twice
    expect((await screen.findAllByText(title)).length).toBeGreaterThanOrEqual(1);
    if (reason !== null) expect(screen.getAllByText(reason).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('something new')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('is picked up again after a reload from the open manual refreshes, and ends with its toast', async () => {
    const state: RunsState = { used: 3, open: [running(3, 10)] };
    const runs = serveRuns(state);
    let current = running(3, 10);
    serveRun(() => current);
    const { user } = renderWithProviders(as('editor'));
    expect(await screen.findByText('Refreshing metrics')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '3 of 10 keywords read');

    current = run({ status: 'completed', tasks_total: 10, tasks_succeeded: 10 });
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(await screen.findByText('Metrics refreshed for 10 keywords')).toBeInTheDocument();
    expect(screen.queryByText('Refreshing metrics')).toBeNull();

    // A later read of the open runs that still names the run (the list is a little behind) does not bring it back
    const before = runs.reads();
    await openMenu(user);
    await waitFor(() => expect(runs.reads()).toBeGreaterThan(before));
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.queryByText('Refreshing metrics')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('asks only for the manual keyword metrics runs that are open', async () => {
    const asked: URLSearchParams[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname.endsWith('/runs')) asked.push(url.searchParams);
    });
    renderWithProviders(as('editor'));
    await loadedGrid();
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    const [first] = asked;
    expect(first?.get('filter[workload_in]')).toBe('keyword_metrics');
    expect(first?.get('filter[trigger_in]')).toBe('manual');
    expect(first?.get('filter[status_in]')).toBe('planned,running');
  });

  it('follows several refreshes at once, each on its own', async () => {
    serveRuns({
      used: 2,
      open: [running(3, 10), run({ run_id: OTHER_RUN_ID, status: 'planned' })],
    });
    serveRun((runId) => (runId === RUN_ID ? running(3, 10) : run({ run_id: OTHER_RUN_ID })));
    renderWithProviders(as('editor'));
    expect(await screen.findByText('Refreshing metrics')).toBeInTheDocument();
    expect(await screen.findByText('Metrics refresh queued')).toBeInTheDocument();
  });

  it('lets go of a run the API no longer knows, without a word', async () => {
    serveRuns({ used: 0, open: [running(3, 10)] });
    const reads = serveRun(() => null);
    renderWithProviders(as('editor'));
    await loadedGrid();
    await waitFor(() => expect(reads.reads()).toBeGreaterThan(0));
    expect(screen.queryByText('Refreshing metrics')).toBeNull();
    expect(document.querySelector('[data-slot="toast"]')).toBeNull();
    const asked = reads.reads();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(reads.reads()).toBe(asked);
  });

  it('keeps a viewer out of it: nothing is read, nothing follows', async () => {
    const runs = serveRuns({ used: 0, open: [running(3, 10)] });
    renderWithProviders(as('viewer'));
    await loadedGrid();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(runs.reads()).toBe(0);
    expect(screen.queryByText('Refreshing metrics')).toBeNull();
  });
});

/** The poll of waiting keywords: the first page, newest first, with the metrics that arrived. */
function servePoll(): { polls: () => number; arrive: () => void } {
  let polls = 0;
  let arrived = false;
  server.use(
    http.get(mswPath(TRACKED), async ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get('sort') !== '-created_at') return undefined;
      polls += 1;
      const real = await getResponse([...handlers], new Request(url, { headers: request.headers }));
      const body = ROWS.parse(await real?.json());
      const donor = body.data.find((row) => row.metrics !== null && row.metrics !== undefined)?.metrics;
      if (!arrived || donor === undefined) return HttpResponse.json(body);
      return HttpResponse.json({
        ...body,
        data: body.data.map((row) => ({ ...row, metrics: row.metrics ?? donor })),
      });
    }),
  );
  return {
    polls: () => polls,
    arrive: () => {
      arrived = true;
    },
  };
}

describe('Keywords that wait for their first metrics', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  const pending = (grid: HTMLElement): number => within(grid).queryAllByText('Pending').length;

  it('are read every 30 seconds, newest first, until none is left, and the list is not read again', async () => {
    const poll = servePoll();
    const listReads = countListReads();
    const { user } = renderWithProviders(as('editor'));
    const grid = await loadedGrid();
    const waiting = pending(grid);
    expect(waiting).toBeGreaterThanOrEqual(3);
    await waitFor(() => expect(listReads()).toBeGreaterThan(0));
    const loaded = listReads();
    await user.click(screen.getByRole('checkbox', { name: 'Select seo agency' }));

    await act(() => vi.advanceTimersByTimeAsync(29_000));
    expect(poll.polls()).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    await waitFor(() => expect(poll.polls()).toBe(1));
    // Nothing arrived yet: the rows say Pending still, and the table does not flash
    expect(pending(grid)).toBe(waiting);
    expect(grid).not.toHaveAttribute('aria-busy', 'true');

    poll.arrive();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    await waitFor(() => expect(poll.polls()).toBe(2));
    await waitFor(() => expect(pending(grid)).toBe(0));
    // The chosen row is still chosen, and no page of the list was read again
    expect(screen.getByRole('checkbox', { name: 'Select seo agency' })).toBeChecked();
    expect(listReads()).toBe(loaded);

    // None is left: the polling stops
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(poll.polls()).toBe(2);
  });

  it('are not waited for after 15 minutes from when the page first saw them', async () => {
    const poll = servePoll();
    renderWithProviders(as('editor'));
    const grid = await loadedGrid();
    expect(pending(grid)).toBeGreaterThan(0);
    for (let tick = 0; tick < 31; tick += 1) await act(() => vi.advanceTimersByTimeAsync(30_000));
    const reads = poll.polls();
    expect(reads).toBeGreaterThanOrEqual(28);
    expect(reads).toBeLessThanOrEqual(30);
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(poll.polls()).toBe(reads);
  });

  it('are not polled when none on screen waits: archived keywords are not collected', async () => {
    const poll = servePoll();
    renderWithProviders(as('editor'), { searchParams: '?archived=true' });
    await loadedGrid();
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(poll.polls()).toBe(0);
  });

  it('are not polled once the screen is gone', async () => {
    const poll = servePoll();
    const { unmount } = renderWithProviders(as('editor'));
    await loadedGrid();
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(poll.polls()).toBe(0);
  });

  it('are not polled while the tab is hidden', async () => {
    const poll = servePoll();
    const hidden = vi.spyOn(Document.prototype, 'hidden', 'get').mockReturnValue(true);
    renderWithProviders(as('editor'));
    await loadedGrid();
    await act(() => vi.advanceTimersByTimeAsync(2 * 60_000));
    expect(poll.polls()).toBe(0);
    hidden.mockReturnValue(false);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    await waitFor(() => expect(poll.polls()).toBe(1));
  });
});
