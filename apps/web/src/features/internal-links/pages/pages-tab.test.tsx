import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_TAGS, UNTIERED_QUERY } from './page-filters';
import { downloadApiFile } from '@/lib/api/download';
import { problemFrom } from '@/lib/api/problem';
import { internalLinksKeys } from '@/lib/internal-links/queries';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { crawledPages, EVENTUS, HISTORY_RUN_IDS, MOCK_RUN_ID, pageRow } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { EVENTUS_LINKS } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { pagesAs } from '@/test/pages-harness';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/pages/all',
  useSearchParams: () => new URLSearchParams(),
}));

// The real file save needs a browser; the test reads what the tab asks it to download
vi.mock('@/lib/api/download', () => ({ downloadApiFile: vi.fn(() => Promise.resolve()) }));

const PAGES = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages');

/** A finished crawl older than the latest one. */
const OLDER_RUN = HISTORY_RUN_IDS[1] ?? '';
/** Longer than the search delay of the tab, so the typing has paused. */
const SEARCH_PAUSE_MS = 400;
const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS.project_id };
/** What a crawl that ends makes stale: every read of the project's internal links (`crawlFinishedKeys`). */
const [READS_KEY = []] = internalLinksKeys(SCOPE);

beforeEach(() => {
  stubWideScreen();
  vi.mocked(downloadApiFile).mockReset();
  vi.mocked(downloadApiFile).mockImplementation(() => Promise.resolve());
});
afterEach(() => {
  push.mockClear();
  vi.useRealTimers();
  restoreWideScreen();
  server.events.removeAllListeners();
  document.documentElement.classList.remove('dark');
});

const grid = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Pages' });
/** The row header of one page, named by its path alone. */
const rowOf = async (path: string): Promise<HTMLElement> =>
  within(await grid()).findByRole('rowheader', { name: path });

/** The query strings of the pages reads the tab has made. */
function pageReads(): () => URLSearchParams[] {
  const seen: URLSearchParams[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/internal-links/pages')) seen.push(url.searchParams);
  });
  return () => seen;
}

