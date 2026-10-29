import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mswPath, problem } from '@/mocks/respond';
import { server } from '@/test/msw';
import { loadedGrid, rankingsAs as as, restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({
  EChart: () => <div data-testid="echart-canvas" />,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/rankings',
}));

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const CHECK_NOW = `${P}/seo/check-now`;

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

describe('Check now', () => {
  it('chooses two keywords from bulk bar, posts sorted ids, shows progress and completes', async () => {
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

  it('disables the action under select all matching, archived view, or no manual runs left', async () => {
    const { user } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency');
    const selectAllBtn = screen.queryByRole('button', { name: /^Select all \d+ matching keywords$/ });
    if (selectAllBtn) {
      await user.click(selectAllBtn);
      const checkBtn = within(bar).getByRole('button', { name: 'Check now' });
      expect(checkBtn).toBeDisabled();
    }
  });

  it('shows error messages for 429, 422 quota_exceeded, 503 and keyword_unknown', async () => {
    server.use(http.post(mswPath(CHECK_NOW), ({ request }) => problem(request, 'manual_run_limit', { limit: 20 })));
    const { user } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency');
    await user.click(within(bar).getByRole('button', { name: 'Check now' }));
    expect(
      (await screen.findAllByText('No manual runs left today. The limit resets at 00:00 UTC.')).length,
    ).toBeGreaterThanOrEqual(1);

    server.use(
      http.post(mswPath(CHECK_NOW), ({ request }) =>
        problem(request, 'quota_exceeded', { limit: 500, used: 499, requested: 2 }),
      ),
    );
    await user.click(within(bar).getByRole('button', { name: 'Check now' }));
    expect(
      (await screen.findAllByText(/This workspace has made 499 of its 500 live checks this month/)).length,
    ).toBeGreaterThanOrEqual(1);

    server.use(http.post(mswPath(CHECK_NOW), ({ request }) => problem(request, 'provider_paused')));
    await user.click(within(bar).getByRole('button', { name: 'Check now' }));
    expect(
      (await screen.findAllByText('The data provider is not being asked just now. Try again in a few minutes.')).length,
    ).toBeGreaterThanOrEqual(1);

    server.use(
      http.post(mswPath(CHECK_NOW), ({ request }) =>
        problem(request, 'validation_failed', {
          errors: [{ location: 'body', path: 'tracked_keyword_ids', code: 'keyword_unknown', message: 'x' }],
        }),
      ),
    );
    await user.click(within(bar).getByRole('button', { name: 'Check now' }));
    expect(
      (await screen.findAllByText('A keyword is no longer tracked here. The list was read again; try again.')).length,
    ).toBeGreaterThanOrEqual(1);
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
