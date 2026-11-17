import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadApiFile } from '@/lib/api/download';
import { internalLinksKeys } from '@/lib/internal-links/queries';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { edgeRows, EVENTUS, MOCK_RUN_ID } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

// The real file save needs a browser; the test reads what the tab asks it to download
vi.mock('@/lib/api/download', () => ({ downloadApiFile: vi.fn(() => Promise.resolve()) }));

const EDGES = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/edges');
const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS.project_id };
const [READS_KEY = []] = internalLinksKeys(SCOPE);

beforeEach(() => {
  stubWideScreen();
  vi.mocked(downloadApiFile).mockReset();
  vi.mocked(downloadApiFile).mockImplementation(() => Promise.resolve());
});
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
  document.documentElement.classList.remove('dark');
});

const grid = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Links' });
const rows = async (): Promise<HTMLElement[]> => within(await grid()).findAllByRole('rowheader');

/** The query strings of the edges reads the tab has made. */
function edgeReads(): () => URLSearchParams[] {
  const seen: URLSearchParams[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/internal-links/edges')) seen.push(url.searchParams);
  });
  return () => seen;
}

describe('the Links tab (spec 7.3)', () => {
  it('lists the edges with the columns of the mock', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=links' });
    const table = await grid();
    for (const name of [
      'Source page',
      'Source tier',
      'Target page',
      'Target tier',
      'Anchor text',
      'Placement',
      'Rel',
      'Target status',
      'Target indexable',
      'Occurrences',
    ]) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    expect(await rows()).not.toHaveLength(0);
  });

  it('opens a worklist from the Pages chips as links of every scope, with a chip that removes it', async () => {
    const reads = edgeReads();
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: '?tab=links&lview=broken_and_redirected',
    });
    await rows();
    expect(screen.getByRole('button', { name: 'Remove Broken and redirected links' })).toBeInTheDocument();
    expect(reads().at(-1)?.get('filter[worklist]')).toBe('broken_and_redirected');
  });

  it('reads the links from one page when the address names it, and says so', async () => {
    const reads = edgeReads();
    const [first] = edgeRows('editorial');
    if (first === undefined) throw new Error('The fixture has no edges');
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: `?tab=links&src=${first.source.url_id}`,
    });
    await rows();
    expect(reads().at(-1)?.get('filter[source]')).toBe(first.source.url_id);
    expect(screen.getByRole('button', { name: 'Remove Links from one page' })).toBeInTheDocument();
  });

  it.each(['src', 'tgt'])('shows not found for a malformed %s and never widens the list to every link', async (key) => {
    const reads = edgeReads();
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: `?tab=links&${key}=abc` });
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: 'Links' })).not.toBeInTheDocument();
    expect(reads()).toEqual([]);
  });

  it('exports the server CSV of the same filter, with no page size', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: '?tab=links&scope=all&lq=%2Fservices',
    });
    await rows();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export this tab (CSV)' }));
    await waitFor(() => expect(downloadApiFile).toHaveBeenCalledTimes(1));
    expect(downloadApiFile).toHaveBeenCalledWith(
      `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS.project_id}/internal-links/edges`,
      { scope: 'all', q_target: '/services', format: 'csv' },
      'internal-links-links.csv',
    );
  });

  it('never shows equity, in the text or in a name', async () => {
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: '?tab=links',
    });
    await rows();
    expect(container.textContent?.toLowerCase()).not.toContain('equity');
    const names = [...container.querySelectorAll('[aria-label]')].map((node) => node.getAttribute('aria-label'));
    expect(names.join(' ').toLowerCase()).not.toContain('equity');
  });

  it('says why when the filters match no link, and clears them', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: '?tab=links&lq=zzzz',
    });
    expect(await screen.findByText('No links match')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await rows()).not.toHaveLength(0);
  });

  describe('paging and a crawl that ends', () => {
    const NEW_RUN = '0192e4a0-1000-7000-8000-000000000002';
    /** 120 links in a page of 100 and one of 20; a cursor belongs to the crawl in `live.run`. */
    const crawlEdges = (): { live: { run: string; lenient: boolean }; cursors: () => (string | null)[] } => {
      const [base] = edgeRows('all');
      if (base === undefined) throw new Error('The fixture has no edges');
      const all = Array.from({ length: 120 }, (_, index) => ({ ...base, link_id: String(9000 + index) }));
      const live = { run: MOCK_RUN_ID, lenient: false };
      const cursors: (string | null)[] = [];
      server.use(
        http.get(EDGES, ({ request }) => {
          const cursor = new URL(request.url).searchParams.get('cursor');
          cursors.push(cursor);
          if (cursor !== null && cursor !== `second-${live.run}` && !live.lenient) {
            return HttpResponse.json(
              { type: 'about:blank', title: 'Bad request', status: 400, code: 'invalid_cursor' },
              { status: 400, headers: { 'content-type': 'application/problem+json' } },
            );
          }
          const second = cursor !== null;
          return HttpResponse.json({
            data: second ? all.slice(100) : all.slice(0, 100),
            page: { limit: 100, next_cursor: second ? null : `second-${live.run}`, has_more: !second },
            meta: { run_id: live.run, scope: 'editorial', total: all.length },
          });
        }),
      );
      return { live, cursors: () => cursors };
    };

    it('goes forward by the cursor the API gave and back again', async () => {
      const { cursors } = crawlEdges();
      const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=links' });
      expect(await screen.findByText('Showing 1 to 100 of 120')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Next page' }));
      expect(await screen.findByText('Showing 101 to 120 of 120')).toBeInTheDocument();
      expect(cursors()).toContain(`second-${MOCK_RUN_ID}`);
      await user.click(screen.getByRole('button', { name: 'Previous page' }));
      expect(await screen.findByText('Showing 1 to 100 of 120')).toBeInTheDocument();
    });

    it('starts again at the first page when the old cursor is refused after a crawl ends', async () => {
      const { live, cursors } = crawlEdges();
      const { user, queryClient } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
        searchParams: '?tab=links',
      });
      await screen.findByText('Showing 1 to 100 of 120');
      await user.click(screen.getByRole('button', { name: 'Next page' }));
      await screen.findByText('Showing 101 to 120 of 120');
      live.run = NEW_RUN;
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: READS_KEY });
      });
      expect(await screen.findByText('Showing 1 to 100 of 120')).toBeInTheDocument();
      expect(cursors().at(-1)).toBeNull();
    });

    it('starts again at the first page when a page of another crawl arrives unrefused', async () => {
      const { live } = crawlEdges();
      live.lenient = true;
      const { user, queryClient } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
        searchParams: '?tab=links',
      });
      await screen.findByText('Showing 1 to 100 of 120');
      await user.click(screen.getByRole('button', { name: 'Next page' }));
      await screen.findByText('Showing 101 to 120 of 120');
      live.run = NEW_RUN;
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: READS_KEY });
      });
      expect(await screen.findByText('Showing 1 to 100 of 120')).toBeInTheDocument();
    });
  });

  it('treats an answer that is not a page of links as a failed read', async () => {
    server.use(http.get(EDGES, () => HttpResponse.json({ data: 'x' })));
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=links' });
    expect(await screen.findByText('The links could not be loaded')).toBeInTheDocument();
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: '?tab=links',
    });
    await rows();
    expect(await axe(container)).toHaveNoViolations();
  });
});