describe('the Pages tab (spec 7.2)', () => {
  it('lists the pages with the slice 1 columns, and never an equity column, option or word', async () => {
    const { container, user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    const table = await grid();
    for (const name of ['Page', 'Tier', 'Status', 'Indexable', 'Flags', 'Clicks']) {
      // The Page group cell and the Page column share a name, so more than one header may match
      expect(within(table).getAllByRole('columnheader', { name: new RegExp(`^${name}`, 'i') }).length).toBeGreaterThan(
        0,
      );
    }
    expect(await rowOf('/pricing')).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: /equity/i })).toBeNull();
    // The column chooser, the filter picker and the page text hold no equity either
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    expect(await screen.findByText('Canonical')).toBeInTheDocument();
    expect(screen.queryByText(/equity/i)).toBeNull();
    await user.keyboard('{Escape}');
    expect(container.textContent).not.toMatch(/equity/i);
    expect(document.body.textContent).not.toMatch(/equity/i);
  });

  it('shows the tier, the depth, the linking pages and the flags of a page', async () => {
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: '?q=%2Fblog%2Fthreat' });
    // An editor's row starts with its selection checkbox ("Select /blog/..."), so the name is matched anywhere
    const row = await within(await grid()).findByRole('row', { name: /\/blog\/threat-report-2022/ });
    expect(row).toHaveTextContent('T3');
    expect(row).toHaveTextContent('No editorial links in');
  });

  it('narrows to a worklist from the View menu and back to all pages, and counts each view', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await rowOf('/pricing');
    await user.click(await screen.findByRole('button', { name: 'View: All pages' }));
    const orphans = await screen.findByRole('menuitemradio', { name: 'Orphans' });
    await waitFor(() => expect(orphans).toHaveAccessibleDescription('1'));
    await user.click(orphans);
    expect(await screen.findByRole('button', { name: 'View: Orphans' })).toBeInTheDocument();
    expect(await rowOf('/partners')).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('grid', { name: 'Pages' })).queryByText('/pricing')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'View: Orphans' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'All pages' }));
    expect(await rowOf('/pricing')).toBeInTheDocument();
  });

  it('has no row of worklist chips above the table', async () => {
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await rowOf('/pricing');
    expect(screen.queryByRole('group', { name: 'Worklists' })).toBeNull();
    expect(screen.getByRole('button', { name: 'View: All pages' })).toBeInTheDocument();
  });

  it('sends a server view as filter[view] and a worklist as filter[worklist], from the address', async () => {
    const reads = pageReads();
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: '?view=live' });
    await rowOf('/pricing');
    expect(reads()[0]?.get('filter[view]')).toBe('live');
    expect(reads()[0]?.has('filter[worklist]')).toBe(false);
  });

  it('opens the Links tab for the two link worklists, which count links, in the scope of every link', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await user.click(await screen.findByRole('button', { name: 'View: All pages' }));
    const chip = await screen.findByRole('menuitem', { name: 'Broken and redirected links' });
    await user.click(chip);
    await waitFor(() => expect(push).toHaveBeenCalled());
    const [address] = push.mock.calls.at(-1) as [string];
    const [path, query] = address.split('?');
    expect(path).toBe('/digibranders/eventus-security/seo/internal-links');
    expect(query).toContain('tab=links');
    expect(query).toContain('lview=broken_and_redirected');
    // The chip counts links of every scope, so the tab opens on all of them and lists as many rows as the chip says
    expect(new URLSearchParams(query).get('scope')).toBe('all');
  });

  it('asks for the link scope the chip names and sends the explicit sort, never by equity', async () => {
    const reads = pageReads();
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
      searchParams: 'sort=-linking_pages&cols=page,linking',
    });
    await rowOf('/pricing');
    expect(reads()[0]?.get('sort')).toBe('-linking_pages');
    expect(reads()[0]?.get('scope')).toBe('editorial');
    await user.click(screen.getByRole('button', { name: 'Link scope: Editorial' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'All links' }));
    expect(await screen.findByRole('button', { name: 'Link scope: All links' })).toBeInTheDocument();
    await waitFor(() => expect(reads().some((read) => read.get('scope') === 'all')).toBe(true));
    expect(reads().every((read) => !(read.get('sort') ?? '').includes('equity'))).toBe(true);
  });

  it('sorts on the server from a header, and does not write the default sort to the address', async () => {
    const reads = pageReads();
    const writes: string[] = [];
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
      searchParams: '?cols=page,tier,depth,tags',
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    const table = await grid();
    await rowOf('/pricing');
    await user.click(within(table).getByRole('button', { name: 'Depth' }));
    await waitFor(() => expect(reads().some((read) => read.get('sort') === '-click_depth')).toBe(true));
    expect(writes.at(-1)).toContain('sort=-click_depth');
    // The Tags column has no server sort: its header offers none; Tier sorts on the server since the sorts of plan 06
    expect(within(table).queryByRole('button', { name: 'Tags' })).toBeNull();
    expect(within(table).getByRole('button', { name: 'Tier' })).toBeInTheDocument();
    // The path is the default sort on All pages: choosing it again leaves the address without a sort
    await user.click(within(table).getByRole('button', { name: 'Page' }));
    await waitFor(() => expect(writes.at(-1)).not.toContain('sort='));
    expect(writes.at(-1)).toBeDefined();
  });

  it('waits for the typing to pause before it asks for a search, and asks once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const reads = pageReads();
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await rowOf('/pricing');
    await user.type(screen.getByRole('searchbox', { name: 'Search in table' }), 'pri');
    // Nothing is asked while the typing goes on
    expect(reads().flatMap((read) => read.get('q') ?? [])).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(SEARCH_PAUSE_MS);
    });
    await waitFor(() => expect(reads().some((read) => read.get('q') === 'pri')).toBe(true));
    expect(reads().flatMap((read) => read.get('q') ?? [])).toEqual(['pri']);
  });

  it('keeps the spaces typed in the search box, asks for the text as typed, and a Clear empties the box', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const reads = pageReads();
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await rowOf('/pricing');
    const box = screen.getByRole('searchbox', { name: 'Search in table' });
    await user.type(box, 'a b');
    expect(box).toHaveValue('a b');
    act(() => {
      vi.advanceTimersByTime(SEARCH_PAUSE_MS);
    });
    await waitFor(() => expect(reads().some((read) => read.get('q') === 'a b')).toBe(true));
    // The address holds the trimmed text, and coming back from it must not eat a space just typed
    expect(box).toHaveValue('a b');
    await user.type(box, ' ');
    act(() => {
      vi.advanceTimersByTime(SEARCH_PAUSE_MS);
    });
    expect(box).toHaveValue('a b ');
    await user.type(box, 'c');
    expect(box).toHaveValue('a b c');
    // Nothing matches: Clear filters empties the search, and the box follows
    await user.clear(box);
    await user.type(box, 'zzzz');
    act(() => {
      vi.advanceTimersByTime(SEARCH_PAUSE_MS);
    });
    await user.click(await screen.findByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(box).toHaveValue(''));
    expect(await rowOf('/pricing')).toBeInTheDocument();
  });

  it('starts the box from the search in the address, and writes nothing on load', async () => {
    const writes: string[] = [];
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
      searchParams: '?q=%2Fpricing',
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    const box = await screen.findByRole('searchbox', { name: 'Search in table' });
    expect(box).toHaveValue('/pricing');
    expect(await rowOf('/pricing')).toBeInTheDocument();
    expect(writes).toEqual([]);
  });

  it('exports the server CSV of the current filter, scope and sort, with no page size and no equity', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
      searchParams: '?q=%2Fservices&scope=all&sort=path',
    });
    await rowOf('/services');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export this tab (CSV)' }));
    await waitFor(() => expect(downloadApiFile).toHaveBeenCalledTimes(1));
    expect(downloadApiFile).toHaveBeenCalledWith(
      `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS.project_id}/internal-links/pages`,
      { scope: 'all', sort: 'path', q: '/services', format: 'csv' },
      'internal-links-pages.csv',
    );
  });

  it('starts no second download while one is running, and says why', async () => {
    let finish = (): void => undefined;
    vi.mocked(downloadApiFile).mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await rowOf('/pricing');
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
    // Done: the next export starts again
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export this tab (CSV)' }));
    expect(downloadApiFile).toHaveBeenCalledTimes(2);
  });

  it('names what the API said when the export fails', async () => {
    vi.mocked(downloadApiFile).mockRejectedValue(
      problemFrom(new Response(null, { status: 500 }), {
        title: 'Server error',
        detail: 'The export could not be built for this crawl.',
      }),
    );
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await rowOf('/pricing');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export this tab (CSV)' }));
    // The toast and the live region that speaks it
    expect((await screen.findAllByText('The export could not be made')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('The export could not be built for this crawl.').length).toBeGreaterThan(0);
  });

  it('opens a page in the journey from its row, as a pushed history entry', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await rowOf('/pricing');
    await user.click(await screen.findByRole('button', { name: 'Open /pricing in journey' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const [address] = push.mock.calls.at(-1) as [string];
    expect(address).toContain('/seo/internal-links?');
    expect(address).toContain('tab=journey');
    expect(address).toContain('focus=108');
  });
});

describe('the toolbar and the column groups of All pages (spec 7.1 and 7.2)', () => {
  /** The table's whole toolbar: the role is on the density and Columns buttons, and the bar is two levels up. */
  const toolbar = async (): Promise<HTMLElement> => {
    const actions = await screen.findByRole('toolbar', { name: 'Pages table actions' });
    const bar = actions.parentElement?.parentElement;
    if (bar === null || bar === undefined) throw new Error('The table toolbar is missing');
    return bar;
  };

  it('draws a group cell over two or more shown columns of a group, and none over one', async () => {
    const first = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    const table = await grid();
    await rowOf('/pricing');
    // The default set shows one column of Indexing, Issues and Search: each collapses into its own header
    for (const name of ['Indexing', 'Issues', 'Search']) {
      expect(within(table).queryByRole('columnheader', { name })).toBeNull();
    }
    first.unmount();
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
      searchParams: '?cols=page,tier,reason,canonical,clicks,impressions',
    });
    const grouped = await grid();
    await rowOf('/pricing');
    for (const name of ['Indexing', 'Search']) {
      expect(within(grouped).getByRole('columnheader', { name })).toBeInTheDocument();
    }
    expect(within(grouped).queryByRole('columnheader', { name: 'Issues' })).toBeNull();
    expect(within(grouped).queryByRole('columnheader', { name: 'Links' })).toBeNull();
  });

  it('holds the filter bar in the table toolbar and draws no filter row outside the table', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: '?tier=none' });
    await rowOf('/blog');
    const bar = await toolbar();
    expect(within(bar).getByRole('button', { name: 'Add a filter' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Columns' })).toBeInTheDocument();
    // A chosen filter draws its chip in the toolbar
    expect(within(bar).getByRole('button', { name: 'Tier: Untiered. Edit filter' })).toBeInTheDocument();
    // Nothing outside the table holds a filter control
    const outside = [...document.querySelectorAll('[data-filter-add], [data-filter-chip]')].filter(
      (element) => !bar.contains(element),
    );
    expect(outside).toEqual([]);
    await user.click(within(bar).getByRole('button', { name: 'Columns' }));
    const dialog = await screen.findByRole('dialog', { name: 'Columns' });
    const headings = [...dialog.querySelectorAll('li[role="presentation"]')].map((li) => li.textContent);
    // A hidden column sits with the rest of its group, so each group is headed once
    expect(headings).toEqual(['Page', 'Indexing', 'Issues', 'Search', 'AI', 'Links']);
  });

  it('shows the link scope menu only while a column that depends on it is shown', async () => {
    const first = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await rowOf('/pricing');
    expect(screen.queryByRole('button', { name: /^Link scope/ })).toBeNull();
    first.unmount();
    for (const id of ['linking', 'fromTiers', 'outlinks']) {
      const shown = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
        searchParams: `?cols=page,${id}`,
      });
      await rowOf('/pricing');
      expect(within(await toolbar()).getByRole('button', { name: /^Link scope/ })).toBeInTheDocument();
      shown.unmount();
    }
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: '?cols=page,depth' });
    await rowOf('/pricing');
    expect(screen.queryByRole('button', { name: /^Link scope/ })).toBeNull();
  });

  it('asks for the pages sorted by address when the address names no sort', async () => {
    const reads = pageReads();
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await rowOf('/pricing');
    expect(reads()[0]?.get('sort')).toBe('path');
  });
});

