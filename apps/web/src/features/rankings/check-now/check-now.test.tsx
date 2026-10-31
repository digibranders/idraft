import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as announcer from '@/lib/a11y/announcer';
import * as toastModule from '@/components/ui/toast';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { refreshRunKey } from '../refresh/refresh-queries';
import { server } from '@/test/msw';
import {
  answerTrackedAsMany,
  loadedGrid,
  rankingsAs as as,
  restoreWideScreen,
  stubWideScreen,
} from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({
  EChart: () => <div data-testid="echart-canvas" />,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/keywords',
}));

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const CHECK_NOW = `${P}/seo/check-now`;
const RUNS = `${P}/runs`;
const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: MOCK_PROJECTS[0]?.project_id ?? '' };

beforeEach(stubWideScreen);
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
  vi.restoreAllMocks();
});

type User = ReturnType<typeof renderWithProviders>['user'];

async function choose(user: User, ...keywords: string[]): Promise<HTMLElement> {
  await loadedGrid();
  for (const keyword of keywords) {
    await user.click(screen.getByRole('checkbox', { name: new RegExp(`^Select ${keyword},`) }));
  }
  return screen.getByRole('group', { name: /Bulk actions/ });
}

async function openFromRow(user: User, keyword: string): Promise<HTMLElement> {
  const grid = await loadedGrid();
  const cell = within(grid)
    .getAllByRole('rowheader')
    .find((header) => header.querySelector('.truncate')?.textContent === keyword);
  if (cell === undefined) throw new Error(`No row for ${keyword}`);
  await user.click(cell);
  return screen.findByRole('complementary', { name: keyword });
}

interface RunsState {
  used: number;
  open: Array<{
    run_id: string;
    workload: string;
    status: string;
    tasks_total: number;
    tasks_succeeded: number;
    tasks_failed: number;
  }>;
}

function serveRuns(state: RunsState): void {
  server.use(
    http.get(mswPath(RUNS), ({ request }) => {
      const url = new URL(request.url);
      const workloads = url.searchParams.getAll('filter[workload_in]');
      const matching = workloads.length === 0 ? state.open : state.open.filter((r) => workloads.includes(r.workload));
      return HttpResponse.json({
        data: matching.map((r) => ({
          ...r,
          created_by: { actor_type: 'user', actor_id: mockUser('editor').user_id, label: 'Editor' },
        })),
        page: { total_items: matching.length, total_pages: 1, current_page: 1, per_page: 50 },
        meta: { manual_runs_today: { used: state.used, limit: 20 } },
      });
    }),
  );
}

