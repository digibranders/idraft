import { act, screen, waitFor, within } from '@testing-library/react';
import { getResponse, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { api } from '@/lib/api/client';
import { gate } from '@/test/gate';
import type { Run } from '@/lib/api/types';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { handlers } from '@/mocks/handlers';
import { PENDING_ADDED_AT } from '@/mocks/keyword-fixtures';
import { invalidField, mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import {
  answerTrackedAsMany,
  columnTexts,
  fynix,
  keywordsIn,
  loadedGrid,
  pendingMetricCells,
  pendingRankCells,
  rankingsAs as as,
  restoreWideScreen,
  stubWideScreen,
} from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/keywords',
}));

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const RUNS = `${P}/runs`;
const RUN = `${P}/runs/{run_id}`;
const REFRESH = `${P}/keyword-metrics/refresh`;
const TRACKED = `${P}/tracked-keywords`;
const BULK_ARCHIVE = `${TRACKED}/bulk-archive`;

const RUN_ID = '0192d1a8-e00b-7a10-8e07-000000000a01';
const OTHER_RUN_ID = '0192d1a8-e00b-7a10-8e07-000000000a02';
const NOW = '2026-10-05T10:00:00.000Z';
const LIST_PAGE = { limit: 20, next_cursor: null, has_more: false };

beforeEach(stubWideScreen);
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
  // A spy on the document (the hidden tab) must not outlive its test
  vi.restoreAllMocks();
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
    // The editor of these tests started it: the header follows the runs of the member alone
    created_by: { actor_type: 'user', actor_id: mockUser('editor').user_id, label: 'Editor' },
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
    http.get(mswPath(RUNS), ({ request }) => {
      reads += 1;
      const url = new URL(request.url);
      const workloads = url.searchParams.getAll('filter[workload_in]');
      const matching = workloads.length === 0 ? state.open : state.open.filter((r) => workloads.includes(r.workload));
      return HttpResponse.json({
        data: matching,
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
        state: z.object({ current: z.object({ state: z.string() }).loose() }).loose(),
      })
      .loose(),
  ),
  page: z.record(z.string(), z.unknown()),
});

type FeedRow = z.infer<typeof ROWS>['data'][number];