describe('the Untiered filter', () => {
  it('shows only the pages with no tier for the address the summary strip links to (the round trip)', async () => {
    const first = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    const href = (await screen.findByRole('link', { name: /Tiered/ })).getAttribute('href');
    expect(href).toBe(`/digibranders/eventus-security/seo/pages/all?${UNTIERED_QUERY}`);
    first.unmount();
    // Open the address the link names: the Tier filter and the request read it as Untiered
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
      searchParams: new URL(href ?? '', 'http://x').search,
    });
    expect(await rowOf('/contact/thank-you')).toBeInTheDocument();
    expect(within(await grid()).queryByRole('rowheader', { name: '/pricing' })).toBeNull();
  });

  it('leaves out a tier, tag or status in the address that the API would refuse, instead of failing', async () => {
    const reads = pageReads();
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
      searchParams: '?tag=not-an-id&tier=T1&status=9xx',
    });
    expect(await rowOf('/pricing')).toBeInTheDocument();
    expect(reads().length).toBeGreaterThan(0);
    for (const read of reads()) {
      expect(read.get('filter[tag]')).toBeNull();
      expect(read.get('filter[tier]') ?? 'none').not.toBe('T1');
      expect(read.get('filter[status]')).toBeNull();
    }
  });

  it('keeps the tag filter to the most the API takes, in the chips as well as in the request, and says so', async () => {
    const reads = pageReads();
    const writes: string[] = [];
    const tags = Array.from(
      { length: MAX_TAGS + 1 },
      (_, index) => `0192e4a0-4000-7000-8000-${String(index).padStart(12, '0')}`,
    );
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
      searchParams: `?tag=${tags.join(',')}`,
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    expect(await screen.findByText('Tag filter limited to 50 tags')).toBeInTheDocument();
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    const kept = (query: string): string[] => new URLSearchParams(query).get('tag')?.split(',') ?? [];
    expect(writes.some((query) => kept(query).join() === tags.slice(0, MAX_TAGS).join())).toBe(true);
    for (const read of reads()) expect(read.get('filter[tag]')?.split(',').length ?? 0).toBeLessThanOrEqual(MAX_TAGS);
  });

  it('says that a filter from the link was left out', async () => {
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: '?status=9xx' });
    expect(await screen.findByText('A filter from the link was left out')).toBeInTheDocument();
    expect(screen.getByText('Status: the link holds a value this list does not have.')).toBeInTheDocument();
  });

  it('reads tier=none from the address into the Tier filter and the request', async () => {
    const reads = pageReads();
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: `?${UNTIERED_QUERY}` });
    expect(await rowOf('/contact/thank-you')).toBeInTheDocument();
    expect(await rowOf('/blog')).toBeInTheDocument();
    expect(within(await grid()).queryByRole('rowheader', { name: /^\/pricing/ })).toBeNull();
    expect(reads().some((read) => read.get('filter[tier]') === 'none')).toBe(true);
    // The chip names the choice
    expect(screen.getByRole('button', { name: 'Tier: Untiered. Edit filter' })).toBeInTheDocument();
  });
});