describe('Check now', () => {
  it('chooses two keywords from bulk bar, posts sorted ids, shows progress', async () => {
    let checkBody: unknown = null;
    server.events.on('request:start', async ({ request }) => {
      if (request.url.includes('/seo/check-now')) {
        checkBody = await request.clone().json();
      }
    });

    const { user } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency', 'backlink checker');
    const button = within(bar).getByRole('button', { name: 'Check now' });
    await user.click(button);

    await waitFor(() => {
      expect(checkBody).not.toBeNull();
    });

    const bodyObj = checkBody as { tracked_keyword_ids: string[]; depth?: unknown };
    expect(bodyObj.tracked_keyword_ids).toHaveLength(2);
    expect(bodyObj.depth).toBeUndefined();
    const sorted = [...bodyObj.tracked_keyword_ids].sort();
    expect(bodyObj.tracked_keyword_ids).toEqual(sorted);

    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText('Rank check queued')).toBeInTheDocument();
  });

  it('shows finished toast and reads the keyword list again on completion', async () => {
    let listReads = 0;
    const runId = 'test-finished-run-1';
    server.use(
      http.post(mswPath(CHECK_NOW), () =>
        HttpResponse.json({
          data: {
            run_id: runId,
            workload: 'seo_rank',
            status: 'running',
            tasks_total: 2,
            tasks_succeeded: 0,
            tasks_failed: 0,
          },
        }),
      ),
      http.get(mswPath(`${P}/runs/${runId}`), () =>
        HttpResponse.json({
          data: {
            run_id: runId,
            workload: 'seo_rank',
            status: 'completed',
            tasks_total: 2,
            tasks_succeeded: 2,
            tasks_failed: 0,
          },
        }),
      ),
    );
    server.events.on('request:start', ({ request }) => {
      if (request.url.includes('/tracked-keywords') && !request.url.includes('/tracked-keywords/')) {
        listReads += 1;
      }
    });

    const { user, queryClient } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency', 'backlink checker');
    const initialListReads = listReads;
    await user.click(within(bar).getByRole('button', { name: 'Check now' }));

    expect(await screen.findByRole('progressbar')).toBeInTheDocument();

    queryClient.setQueryData(refreshRunKey(SCOPE, runId, 'seo_rank'), {
      run_id: runId,
      workload: 'seo_rank',
      status: 'completed',
      tasks_total: 2,
      tasks_succeeded: 2,
      tasks_failed: 0,
    });

    expect((await screen.findAllByText('Ranks checked: 2 of 2')).length).toBeGreaterThanOrEqual(1);

    await waitFor(() => {
      expect(listReads).toBeGreaterThan(initialListReads);
    });
  });

  it('prevents duplicate POST on rapid double click in bar (in-flight guard)', async () => {
    let postCount = 0;
    server.use(
      http.post(mswPath(CHECK_NOW), async () => {
        postCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 80));
        return HttpResponse.json({
          data: {
            run_id: 'test-double-click-run',
            workload: 'seo_rank',
            status: 'running',
            tasks_total: 1,
            tasks_succeeded: 0,
            tasks_failed: 0,
          },
        });
      }),
    );

    const { user } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency');
    const button = within(bar).getByRole('button', { name: 'Check now' });
    await Promise.all([user.click(button), user.click(button)]);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(postCount).toBe(1);
  });

  it('prevents duplicate POST on rapid double click in inspector (in-flight guard)', async () => {
    let postCount = 0;
    server.use(
      http.post(mswPath(CHECK_NOW), async () => {
        postCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 80));
        return HttpResponse.json({
          data: {
            run_id: 'test-double-click-inspector-run',
            workload: 'seo_rank',
            status: 'running',
            tasks_total: 1,
            tasks_succeeded: 0,
            tasks_failed: 0,
          },
        });
      }),
    );

    const { user } = renderWithProviders(as('editor'));
    const inspector = await openFromRow(user, 'seo agency');
    const button = within(inspector).getByRole('button', { name: 'Check now' });
    await Promise.all([user.click(button), user.click(button)]);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(postCount).toBe(1);
  });

  it('prevents duplicate POST across entry points: inspector then bar', async () => {
    let postCount = 0;
    server.use(
      http.post(mswPath(CHECK_NOW), async () => {
        postCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 80));
        return HttpResponse.json({
          data: {
            run_id: 'test-cross-entry-run',
            workload: 'seo_rank',
            status: 'running',
            tasks_total: 1,
            tasks_succeeded: 0,
            tasks_failed: 0,
          },
        });
      }),
    );

    const { user } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency');
    const barButton = within(bar).getByRole('button', { name: 'Check now' });
    const inspector = await openFromRow(user, 'seo agency');
    const inspectorButton = within(inspector).getByRole('button', { name: 'Check now' });

    await Promise.all([user.click(inspectorButton), user.click(barButton)]);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(postCount).toBe(1);
  });

  it('disables bulk Check now when 101 keywords are selected, with a reason', async () => {
    answerTrackedAsMany({ total: 101, pages: 1, rowsPerPage: 101 });
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    const selectAllCheckbox = screen.getByRole('checkbox', { name: /^Select all/ });
    await user.click(selectAllCheckbox);
    const bar = screen.getByRole('group', { name: /Bulk actions/ });
    expect(within(bar).getByText('101 selected')).toBeInTheDocument();
    const checkBtn = within(bar).getByRole('button', { name: 'Check now' });
    expect(checkBtn).toHaveAttribute('data-disabled');
    expect(checkBtn).toHaveAttribute('aria-disabled', 'true');
  });

  it('disables bulk Check now under select all matching, with a reason', async () => {
    answerTrackedAsMany({ total: 12_000 });
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    const selectAllCheckbox = screen.getByRole('checkbox', { name: /^Select all/ });
    await user.click(selectAllCheckbox);
    const bar = screen.getByRole('group', { name: /Bulk actions/ });
    const selectAllMatchingBtn = await within(bar).findByRole('button', { name: 'Select all 12,000 matching' });
    await user.click(selectAllMatchingBtn);
    const checkBtn = within(bar).getByRole('button', { name: 'Check now' });
    expect(checkBtn).toHaveAttribute('data-disabled');
    expect(checkBtn).toHaveAttribute('aria-disabled', 'true');
  });

  it('disables bulk Check now in the Archived view, with a reason', async () => {
    const { user } = renderWithProviders(as('editor'), { searchParams: '?archived=true' });
    const bar = await choose(user, 'seo newsletter');
    const checkBtn = within(bar).getByRole('button', { name: 'Check now' });
    expect(checkBtn).toHaveAttribute('data-disabled');
    expect(checkBtn).toHaveAttribute('aria-disabled', 'true');
  });

  it('disables bulk action and inspector Check now when 0 manual runs left, with a reason', async () => {
    serveRuns({ used: 20, open: [] });
    const { user } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency');
    const checkBtn = within(bar).getByRole('button', { name: 'Check now' });
    expect(checkBtn).toHaveAttribute('data-disabled');
    expect(checkBtn).toHaveAttribute('aria-disabled', 'true');

    const inspector = await openFromRow(user, 'seo agency');
    const inspectorBtn = within(inspector).getByRole('button', { name: 'Check now' });
    expect(inspectorBtn).toHaveAttribute('aria-disabled', 'true');
    expect(inspectorBtn).not.toHaveAttribute('title');
    expect(inspectorBtn).toHaveAccessibleDescription('No manual runs left today. The limit resets at 00:00 UTC.');
  });

  it('disables inspector Check now while in flight with "Check in progress" reason', async () => {
    server.use(
      http.post(mswPath(CHECK_NOW), async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({
          data: {
            run_id: 'test-in-flight-run',
            workload: 'seo_rank',
            status: 'running',
            tasks_total: 1,
            tasks_succeeded: 0,
            tasks_failed: 0,
          },
        });
      }),
    );

    const { user } = renderWithProviders(as('editor'));
    const inspector = await openFromRow(user, 'seo agency');
    const inspectorBtn = within(inspector).getByRole('button', { name: 'Check now' });
    await user.click(inspectorBtn);

    const inFlightBtn = await within(inspector).findByRole('button', { name: 'Check now' });
    await waitFor(() => {
      expect(inFlightBtn).toHaveAttribute('aria-disabled', 'true');
    });
    expect(inFlightBtn).not.toHaveAttribute('title');
    expect(inFlightBtn).toHaveAccessibleDescription('Check in progress');
  });

  it('announces to live region when check now starts', async () => {
    const announceSpy = vi.spyOn(announcer, 'announce');
    const { user } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency');
    await user.click(within(bar).getByRole('button', { name: 'Check now' }));
    await waitFor(() => {
      expect(announceSpy).toHaveBeenCalledWith('Rank check queued. Its progress shows under the page title.');
    });
  });

  it('refetches manual run quota when the bulk actions bar opens', async () => {
    let runsReads = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.url.includes('/runs') && request.method === 'GET') {
        runsReads += 1;
      }
    });

    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    const initialReads = runsReads;

    const bar = await choose(user, 'seo agency');
    expect(bar).toBeInTheDocument();

    await waitFor(() => {
      expect(runsReads).toBeGreaterThan(initialReads);
    });
  });

  it('clears selection and refetches keyword list after keyword_unknown error', async () => {
    server.use(
      http.post(mswPath(CHECK_NOW), ({ request }) =>
        problem(request, 'validation_failed', {
          errors: [{ location: 'body', path: 'tracked_keyword_ids', code: 'keyword_unknown', message: 'x' }],
        }),
      ),
    );
    const { user } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency');
    const checkbox = screen.getByRole('checkbox', { name: new RegExp('^Select seo agency,') });
    expect(checkbox).toBeChecked();

    await user.click(within(bar).getByRole('button', { name: 'Check now' }));
    expect(
      (await screen.findAllByText('A keyword is no longer tracked here. The list was read again; try again.')).length,
    ).toBeGreaterThanOrEqual(1);

    await waitFor(() => {
      expect(checkbox).not.toBeChecked();
    });
    expect(screen.queryByRole('group', { name: /Bulk actions/ })).toBeNull();
  });

  it('shows refusal error toast without leftover finished toast or progress bar', async () => {
    server.use(http.post(mswPath(CHECK_NOW), ({ request }) => problem(request, 'manual_run_limit', { limit: 20 })));
    const { user } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency');
    await user.click(within(bar).getByRole('button', { name: 'Check now' }));

    expect(
      (await screen.findAllByText('No manual runs left today. The limit resets at 00:00 UTC.')).length,
    ).toBeGreaterThanOrEqual(1);

    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/^Ranks checked:/)).toBeNull();
  });

  it('shows error messages for 422 quota_exceeded and 503 provider_paused', async () => {
    server.use(
      http.post(mswPath(CHECK_NOW), ({ request }) =>
        problem(request, 'quota_exceeded', { limit: 500, used: 499, requested: 2 }),
      ),
    );
    const { user } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency');
    await user.click(within(bar).getByRole('button', { name: 'Check now' }));
    expect(
      (await screen.findAllByText(/This workspace has made 499 of its 500 live checks this month/)).length,
    ).toBeGreaterThanOrEqual(1);

    server.use(http.post(mswPath(CHECK_NOW), ({ request }) => problem(request, 'provider_paused')));
    await user.click(within(bar).getByRole('button', { name: 'Check now' }));
    expect(
      (await screen.findAllByText('The data provider is not being asked just now. Try again in a few minutes.')).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('reports lost run with toast id matching keyword-${workload}-${runId}', async () => {
    const toastSpy = vi.spyOn(toastModule, 'toast');
    const runId = 'lost-seo-run-123';
    serveRuns({
      used: 3,
      open: [
        {
          run_id: runId,
          workload: 'seo_rank',
          status: 'running',
          tasks_total: 10,
          tasks_succeeded: 3,
          tasks_failed: 0,
        },
      ],
    });
    server.use(http.get(mswPath(`${P}/runs/${runId}`), ({ request }) => problem(request, 'forbidden')));

    renderWithProviders(as('editor'));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: `keyword-seo_rank-${runId}`,
          type: 'info',
        }),
      );
    });
  });

  it('hides check now for a member without runs:trigger', async () => {
    const { user } = renderWithProviders(as('viewer'));
    await loadedGrid();
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
    const inspector = await openFromRow(user, 'seo agency');
    expect(within(inspector).queryByRole('button', { name: 'Check now' })).toBeNull();
  });

  it('shows Check now in the keyword inspector for an active keyword and posts that id', async () => {
    let checkBody: unknown = null;
    server.events.on('request:start', async ({ request }) => {
      if (request.url.includes('/seo/check-now')) {
        checkBody = await request.clone().json();
      }
    });

    const { user } = renderWithProviders(as('editor'));
    const inspector = await openFromRow(user, 'seo agency');
    const checkNowBtn = within(inspector).getByRole('button', { name: 'Check now' });
    expect(checkNowBtn).toBeInTheDocument();
    await user.click(checkNowBtn);

    await waitFor(() => {
      expect(checkBody).not.toBeNull();
    });
    const bodyObj = checkBody as { tracked_keyword_ids: string[] };
    expect(bodyObj.tracked_keyword_ids).toHaveLength(1);
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  });
});