/** The rank state of a keyword that has not been checked yet, and of one that has, as the fixtures give them. */
function rankStates(rows: readonly FeedRow[]): { unchecked: FeedRow['state']; checked: FeedRow['state'] } {
  const unchecked = rows.find((row) => row.state.current.state === 'not_checked')?.state;
  const checked = rows.find((row) => row.state.current.state !== 'not_checked')?.state;
  if (unchecked === undefined || checked === undefined)
    throw new Error('The fixtures lack a checked or an unchecked keyword');
  return { unchecked, checked };
}

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
    // The count is the item's description and not part of its name
    expect(item).toHaveAccessibleName('Refresh metrics');
    expect(item).toHaveAccessibleDescription('14 of 20 left today');
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
    const header = menu.querySelector<HTMLElement>('[data-slot="menu-header"]');
    expect(header).toHaveTextContent('No manual runs left today. The limit resets at 00:00 UTC.');
    // Assistive technology reaches the reset time from the item: the header is not focusable
    expect(item).toHaveAccessibleName('Refresh metrics');
    expect(item).toHaveAccessibleDescription('No manual runs left today. The limit resets at 00:00 UTC.');
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

  /** An analyst holds runs:trigger but not keywords:write: the dialog opens from the menu, which has no Manage groups. */
  async function openRefreshAsAnalyst(user: User): Promise<HTMLElement> {
    await loadedGrid();
    const menu = await openMenu(user);
    expect(within(menu).queryByRole('menuitem', { name: 'Manage groups' })).toBeNull();
    await user.click(await within(menu).findByRole('menuitem', { name: /Refresh metrics/ }));
    return screen.findByRole('dialog', { name: 'Refresh metrics' });
  }

  it('lets an analyst refresh the keywords matching the filters, which it has no chosen keywords for', async () => {
    serveRuns({ used: 0, open: [] });
    const seen = watchRows();
    const sent = serveRefresh(() => accepted(run()));
    const { user } = renderWithProviders(as('analyst'), { searchParams: '?intent=commercial' });
    const dialog = await openRefreshAsAnalyst(user);
    // Rows cannot be chosen without keywords:write, so nothing is offered to start on but the list
    expect(within(dialog).queryByRole('radio', { name: /chosen/ })).toBeNull();
    const label = within(dialog).getByText(/^All \d+ keywords matching the filters$/);
    expect(within(dialog).getByRole('radio', { name: label.textContent ?? '' })).toBeChecked();
    const count = Number(/\d+/.exec(label.textContent ?? '')?.[0]);
    await submit(user, dialog, `Refresh metrics for ${String(count)} keywords`);
    await waitFor(() => expect(sent.bodies).toHaveLength(1));
    const body = z.object({ keyword_ids: z.array(z.string()) }).parse(sent.bodies[0]);
    expect(body.keyword_ids).toHaveLength(count);
    expect(body.keyword_ids.every((id) => seen.all().includes(id))).toBe(true);
  });

  it('lets an analyst refresh the stale keywords', async () => {
    serveRuns({ used: 0, open: [] });
    const sent = serveRefresh(() => accepted(run()));
    const { user } = renderWithProviders(as('analyst'));
    const dialog = await openRefreshAsAnalyst(user);
    expect(within(dialog).getByRole('radio', { name: 'All keywords with stale metrics' })).toBeChecked();
    await submit(user, dialog, 'Refresh metrics');
    await waitFor(() => expect(sent.bodies).toEqual([{ stale_days: 25 }]));
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
    await user.click(screen.getByRole('checkbox', { name: 'Select seo agency, desktop, United States' }));
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
    expect(screen.queryByRole('checkbox', { name: 'Select seo agency, desktop, United States' })).toBeNull();
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
    expect(within(dialog).getByText('20 of 20 manual runs left today.')).toBeInTheDocument();
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
    await user.click(screen.getByRole('checkbox', { name: 'Select seo agency, desktop, United States' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select backlink checker, desktop, Germany' }));
    const dialog = await openRefresh(user);
    expect(within(dialog).getByRole('radio', { name: 'The 2 chosen keywords' })).toBeChecked();
    await submit(user, dialog, 'Refresh metrics for 2 keywords');
    const first = seen.ids('seo agency');
    const second = seen.ids('backlink checker');
    await waitFor(() => expect(sent.bodies).toHaveLength(1));
    expect(sent.bodies[0]).toEqual({ keyword_ids: [first.keyword, second.keyword] });
    expect(first.keyword).not.toBe(first.tracked);
    // The choice is kept: the chosen rows stay chosen
    expect(screen.getByRole('checkbox', { name: 'Select seo agency, desktop, United States' })).toBeChecked();
  });

  it('opens from the bulk bar for the same keywords', async () => {
    serveRuns({ used: 0, open: [] });
    const seen = watchRows();
    const sent = serveRefresh(() => accepted(run()));
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    await user.click(screen.getByRole('checkbox', { name: 'Select seo agency, desktop, United States' }));
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

  it('names the keywords chosen on several pages of a list above 10,000, which only the pages seen can tell', async () => {
    serveRuns({ used: 0, open: [] });
    answerTrackedAsMany({ total: 12_000, pages: 3 });
    const seen = watchRows();
    const sent = serveRefresh(() => accepted(run()));
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    await user.click(screen.getByRole('checkbox', { name: 'Select seo agency, desktop, United States' }));
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    // The second page holds the same keywords under ids of their own: the first page's choice is not ticked
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Select seo agency, desktop, United States' })).not.toBeChecked(),
    );
    await user.click(screen.getByRole('checkbox', { name: 'Select backlink checker, desktop, Germany' }));
    const dialog = await openRefresh(user);
    expect(within(dialog).getByRole('radio', { name: 'The 2 chosen keywords' })).toBeChecked();
    await submit(user, dialog, 'Refresh metrics for 2 keywords');
    await waitFor(() => expect(sent.bodies).toHaveLength(1));
    expect(sent.bodies[0]).toEqual({
      keyword_ids: [seen.ids('seo agency').keyword, seen.ids('backlink checker').keyword],
    });
  });

  it('cannot send the ids of the previous filters while the list of the new ones loads', async () => {
    serveRuns({ used: 0, open: [] });
    const seen = watchRows();
    const sent = serveRefresh(() => accepted(run()));
    // Without the filter the list answers late (when the test says), and the rows of the filter stay on screen meanwhile
    const late = gate();
    server.use(
      http.get(mswPath(TRACKED), async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('limit') !== '1' && !url.searchParams.has('filter[intent_in]')) await late.promise;
        return undefined;
      }),
    );
    const { user } = renderWithProviders(as('editor'), { searchParams: '?intent=commercial' });
    const grid = await loadedGrid();
    const filtered = keywordsIn(grid).length;
    await user.click(screen.getByRole('button', { name: 'Remove filter Intent: Commercial' }));
    const menu = await openMenu(user);
    await user.click(await within(menu).findByRole('menuitem', { name: /Refresh metrics/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Refresh metrics' });
    const matching = within(dialog).getByRole('radio', { name: /^All \d+ keywords in the list$/ });
    expect(matching).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(dialog).getByText('The list is still loading, so its keywords cannot be counted yet.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'All keywords with stale metrics' })).toBeChecked();
    // Once the new list has loaded, the whole list is named, not the rows that were on screen
    late.open();
    await waitFor(() => expect(matching).not.toHaveAttribute('aria-disabled', 'true'), { timeout: 5_000 });
    await user.click(matching);
    const count = Number(/\d+/.exec(within(dialog).getByText(/^All \d+ keywords in the list$/).textContent)?.[0]);
    expect(count).toBeGreaterThan(filtered);
    await submit(user, dialog, `Refresh metrics for ${String(count)} keywords`);
    await waitFor(() => expect(sent.bodies).toHaveLength(1));
    const body = z.object({ keyword_ids: z.array(z.string()) }).parse(sent.bodies[0]);
    expect(body.keyword_ids).toHaveLength(count);
    expect(body.keyword_ids.every((id) => seen.all().includes(id))).toBe(true);
  });

  it('says when a later page of the list did not load, not that the list is still loading', async () => {
    serveRuns({ used: 0, open: [] });
    answerTrackedAsMany({ total: 450, pages: 3, failSecond: () => true });
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openRefresh(user);
    expect(await within(dialog).findByText('The list could not be fully loaded. Try again.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/still loading/)).toBeNull();
    expect(within(dialog).getByRole('radio', { name: 'All 450 keywords in the list' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('keeps the choice it opened on when the list finishes loading with the dialog open', async () => {
    serveRuns({ used: 0, open: [] });
    answerTrackedAsMany({ total: 450, pages: 3 });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The pages after the first wait until the test lets them go
    server.use(
      http.get(mswPath(TRACKED), async ({ request }) => {
        if (new URL(request.url).searchParams.has('cursor')) await held;
        return undefined;
      }),
    );
    const { user } = renderWithProviders(as('editor'), { searchParams: '?intent=commercial' });
    const dialog = await openRefresh(user);
    const stale = within(dialog).getByRole('radio', { name: 'All keywords with stale metrics' });
    const matching = within(dialog).getByRole('radio', { name: /^All 450 keywords matching the filters$/ });
    expect(matching).toHaveAttribute('aria-disabled', 'true');
    expect(stale).toBeChecked();
    release();
    await waitFor(() => expect(matching).not.toHaveAttribute('aria-disabled', 'true'));
    // Narrowed filters would start on the list had it been loaded at the start: the choice does not move
    expect(stale).toBeChecked();
    expect(matching).not.toBeChecked();
  });

  it('keeps its choices while the dialog closes, which they would not if the selection went with it', async () => {
    serveRuns({ used: 0, open: [] });
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    await user.click(screen.getByRole('checkbox', { name: 'Select seo agency, desktop, United States' }));
    const dialog = await openRefresh(user);
    expect(within(dialog).getByRole('radio', { name: 'The chosen keyword' })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(within(dialog).getByRole('radio', { name: 'The chosen keyword' })).toBeChecked();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Refresh metrics' })).toBeNull());
  });

  it('says that every location and language of a keyword is read, whatever the filters narrow', async () => {
    serveRuns({ used: 0, open: [] });
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    await user.click(screen.getByRole('checkbox', { name: 'Select seo agency, desktop, United States' }));
    const dialog = await openRefresh(user);
    const hint = 'A keyword is read at every location and language it is tracked in.';
    expect(within(dialog).getByText(hint)).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'The search box is left out. Each keyword is read at every location and language it is tracked in, whatever a filter says about them.',
      ),
    ).toBeInTheDocument();
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
      return problem(request, 'manual_run_limit', { limit: 20 });
    }, state);
    expect(
      await within(dialog).findByText('This project has used its 20 manual runs today. The limit resets at 00:00 UTC.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Refresh metrics' })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByText('0 of 20 manual runs left today.')).toBeInTheDocument());
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
        'A keyword was archived or removed in the meantime. The list was read again, and the keywords that left it are no longer chosen. Check the choice and try again.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(listReads()).toBeGreaterThan(before));
    expect(screen.getByRole('dialog', { name: 'Refresh metrics' })).toBeInTheDocument();
  });

  it('drops the chosen keyword that left the list after the 422, so the second try offers the rest and goes through', async () => {
    serveRuns({ used: 6, open: [] });
    const seen = watchRows();
    // The mock refuses a keyword the project no longer tracks, as the API does
    const sent = serveRefresh();
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    for (const name of ['seo agency', 'backlink checker', 'crawl budget']) {
      // A row's name goes on after the keyword: its device and location
      await user.click(screen.getByRole('checkbox', { name: new RegExp(`^Select ${name},`) }));
    }
    // Another member archives one of the three while the dialog is open
    const dialog = await openRefresh(user);
    expect(within(dialog).getByRole('radio', { name: 'The 3 chosen keywords' })).toBeChecked();
    const archived = await api.POST(BULK_ARCHIVE, {
      params: { path: { workspace_id: MOCK_WORKSPACE.workspace_id, project_id: fynix.project_id } },
      body: { ids: [seen.ids('backlink checker').tracked], archive: true },
    });
    expect(archived.response.ok).toBe(true);

    await submit(user, dialog, 'Refresh metrics for 3 keywords');
    expect(await within(dialog).findByText(/^A keyword was archived or removed in the meantime/)).toBeInTheDocument();
    // The list is read again, and the keyword that left it is no longer chosen, here or in the table
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'The 2 chosen keywords' })).toBeChecked());
    // The table is behind the dialog, which leaves it out of the accessibility tree
    expect(
      screen.getByRole('checkbox', { name: 'Select seo agency, desktop, United States', hidden: true }),
    ).toBeChecked();
    expect(
      screen.queryByRole('checkbox', { name: 'Select backlink checker, desktop, Germany', hidden: true }),
    ).toBeNull();

    await submit(user, dialog, 'Refresh metrics for 2 keywords');
    await waitFor(() => expect(sent.bodies).toHaveLength(2));
    expect(sent.bodies[1]).toEqual({
      keyword_ids: [seen.ids('seo agency').keyword, seen.ids('crawl budget').keyword],
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Refresh metrics' })).toBeNull());
  });

  it('tells a refusal for lack of permission', async () => {
    const { dialog } = await failWith((request) => problem(request, 'forbidden'));
    expect(
      await within(dialog).findByText(
        'You do not have permission to refresh metrics in this project. Ask an admin of this workspace.',
      ),
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
    expect(bar).toHaveAttribute('aria-valuetext', '4 of 10 read');

    const before = listReads();
    current = run({ status: 'completed', tasks_total: 10, tasks_succeeded: 10, completed_at: NOW });
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(await screen.findByText('Metrics refreshed: 10 of 10 read')).toBeInTheDocument();
    expect(screen.getAllByText('Metrics refreshed: 10 of 10 read')).toHaveLength(1);
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
      title: 'Metrics refreshed: 7 of 10 read, 3 failed',
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
      reason: 'The project no longer collects data',
    },
    {
      name: 'cancelled for lack of credentials',
      run: { status: 'cancelled', status_reason: 'workload_unavailable' },
      title: 'The metrics refresh was cancelled',
      reason: 'This kind of data cannot be collected here',
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
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '3 of 10 read');

    current = run({ status: 'completed', tasks_total: 10, tasks_succeeded: 10 });
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(await screen.findByText('Metrics refreshed: 10 of 10 read')).toBeInTheDocument();
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

  it('announces that the refresh was queued, which the bar does not say when it first shows', async () => {
    serveRuns({ used: 0, open: [] });
    serveRun(() => run());
    serveRefresh(() => accepted(run()));
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openRefresh(user);
    await submit(user, dialog, 'Refresh metrics');
    await waitFor(() =>
      expect(document.getElementById('live-region-polite')).toHaveTextContent(
        'Metrics refresh queued. Its progress shows under the page title.',
      ),
    );
  });

  it('shows a refresh a reload found at once, from the open runs, before its own read has answered', async () => {
    serveRuns({ used: 3, open: [running(3, 10)] });
    // The run's own read stays unanswered until the test ends
    const unanswered = gate();
    server.use(
      http.get(mswPath(RUN), async () => {
        await unanswered.promise;
        return HttpResponse.json({ data: running(3, 10) });
      }),
    );
    renderWithProviders(as('editor'));
    expect(await screen.findByText('Refreshing metrics')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '3 of 10 read');
    unanswered.open();
  });

  describe('that the member did not start', () => {
    const SYSTEM = { actor_type: 'system', actor_id: 'system', label: 'idraft.ai' } as const;
    const OTHER_MEMBER = { actor_type: 'user', actor_id: mockUser('admin').user_id, label: 'Another member' } as const;

    it('does not follow the manual run the system starts for new keywords, and quotes the day’s count as the API says', async () => {
      const runs = serveRuns({ used: 4, open: [running(0, 3, { created_by: SYSTEM })] });
      const reads = serveRun(() => running(0, 3, { created_by: SYSTEM }));
      const { user } = renderWithProviders(as('editor'));
      await loadedGrid();
      await waitFor(() => expect(runs.reads()).toBeGreaterThan(0));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(screen.queryByText('Refreshing metrics')).toBeNull();
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(reads.reads()).toBe(0);
      // The API's count of the day (it leaves the system's runs out), which the menu quotes
      const dialog = await openRefresh(user);
      expect(within(dialog).getByText('16 of 20 manual runs left today.')).toBeInTheDocument();
    });

    it('shows no bar after keywords were added and the page was opened again, with the mock’s own system run open', async () => {
      const first = renderWithProviders(as('editor'));
      await loadedGrid();
      const path = { workspace_id: MOCK_WORKSPACE.workspace_id, project_id: fynix.project_id };
      const added = await api.POST(TRACKED, {
        params: { path },
        body: { keyword: 'fresh idea one', priority: 3, funnel_stage: 'unknown', search_engine: 'google' },
      });
      expect(added.response.status).toBe(201);
      // The mocks record the run the worker would make for the new keyword's first metrics
      const open = await api.GET(RUNS, {
        params: { path, query: { 'filter[status_in]': ['planned', 'running'], 'filter[trigger_in]': ['manual'] } },
      });
      expect(open.data?.data.map((found) => found.created_by?.actor_type)).toEqual(['system']);
      first.unmount();
      renderWithProviders(as('editor'));
      await loadedGrid();
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(screen.queryByText('Refreshing metrics')).toBeNull();
      expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('does not follow a refresh another member started', async () => {
      serveRuns({ used: 1, open: [running(2, 10, { created_by: OTHER_MEMBER })] });
      const reads = serveRun(() => running(2, 10, { created_by: OTHER_MEMBER }));
      renderWithProviders(as('editor'));
      await loadedGrid();
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(screen.queryByText('Refreshing metrics')).toBeNull();
      expect(reads.reads()).toBe(0);
    });

    it('follows the member’s own refresh among the others', async () => {
      serveRuns({
        used: 3,
        open: [
          running(0, 3, { created_by: SYSTEM, run_id: OTHER_RUN_ID }),
          running(4, 10, { created_by: { ...OTHER_MEMBER, actor_id: mockUser('editor').user_id, label: 'Me' } }),
        ],
      });
      serveRun((runId) =>
        runId === RUN_ID
          ? running(4, 10, { created_by: { ...OTHER_MEMBER, actor_id: mockUser('editor').user_id, label: 'Me' } })
          : running(0, 3, { created_by: SYSTEM, run_id: OTHER_RUN_ID }),
      );
      renderWithProviders(as('editor'));
      expect(await screen.findByText('Refreshing metrics')).toBeInTheDocument();
      expect(screen.getAllByRole('progressbar')).toHaveLength(1);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '4 of 10 read');
    });

    it('finds an open seo_rank run on mount by the Check now follower and not by the refresh follower', async () => {
      const seoRankRun = run({
        run_id: RUN_ID,
        workload: 'seo_rank',
        status: 'running',
        tasks_total: 5,
        tasks_succeeded: 2,
        created_by: { actor_type: 'user', actor_id: mockUser('editor').user_id, label: 'Editor' },
      });
      serveRuns({ used: 1, open: [seoRankRun] });
      serveRun(() => seoRankRun);
      renderWithProviders(as('editor'));
      expect(await screen.findByText('Checking ranks')).toBeInTheDocument();
      expect(screen.queryByText('Refreshing metrics')).toBeNull();
    });
  });

  describe('that cannot be followed', () => {
    /** The run is answered with `answer` every time; counts the reads. */
    function answerRunWith(answer: (request: Request) => Response): { reads: () => number } {
      let reads = 0;
      server.use(
        http.get(mswPath(RUN), ({ request }) => {
          reads += 1;
          return answer(request);
        }),
      );
      return { reads: () => reads };
    }

    it('is let go of at once when the API refuses to say, with one word that it may still run', async () => {
      serveRuns({ used: 3, open: [running(3, 10)] });
      const reads = answerRunWith((request) => problem(request, 'forbidden'));
      renderWithProviders(as('editor'));
      await act(() => vi.advanceTimersByTimeAsync(5_000));
      const lost = await screen.findByText(
        'This refresh could not be followed here. It may still be running. Reload the page to check on it.',
      );
      expect(lost.closest('[data-slot="toast"]')).toHaveAttribute('data-type', 'info');
      expect(screen.queryByRole('progressbar')).toBeNull();
      const asked = reads.reads();
      expect(asked).toBeGreaterThan(0);
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect(reads.reads()).toBe(asked);
    });

    it('is let go of after five reads in a row that the API did not answer, and not before', async () => {
      serveRuns({ used: 3, open: [running(3, 10)] });
      const reads = answerRunWith(() => new HttpResponse('Bad gateway', { status: 502 }));
      renderWithProviders(as('editor'));
      await waitFor(() => expect(reads.reads()).toBeGreaterThanOrEqual(1));
      while (reads.reads() < 4) await act(() => vi.advanceTimersByTimeAsync(5_000));
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
      expect(screen.queryByText(/This refresh could not be followed here/)).toBeNull();
      while (reads.reads() < 5) await act(() => vi.advanceTimersByTimeAsync(5_000));
      expect(await screen.findByText(/^This refresh could not be followed here/)).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).toBeNull();
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect(reads.reads()).toBe(5);
    });

    it('starts over the count of failed reads with every read that is answered', async () => {
      serveRuns({ used: 3, open: [running(3, 10)] });
      let failing = true;
      const reads = answerRunWith(() =>
        failing ? new HttpResponse('Bad gateway', { status: 502 }) : HttpResponse.json({ data: running(4, 10) }),
      );
      renderWithProviders(as('editor'));
      while (reads.reads() < 4) await act(() => vi.advanceTimersByTimeAsync(5_000));
      failing = false;
      await act(() => vi.advanceTimersByTimeAsync(5_000));
      failing = true;
      const answered = reads.reads();
      while (reads.reads() < answered + 4) await act(() => vi.advanceTimersByTimeAsync(5_000));
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  it('counts the keywords read as the ones that succeeded, with the failed ones apart, as the finished toast does', async () => {
    serveRuns({ used: 3, open: [running(5, 10, { tasks_failed: 3 })] });
    serveRun(() => running(5, 10, { tasks_failed: 3 }));
    renderWithProviders(as('editor'));
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuetext', '5 of 10 read, 3 failed');
  });

  it('says when a queued run has waited longer than usual, and keeps following it', async () => {
    serveRuns({ used: 0, open: [run()] });
    const reads = serveRun(() => run());
    renderWithProviders(as('editor'));
    expect(await screen.findByText('Metrics refresh queued')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(14 * 60_000));
    expect(screen.queryByText('Metrics refresh is taking longer than usual to start')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(2 * 60_000));
    expect(await screen.findByText('Metrics refresh is taking longer than usual to start')).toBeInTheDocument();
    const asked = reads.reads();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(reads.reads()).toBeGreaterThan(asked);
  });

  it('reports a run that ended once, however often the screen is left and opened again', async () => {
    const runs = serveRuns({ used: 3, open: [running(3, 10)] });
    let current = running(3, 10);
    const reads = serveRun(() => current);
    const listReads = countListReads();
    const view = renderWithProviders(as('editor'));
    expect(await screen.findByText('Refreshing metrics')).toBeInTheDocument();
    current = run({ status: 'completed', tasks_total: 10, tasks_succeeded: 10 });
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(await screen.findByText('Metrics refreshed: 10 of 10 read')).toBeInTheDocument();
    // The toast goes by itself after a while
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    await waitFor(() => expect(screen.queryByText('Metrics refreshed: 10 of 10 read')).toBeNull());

    // The open runs still name the run, as a list that is a little behind does
    const readsBefore = reads.reads();
    const runsBefore = runs.reads();
    const listBefore = listReads();
    view.rerender(<div />);
    view.rerender(as('editor'));
    await loadedGrid();
    await waitFor(() => expect(runs.reads()).toBeGreaterThan(runsBefore));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.queryByText('Metrics refreshed: 10 of 10 read')).toBeNull();
    expect(screen.queryByText('Refreshing metrics')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    // Nothing asked about the run again, and no report reads the list: it was read after the run ended and
    // is still fresh, so the screen opened again shows it as it is
    expect(reads.reads()).toBe(readsBefore);
    expect(listReads()).toBe(listBefore);
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

/**
 * The poll of waiting keywords: the first page, newest first, with what has arrived: the metrics and the
 * first rank check together, or (`metricsFirst`) the metrics from the first poll and the first check only
 * once `arrive` says so.
 */
function servePoll({ metricsFirst = false }: { metricsFirst?: boolean } = {}): {
  polls: () => number;
  arrive: () => void;
} {
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
      const { checked } = rankStates(body.data);
      return HttpResponse.json({
        ...body,
        data: body.data.map((row) => ({
          ...row,
          metrics: (arrived || metricsFirst) && donor !== undefined ? (row.metrics ?? donor) : row.metrics,
          state: arrived && row.state.current.state === 'not_checked' ? checked : row.state,
        })),
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

/**
 * The list once Labs has answered every keyword while no rank check has run, counting the polls: what a project
 * whose collection is paused (or out of budget) shows, however long ago its keywords were added.
 */
function serveMetricsWithoutChecks(): { polls: () => number } {
  let polls = 0;
  server.use(
    http.get(mswPath(TRACKED), async ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get('limit') === '1') return undefined;
      if (url.searchParams.get('sort') === '-created_at') polls += 1;
      const real = await getResponse([...handlers], new Request(url, { headers: request.headers }));
      const body = ROWS.parse(await real?.json());
      const donor = donorMetrics(body.data);
      return HttpResponse.json({ ...body, data: body.data.map((row) => ({ ...row, metrics: row.metrics ?? donor })) });
    }),
  );
  return { polls: () => polls };
}

/** Mock time shortly after the fixture keywords that wait were added (`PENDING_ADDED_AT`): they are new. */
const SHORTLY_AFTER_ADDED = Date.parse(PENDING_ADDED_AT) + 20 * 60_000;

describe('Keywords that wait for their first metrics', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  const pending = (grid: HTMLElement): number => pendingMetricCells(grid).length;

  it('are read every 30 seconds, newest first, until none is left, and the list is not read again', async () => {
    const poll = servePoll();
    const listReads = countListReads();
    const { user } = renderWithProviders(as('editor'));
    const grid = await loadedGrid();
    const waiting = pending(grid);
    expect(waiting).toBeGreaterThanOrEqual(3);
    await waitFor(() => expect(listReads()).toBeGreaterThan(0));
    const loaded = listReads();
    await user.click(screen.getByRole('checkbox', { name: 'Select seo agency, desktop, United States' }));

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
    expect(screen.getByRole('checkbox', { name: 'Select seo agency, desktop, United States' })).toBeChecked();
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

  it('are not polled for a first rank check when they were added long ago: a paused project is not asked about', async () => {
    // The fixture keywords were added on 30 September; the clock is days later, and their metrics are in
    const feed = serveMetricsWithoutChecks();
    renderWithProviders(as('editor'));
    const grid = await loadedGrid();
    expect(pending(grid)).toBe(0);
    // They still say Pending in Rank: nothing is made up
    expect(pendingRankCells(grid).length).toBeGreaterThanOrEqual(3);
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(feed.polls()).toBe(0);
  });

  it('are polled for a first rank check when they were added within the last hour', async () => {
    vi.setSystemTime(SHORTLY_AFTER_ADDED);
    const feed = serveMetricsWithoutChecks();
    renderWithProviders(as('editor'));
    const grid = await loadedGrid();
    expect(pending(grid)).toBe(0);
    expect(pendingRankCells(grid).length).toBeGreaterThanOrEqual(3);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    await waitFor(() => expect(feed.polls()).toBe(1));
  });

  it('are read for their first rank check too: the metrics come first, the check later, and the polling stops after it', async () => {
    vi.setSystemTime(SHORTLY_AFTER_ADDED);
    const poll = servePoll({ metricsFirst: true });
    renderWithProviders(as('editor'));
    const grid = await loadedGrid();
    const waiting = pendingRankCells(grid).length;
    expect(waiting).toBeGreaterThanOrEqual(3);
    expect(pending(grid)).toBeGreaterThanOrEqual(3);

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    await waitFor(() => expect(poll.polls()).toBe(1));
    // The metrics arrived with the first poll, the first check did not: the rows still wait
    await waitFor(() => expect(pending(grid)).toBe(0));
    expect(pendingRankCells(grid)).toHaveLength(waiting);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    await waitFor(() => expect(poll.polls()).toBe(3));

    poll.arrive();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    await waitFor(() => expect(pendingRankCells(grid)).toHaveLength(0));
    const reads = poll.polls();
    // Nothing waits any more: the polling stops
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(poll.polls()).toBe(reads);
  });

  it('are not waited for after 15 minutes when the first check never comes, though their metrics are there', async () => {
    vi.setSystemTime(SHORTLY_AFTER_ADDED);
    const poll = servePoll({ metricsFirst: true });
    renderWithProviders(as('editor'));
    const grid = await loadedGrid();
    expect(pendingRankCells(grid).length).toBeGreaterThan(0);
    for (let tick = 0; tick < 31; tick += 1) await act(() => vi.advanceTimersByTimeAsync(30_000));
    const reads = poll.polls();
    expect(reads).toBeGreaterThanOrEqual(28);
    expect(reads).toBeLessThanOrEqual(30);
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(poll.polls()).toBe(reads);
    // The rows say Pending still: nothing was made up
    expect(pendingRankCells(grid).length).toBeGreaterThan(0);
  });

  it('fills in the first rank of a keyword added a moment ago once its first check has run, without a reload', async () => {
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    await user.click(screen.getByRole('button', { name: 'Add keywords' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add keywords' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'rank tracker api');
    await user.click(within(dialog).getByRole('radio', { name: 'Desktop' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    expect(await screen.findByText('1 keyword added')).toBeInTheDocument();
    const grid = await loadedGrid();
    await waitFor(() => expect(keywordsIn(grid)).toContain('rank tracker api'));
    const rankOf = (): string => columnTexts(grid, /^Rank$/)[keywordsIn(grid).indexOf('rank tracker api')] ?? '';
    expect(rankOf()).toBe('Pending');

    // The metrics come at 2 minutes, the first check at 3: at 2 minutes and a half the rank still waits
    for (let tick = 0; tick < 5; tick += 1) await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(rankOf()).toBe('Pending');
    for (let tick = 0; tick < 2; tick += 1) await act(() => vi.advanceTimersByTimeAsync(30_000));
    await waitFor(() => expect(rankOf()).toMatch(/^(\d+|>\d+not in top \d+)(?:first check)?$/));
  }, 20_000);

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

  it('are read at once when the tab is shown again, and the hidden time does not count towards the 15 minutes', async () => {
    const poll = servePoll();
    const hidden = vi.spyOn(Document.prototype, 'hidden', 'get').mockReturnValue(true);
    renderWithProviders(as('editor'));
    const grid = await loadedGrid();
    expect(pending(grid)).toBeGreaterThan(0);
    await act(() => vi.advanceTimersByTimeAsync(20 * 60_000));
    expect(poll.polls()).toBe(0);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    // No wait for the next tick, and no giving up for the 20 minutes the tab was away
    await waitFor(() => expect(poll.polls()).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    await waitFor(() => expect(poll.polls()).toBe(2));
  });

  it('are not read at once when the tab is hidden, which is what the event also says', async () => {
    const poll = servePoll();
    const hidden = vi.spyOn(Document.prototype, 'hidden', 'get').mockReturnValue(false);
    renderWithProviders(as('editor'));
    await loadedGrid();
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(poll.polls()).toBe(0);
  });
});

/** The metrics a row of the list has once they have arrived: the first of the fixture's own. */
const donorMetrics = (rows: z.infer<typeof ROWS>['data']): unknown =>
  rows.find((row) => row.metrics !== null && row.metrics !== undefined)?.metrics;

interface Synthetic {
  /** The reads of the list, the polls among them, in order. */
  asked: URLSearchParams[];
  /** The reads of the poll in client mode: the newest first by creation. */
  polls: () => URLSearchParams[];
  /** The metrics the keywords that waited have now. */
  arrive: () => void;
}

/**
 * A list of `count` keywords, the newest first, read in cursor pages whatever the sort; the oldest from
 * `waitingFrom` on have no metrics until `arrive`. `total` is what the page says matches (above 10,000 the
 * screen reads one page at a time).
 */
function serveSynthetic({
  count,
  waitingFrom,
  waitingTo = count,
  total = count,
}: {
  count: number;
  waitingFrom: number;
  /** The keywords from `waitingFrom` up to this one wait; the older ones have their metrics. */
  waitingTo?: number;
  total?: number;
}): Synthetic {
  let arrived = false;
  const asked: URLSearchParams[] = [];
  const newest = Date.parse('2026-10-01T09:00:00.000Z');
  server.use(
    http.get(mswPath(TRACKED), async ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get('limit') === '1') return undefined;
      asked.push(new URLSearchParams(url.searchParams));
      const cursor = url.searchParams.get('cursor');
      const limit = Number(url.searchParams.get('limit') ?? 200);
      // The real answer of the first page for the same filters gives the rows to copy
      url.searchParams.delete('cursor');
      const real = await getResponse([...handlers], new Request(url, { headers: request.headers }));
      const body = ROWS.parse(await real?.json());
      const donor = donorMetrics(body.data);
      const states = rankStates(body.data);
      const from = cursor === null ? 0 : Number(cursor.slice(1));
      const rows = Array.from({ length: Math.min(limit, count - from) }, (_, offset) => {
        const index = from + offset;
        const row = body.data[index % body.data.length];
        if (row === undefined) throw new Error('The list has no row to copy');
        const suffix = String(index).padStart(6, '0');
        const waiting = index >= waitingFrom && index < waitingTo && !arrived;
        return {
          ...row,
          tracked_keyword_id: `0192d1a8-0000-7a10-8e07-${suffix}`,
          keyword: { ...row.keyword, keyword_id: `0192d1a8-1111-7a10-8e07-${suffix}` },
          is_active: true,
          created_at: new Date(newest - index * 60_000).toISOString(),
          // A keyword that waits has neither its metrics nor its first check
          metrics: waiting ? null : donor,
          state: waiting ? states.unchecked : states.checked,
        };
      });
      const more = from + limit < count;
      return HttpResponse.json({
        data: rows,
        page: { ...body.page, limit, total, has_more: more, next_cursor: more ? `c${String(from + limit)}` : null },
      });
    }),
  );
  return {
    asked,
    polls: () => asked.filter((query) => query.get('sort') === '-created_at'),
    arrive: () => {
      arrived = true;
    },
  };
}

describe('Keywords that wait beyond the first page of the poll', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  // The table shows a window of its rows: the polls tell what was waited for, and when nothing is
  const pending = (grid: HTMLElement): number => pendingMetricCells(grid).length;
  const cursors = (polls: readonly URLSearchParams[]): (string | null)[] => polls.map((poll) => poll.get('cursor'));
  /** The pages of the list itself read so far, in client mode. */
  const listPages = (feed: Synthetic): number => feed.asked.filter((query) => query.get('sort') === 'keyword').length;
  /** A little over one tick of the poll, with the effect that sets it going started afresh by the last page. */
  const tick = async (): Promise<void> => {
    await act(() => vi.advanceTimersByTimeAsync(35_000));
  };

  it('reads on by cursor, newest first, to the oldest waiting keyword, so 500 of 1,000 get their metrics', async () => {
    const feed = serveSynthetic({ count: 1_000, waitingFrom: 500 });
    renderWithProviders(as('editor'));
    await loadedGrid();
    await waitFor(() => expect(listPages(feed)).toBe(5), { timeout: 20_000 });
    await tick();
    await waitFor(() => expect(cursors(feed.polls())).toEqual([null, 'c200', 'c400', 'c600', 'c800']), {
      timeout: 20_000,
    });
    // Nothing has arrived: the next poll reads the same five pages, and the waiting go on
    await tick();
    await waitFor(() => expect(feed.polls()).toHaveLength(10), { timeout: 20_000 });
    feed.arrive();
    await tick();
    await waitFor(() => expect(feed.polls()).toHaveLength(15), { timeout: 20_000 });
    // All 500 keywords that waited have their metrics, from pages the first 200 never held: no more reads
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(feed.polls()).toHaveLength(15);
  });

  it('stops at the page that holds the oldest waiting keyword, and reads no further', async () => {
    const feed = serveSynthetic({ count: 1_000, waitingFrom: 250, waitingTo: 450 });
    renderWithProviders(as('editor'));
    await loadedGrid();
    await waitFor(() => expect(listPages(feed)).toBe(5), { timeout: 20_000 });
    // The oldest waiting keyword is the 450th: the third page holds it, so the poll reads three pages
    await tick();
    await waitFor(() => expect(feed.polls()).toHaveLength(3), { timeout: 20_000 });
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(cursors(feed.polls())).toEqual([null, 'c200', 'c400']);
  });

  it('reads at most five pages a poll, whatever the list holds', async () => {
    const feed = serveSynthetic({ count: 1_300, waitingFrom: 1_000 });
    renderWithProviders(as('editor'));
    await loadedGrid();
    await waitFor(() => expect(listPages(feed)).toBe(7), { timeout: 20_000 });
    await tick();
    await waitFor(() => expect(feed.polls()).toHaveLength(5), { timeout: 20_000 });
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(cursors(feed.polls())).toEqual([null, 'c200', 'c400', 'c600', 'c800']);
    // The next poll reads the newest page again, then goes on where the last stopped: the oldest keywords
    // are reached after two polls instead of never
    await tick();
    await waitFor(() => expect(feed.polls()).toHaveLength(8), { timeout: 20_000 });
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(cursors(feed.polls().slice(5))).toEqual([null, 'c1000', 'c1200']);
    // Having reached the end, the poll starts from the newest again
    await tick();
    await waitFor(() => expect(feed.polls()).toHaveLength(13), { timeout: 20_000 });
    expect(cursors(feed.polls().slice(8))).toEqual([null, 'c200', 'c400', 'c600', 'c800']);
  });

  it('reaches keywords older than the pages of one poll once their metrics arrive: 3,000 waiting after an import', async () => {
    const feed = serveSynthetic({ count: 2_600, waitingFrom: 0 });
    renderWithProviders(as('editor'));
    await loadedGrid();
    await waitFor(() => expect(listPages(feed)).toBe(13), { timeout: 20_000 });
    feed.arrive();
    // Poll one: pages 1 to 5. Poll two: the newest page, then pages 6 to 9. Poll three: the newest, then 10 to 13.
    for (let poll = 1; poll <= 3; poll += 1) {
      await tick();
      await waitFor(() => expect(feed.polls().length).toBeGreaterThanOrEqual(poll === 1 ? 5 : poll === 2 ? 10 : 15), {
        timeout: 20_000,
      });
    }
    const oldest = feed.polls().map((poll) => Number((poll.get('cursor') ?? 'c0').slice(1)));
    expect(Math.max(...oldest)).toBe(2_400);
  });

  it('reads the page on screen again in server mode, with the request the list made for it, and nothing else', async () => {
    // The 20 keywords on top of the page wait; the table shows them first
    const feed = serveSynthetic({ count: 400, waitingFrom: 0, waitingTo: 20, total: 12_000 });
    renderWithProviders(as('editor'));
    const grid = await loadedGrid();
    await waitFor(() => expect(pending(grid)).toBeGreaterThan(0));
    const [, listRequest] = feed.asked;
    expect(listRequest?.get('sort')).not.toBe('-created_at');
    const before = feed.asked.length;
    await tick();
    await waitFor(() => expect(feed.asked.length).toBe(before + 1));
    const poll = feed.asked.at(-1);
    expect(Object.fromEntries(poll ?? [])).toEqual(Object.fromEntries(listRequest ?? []));
    feed.arrive();
    await tick();
    await waitFor(() => expect(pending(grid)).toBe(0));
    expect(feed.asked.length).toBe(before + 2);
    await act(() => vi.advanceTimersByTimeAsync(2 * 60_000));
    expect(feed.asked.length).toBe(before + 2);
  });
});
