import { screen, waitFor, within } from '@testing-library/react';
import { delay, http } from 'msw';
import type { UrlUpdateEvent } from 'nuqs/adapters/testing';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TrackedKeywordState } from '@/lib/api/types';
import { MOCK_KEYWORDS, MOCK_TRACKED_KEYWORDS } from '@/mocks/keyword-fixtures';
import { KEYWORD_TABLE } from '@/mocks/keyword-table';
import { FAILED_IDS, FAILING_IDS, rankStateOf } from '@/mocks/rank-state';
import { mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import {
  answerTrackedAsMany,
  cleanstart,
  columnIndex,
  columnTexts,
  keywordsIn,
  loadedGrid,
  pendingMetricCells,
  rankingsAs as as,
  restoreWideScreen,
  stubWideScreen,
  visibleColumnTexts,
} from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
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
    // The three without metrics tie on volume, so they follow in the order of their ids, as the API orders ties
    expect(keywordsIn(grid).slice(-3)).toEqual(['generative engine optimization', 'llm seo', 'chatgpt seo agency']);
    expect(within(grid).getAllByText('Pending').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('columnheader', { name: /Volume/ })).toHaveAttribute('aria-sort', 'descending');
    expect(await screen.findByText(/59 tracked keywords/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('names the rows of one keyword apart by device and location, and by language when it is not the project’s', async () => {
    renderWithProviders(as('editor'));
    const grid = await loadedGrid();
    expect(
      within(grid).getByRole('checkbox', { name: 'Select seo agency berlin, desktop, Germany' }),
    ).toBeInTheDocument();
    expect(
      within(grid).getByRole('checkbox', { name: 'Select seo agency berlin, mobile, Germany' }),
    ).toBeInTheDocument();
    expect(
      within(grid).getByRole('checkbox', { name: 'Select seo agentur berlin, desktop, Germany, German' }),
    ).toBeInTheDocument();
  });

  it('describes a keyword’s row header by where, on what device and in which language it is tracked', async () => {
    renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    const header = within(grid).getAllByRole('rowheader')[0];
    expect(header).toHaveAccessibleDescription('United States · Desktop · Google · English');
    expect(screen.getByRole('columnheader', { name: /KD/ })).toHaveAccessibleDescription(
      'Keyword difficulty, from 0 to 100',
    );
    // A keyword with no metrics yet says so in its Volume, KD and CPC cells; its Rank cell says Pending for the first check
    expect(pendingMetricCells(grid)[0]).toHaveAccessibleDescription(
      'Metrics arrive within minutes of adding a keyword',
    );
    // A time names its zone in the header's description: 22-content-formatting.md section 4
    expect(screen.getByRole('columnheader', { name: /Added/ })).toHaveAccessibleDescription(
      'Times in Europe/Berlin (project time zone)',
    );
  });

  it('copies a keyword from inspector and links the ranking URL without opening the keyword', async () => {
    const url = urlWrites();
    const { user } = renderWithProviders(as('viewer'), { onUrlUpdate: url.onUrlUpdate });
    const grid = await loadedGrid();
    await waitFor(() => expect(keywordsIn(grid)).toHaveLength(ACTIVE.length));
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    // The first row that ranks with a URL
    const link = within(grid).getAllByRole('link', { name: /^Open the ranking page of .*: https?:\/\// })[0];
    const row = link?.closest('tr');
    const header = row === null || row === undefined ? undefined : within(row).getByRole('rowheader');
    const keyword = header?.querySelector('.truncate')?.textContent;
    if (
      row === null ||
      row === undefined ||
      header === undefined ||
      keyword === undefined ||
      keyword === '' ||
      link === undefined
    ) {
      throw new Error('No row with a ranking URL');
    }
    // The row header is named by the keyword alone, whatever buttons it holds
    expect(header).toHaveAccessibleName(keyword);
    expect(link).toHaveAttribute('href', expect.stringMatching(/^https:\/\//));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const keep = (event: Event): void => event.preventDefault();
    // Capturing: the link's own handler stops the click before it reaches the document
    document.addEventListener('click', keep, true);
    try {
      await user.click(link);
    } finally {
      document.removeEventListener('click', keep, true);
    }
    // Nothing of that opened the keyword; a click on the keyword itself still does
    expect(url.latest().has('inspect')).toBe(false);
    await user.click(header);
    await waitFor(() => expect(url.latest().get('inspect')).toMatch(/^keyword:/));
    await user.click(screen.getByRole('button', { name: new RegExp(`^More actions for ${keyword}`) }));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy keyword' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(keyword));
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('says once how fresh the metrics are: in the page header, not again in the table footer', async () => {
    renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    await waitFor(() => expect(keywordsIn(grid)).toHaveLength(ACTIVE.length));
    expect(screen.getAllByText(/Updated /)).toHaveLength(1);
    expect(screen.getByText(/Updated .* · 59 tracked keywords/)).toBeInTheDocument();
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

  it('opens in compact density from a link without one, keeps a link that says default, and writes a change to the URL', async () => {
    const url = urlWrites();
    const first = renderWithProviders(as('viewer'), { onUrlUpdate: url.onUrlUpdate });
    const grid = await loadedGrid();
    const rowsOf = (): HTMLElement[] => within(grid).getAllByRole('row').slice(1);
    expect(rowsOf().every((row) => row.classList.contains('h-row-compact'))).toBe(true);
    await first.user.click(screen.getByRole('button', { name: 'Density' }));
    await first.user.click(await screen.findByRole('menuitemradio', { name: 'Comfortable' }));
    await waitFor(() => expect(url.latest().get('density')).toBe('default'));
    await waitFor(() => expect(rowsOf().every((row) => row.classList.contains('h-row'))).toBe(true));
    first.unmount();
    renderWithProviders(as('viewer'), { searchParams: '?density=default' });
    const again = await loadedGrid();
    expect(within(again).getAllByRole('row')[1]).toHaveClass('h-row');
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
    expect(screen.getByRole('heading', { level: 1, name: 'Keywords' })).toBeInTheDocument();
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

  it('sends only what the API takes of a search: printable, at most 200 characters, and nothing when nothing is left', async () => {
    const asked = answerAsMany({ total: 12_000 });
    const { user } = renderWithProviders(as('viewer'));
    expect(await screen.findByText(/^Showing 1 to 59 of 12,000 keywords/)).toBeInTheDocument();
    const box = screen.getByRole('searchbox', { name: /Search/ });
    // The box takes no more than the API does
    expect(box).toHaveAttribute('maxlength', '200');
    // A tab and a zero-width space come in with a paste; the API refuses both
    await user.click(box);
    await user.paste('seo\tagency​');
    await waitFor(() => expect(asked.at(-1)?.get('filter[q]')).toBe('seo agency'));
    // Only such characters: no search at all, not a refused one
    await user.clear(box);
    await user.paste('​\t');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(asked.map((params) => params.get('filter[q]')).filter((value) => value !== null)).toEqual(['seo agency']);
    expect(await screen.findByText(/^Showing 1 to 59 of 12,000 keywords/)).toBeInTheDocument();
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

/** The fixture keywords as the mocks state them now: what the API will answer for each active row. */
function fixtureStates(): { text: string; state: TrackedKeywordState }[] {
  const texts = new Map(MOCK_KEYWORDS.map((keyword) => [keyword.keyword_id, keyword.text]));
  return MOCK_TRACKED_KEYWORDS.filter((row) => row.is_active).map((row) => ({
    text: texts.get(row.keyword_id) ?? '',
    state: rankStateOf(
      row.tracked_keyword_id,
      row.created_at,
      Date.now(),
      'fynix.digital',
      row.versions.at(-1)?.target_url ?? null,
    ),
  }));
}

/** The text of the keyword a tracked keyword tracks. */
function textOfKeyword(trackedId: string): string {
  const keywordId = MOCK_TRACKED_KEYWORDS.find((row) => row.tracked_keyword_id === trackedId)?.keyword_id;
  const text = MOCK_KEYWORDS.find((keyword) => keyword.keyword_id === keywordId)?.text;
  if (text === undefined) throw new Error(`No keyword text for ${trackedId}`);
  return text;
}

describe('Rankings rank columns', () => {
  it('shows the rank, the change and the ranking URL of a ranked keyword from its own state', async () => {
    const all = fixtureStates();
    const moved = all.find(
      ({ text, state }) =>
        state.current.state === 'ranked' &&
        state.change.label === 'numeric' &&
        Math.abs(state.change.value ?? 0) > 2 &&
        state.current.url !== null &&
        all.filter((other) => other.text === text).length === 1,
    );
    if (moved === undefined) throw new Error('No fixture keyword moved by more than 2 places');
    renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    const header = within(grid)
      .getAllByRole('rowheader')
      .find((candidate) => candidate.textContent === moved.text);
    const row = header?.closest('tr');
    if (row === null || row === undefined || header === undefined) throw new Error(`No row for ${moved.text}`);
    const change = moved.state.change.value ?? 0;
    const rankCell = row.cells[columnIndex(grid, /^Rank$/)];
    if (rankCell === undefined) throw new Error('No Rank cell');
    expect(within(rankCell).getByText(String(moved.state.current.rank))).toHaveClass('num');
    expect(within(rankCell).getByText(`${change > 0 ? '↑' : '↓'}${String(Math.abs(change))}`)).toHaveClass(
      change > 0 ? 'text-positive-text' : 'text-negative-text',
    );
    const link = within(header).getByRole('link', {
      name: `Open the ranking page of ${moved.text}: ${moved.state.current.url?.canonical_url}`,
    });
    expect(link).toHaveAttribute('href', moved.state.current.url?.canonical_url);
  });

  it('shows what is not a rank in words: beyond the depth, still waiting, a failed check, and stale', async () => {
    const states = fixtureStates().map(({ state }) => state);
    const beyond = states.filter(({ current }) => current.state === 'beyond_depth').length;
    const stale = states.filter(({ is_stale: isStale }) => isStale).length;
    expect(beyond).toBeGreaterThan(0);
    expect(stale).toBeGreaterThan(0);
    renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    const ranks = visibleColumnTexts(grid, /^Rank$/);
    expect(ranks.filter((text) => text.startsWith('>'))).toHaveLength(beyond);
    expect(ranks.filter((text) => text === 'Pending')).toHaveLength(
      states.filter(({ current }) => current.state === 'not_checked').length,
    );
    expect(within(grid).getAllByRole('img', { name: 'Check failed' }).length).toBeGreaterThan(0);
    // The marker follows the API's flag: one per stale keyword, nowhere else
    expect(within(grid).getAllByText('Stale')).toHaveLength(stale);
  });

  it('says Pending in Rank for a keyword added a moment ago', async () => {
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
    const at = keywordsIn(grid).indexOf('rank tracker api');
    expect(columnTexts(grid, /^Rank$/)[at]).toBe('Pending');
  }, 15_000);

  /** The cells of the row at a place in the grid, found by their column. */
  function rowCells(grid: HTMLElement, at: number): (name: RegExp) => HTMLElement {
    const row = within(grid).getAllByRole('rowheader')[at]?.closest('tr');
    if (row === null || row === undefined) throw new Error(`No row ${String(at)}`);
    return (name) => {
      const cell = row.cells[columnIndex(grid, name)];
      if (cell === undefined) throw new Error(`No ${String(name)} cell`);
      return cell;
    };
  }

  it('marks every stale keyword in its Rank cell too, and warns beside the rank when checks since then failed', async () => {
    renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    const stale = fixtureStates().filter(({ state }) => state.is_stale);
    expect(stale.length).toBeGreaterThan(1);
    // The Rank cell speaks "stale" for exactly the keywords the API flags, whatever columns the width shows
    expect(columnTexts(grid, /^Rank$/).filter((text) => text.includes('stale'))).toHaveLength(stale.length);
    const failing = columnTexts(grid, /^Rank$/).flatMap((text, at) => (text.includes('last check failed') ? [at] : []));
    expect(failing).toHaveLength(FAILING_IDS.size);
    for (const at of failing) {
      const cell = rowCells(grid, at)(/^Rank$/);
      expect(within(cell).getByText('last check failed')).toHaveClass('sr-only');
      expect(within(cell).getByText('stale')).toHaveClass('sr-only');
      // The rank of the last good check is still there
      expect(cell.querySelector('.num')?.textContent).toMatch(/^\d+$|^>\d+$/);
      expect(keywordsIn(grid)[at]).toBe(textOfKeyword([...FAILING_IDS][0] ?? ''));
    }
  });

  it('shows SERP features icons and the spoken list for a keyword with features', async () => {
    const withFeatures = fixtureStates().find(({ state }) => state.feature_types_present.length > 0);
    if (withFeatures === undefined) throw new Error('No fixture keyword has features');
    renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    const header = within(grid)
      .getAllByRole('rowheader')
      .find((candidate) => candidate.textContent === withFeatures.text);
    const row = header?.closest('tr');
    if (row === null || row === undefined) throw new Error(`No row for ${withFeatures.text}`);
    const cell = row.cells[columnIndex(grid, /^SERP features$/)];
    if (cell === undefined) throw new Error('No SERP features cell');
    expect(cell.querySelectorAll('svg[data-slot="icon"]').length).toBeGreaterThan(0);
    expect(within(cell).getByText(/^SERP features:/)).toHaveClass('sr-only');
  });

  it('shows Cited #n for a keyword cited in the AI Overview', async () => {
    const withAioCited = fixtureStates().find(
      ({ state }) => state.aio.state === 'present_cited' && state.aio.citation_position !== null,
    );
    if (withAioCited === undefined) throw new Error('No fixture keyword has a cited AI Overview');
    renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    const header = within(grid)
      .getAllByRole('rowheader')
      .find((candidate) => candidate.textContent === withAioCited.text);
    const row = header?.closest('tr');
    if (row === null || row === undefined) throw new Error(`No row for ${withAioCited.text}`);
    const cell = row.cells[columnIndex(grid, /^AI Overview$/)];
    if (cell === undefined) throw new Error('No AI Overview cell');
    expect(within(cell).getByText(`Cited #${withAioCited.state.aio.citation_position}`)).toBeInTheDocument();
  });

  it('tells one story for a keyword whose checks all failed: a warning, n/a, no change, a stale marker', async () => {
    renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    for (const id of FAILED_IDS) {
      const cells = rowCells(grid, keywordsIn(grid).indexOf(textOfKeyword(id)));
      expect(within(cells(/^Rank$/)).getByRole('img', { name: 'Check failed' })).toBeInTheDocument();
      expect(within(cells(/^Rank$/)).getByText('stale')).toHaveClass('sr-only');
      expect(within(cells(/^SERP features$/)).getByRole('img', { name: 'Check failed' })).toBeInTheDocument();
      expect(within(cells(/^SERP features$/)).getByText('stale')).toHaveClass('sr-only');
      expect(within(cells(/^AI Overview$/)).getByRole('img', { name: 'Check failed' })).toBeInTheDocument();
      expect(within(cells(/^AI Overview$/)).getByText('stale')).toHaveClass('sr-only');
      // Updated says the check failed and, because the API flags the keyword stale, shows the marker as well
      expect(within(cells(/^Updated$/)).getByText('Check failed')).toBeInTheDocument();
      expect(within(cells(/^Updated$/)).getByText('Stale')).toBeInTheDocument();
    }
  });

  it('sorts by rank best first with the keywords that have none last in both directions', async () => {
    const url = urlWrites();
    const { user } = renderWithProviders(as('viewer'), { onUrlUpdate: url.onUrlUpdate });
    const grid = await loadedGrid();
    await user.click(within(grid).getByRole('button', { name: 'Rank' }));
    await waitFor(() => expect(url.latest().get('sort')).toBe('current_rank'));
    const parseRank = (text: string): number | null => {
      const match = text.match(/^(\d+)/);
      return match ? Number(match[1]) : null;
    };
    const places = (): string[] => visibleColumnTexts(grid, /^Rank$/);
    const asc = places();
    const ranked = asc.map(parseRank).filter((val): val is number => val !== null);
    expect(ranked.length).toBeGreaterThan(5);
    expect(ranked).toEqual([...ranked].sort((a, b) => a - b));
    expect(asc.slice(0, ranked.length).every((text) => parseRank(text) !== null)).toBe(true);
    await user.click(within(grid).getByRole('button', { name: 'Rank' }));
    await waitFor(() => expect(url.latest().get('sort')).toBe('-current_rank'));
    const desc = places();
    expect(desc.slice(0, ranked.length).map(parseRank)).toEqual([...ranked].reverse());
    expect(desc.slice(ranked.length).some((text) => parseRank(text) !== null)).toBe(false);
  });

  it('gives the tooltip of a rank to the cell that holds the keyboard focus, as its description too', async () => {
    const { user } = renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    for (let presses = 0; presses < 6 && !grid.contains(document.activeElement); presses += 1) await user.tab();
    // From the first header to the first row, then past its keyword (a viewer has no checkbox column) to the Rank cell
    await user.keyboard('{ArrowDown}{ArrowRight}');
    const cell = document.activeElement;
    expect(cell).toHaveAttribute('role', 'gridcell');
    const tip = /^(Rank \d+|Not in the top \d+), \w{3} \d+, \d{4} · \d{2}:\d{2} \w+/;
    await waitFor(() => expect(document.querySelector('[data-slot="tooltip"]')?.textContent).toMatch(tip));
    // The description is the whole tooltip, except for `>20`, which the cell already speaks as "not in top 20":
    // then it is the check that follows
    const checked = /^Checked \w{3} \d+, \d{4} · \d{2}:\d{2} \S+\./;
    expect(cell).toHaveAccessibleDescription(expect.stringMatching(new RegExp(`${tip.source}|${checked.source}`)));
  });

  it('asks the API to sort by rank above 10,000 keywords', async () => {
    const asked = answerAsMany({ total: 12_000 });
    const { user } = renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    await user.click(within(grid).getByRole('button', { name: 'Rank' }));
    await waitFor(() => expect(asked.some((params) => params.get('sort') === 'current_rank')).toBe(true));
  });

  it('lists Best rank in the column chooser, off by default, and shows it when chosen', async () => {
    const { user } = renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    expect(within(grid).queryByRole('columnheader', { name: /Best rank/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    const choice = screen.getByRole('checkbox', { name: 'Best rank' });
    expect(choice).not.toBeChecked();
    await user.click(choice);
    expect(within(grid).getByRole('columnheader', { name: /Best rank/ })).toBeInTheDocument();
  });
});

describe('Rankings rank filters', () => {
  afterEach(() => server.events.removeAllListeners());

  /** The queries of the list's own reads, newest last (not its count, not the poll for first metrics). */
  function listQueries(): URLSearchParams[] {
    const asked: URLSearchParams[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (request.method !== 'GET' || !url.pathname.endsWith('/tracked-keywords')) return;
      if (url.searchParams.get('limit') === '1' || url.searchParams.get('sort') === '-created_at') return;
      asked.push(url.searchParams);
    });
    return asked;
  }

  type User = ReturnType<typeof renderWithProviders>['user'];

  /** Adds a single choice chip through the field picker, which applies the choice at once. */
  async function choose(user: User, grid: HTMLElement, field: string, option: string): Promise<void> {
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    // The grid's own header buttons carry the same names as some fields
    const picker = (await screen.findAllByRole('button', { name: field })).find((button) => !grid.contains(button));
    if (picker === undefined) throw new Error(`The field picker has no ${field}`);
    await user.click(picker);
    await user.click(await screen.findByRole('radio', { name: option }));
  }

  it('sends the places of a bucket to the API, writes it to the URL and keeps the keywords in range', async () => {
    const asked = listQueries();
    const url = urlWrites();
    const { user } = renderWithProviders(as('viewer'), { onUrlUpdate: url.onUrlUpdate });
    const grid = await loadedGrid();
    await choose(user, grid, 'Rank', '4 to 10');
    await waitFor(() => expect(url.latest().get('rank')).toBe('top10'));
    await waitFor(() =>
      expect(
        asked.some((query) => query.get('filter[rank_gte]') === '4' && query.get('filter[rank_lte]') === '10'),
      ).toBe(true),
    );
    const within4to10 = fixtureStates().filter(
      ({ state }) => state.current.rank !== null && state.current.rank >= 4 && state.current.rank <= 10,
    );
    expect(within4to10.length).toBeGreaterThan(0);
    await waitFor(() => expect(keywordsIn(grid)).toHaveLength(within4to10.length));
    const places = visibleColumnTexts(grid, /^Rank$/).map((text) => parseInt(text, 10));
    expect(places.every((place) => place >= 4 && place <= 10)).toBe(true);
    expect(screen.getByRole('button', { name: 'Rank: 4 to 10. Edit filter' })).toBeInTheDocument();
  });

  it('sends Top 3 as places 1 to 3', async () => {
    const asked = listQueries();
    const { user } = renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    await choose(user, grid, 'Rank', 'Top 3');
    await waitFor(() =>
      expect(
        asked.some((query) => query.get('filter[rank_gte]') === '1' && query.get('filter[rank_lte]') === '3'),
      ).toBe(true),
    );
  });

  it('sends Improved, and keeps the keywords that moved up', async () => {
    const asked = listQueries();
    const url = urlWrites();
    const { user } = renderWithProviders(as('viewer'), { onUrlUpdate: url.onUrlUpdate });
    const grid = await loadedGrid();
    await choose(user, grid, 'Change', 'Improved');
    await waitFor(() => expect(url.latest().get('chg')).toBe('improved'));
    await waitFor(() => expect(asked.some((query) => query.get('filter[improved]') === 'true')).toBe(true));
    const improved = fixtureStates().filter(({ state }) => (state.change.value ?? 0) > 0);
    expect(improved.length).toBeGreaterThan(0);
    await waitFor(() => expect(keywordsIn(grid)).toHaveLength(improved.length));
  });

  it('sends Entered as the new label and Lost as the lost label', async () => {
    const asked = listQueries();
    const { user } = renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    await choose(user, grid, 'Change', 'Entered');
    await waitFor(() => expect(asked.some((query) => query.get('filter[rank_change_label_in]') === 'new')).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Change: Entered. Edit filter' }));
    await user.click(await screen.findByRole('radio', { name: 'Lost' }));
    await waitFor(() => expect(asked.some((query) => query.get('filter[rank_change_label_in]') === 'lost')).toBe(true));
  });

  it('sends Stale, and keeps the keywords the API flags as stale', async () => {
    const asked = listQueries();
    const { user } = renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    // The chip reads "Freshness: Stale", not "Stale: Stale"
    await choose(user, grid, 'Freshness', 'Stale');
    expect(await screen.findByRole('button', { name: 'Freshness: Stale. Edit filter' })).toBeInTheDocument();
    await waitFor(() => expect(asked.some((query) => query.get('filter[is_stale]') === 'true')).toBe(true));
    const stale = fixtureStates().filter(({ state }) => state.is_stale);
    await waitFor(() => expect(keywordsIn(grid)).toHaveLength(stale.length));
  });

  it('lists under the Stale filter only rows that show the marker, the failed keyword included', async () => {
    const { user } = renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    await choose(user, grid, 'Freshness', 'Stale');
    const stale = fixtureStates().filter(({ state }) => state.is_stale);
    await waitFor(() => expect(keywordsIn(grid)).toHaveLength(stale.length));
    expect(keywordsIn(grid)).toContain(textOfKeyword([...FAILED_IDS][0] ?? ''));
    const updated = columnTexts(grid, /^Updated$/);
    expect(updated).toHaveLength(stale.length);
    for (const text of updated) expect(text).toContain('Stale');
    // The Rank cell of each says it too
    for (const text of columnTexts(grid, /^Rank$/)) expect(text).toContain('stale');
  });

  it('applies a rank filter from a link, and sends no filter it does not have', async () => {
    const asked = listQueries();
    renderWithProviders(as('viewer'), { searchParams: '?rank=beyond' });
    const grid = await loadedGrid();
    expect(screen.getByRole('button', { name: 'Rank: Beyond depth. Edit filter' })).toBeInTheDocument();
    const beyond = fixtureStates().filter(({ state }) => state.current.state === 'beyond_depth');
    await waitFor(() => expect(keywordsIn(grid)).toHaveLength(beyond.length));
    expect(asked.every((query) => query.get('filter[rank_is_null]') === 'true')).toBe(true);
    for (const name of ['rank_gte', 'rank_lte', 'improved', 'declined', 'rank_change_label_in', 'is_stale']) {
      expect(asked.some((query) => query.has(`filter[${name}]`))).toBe(false);
    }
  });

  it('keeps the first bucket of a link that names two, and says the other was left out', async () => {
    // The API takes one range of places, so the chip holds one bucket; a spec-form link may name more
    const asked = listQueries();
    const url = urlWrites();
    renderWithProviders(as('viewer'), { searchParams: '?rank=top3,top10', onUrlUpdate: url.onUrlUpdate });
    expect(await screen.findByText('A filter from the link was left out')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Rank: Top 3. Edit filter' })).toBeInTheDocument();
    await waitFor(() => expect(url.latest().get('rank')).toBe('top3'));
    await loadedGrid();
    expect(asked.some((query) => query.get('filter[rank_lte]') === '10')).toBe(false);
    expect(asked.some((query) => query.get('filter[rank_lte]') === '3')).toBe(true);
  });

  it('drops an invalid value of a link with the notice the other chips give, and sends nothing for it', async () => {
    const asked = listQueries();
    const url = urlWrites();
    renderWithProviders(as('viewer'), { searchParams: '?rank=top7&chg=sideways', onUrlUpdate: url.onUrlUpdate });
    expect(await screen.findByText('2 filters from the link were left out')).toBeInTheDocument();
    await waitFor(() => expect(url.latest().has('rank') || url.latest().has('chg')).toBe(false));
    await loadedGrid();
    expect(asked.some((query) => [...query.keys()].some((key) => /rank_|improved|declined/.test(key)))).toBe(false);
  });

  it('chooses SERP feature: Video, sends filter[feature_present]=video and writes feat=video to the URL', async () => {
    const asked = listQueries();
    const url = urlWrites();
    const { user } = renderWithProviders(as('viewer'), { onUrlUpdate: url.onUrlUpdate });
    const grid = await loadedGrid();
    await choose(user, grid, 'SERP feature', 'Video');
    await waitFor(() => expect(asked.some((query) => query.get('filter[feature_present]') === 'video')).toBe(true));
    await waitFor(() => expect(url.latest().get('feat')).toBe('video'));
  });

  it('drops an unknown feature code from a link with a notice', async () => {
    const asked = listQueries();
    const url = urlWrites();
    renderWithProviders(as('viewer'), { searchParams: '?feat=image_pack', onUrlUpdate: url.onUrlUpdate });
    expect(await screen.findByText('A filter from the link was left out')).toBeInTheDocument();
    await waitFor(() => expect(url.latest().has('feat')).toBe(false));
    await loadedGrid();
    expect(asked.some((query) => query.has('filter[feature_present]'))).toBe(false);
  });

  it('chooses AI Overview: Cited, sends filter[aio_state]=present_cited and keeps only matching rows', async () => {
    const asked = listQueries();
    const url = urlWrites();
    const { user } = renderWithProviders(as('viewer'), { onUrlUpdate: url.onUrlUpdate });
    const grid = await loadedGrid();
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    const picker = (await screen.findAllByRole('button', { name: 'AI Overview' })).find(
      (button) => !grid.contains(button),
    );
    if (picker === undefined) throw new Error('The field picker has no AI Overview');
    await user.click(picker);
    await user.click(await screen.findByRole('checkbox', { name: 'Cited' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(asked.some((query) => query.get('filter[aio_state]') === 'present_cited')).toBe(true));
    await waitFor(() => expect(url.latest().get('aio')).toBe('present_cited'));
    await waitFor(() => {
      const texts = keywordsIn(grid);
      expect(texts.length).toBeGreaterThan(0);
      expect(
        texts.every((text) => {
          const item = fixtureStates().find((candidate) => candidate.text === text);
          return item?.state.aio.state === 'present_cited';
        }),
      ).toBe(true);
    });
  });

  it('marks a keyword whose ranking URL does not match its target and filters by target URL match', async () => {
    const asked = listQueries();
    const url = urlWrites();
    const { user } = renderWithProviders(as('viewer'), { onUrlUpdate: url.onUrlUpdate });
    const grid = await loadedGrid();

    const mismatchRow = within(grid)
      .getAllByRole('rowheader')
      .find((candidate) => candidate.textContent === 'website seo audit');
    expect(mismatchRow).toBeDefined();
    if (!mismatchRow) throw new Error('No mismatch row found');
    const icon = mismatchRow.querySelector('svg.text-warning-text');
    expect(icon).toBeInTheDocument();
    expect(mismatchRow).toHaveAccessibleDescription(/Ranks with \/blog\/local-seo, not the target \/audits\./);

    await choose(user, grid, 'Target URL', 'Ranks with another URL');
    await waitFor(() => expect(asked.some((query) => query.get('filter[target_url_match]') === 'false')).toBe(true));
    await waitFor(() => expect(url.latest().get('tmatch')).toBe('mismatch'));
    await waitFor(() => {
      const texts = keywordsIn(grid);
      expect(texts.length).toBeGreaterThan(0);
      expect(
        texts.every((text) => {
          const item = fixtureStates().find((candidate) => candidate.text === text);
          return item?.state.target_url_match === false;
        }),
      ).toBe(true);
    });
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
