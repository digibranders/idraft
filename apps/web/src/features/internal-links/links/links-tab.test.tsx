import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_TAGS } from '../pages/page-filters';
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
/** Longer than the search delay of the tab, so the typing has paused. */
const SEARCH_PAUSE_MS = 400;
const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS.project_id };
const [READS_KEY = []] = internalLinksKeys(SCOPE);

beforeEach(() => {
  stubWideScreen();
  vi.mocked(downloadApiFile).mockReset();
  vi.mocked(downloadApiFile).mockImplementation(() => Promise.resolve());
});
afterEach(() => {
  vi.useRealTimers();
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

  it('reads the worklist the Pages chip opens (scope all, as the chip counts) and shows a chip that removes it', async () => {
    const reads = edgeReads();
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: '?tab=links&lview=broken_and_redirected&scope=all',
    });
    await rows();
    expect(screen.getByRole('button', { name: 'Remove Broken and redirected links' })).toBeInTheDocument();
    expect(reads().at(-1)?.get('filter[worklist]')).toBe('broken_and_redirected');
    expect(reads().at(-1)?.get('scope')).toBe('all');
  });

  it('reads All links for a hand typed worklist address with no scope, and keeps Editorial choosable', async () => {
    const reads = edgeReads();
    const writes: string[] = [];
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: '?tab=links&lview=broken_and_redirected',
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await rows();
    expect(reads().at(-1)?.get('scope')).toBe('all');
    await user.click(screen.getByRole('button', { name: 'Link scope: All links' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Editorial' }));
    await waitFor(() => {
      expect(writes.at(-1)).toContain('scope=editorial');
    });
    await waitFor(() => {
      expect(reads().at(-1)?.get('scope')).toBe('editorial');
    });
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

  it('never shows or asks for equity: not in the text, a name, the column chooser, a request or the export', async () => {
    const reads = edgeReads();
    const { container, user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: '?tab=links',
    });
    await rows();
    expect(container.textContent?.toLowerCase()).not.toContain('equity');
    const names = [...container.querySelectorAll('[aria-label]')].map((node) => node.getAttribute('aria-label'));
    expect(names.join(' ').toLowerCase()).not.toContain('equity');
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    expect(await screen.findByRole('checkbox', { name: 'Source page' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /equity/i })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export this tab (CSV)' }));
    await waitFor(() => expect(downloadApiFile).toHaveBeenCalledTimes(1));
    const asked = [...reads().map((read) => read.toString()), JSON.stringify(vi.mocked(downloadApiFile).mock.calls)];
    for (const text of asked) {
      expect(text.toLowerCase()).not.toContain('equity');
      expect(text).not.toMatch(/sort/);
    }
  });

  it('sends every filter of the address to the server CSV too: tiers, placement, status, worklist and both pages', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams:
        '?tab=links&scope=all&lview=links_to_non_indexable&stier=none&ttier=none&place=footer&tstatus=3xx&src=5&tgt=7',
    });
    await user.click(await screen.findByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export this tab (CSV)' }));
    await waitFor(() => expect(downloadApiFile).toHaveBeenCalledTimes(1));
    expect(downloadApiFile).toHaveBeenCalledWith(
      `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS.project_id}/internal-links/edges`,
      {
        scope: 'all',
        'filter[source_tier]': ['none'],
        'filter[target_tier]': ['none'],
        'filter[placement]': ['footer'],
        'filter[target_status]': ['3xx'],
        'filter[source]': '5',
        'filter[target]': '7',
        'filter[worklist]': 'links_to_non_indexable',
        format: 'csv',
      },
      'internal-links-links.csv',
    );
  });

  it('starts no second download while one is running, and says why', async () => {
    let finish = (): void => undefined;
    vi.mocked(downloadApiFile).mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=links' });
    await rows();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export this tab (CSV)' }));
    await user.click(screen.getByRole('button', { name: 'Export' }));
    const again = await screen.findByRole('menuitem', { name: /Export this tab \(CSV\)/ });
    expect(again).toHaveAttribute('aria-disabled', 'true');
    expect(again).toHaveTextContent('The export is being prepared');
    await user.click(again);
    expect(downloadApiFile).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    await act(async () => {
      finish();
      await Promise.resolve();
    });
  });

  it('keeps the tag filter to the most the API takes, in the chips and the request, and says so', async () => {
    const reads = edgeReads();
    const writes: string[] = [];
    const tags = Array.from(
      { length: MAX_TAGS + 1 },
      (_, index) => `0192e4a0-4000-7000-8000-${String(index).padStart(12, '0')}`,
    );
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: `?tab=links&tag=${tags.join(',')}`,
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    expect(await screen.findByText('Tag filter limited to 50 tags')).toBeInTheDocument();
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    const kept = (query: string): string[] => new URLSearchParams(query).get('tag')?.split(',') ?? [];
    expect(writes.some((query) => kept(query).join() === tags.slice(0, MAX_TAGS).join())).toBe(true);
    for (const read of reads()) expect(read.get('filter[tag]')?.split(',').length ?? 0).toBeLessThanOrEqual(MAX_TAGS);
  });

  it('keeps the spaces typed in the search, asks once typing pauses, and a cleared box sends no search', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const reads = edgeReads();
    const writes: string[] = [];
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: '?tab=links',
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await rows();
    const box = screen.getByRole('searchbox', { name: 'Search in table' });
    await user.type(box, 'seo ');
    expect(reads().flatMap((read) => read.get('q_target') ?? [])).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(SEARCH_PAUSE_MS);
    });
    await waitFor(() => expect(reads().some((read) => read.get('q_target') === 'seo')).toBe(true));
    expect(box).toHaveValue('seo ');
    await user.clear(box);
    act(() => {
      vi.advanceTimersByTime(SEARCH_PAUSE_MS);
    });
    // The address drops the search (the unfiltered list is cached, so no new request is needed to show it)
    await waitFor(() => expect(new URLSearchParams(writes.at(-1)).has('lq')).toBe(false));
    expect(box).toHaveValue('');
    expect(reads().flatMap((read) => read.get('q_target') ?? [])).toEqual(['seo']);
  });

  it('clears a tier filter and the worklist in one go', async () => {
    server.use(
      http.get(EDGES, ({ request }) =>
        new URL(request.url).searchParams.has('filter[worklist]')
          ? HttpResponse.json({
              data: [],
              page: { limit: 100, next_cursor: null, has_more: false },
              meta: { run_id: MOCK_RUN_ID, scope: 'all', total: 0 },
            })
          : undefined,
      ),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: '?tab=links&lview=broken_and_redirected&stier=none',
    });
    // The table's own message, not the filter bar's Clear, which is there before the rows have loaded
    const empty = await screen.findByRole('gridcell', { name: /No links match/ });
    await user.click(within(empty).getByRole('button', { name: 'Clear filters' }));
    expect(await rows()).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Remove Broken and redirected links' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove Source tier/ })).not.toBeInTheDocument();
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
