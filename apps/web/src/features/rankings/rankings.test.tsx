import { screen, waitFor, within } from '@testing-library/react';
import { delay, http } from 'msw';
import type { UrlUpdateEvent } from 'nuqs/adapters/testing';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KEYWORD_TABLE } from '@/mocks/keyword-table';
import { mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import {
  answerTrackedAsMany,
  cleanstart,
  keywordsIn,
  loadedGrid,
  rankingsAs as as,
  restoreWideScreen,
  stubWideScreen,
} from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/rankings',
}));

const TRACKED = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords';
const ACTIVE = KEYWORD_TABLE.filter((row) => row.archived !== true);

beforeEach(stubWideScreen);
afterEach(restoreWideScreen);

/** The query strings the screen wrote, newest last. */
function urlWrites(): { onUrlUpdate: (event: UrlUpdateEvent) => void; latest: () => URLSearchParams } {
  const writes: string[] = [];
  return {
    onUrlUpdate: (event) => writes.push(event.queryString),
    latest: () => new URLSearchParams(writes.at(-1) ?? ''),
  };
}

describe('Rankings', () => {
  it('lists the active keywords by volume, the ones still without metrics last, with the project count', async () => {
    const { container } = renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    await waitFor(() => expect(keywordsIn(grid)).toHaveLength(ACTIVE.length));
    expect(keywordsIn(grid).slice(0, 2)).toEqual(['seo agency', 'backlink checker']);
    expect(keywordsIn(grid).slice(-3)).toEqual(['chatgpt seo agency', 'generative engine optimization', 'llm seo']);
    expect(within(grid).getAllByText('Pending').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('columnheader', { name: /Volume/ })).toHaveAttribute('aria-sort', 'descending');
    expect(await screen.findByText(/59 tracked keywords/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('writes a sort from a header into the URL, and leaves the default out', async () => {
    const url = urlWrites();
    const { user } = renderWithProviders(as('viewer'), { onUrlUpdate: url.onUrlUpdate });
    const grid = await loadedGrid();
    await user.click(within(grid).getByRole('button', { name: 'Keyword' }));
    await waitFor(() => expect(url.latest().get('sort')).toBe('keyword'));
    expect(keywordsIn(grid)[0]).toBe('ai overviews seo');
    await user.click(within(grid).getByRole('button', { name: 'Keyword' }));
    await user.click(within(grid).getByRole('button', { name: 'Keyword' }));
    // Back to Volume descending, the default: no `sort` in the URL
    await waitFor(() => expect(url.latest().has('sort')).toBe(false));
  });

  it('reads filters from the URL as chips, and writes a removed chip back', async () => {
    const url = urlWrites();
    const { user } = renderWithProviders(as('viewer'), {
      searchParams: '?intent=commercial&vol=5000..',
      onUrlUpdate: url.onUrlUpdate,
    });
    const grid = await loadedGrid();
    await waitFor(() => expect(keywordsIn(grid)).toHaveLength(6));
    expect(screen.getByRole('button', { name: 'Volume: at least 5,000. Edit filter' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove filter Intent: Commercial' }));
    await waitFor(() => expect(url.latest().has('intent')).toBe(false));
    expect(url.latest().get('vol')).toBe('5000..');
    const louder = ACTIVE.filter((row) => (row.metrics?.volume ?? 0) >= 5000).length;
    await waitFor(() => expect(keywordsIn(grid)).toHaveLength(louder));
  });

  it('switches to the archived keywords and back', async () => {
    const url = urlWrites();
    const { user } = renderWithProviders(as('viewer'), { onUrlUpdate: url.onUrlUpdate });
    const grid = await loadedGrid();
    await user.click(screen.getByRole('radio', { name: 'Archived' }));
    await waitFor(() => expect(url.latest().get('archived')).toBe('true'));
    await waitFor(() =>
      expect(keywordsIn(grid).sort()).toEqual(['seo meme', 'seo newsletter', 'wordpress seo plugin']),
    );
    await user.click(screen.getByRole('radio', { name: 'Active' }));
    await waitFor(() => expect(url.latest().has('archived')).toBe(false));
  });

  it('says when the project tracks nothing yet, and when the filters match nothing', async () => {
    const { unmount } = renderWithProviders(as('viewer', cleanstart.project_id));
    expect(await screen.findByRole('heading', { name: 'No keywords tracked yet' })).toBeInTheDocument();
    unmount();
    const { user } = renderWithProviders(as('viewer'), { searchParams: '?vol=50000..' });
    const noMatches = await screen.findByRole('heading', { name: 'No keywords match these filters' });
    // The tracked count, and the filters that exclude them as chips that cannot be changed (17 section 2)
    expect(await screen.findByText('59 keywords are tracked; the active filter excludes all of them.')).toBeVisible();
    const applied = screen.getByRole('list', { name: 'Applied filters' });
    expect(within(applied).getByText('Volume: at least 50,000')).toBeInTheDocument();
    expect(within(applied).queryByRole('button')).toBeNull();
    // The empty state's own button, besides the filter bar's
    const clear = screen.getAllByRole('button', { name: 'Clear filters' });
    expect(clear).toHaveLength(2);
    // While the unfiltered list loads, the empty answer to the filters does not read as an empty project
    server.use(
      http.get(mswPath(TRACKED), async () => {
        await delay(200);
      }),
    );
    await user.click(clear.at(-1) ?? noMatches);
    expect(screen.queryByRole('heading', { name: 'No keywords tracked yet' })).toBeNull();
    expect(await loadedGrid()).toBeInTheDocument();
  });

  it('does not quote the active count when the archive is filtered to nothing', async () => {
    renderWithProviders(as('viewer'), { searchParams: '?archived=true&vol=50000..' });
    expect(await screen.findByText('The active filter excludes every archived keyword.')).toBeInTheDocument();
  });

  it('searches the loaded keywords at once in client mode, and offers to clear a search that finds nothing', async () => {
    const asked: URLSearchParams[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.url.includes('/tracked-keywords')) asked.push(new URL(request.url).searchParams);
    });
    const { user } = renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    await user.type(screen.getByRole('searchbox', { name: /Search/ }), 'agentur');
    await waitFor(() => expect(keywordsIn(grid)).toEqual(['seo agentur', 'seo agentur berlin']));
    // In memory: no request carries the search
    expect(asked.some((params) => params.has('filter[q]'))).toBe(false);
    await user.clear(screen.getByRole('searchbox', { name: /Search/ }));
    await user.type(screen.getByRole('searchbox', { name: /Search/ }), 'zebra');
    expect(await screen.findByRole('heading', { name: 'No keywords match “zebra”' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(keywordsIn(grid)).toHaveLength(ACTIVE.length));
    server.events.removeAllListeners();
  });

  it('shows an archived search that finds nothing as a search, not as an empty archive', async () => {
    renderWithProviders(as('viewer'), { searchParams: '?archived=true&q=zebra' });
    expect(await screen.findByRole('heading', { name: 'No keywords match “zebra”' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No archived keywords' })).toBeNull();
  });

  it('leaves out a filter of the link that the list does not have, and says so', async () => {
    const url = urlWrites();
    renderWithProviders(as('viewer'), { searchParams: '?intent=bogus&vol=1000..', onUrlUpdate: url.onUrlUpdate });
    expect(await screen.findByText('A filter from the link was left out')).toBeInTheDocument();
    await waitFor(() => expect(url.latest().has('intent')).toBe(false));
    expect(url.latest().get('vol')).toBe('1000..');
  });

  it('leaves out a range of the link outside its bounds, so the API never refuses it, and says so once', async () => {
    const asked: URLSearchParams[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.url.includes('/tracked-keywords')) asked.push(new URL(request.url).searchParams);
    });
    const url = urlWrites();
    renderWithProviders(<StrictMode>{as('viewer')}</StrictMode>, {
      searchParams: '?kd=..500&prio=..9&vol=-5..',
      onUrlUpdate: url.onUrlUpdate,
    });
    expect(await screen.findByText('3 filters from the link were left out')).toBeInTheDocument();
    await waitFor(() => expect(['kd', 'prio', 'vol'].some((key) => url.latest().has(key))).toBe(false));
    expect(await loadedGrid()).toBeInTheDocument();
    expect(screen.getAllByText('3 filters from the link were left out')).toHaveLength(1);
    const bounded = ['filter[keyword_difficulty_lte]', 'filter[priority_lte]', 'filter[search_volume_gte]'];
    expect(asked.some((params) => bounded.some((key) => params.has(key)))).toBe(false);
    server.events.removeAllListeners();
  });

  it('keeps the page when the list does not load, and tries again', async () => {
    let fail = true;
    server.use(
      http.get(mswPath(TRACKED), ({ request }) =>
        fail ? problem(request, 'not_found', { detail: 'Gone for this test' }) : undefined,
      ),
    );
    const { user } = renderWithProviders(as('viewer'));
    expect(await screen.findByText('The keywords did not load')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Rankings' })).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await loadedGrid()).toBeInTheDocument();
  });

  it('pages on the server above 10,000 matches, in the API sort, by cursor, 100 or 200 a page', async () => {
    const asked = answerAsMany({ total: 12_000 });
    const { user } = renderWithProviders(as('viewer'));
    expect(await screen.findByText(/^Showing 1 to 59 of 12,000 keywords/)).toBeInTheDocument();
    // The page asked for in server mode carries the table's sort
    await waitFor(() => expect(asked.some((params) => params.get('sort') === '-search_volume')).toBe(true));
    // Two quick clicks move one page: the second lands while the next page loads
    slowPages = true;
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    // The range stays with the rows on screen until the next page has loaded
    expect(screen.getByText(/^Showing 1 to 59 of 12,000 keywords/)).toBeInTheDocument();
    expect(await screen.findByText(/^Showing 201 to 259 of 12,000 keywords/)).toBeInTheDocument();
    slowPages = false;
    expect(asked.at(-1)?.get('cursor')).toBe('cursor-1');
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(await screen.findByText(/^Showing 1 to 59 of 12,000 keywords/)).toBeInTheDocument();
    // The API answers at most 200 a page, so 500 is not offered
    await user.click(screen.getByRole('combobox', { name: 'Rows per page' }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      '100 per page',
      '200 per page',
    ]);
  });

  it('sends the search to the API in server mode, once typing stops', async () => {
    const asked = answerAsMany({ total: 12_000 });
    const { user } = renderWithProviders(as('viewer'));
    expect(await screen.findByText(/^Showing 1 to 59 of 12,000 keywords/)).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: /Search/ }), 'audit');
    await waitFor(() => expect(asked.at(-1)?.get('filter[q]')).toBe('audit'));
    // Not a request per keystroke
    expect(asked.filter((params) => params.has('filter[q]')).map((params) => params.get('filter[q]'))).toEqual([
      'audit',
    ]);
  });

  it('loads every page in client mode, and says when a later page failed until it loads', async () => {
    let failSecond = true;
    answerAsMany({ total: 118, pages: 2, failSecond: () => failSecond });
    const { user } = renderWithProviders(as('viewer'));
    expect(
      await screen.findByText(
        'Some keywords did not load: 59 of 118 are shown, and sorting and search cover these only.',
      ),
    ).toBeInTheDocument();
    failSecond = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const grid = await loadedGrid();
    // Above 100 rows the table renders the rows near the view, so the count tells how many it holds
    await waitFor(() => expect(grid).toHaveAttribute('aria-rowcount', '119'));
    expect(screen.getAllByText(/^118 keywords/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Some keywords did not load/)).toBeNull();
  });
});

describe('Rankings import button', () => {
  it('opens the import for a member who may import, before Add keywords', async () => {
    const onImportOpenChange = vi.fn<(open: boolean) => void>();
    const { user } = renderWithProviders(as('editor', undefined, { onImportOpenChange }));
    await loadedGrid();
    const importButton = screen.getByRole('button', { name: 'Import' });
    const addButton = screen.getByRole('button', { name: 'Add keywords' });
    expect(importButton.compareDocumentPosition(addButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(importButton);
    expect(onImportOpenChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('shows no import to a viewer', async () => {
    renderWithProviders(as('viewer'));
    await loadedGrid();
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
  });
});

/** While true, pages after the first answer after 300 ms. */
let slowPages = false;

const answerAsMany = (options: { total: number; pages?: number; failSecond?: () => boolean }): URLSearchParams[] =>
  answerTrackedAsMany({ ...options, slow: () => slowPages });
