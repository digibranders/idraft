import { act, screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { useQueryState } from 'nuqs';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { announce } from '@/lib/a11y/announcer';
import { downloadApiFile } from '@/lib/api/download';
import { formatTableDate } from '@/lib/format';
import type { PageRow } from '@/lib/internal-links/types';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { crawledPage, EVENTUS, MOCK_RUN_ID, pageRow } from '@/mocks/internal-links-world';
import { mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { EVENTUS_LINKS } from '@/test/internal-links-harness';
import { answerIssues, issueList, issuesAs, ISSUE_CHECKS } from '@/test/issues-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: router.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/issues',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api/download', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/download')>();
  return { ...actual, downloadApiFile: vi.fn(async () => undefined) };
});

// The real announcer with a spy on it, so a test counts what the page says as well as what the region holds
vi.mock('@/lib/a11y/announcer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/a11y/announcer')>();
  return { ...actual, announce: vi.fn(actual.announce) };
});

const PAGES = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages');
/** Where the pages list is asked for, written out so a test does not depend on the code that builds it. */
const PAGES_PATH = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS.project_id}/internal-links/pages`;
type RowGsc = NonNullable<NonNullable<PageRow['extras']>['gsc']>;
const GSC_OK: RowGsc = {
  state: 'ok',
  clicks: 340,
  impressions: 9000,
  window_start: '2026-10-28',
  window_end: '2026-11-24',
};

/** A page of the fixture crawl as the pages list returns it for a check: with its detail and its clicks. */
function rowOf(
  id: string,
  over: Partial<PageRow>,
  issue: NonNullable<NonNullable<PageRow['extras']>['issue']>,
  gsc: RowGsc = GSC_OK,
): PageRow {
  const page = crawledPage(id);
  if (page === undefined) throw new Error(`The fixture crawl has no page ${id}`);
  return { ...pageRow(page, 'all'), ...over, extras: { issue, gsc } };
}

const BROKEN: readonly PageRow[] = [
  rowOf('102', { status_code: 404, linking_pages_all: 7 }, { count: 2 }),
  rowOf('108', { status_code: 404, linking_pages_all: 12 }, { count: 1 }, { ...GSC_OK, clicks: 0 }),
];

const asked: URL[] = [];
/** The pages list answering `rows` for every ask, and remembering what was asked. */
const answerPages = (
  rows: (url: URL) => readonly PageRow[] = () => BROKEN,
  page: { next: string | null; total?: number } = { next: null },
): ReturnType<typeof http.get> =>
  http.get(PAGES, ({ request }) => {
    const url = new URL(request.url);
    asked.push(url);
    const data = rows(url);
    return HttpResponse.json({
      data,
      page: { has_more: page.next !== null, limit: 50, next_cursor: page.next },
      meta: { run_id: MOCK_RUN_ID, scope: 'all', total: page.total ?? data.length, links_available: true },
    });
  });

// jsdom has no scrollIntoView: a spy stands in, and `mock.contexts` says which row was scrolled
const scrollIntoView = vi.fn();
beforeEach(() => {
  stubWideScreen();
  asked.length = 0;
  vi.mocked(downloadApiFile).mockClear();
  vi.mocked(announce).mockClear();
  router.push.mockClear();
  scrollIntoView.mockClear();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  });
  server.use(answerIssues(), answerPages());
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  restoreWideScreen();
  document.documentElement.classList.remove('dark');
});

/** A button that writes one key of the address from outside the screen, as the Back button or a pasted link would. */
function AddressButton({ name, value }: { name: string; value: string }): ReactElement {
  const [, setValue] = useQueryState(name);
  return (
    <button type="button" onClick={() => void setValue(value)}>
      {`Set ${name}`}
    </button>
  );
}

const OPEN = { searchParams: '?check=status-4xx' };
const openCheck = async (searchParams = OPEN.searchParams) => {
  const view = renderWithProviders(issuesAs('editor'), { searchParams });
  const table = await screen.findByRole('table', { name: /^Pages: / });
  return { ...view, table };
};
const bodyRow = (table: HTMLElement, path: string): HTMLElement => {
  const found = within(table)
    .getByRole('button', { name: `Open ${path}` })
    .closest('tr');
  if (found === null) throw new Error(`No row for ${path}`);
  return found;
};
// The cells after the Page cell, which is the row header: what was found, clicks, status, tier, links in
const FOUND = 0;
const CLICKS = 1;
const STATUS = 2;
const TIER = 3;
const LINKS_IN = 4;
const cellsOf = (row: HTMLElement): HTMLElement[] => within(row).getAllByRole('cell');

describe('the bar and the two lines of the open check (spec 7.3)', () => {
  it('shows All issues, the name, the severity, where the check was found, the search and Export', async () => {
    await openCheck();
    expect(screen.getByRole('button', { name: 'All issues' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Pages that return a 4xx error' })).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Found by: Crawl')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search pages' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('explains the badges with a tooltip', async () => {
    await openCheck();
    expect(screen.getByText('Found by: Crawl')).toHaveAccessibleDescription(
      'Found by crawling the site, page by page.',
    );
    expect(screen.getByText('Error')).toHaveAccessibleDescription(
      'Breaks a page for visitors or for Google. Fix these first.',
    );
  });

  it('puts why it matters and how to fix it in two lines side by side, the label inside each line', async () => {
    await openCheck();
    const why = screen.getByText('Why it matters:').parentElement as HTMLElement;
    const fix = screen.getByText('How to fix it:').parentElement as HTMLElement;
    expect(why).toHaveTextContent(
      'Why it matters: Visitors and Google get an error instead of the page, and every link to it is wasted.',
    );
    expect(fix).toHaveTextContent(
      'How to fix it: Restore the page, redirect its address to the closest live page, or remove the links to it.',
    );
    expect(why).toHaveClass('type-body');
    expect(why.parentElement).toBe(fix.parentElement);
    expect(why.parentElement).toHaveClass('md:grid-cols-2');
  });

  it('puts nothing between the bar, the two lines and the table', async () => {
    const { table } = await openCheck();
    const panel = table.closest('section') as HTMLElement;
    const [bar, lines, region] = Array.from(panel.children);
    expect(bar).toContainElement(screen.getByRole('button', { name: 'All issues' }));
    expect(lines).toContainElement(screen.getByText('Why it matters:'));
    expect(region).toContainElement(table);
    // No heading, no description: the panel's headings are the check's name alone
    expect(within(panel).getAllByRole('heading')).toHaveLength(1);
  });

  it('shows neither the page toolbar nor the strip while a check is open', async () => {
    await openCheck();
    expect(screen.queryByRole('group', { name: 'Measures' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Crawl now|Crawling/ })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('table', { name: 'Technical checks' })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('the pages of the check (spec 7.3)', () => {
  it('names the table and its columns, and draws the rows at the compact height', async () => {
    const { table } = await openCheck();
    expect(table).toHaveAccessibleName('Pages: Pages that return a 4xx error');
    const names = ['Page', 'What was found', 'Clicks', 'Status', 'Tier', 'Links in'];
    const headers = within(table).getAllByRole('columnheader');
    headers.forEach((header, index) => expect(header).toHaveAccessibleName(names[index]));
    expect(headers).toHaveLength(names.length);
    expect(bodyRow(table, '/services')).toHaveClass('h-row-compact');
  });

  it('shows a row per page: the path in mono, the sentence, the clicks, the status, the tier and the links in', async () => {
    const { table } = await openCheck();
    const row = bodyRow(table, '/pricing');
    const path = within(row).getByText('/pricing');
    expect(path).toHaveClass('font-mono');
    const cells = cellsOf(row);
    expect(cells[FOUND]).toHaveTextContent('Returns 404, linked from 1 page');
    // Numbers are left aligned, as in the list of checks
    expect(cells[CLICKS]).toHaveTextContent('0');
    expect(cells[CLICKS]).not.toHaveClass('text-right');
    expect(cells[STATUS]).toHaveTextContent('404');
    expect(cells[TIER]).toHaveTextContent(
      pageRow(crawledPage('108') as NonNullable<ReturnType<typeof crawledPage>>, 'all').tier?.code ?? 'Untiered',
    );
    expect(cells[LINKS_IN]).toHaveTextContent('12');
    expect(cellsOf(bodyRow(table, '/services'))[CLICKS]).toHaveTextContent('340');
  });

  it('says what was found in the words of three kinds of check', async () => {
    server.use(
      answerPages((url) => {
        switch (url.searchParams.get('filter[issue]')) {
          case 'redirect-chain':
            return [rowOf('108', { status_code: 301 }, { target_path: '/pricing/plans' })];
          case 'title-long':
            return [rowOf('112', { status_code: 200 }, { count: 74 })];
          default:
            return [rowOf('112', { status_code: 200 }, { reason: 'meta_tag' })];
        }
      }),
    );
    const chain = await openCheck('?check=redirect-chain');
    expect(cellsOf(bodyRow(chain.table, '/pricing'))[FOUND]).toHaveTextContent(
      'Redirects to /pricing/plans, which redirects again',
    );
    chain.unmount();
    const title = await openCheck('?check=title-long');
    expect(cellsOf(bodyRow(title.table, '/blog/what-is-a-soc'))[FOUND]).toHaveTextContent('74 characters');
    title.unmount();
    server.use(
      answerIssues(
        issueList([
          ...ISSUE_CHECKS,
          { ...(ISSUE_CHECKS[0] as (typeof ISSUE_CHECKS)[number]), id: 'noindex', pages: 1, example_path: '/x' },
        ]),
      ),
    );
    const noindex = await openCheck('?check=noindex');
    expect(cellsOf(bodyRow(noindex.table, '/blog/what-is-a-soc'))[FOUND]).toHaveTextContent('Has a noindex tag');
  });

  it('shows n/a with its tooltip for the clicks of a page when Search Console has no number for it', async () => {
    server.use(
      answerPages(() => [
        rowOf('102', { status_code: 404 }, { count: 2 }, { ...GSC_OK, state: 'not_connected', clicks: null }),
        rowOf('108', { status_code: 404 }, { count: 1 }, { ...GSC_OK, state: 'pending', clicks: null }),
      ]),
    );
    const { table } = await openCheck();
    const notConnected = within(cellsOf(bodyRow(table, '/services'))[CLICKS] as HTMLElement).getByText('n/a');
    expect(notConnected).toHaveAccessibleDescription('Search Console is not connected');
    const pending = within(cellsOf(bodyRow(table, '/pricing'))[CLICKS] as HTMLElement).getByText('n/a');
    expect(pending).toHaveAccessibleDescription('Search Console has no page numbers yet');
  });

  it('says in a tooltip why a page has no sentence', async () => {
    server.use(answerPages(() => [rowOf('102', { status_code: 404 }, {})]));
    const { table } = await openCheck();
    const found = within(cellsOf(bodyRow(table, '/services'))[FOUND] as HTMLElement).getByText('n/a');
    expect(found).toHaveAccessibleDescription('No detail for this page');
  });

  it('sorts by clicks when Search Console is connected, by path when it is not, and by the address when it says', async () => {
    const connected = await openCheck();
    expect(asked.at(-1)?.searchParams.get('sort')).toBe('-clicks');
    expect(asked.at(-1)?.searchParams.get('filter[issue]')).toBe('status-4xx');
    expect(asked.at(-1)?.searchParams.getAll('include').join(',')).toContain('issue');
    connected.unmount();
    asked.length = 0;
    server.use(answerIssues(issueList(ISSUE_CHECKS, { state: 'not_connected', window_start: null, window_end: null })));
    const notConnected = await openCheck();
    expect(asked.at(-1)?.searchParams.get('sort')).toBe('path');
    notConnected.unmount();
    asked.length = 0;
    await openCheck('?check=status-4xx&sort=-linking_pages');
    expect(asked.at(-1)?.searchParams.get('sort')).toBe('-linking_pages');
  });

  it('says which pages show of how many there are, and the date of the crawl', async () => {
    server.use(answerPages(() => BROKEN, { next: null, total: 120 }));
    await openCheck();
    expect(await screen.findByText('Showing 1 to 2 of 120 pages')).toBeInTheDocument();
    const date = formatTableDate('2026-11-25T09:12:00Z', EVENTUS_LINKS.timeZone);
    expect(screen.getByText(`Crawl of ${date}`)).toBeInTheDocument();
  });

  it('asks the next cursor with Next page, and goes back with Previous page', async () => {
    server.use(
      answerPages((url) => (url.searchParams.get('cursor') === 'c2' ? [BROKEN[1] as PageRow] : BROKEN), {
        next: 'c2',
        total: 120,
      }),
    );
    const { user } = await openCheck();
    expect(screen.getByRole('button', { name: 'Previous page' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(asked.at(-1)?.searchParams.get('cursor')).toBe('c2'));
    // The second page starts after the 50 rows of the first
    expect(await screen.findByText('Showing 51 to 51 of 120 pages')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    // The first page is back (from the cache, so no new ask)
    expect(await screen.findByText('Showing 1 to 2 of 120 pages')).toBeInTheDocument();
  });

  it('says one page in the singular', async () => {
    server.use(answerPages(() => [BROKEN[0] as PageRow]));
    await openCheck();
    expect(await screen.findByText('Showing 1 to 1 of 1 page')).toBeInTheDocument();
  });

  describe('the paging starts again at the first page', () => {
    const PAGED = answerPages((url) => (url.searchParams.get('cursor') === 'c2' ? [BROKEN[1] as PageRow] : BROKEN), {
      next: 'c2',
      total: 120,
    });
    const onSecondPage = async (searchParams: string, jump: ReactElement) => {
      server.use(PAGED);
      const view = renderWithProviders(
        <>
          {jump}
          {issuesAs('editor')}
        </>,
        { searchParams },
      );
      await screen.findByRole('table', { name: /^Pages: / });
      await view.user.click(screen.getByRole('button', { name: 'Next page' }));
      await waitFor(() => expect(asked.at(-1)?.searchParams.get('cursor')).toBe('c2'));
      await screen.findByText('Showing 51 to 51 of 120 pages');
      asked.length = 0;
      return view;
    };

    it('when the search changes', async () => {
      const { user } = await onSecondPage(OPEN.searchParams, <></>);
      await user.type(screen.getByRole('searchbox', { name: 'Search pages' }), 'pr');
      await waitFor(() => expect(asked.at(-1)?.searchParams.get('q')).toBe('pr'));
      expect(asked.every((url) => url.searchParams.get('cursor') === null)).toBe(true);
      expect(await screen.findByText('Showing 1 to 2 of 120 pages')).toBeInTheDocument();
    });

    it('when the sort changes', async () => {
      const { user } = await onSecondPage(OPEN.searchParams, <AddressButton name="sort" value="path" />);
      await user.click(screen.getByRole('button', { name: 'Set sort' }));
      await waitFor(() => expect(asked.at(-1)?.searchParams.get('sort')).toBe('path'));
      expect(asked.every((url) => url.searchParams.get('cursor') === null)).toBe(true);
      expect(await screen.findByText('Showing 1 to 2 of 120 pages')).toBeInTheDocument();
    });

    it('when the check changes', async () => {
      const { user } = await onSecondPage(OPEN.searchParams, <AddressButton name="check" value="title-long" />);
      await user.click(screen.getByRole('button', { name: 'Set check' }));
      await waitFor(() => expect(asked.at(-1)?.searchParams.get('filter[issue]')).toBe('title-long'));
      expect(asked.every((url) => url.searchParams.get('cursor') === null)).toBe(true);
      expect(await screen.findByText('Showing 1 to 2 of 120 pages')).toBeInTheDocument();
    });

    it('when the API refuses the cursor, which a newer crawl makes invalid', async () => {
      server.use(
        http.get(PAGES, ({ request }) => {
          const url = new URL(request.url);
          asked.push(url);
          if (url.searchParams.get('cursor') === 'c2') return problem(request, 'invalid_cursor');
          return HttpResponse.json({
            data: BROKEN,
            page: { has_more: true, limit: 50, next_cursor: 'c2' },
            meta: { run_id: MOCK_RUN_ID, scope: 'all', total: 120, links_available: true },
          });
        }),
      );
      const { user } = await openCheck();
      await user.click(screen.getByRole('button', { name: 'Next page' }));
      await waitFor(() => expect(asked.some((url) => url.searchParams.get('cursor') === 'c2')).toBe(true));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Previous page' })).toHaveAttribute('aria-disabled', 'true'),
      );
      expect(screen.getByText('Showing 1 to 2 of 120 pages')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Next page' })).not.toHaveAttribute('aria-disabled', 'true');
    });
  });

  it('keeps the first page of the next check from showing the rows of the one before', async () => {
    server.use(
      http.get(PAGES, async ({ request }) => {
        const url = new URL(request.url);
        const title = url.searchParams.get('filter[issue]') === 'title-long';
        if (title) await delay(300);
        return HttpResponse.json({
          data: title ? [rowOf('112', { status_code: 200 }, { count: 74 })] : BROKEN,
          page: { has_more: false, limit: 50, next_cursor: null },
          meta: { run_id: MOCK_RUN_ID, scope: 'all', total: title ? 1 : 2, links_available: true },
        });
      }),
    );
    const { user } = renderWithProviders(
      <>
        <AddressButton name="check" value="title-long" />
        {issuesAs('editor')}
      </>,
      OPEN,
    );
    await screen.findByRole('table', { name: /^Pages: / });
    expect(screen.getByText('Returns 404, linked from 1 page')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set check' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Titles over 60 characters' })).toBeInTheDocument();
    // Until the new answer arrives, nothing of the first check stands under the second check's name
    expect(screen.queryByText(/^Returns 404/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open /services' })).toBeNull();
    expect(await screen.findByText('74 characters')).toBeInTheDocument();
  });
});

describe('the address and the search of the open check', () => {
  it('writes q to the address and asks the API with it', async () => {
    const writes: string[] = [];
    server.use(answerPages((url) => (url.searchParams.get('q') === 'pric' ? [BROKEN[1] as PageRow] : BROKEN)));
    const view = renderWithProviders(issuesAs('editor'), {
      ...OPEN,
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await screen.findByRole('table', { name: /^Pages: / });
    await view.user.type(screen.getByRole('searchbox', { name: 'Search pages' }), 'pric');
    await waitFor(() => expect(writes.at(-1)).toBe('?check=status-4xx&q=pric'));
    await waitFor(() => expect(asked.at(-1)?.searchParams.get('q')).toBe('pric'));
    expect(await screen.findByText('Showing 1 to 1 of 1 page')).toBeInTheDocument();
  });

  it('shows No pages match with Clear search for a search with no answer, and clears it', async () => {
    const writes: string[] = [];
    server.use(answerPages((url) => (url.searchParams.get('q') === null ? BROKEN : [])));
    const { user } = renderWithProviders(issuesAs('editor'), {
      searchParams: '?check=status-4xx&q=zzz',
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    expect(await screen.findByRole('heading', { name: 'No pages match' })).toBeInTheDocument();
    expect(screen.getByText('Change the search.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(writes.at(-1)).toBe('?check=status-4xx'));
    expect(await screen.findByRole('table', { name: /^Pages: / })).toBeInTheDocument();
  });

  it('clears the check, the search and the sort with All issues, and shows the list again', async () => {
    const writes: string[] = [];
    const { user } = renderWithProviders(issuesAs('editor'), {
      searchParams: '?check=status-4xx&q=ser&sort=path',
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await screen.findByRole('table', { name: /^Pages: / });
    await user.click(screen.getByRole('button', { name: 'All issues' }));
    await waitFor(() => expect(writes.at(-1)).toBe(''));
    expect(await screen.findByRole('table', { name: 'Technical checks' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Measures' })).toBeInTheDocument();
  });

  it('keeps the tab of the check when going back to all issues', async () => {
    const writes: string[] = [];
    const { user } = renderWithProviders(issuesAs('editor'), {
      searchParams: '?check=title-long&q=a',
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await screen.findByRole('table', { name: /^Pages: / });
    await user.click(screen.getByRole('button', { name: 'All issues' }));
    await waitFor(() => expect(writes.at(-1)).toBe('?tab=on-page'));
    expect(await screen.findByRole('table', { name: 'On-page checks' })).toBeInTheDocument();
  });

  it('shows the list for a check that did not run or that does not exist', async () => {
    const unknown = renderWithProviders(issuesAs('editor'), { searchParams: '?check=nope' });
    expect(await screen.findByRole('table', { name: 'Technical checks' })).toBeInTheDocument();
    unknown.unmount();
    renderWithProviders(issuesAs('editor'), { searchParams: '?check=cited-page-broken' });
    expect(await screen.findByRole('table', { name: 'Technical checks' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /^Pages: / })).toBeNull();
  });
});

describe('the states of the open check (spec 7.4)', () => {
  it('shows skeleton rows and no spinner while the pages load', async () => {
    server.use(
      http.get(PAGES, async () => {
        await delay(150);
        return HttpResponse.json({
          data: BROKEN,
          page: { has_more: false, limit: 50, next_cursor: null },
          meta: { run_id: MOCK_RUN_ID, scope: 'all', total: 2, links_available: true },
        });
      }),
    );
    renderWithProviders(issuesAs('editor'), OPEN);
    expect(await screen.findByRole('heading', { level: 2, name: 'Pages that return a 4xx error' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('table', { name: /^Pages: / })).toBeNull();
    expect(await screen.findByRole('table', { name: /^Pages: / })).toBeInTheDocument();
  });

  it('says the pages could not be loaded, with Try again, and reads them again', async () => {
    let calls = 0;
    server.use(
      http.get(PAGES, ({ request }) => {
        calls += 1;
        if (calls === 1) return problem(request, 'internal_error');
        return HttpResponse.json({
          data: BROKEN,
          page: { has_more: false, limit: 50, next_cursor: null },
          meta: { run_id: MOCK_RUN_ID, scope: 'all', total: 2, links_available: true },
        });
      }),
    );
    const { user } = renderWithProviders(issuesAs('editor'), OPEN);
    expect(await screen.findByText('The pages could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Pages that return a 4xx error' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: /^Pages: / })).toBeInTheDocument();
  });

  it('says the links of the crawl are not stored, with no Try again, when the API says they are gone', async () => {
    server.use(http.get(PAGES, ({ request }) => problem(request, 'links_dropped')));
    renderWithProviders(issuesAs('editor'), OPEN);
    expect(await screen.findByRole('heading', { name: 'Links of this crawl are not stored' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByText('The pages could not be loaded')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Pages that return a 4xx error' })).toBeInTheDocument();
  });

  it('says that no pages have the issue for a check that ran and passed, with a way back to all issues', async () => {
    server.use(answerPages(() => []));
    const { user } = renderWithProviders(issuesAs('editor'), { searchParams: '?check=status-5xx' });
    expect(await screen.findByRole('heading', { name: 'No pages have this issue' })).toBeInTheDocument();
    expect(screen.getByText('The check ran on this crawl and passed.')).toBeInTheDocument();
    const back = screen.getAllByRole('button', { name: 'All issues' });
    expect(back).toHaveLength(2);
    await user.click(back[1] as HTMLElement);
    expect(await screen.findByRole('table', { name: 'Technical checks' })).toBeInTheDocument();
  });
});

describe('opening a page and exporting', () => {
  it('opens the page inspector from a click on the row', async () => {
    const writes: string[] = [];
    const { user, table } = await (async () => {
      const view = renderWithProviders(issuesAs('editor'), {
        ...OPEN,
        onUrlUpdate: ({ queryString }) => writes.push(queryString),
      });
      return { ...view, table: await screen.findByRole('table', { name: /^Pages: / }) };
    })();
    await user.click(cellsOf(bodyRow(table, '/services'))[FOUND] as HTMLElement);
    await waitFor(() => expect(writes.at(-1)).toContain('inspect=page:102'));
    expect(await screen.findByRole('complementary', { name: '/services' })).toBeInTheDocument();
  });

  it('opens it from the button of the first cell with the keyboard, named Open and the path', async () => {
    const writes: string[] = [];
    const view = renderWithProviders(issuesAs('editor'), {
      ...OPEN,
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    const table = await screen.findByRole('table', { name: /^Pages: / });
    const button = within(table).getByRole('button', { name: 'Open /pricing' });
    expect(button.closest('th')).toHaveAttribute('scope', 'row');
    button.focus();
    await view.user.keyboard('{Enter}');
    await waitFor(() => expect(writes.at(-1)).toContain('inspect=page:108'));
    expect(await screen.findByRole('complementary', { name: '/pricing' })).toBeInTheDocument();
  });

  it('shows the page the address names in the inspector, and marks its row', async () => {
    renderWithProviders(issuesAs('editor'), { searchParams: '?check=status-4xx&inspect=page:108' });
    expect(await screen.findByRole('complementary', { name: '/pricing' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: /^Pages: / });
    expect(bodyRow(table, '/pricing')).toHaveAttribute('aria-current', 'true');
    expect(bodyRow(table, '/services')).not.toHaveAttribute('aria-current');
  });

  it('downloads the CSV of the check, the search and the sort with Export, and says so when it fails', async () => {
    const { user } = renderWithProviders(issuesAs('editor'), { searchParams: '?check=status-4xx&q=ser&sort=path' });
    await screen.findByRole('table', { name: /^Pages: / });
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(downloadApiFile).toHaveBeenCalledWith(
      PAGES_PATH,
      expect.objectContaining({ 'filter[issue]': 'status-4xx', q: 'ser', sort: 'path', format: 'csv' }),
      'issue-pages.csv',
    );
    vi.mocked(downloadApiFile).mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'Export' }));
    // The toast and the live region both carry it
    expect((await screen.findAllByText('The file could not be made. Try again in a moment.')).length).toBeGreaterThan(
      0,
    );
  });

  it('exports in the default sort when the address names none', async () => {
    const { user } = await openCheck();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(downloadApiFile).toHaveBeenCalledWith(
      PAGES_PATH,
      expect.objectContaining({ 'filter[issue]': 'status-4xx', sort: '-clicks', format: 'csv' }),
      'issue-pages.csv',
    );
    expect(vi.mocked(downloadApiFile).mock.calls[0]?.[1]).not.toHaveProperty('q');
  });

  it('exports in the sort by address when Search Console is not connected', async () => {
    server.use(answerIssues(issueList(ISSUE_CHECKS, { state: 'not_connected', window_start: null, window_end: null })));
    const { user } = await openCheck();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(downloadApiFile).toHaveBeenCalledWith(
      PAGES_PATH,
      expect.objectContaining({ sort: 'path' }),
      'issue-pages.csv',
    );
  });

  it('exports what the box shows when the search was typed a moment ago and is not in the address yet', async () => {
    const { user } = await openCheck();
    await user.type(screen.getByRole('searchbox', { name: 'Search pages' }), ' pric ');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(downloadApiFile).toHaveBeenCalledWith(PAGES_PATH, expect.objectContaining({ q: 'pric' }), 'issue-pages.csv');
  });

  it('offers no Export when the pages could not be loaded', async () => {
    server.use(http.get(PAGES, ({ request }) => problem(request, 'internal_error')));
    renderWithProviders(issuesAs('editor'), OPEN);
    expect(await screen.findByText('The pages could not be loaded')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
  });
});

describe('the inspector of the open check', () => {
  const openRow = async (path: string) => {
    const view = renderWithProviders(issuesAs('editor'), OPEN);
    const table = await screen.findByRole('table', { name: /^Pages: / });
    within(table)
      .getByRole('button', { name: `Open ${path}` })
      .focus();
    await view.user.keyboard('{Enter}');
    const panel = await screen.findByRole('complementary', { name: path });
    await waitFor(() => expect(panel).toContainElement(document.activeElement as HTMLElement));
    return { ...view, table, panel };
  };

  it('opens with Enter on the page button of a row', async () => {
    const { panel } = await openRow('/pricing');
    expect(panel).toBeInTheDocument();
  });

  // A page that opened its own inspector closes it with history.back(), which jsdom does not follow, so the address
  // names the page: the inspector then closes by replacing the address, as it does for a shared link
  it('returns focus to the page button of the row when Escape closes it', async () => {
    const { user } = renderWithProviders(issuesAs('editor'), { searchParams: '?check=status-4xx&inspect=page:108' });
    const table = await screen.findByRole('table', { name: /^Pages: / });
    const panel = await screen.findByRole('complementary', { name: '/pricing' });
    await waitFor(() => expect(panel).toContainElement(document.activeElement as HTMLElement));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(within(table).getByRole('button', { name: 'Open /pricing' })).toHaveFocus();
    expect(bodyRow(table, '/pricing')).not.toHaveAttribute('aria-current');
  });

  it('returns focus to the title when the row is not on this page of the check', async () => {
    server.use(answerPages(() => [BROKEN[0] as PageRow]));
    const { user } = renderWithProviders(issuesAs('editor'), { searchParams: '?check=status-4xx&inspect=page:108' });
    await screen.findByRole('table', { name: /^Pages: / });
    const panel = await screen.findByRole('complementary', { name: '/pricing' });
    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(screen.getByRole('heading', { level: 2, name: 'Pages that return a 4xx error' })).toHaveFocus();
  });

  it('scrolls the row in view when the inspector opens and when J and K step to another row', async () => {
    const { user, table } = await openRow('/services');
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(bodyRow(table, '/services'));
    await user.keyboard('j');
    await waitFor(() => expect(bodyRow(table, '/pricing')).toHaveAttribute('aria-current', 'true'));
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(bodyRow(table, '/pricing'));
    await user.keyboard('k');
    await waitFor(() => expect(bodyRow(table, '/services')).toHaveAttribute('aria-current', 'true'));
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(bodyRow(table, '/services'));
  });

  it('keeps the open row where it is, and says so, when J or K go past the ends of the page', async () => {
    const writes: string[] = [];
    const { user } = renderWithProviders(issuesAs('editor'), {
      searchParams: '?check=status-4xx&inspect=page:108',
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    const table = await screen.findByRole('table', { name: /^Pages: / });
    const panel = await screen.findByRole('complementary', { name: '/pricing' });
    await waitFor(() => expect(panel).toContainElement(document.activeElement as HTMLElement));
    await user.keyboard('j');
    await waitFor(() =>
      expect(document.getElementById('live-region-polite')).toHaveTextContent('Last page in this list'),
    );
    expect(writes).toEqual([]);
    expect(bodyRow(table, '/pricing')).toHaveAttribute('aria-current', 'true');
    await user.keyboard('k');
    await waitFor(() => expect(bodyRow(table, '/services')).toHaveAttribute('aria-current', 'true'));
    await user.keyboard('k');
    await waitFor(() =>
      expect(document.getElementById('live-region-polite')).toHaveTextContent('First page in this list'),
    );
  });

  it('links View all in Links to Internal links, without the inspector keys in the address', async () => {
    const { user, panel } = await openRow('/pricing');
    // The linking pages are in the Links tab of the Pages drawer
    await user.click(within(panel).getByRole('tab', { name: 'Links' }));
    const heading = await within(panel).findByRole('heading', { name: /^Linking pages \(\d+\)$/ });
    const link = within(heading.closest('section') as HTMLElement).getByRole('link', { name: 'View all in Links' });
    expect(link).toHaveAttribute('href', '/digibranders/eventus-security/seo/internal-links?tab=links&tgt=108');
  });
});

describe('where focus goes', () => {
  it('takes focus to the title of a check that opens from the list', async () => {
    const { user } = renderWithProviders(issuesAs('editor'));
    await user.click(await screen.findByRole('button', { name: 'Open Pages that return a 4xx error' }));
    const title = await screen.findByRole('heading', { level: 2, name: 'Pages that return a 4xx error' });
    expect(title).toHaveAttribute('tabindex', '-1');
    expect(title).toHaveFocus();
  });

  it('takes focus to the title of a check a shared link opens', async () => {
    await openCheck();
    expect(screen.getByRole('heading', { level: 2, name: 'Pages that return a 4xx error' })).toHaveFocus();
  });

  it('leaves focus in the inspector when a shared link opens the inspector with the check', async () => {
    renderWithProviders(issuesAs('editor'), { searchParams: '?check=status-4xx&inspect=page:108' });
    const panel = await screen.findByRole('complementary', { name: '/pricing' });
    await screen.findByRole('table', { name: /^Pages: / });
    expect(panel).toContainElement(document.activeElement as HTMLElement);
  });

  it('returns to the check just left when All issues is pressed', async () => {
    const { user } = await openCheck();
    await user.click(screen.getByRole('button', { name: 'All issues' }));
    await screen.findByRole('table', { name: 'Technical checks' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open Pages that return a 4xx error' })).toHaveFocus(),
    );
  });

  it('returns to the page heading when a filter hides the check just left', async () => {
    const { user } = renderWithProviders(issuesAs('editor'), { searchParams: '?check=status-4xx&severity=warning' });
    await screen.findByRole('table', { name: /^Pages: / });
    await user.click(screen.getByRole('button', { name: 'All issues' }));
    await screen.findByRole('table', { name: 'Technical checks' });
    expect(screen.queryByRole('button', { name: 'Open Pages that return a 4xx error' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Issues' })).toHaveFocus());
  });
});

describe('the count of pages after a search is spoken', () => {
  const wait = (ms: number): Promise<void> =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const answerSearch = (rows: readonly PageRow[]): void =>
    server.use(answerPages((url) => (url.searchParams.get('q') === null ? BROKEN : rows)));

  it('says nothing on load, then how many pages match 500 ms after the answer, once', async () => {
    answerSearch([BROKEN[1] as PageRow]);
    const { user } = await openCheck();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await wait(1_000);
    expect(announce).not.toHaveBeenCalledWith(expect.stringMatching(/^Showing/), expect.anything());
    await user.type(screen.getByRole('searchbox', { name: 'Search pages' }), 'pric');
    await screen.findByText('Showing 1 to 1 of 1 page');
    await wait(300);
    expect(announce).not.toHaveBeenCalledWith('Showing 1 page', expect.anything());
    await wait(400);
    expect(announce).toHaveBeenCalledWith('Showing 1 page', { key: 'issues-pages-results' });
    expect(vi.mocked(announce).mock.calls.filter(([text]) => text === 'Showing 1 page')).toHaveLength(1);
    expect(document.getElementById('live-region-polite')).toHaveTextContent('Showing 1 page');
  });

  it('says No pages match for a search with no answer', async () => {
    answerSearch([]);
    const { user } = await openCheck();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await user.type(screen.getByRole('searchbox', { name: 'Search pages' }), 'zzz');
    await screen.findByRole('heading', { name: 'No pages match' });
    await wait(1_000);
    expect(announce).toHaveBeenCalledWith('No pages match', { key: 'issues-pages-results' });
  });

  it('says nothing for a move to another page of the same answer', async () => {
    server.use(
      answerPages((url) => (url.searchParams.get('cursor') === 'c2' ? [BROKEN[1] as PageRow] : BROKEN), {
        next: 'c2',
        total: 120,
      }),
    );
    const { user } = await openCheck();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('Showing 51 to 51 of 120 pages');
    await wait(1_000);
    expect(announce).not.toHaveBeenCalledWith(expect.stringMatching(/^(Showing|No pages)/), {
      key: 'issues-pages-results',
    });
  });
});

describe('the cells of a page row', () => {
  it('says why a page has no clicks in neutral words when Search Console gave no block or no number', async () => {
    server.use(
      answerPages(() => [
        { ...(BROKEN[0] as PageRow), extras: { issue: { count: 2 } } },
        rowOf('108', { status_code: 404 }, { count: 1 }, { ...GSC_OK, state: 'ok', clicks: null }),
      ]),
    );
    const { table } = await openCheck();
    for (const path of ['/services', '/pricing']) {
      const cell = within(cellsOf(bodyRow(table, path))[CLICKS] as HTMLElement).getByText('n/a');
      expect(cell).toHaveAccessibleDescription('Not available for this page');
    }
  });

  it('shows n/a with a tooltip for a page that has no status', async () => {
    server.use(answerPages(() => [rowOf('102', { status_code: null }, { count: 2 })]));
    const { table } = await openCheck();
    const status = within(cellsOf(bodyRow(table, '/services'))[STATUS] as HTMLElement).getByText('n/a');
    expect(status).toHaveAccessibleDescription('No status for this page');
  });
});

describe('a refetch that keeps the previous rows', () => {
  it('marks the pages busy, with the static bar and no dimming, until the answer to a new search arrives', async () => {
    server.use(
      http.get(PAGES, async ({ request }) => {
        const url = new URL(request.url);
        const searching = url.searchParams.get('q') !== null;
        if (searching) await delay(400);
        return HttpResponse.json({
          data: searching ? [] : BROKEN,
          page: { has_more: false, limit: 50, next_cursor: null },
          meta: { run_id: MOCK_RUN_ID, scope: 'all', total: searching ? 0 : 2, links_available: true },
        });
      }),
    );
    const { user, table } = await openCheck();
    await user.type(screen.getByRole('searchbox', { name: 'Search pages' }), 'zzz');
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
    const busy = document.querySelector('[aria-busy="true"]') as HTMLElement;
    // The old rows stay on screen at full strength
    expect(busy).toContainElement(table);
    expect(busy.querySelector('[class*="opacity"]')).toBeNull();
    await waitFor(() => expect(document.querySelector('[data-slot="refetch-bar"]')).not.toBeNull());
    expect(await screen.findByRole('heading', { name: 'No pages match' })).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(document.querySelector('[data-slot="refetch-bar"]')).toBeNull();
  });
});

describe('the markup and the accessibility of the open check', () => {
  it('writes no error while it renders: the table markup is valid', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { table } = await openCheck();
    table.querySelectorAll('tr').forEach((tr) => {
      expect(Array.from(tr.children).every((child) => child.tagName === 'TH' || child.tagName === 'TD')).toBe(true);
    });
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('has no axe violation with pages', async () => {
    const { container } = await openCheck();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violation in its error state', async () => {
    server.use(http.get(PAGES, ({ request }) => problem(request, 'internal_error')));
    const { container } = renderWithProviders(issuesAs('editor'), OPEN);
    await screen.findByText('The pages could not be loaded');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violation in its empty state', async () => {
    server.use(answerPages(() => []));
    const { container } = renderWithProviders(issuesAs('editor'), { searchParams: '?check=status-5xx' });
    await screen.findByRole('heading', { name: 'No pages have this issue' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
