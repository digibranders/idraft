import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pageFlags, type FlaggedPage } from '@/lib/internal-links/page-flags';
import { crawledPages, MOCK_RUN_ID, pageRow } from '@/mocks/internal-links-world';
import { overviewOf } from '@/mocks/internal-links-inventory';
import { mswPath } from '@/mocks/respond';
import { EVENTUS_LINKS } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { pagesAs } from '@/test/pages-harness';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/pages/all',
  useSearchParams: () => new URLSearchParams(),
}));

const OVERVIEW = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/overview');

beforeEach(() => stubWideScreen());
afterEach(() => restoreWideScreen());

/** The overview of the fixture crawl with `variants` parameter variants counted. */
function withVariants(variants: number): void {
  const base = overviewOf(
    crawledPages().map((page) => pageRow(page, 'all')),
    { run_id: MOCK_RUN_ID, finished_at: null, sitemap: true },
  );
  server.use(
    http.get(OVERVIEW, () => HttpResponse.json({ data: { ...base, status: { ...base.status, variant: variants } } })),
  );
}

describe('parameter variants', () => {
  it('lists the count in the View menu and opens the list of them', async () => {
    withVariants(148);
    const updates: string[] = [];
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
      onUrlUpdate: ({ queryString }) => updates.push(queryString),
    });
    await user.click(await screen.findByRole('button', { name: 'View: All pages' }));
    const item = await screen.findByRole('menuitemradio', { name: 'Parameter variants' });
    await waitFor(() => expect(item).toHaveAccessibleDescription('148'));
    await user.click(item);
    await waitFor(() => expect(updates.at(-1)).toContain('view=variants'));
    expect(await screen.findByRole('button', { name: 'View: Parameter variants' })).toBeInTheDocument();
  });

  it('is not listed when none was counted', async () => {
    withVariants(0);
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await user.click(await screen.findByRole('button', { name: 'View: All pages' }));
    const live = await screen.findByRole('menuitemradio', { name: 'Live pages' });
    await waitFor(() => expect(live).toHaveAccessibleDescription(/\d/));
    expect(screen.queryByRole('menuitemradio', { name: 'Parameter variants' })).toBeNull();
  });

  it('flags a variant row in neutral, not as a problem', () => {
    const page: FlaggedPage = {
      flags: ['variant'],
      broken_outlinks: 0,
      redirect_outlinks: 0,
      linking_pages: 1,
      is_indexable: false,
      status_code: 200,
      tier: null,
    };
    expect(pageFlags(page, 'all')).toEqual([{ key: 'variant', tone: 'neutral' }]);
  });
});