describe('the states of the tab', () => {
  it('says so when no page matches, and Clear filters brings the pages back', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: '?q=zzzz' });
    expect(await screen.findByRole('heading', { name: 'No pages match' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await rowOf('/pricing')).toBeInTheDocument();
  });

  it('says a worklist is empty in its own words, with a way back to all pages', async () => {
    server.use(
      http.get(PAGES, () =>
        HttpResponse.json({
          data: [],
          page: { limit: 100, next_cursor: null, has_more: false },
          meta: { run_id: MOCK_RUN_ID, scope: 'editorial', total: 0 },
        }),
      ),
    );
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
      searchParams: '?view=under_linked_t1',
    });
    expect(await screen.findByRole('heading', { name: 'No under-linked T1 pages' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all pages' }));
    expect(await screen.findByRole('heading', { name: 'No pages in this crawl' })).toBeInTheDocument();
  });

  it('shows a failed read with Try again, which reads again', async () => {
    let fail = true;
    server.use(
      http.get(PAGES, () =>
        fail
          ? HttpResponse.json({ type: 'about:blank', title: 'Server error', status: 500 }, { status: 500 })
          : undefined,
      ),
    );
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    expect(await screen.findByText('The pages could not be loaded')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await rowOf('/pricing')).toBeInTheDocument();
  });

  it('shows an answer that is not a page of rows as a failed read, not as an empty table', async () => {
    server.use(http.get(PAGES, () => HttpResponse.json({ unexpected: true })));
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    expect(await screen.findByText('The pages could not be loaded')).toBeInTheDocument();
  });

  it('answers 404 no_crawl with the same error state, not an empty table', async () => {
    server.use(
      http.get(PAGES, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'No crawl', status: 404, code: 'no_crawl' },
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    expect(await screen.findByText('The pages could not be loaded')).toBeInTheDocument();
  });
});

/** 120 pages made from the fixture rows: a page of 100 and one of 20. */
function syntheticRows(): ReturnType<typeof pageRow>[] {
  const fixture = crawledPages().map((page) => pageRow(page, 'editorial'));
  return Array.from({ length: 120 }, (_, index) => {
    const own = fixture[index % fixture.length];
    if (own === undefined) throw new Error('The fixture has no pages');
    return { ...own, url_id: String(5000 + index), path: `/page-${String(index)}` };
  });
}

describe('paging (decision W6)', () => {
  /** 120 pages made from the fixture rows, in a page of 100 and one of 20, by cursor. */
  const twoPages = (hold?: Promise<void>): (() => (string | null)[]) => {
    const rows = syntheticRows();
    const cursors: (string | null)[] = [];
    server.use(
      http.get(PAGES, async ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        cursors.push(cursor);
        const second = cursor === 'second';
        // The second page can be held back, to press Next while it loads
        if (second && hold !== undefined) await hold;
        return HttpResponse.json({
          data: second ? rows.slice(100) : rows.slice(0, 100),
          page: { limit: 100, next_cursor: second ? null : 'second', has_more: !second },
          meta: { run_id: MOCK_RUN_ID, scope: 'editorial', total: rows.length },
        });
      }),
    );
    return () => cursors;
  };

  it('goes forward by the cursor the API gave and back to the page before, with the range named', async () => {
    const cursors = twoPages();
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    expect(await screen.findByText('Showing 1 to 100 of 120')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Showing 101 to 120 of 120')).toBeInTheDocument();
    expect(cursors()).toContain('second');
    expect(screen.getByRole('button', { name: 'Next page' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(await screen.findByText('Showing 1 to 100 of 120')).toBeInTheDocument();
  });

  it('does not take the cursor of the page on screen for the page that is loading', async () => {
    let release = (): void => undefined;
    const cursors = twoPages(new Promise<void>((resolve) => (release = resolve)));
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await screen.findByText('Showing 1 to 100 of 120');
    const next = screen.getByRole('button', { name: 'Next page' });
    await user.click(next);
    await user.click(next);
    // The first page's rows stay while the second loads: neither button acts on them
    await waitFor(() => expect(next).toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByRole('button', { name: 'Previous page' })).toHaveAttribute('aria-disabled', 'true');
    release();
    expect(await screen.findByText('Showing 101 to 120 of 120')).toBeInTheDocument();
    expect(cursors()).toEqual([null, 'second']);
  });

  it('starts again at the first page when the worklist changes', async () => {
    const cursors = twoPages();
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await screen.findByText('Showing 1 to 100 of 120');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('Showing 101 to 120 of 120');
    await user.click(await screen.findByRole('button', { name: 'View: All pages' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Orphans' }));
    expect(await screen.findByText('Showing 1 to 100 of 120')).toBeInTheDocument();
    expect(cursors().at(-1)).toBeNull();
  });
});

describe('a crawl that ends while a later page is open', () => {
  /**
   * The pages of the latest crawl, whose cursors belong to it: `live.run` is the crawl the API reads, and a cursor of
   * another crawl is a 400 invalid_cursor, as the backend answers (reads.py binds the run into the cursor).
   * `lenient` answers a cursor of an older crawl with the new crawl's page instead, to see the run id move.
   */
  const crawlPages = (): { live: { run: string; lenient: boolean }; cursors: () => (string | null)[] } => {
    const rows = syntheticRows();
    const live = { run: MOCK_RUN_ID, lenient: false };
    const cursors: (string | null)[] = [];
    server.use(
      http.get(PAGES, ({ request }) => {
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
          data: second ? rows.slice(100) : rows.slice(0, 100),
          page: { limit: 100, next_cursor: second ? null : `second-${live.run}`, has_more: !second },
          meta: { run_id: live.run, scope: 'editorial', total: rows.length },
        });
      }),
    );
    return { live, cursors: () => cursors };
  };
  const NEW_RUN = '0192e4a0-1000-7000-8000-000000000002';

  it('goes back to the first page of the new crawl when the old cursor is refused, and Next then uses the new one', async () => {
    const { live, cursors } = crawlPages();
    const { user, queryClient } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await screen.findByText('Showing 1 to 100 of 120');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('Showing 101 to 120 of 120');
    // The crawl ends: every read of the links is stale, and the page open is read again with its old cursor
    live.run = NEW_RUN;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: READS_KEY });
    });
    expect(await screen.findByText('Showing 1 to 100 of 120')).toBeInTheDocument();
    expect(cursors().at(-1)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Showing 101 to 120 of 120')).toBeInTheDocument();
    expect(cursors().at(-1)).toBe(`second-${NEW_RUN}`);
  });

  it('goes back to the first page when a page of another crawl arrives, even if it was not refused', async () => {
    const { live } = crawlPages();
    live.lenient = true;
    const { user, queryClient } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
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

describe('the crawl in view on All pages', () => {
  it('sends the chosen crawl with every read: the list, the summary strip and the View menu counts', async () => {
    const seen: URL[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (/\/internal-links\/(pages|tier-flow|worklists)$/.test(url.pathname)) seen.push(url);
    });
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: `?run=${OLDER_RUN}` });
    await grid();
    await waitFor(() => {
      const routes = new Set(seen.map((url) => url.pathname.split('/').pop()));
      expect(routes).toEqual(new Set(['pages', 'tier-flow', 'worklists']));
    });
    for (const url of seen) expect(url.searchParams.get('run')).toBe(OLDER_RUN);
  });
});

describe('the folder, depth and variants filters (spec 7.4)', () => {
  it('sends the folder chosen in the filter bar as filter[folder]', async () => {
    const reads = pageReads();
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await rowOf('/pricing');
    await user.click(await screen.findByRole('button', { name: 'Add a filter' }));
    await user.click(await screen.findByRole('button', { name: 'Folder' }));
    await user.click(await screen.findByRole('radio', { name: '/blog/' }));
    await waitFor(() => expect(reads().some((query) => query.get('filter[folder]') === '/blog/')).toBe(true));
  });

  it('keeps a folder of the address from a cold start, with its chip and its request', async () => {
    const reads = pageReads();
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: '?view=live&folder=/blog/' });
    expect(await screen.findByRole('button', { name: 'Folder: /blog/. Edit filter' })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        reads().some((query) => query.get('filter[view]') === 'live' && query.get('filter[folder]') === '/blog/'),
      ).toBe(true),
    );
  });

  it('sends the depth of the address and draws a chip that clears it', async () => {
    const reads = pageReads();
    const updates: string[] = [];
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
      searchParams: '?depth=3',
      onUrlUpdate: ({ queryString }) => updates.push(queryString),
    });
    await grid();
    await waitFor(() => expect(reads()[0]?.get('filter[depth]')).toBe('3'));
    await user.click(await screen.findByRole('button', { name: 'Remove the filter 3 clicks from the home page' }));
    await waitFor(() => expect(updates.at(-1)).not.toContain('depth'));
    await waitFor(() => expect(reads().at(-1)?.has('filter[depth]')).toBe(false));
  });

  it('says Home page for depth 0 and a plural for 6', async () => {
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: '?depth=0' });
    expect(await screen.findByRole('button', { name: 'Remove the filter Home page' })).toBeInTheDocument();
  });

  it('sends the variants of the address as filter[include_variants] and draws a chip that clears it', async () => {
    const reads = pageReads();
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: '?variants=1' });
    await rowOf('/pricing');
    expect(reads()[0]?.get('filter[include_variants]')).toBe('true');
    const remove = await screen.findByRole('button', { name: 'Remove the filter With parameter variants' });
    remove.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(reads().at(-1)?.has('filter[include_variants]')).toBe(false));
  });

  it('carries the view, the folder and the depth to the CSV export', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
      searchParams: '?view=live&folder=/blog/&depth=2',
    });
    await screen.findByRole('button', { name: 'Folder: /blog/. Edit filter' });
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export this tab (CSV)' }));
    await waitFor(() => expect(downloadApiFile).toHaveBeenCalled());
    expect(vi.mocked(downloadApiFile).mock.calls.at(-1)?.[1]).toMatchObject({
      'filter[view]': 'live',
      'filter[folder]': '/blog/',
      'filter[depth]': 2,
      format: 'csv',
    });
  });

  it('draws nothing of the Issues and Tracked seams while they are not filled', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    const table = await grid();
    await rowOf('/pricing');
    expect(within(table).queryByRole('columnheader', { name: /^Issues/ })).toBeNull();
    expect(within(table).queryByRole('columnheader', { name: /^Tracked/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    const dialog = await screen.findByRole('dialog', { name: 'Columns' });
    expect(within(dialog).queryByRole('checkbox', { name: /^Issues$/ })).toBeNull();
    expect(within(dialog).queryByRole('checkbox', { name: /^Tracked$/ })).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Track in Monitoring' })).toBeNull();
  });
});

describe('accessibility of the tab', () => {
  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await rowOf('/pricing');
    expect(await axe(container)).toHaveNoViolations();
  });
});
