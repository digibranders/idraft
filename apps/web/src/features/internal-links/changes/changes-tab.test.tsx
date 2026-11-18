import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadApiFile } from '@/lib/api/download';
import type { ChangeLink, ChangeLinkPage, ChangesSummary, MovedPageList } from '@/lib/internal-links/types';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { EVENTUS, HISTORY_RUN_IDS, MOCK_RUN_ID, setLinksScenario } from '@/mocks/internal-links-world';
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

const BASE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/changes';
const LINKS = mswPath(`${BASE}/links`);
const SUMMARY = mswPath(`${BASE}/summary`);
const PAGES = mswPath(`${BASE}/pages`);
const CHANGES_PATH = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS.project_id}/internal-links/changes/links`;
const OLDEST = HISTORY_RUN_IDS[4];
const PROBLEM = { 'content-type': 'application/problem+json' };

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

const open = (search = ''): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: `?tab=changes${search}` });

const linksTable = (): Promise<HTMLElement> => screen.findByRole('table', { name: 'Lost links' });

/** The query strings of the reads of one changes route the tab makes. */
function reads(route: string): () => URLSearchParams[] {
  const seen: URLSearchParams[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith(route)) seen.push(url.searchParams);
  });
  return () => seen;
}

/** A worked out comparison with no link changes, against the crawl past the last four (whose links are dropped). */
const EMPTY_READY: ChangesSummary = {
  run_id: MOCK_RUN_ID,
  previous_run_id: OLDEST ?? '',
  previous_finished_at: '2026-10-17T03:12:00Z',
  state: 'ready',
  editorial_lost: 0,
  editorial_added: 0,
  all_lost: 0,
  all_added: 0,
  lost_to_top: 0,
  important_max_position: 2,
  pages_added: 1,
  pages_lost: 0,
  alert: null,
};

const ROW: ChangeLink = {
  source: { url_id: '11', url: 'https://eventussecurity.com/a', path: '/a', tier: null },
  target: { url_id: '12', url: 'https://eventussecurity.com/b', path: '/b', tier: null },
  anchor: 'an anchor',
  placement: 'content',
  priority: 'lower',
  still_linked_by: null,
};

/** 120 rows, served by the offset and limit the tab asks for. */
function manyRows(): void {
  const all = Array.from({ length: 120 }, (_, index) => ({ ...ROW, anchor: `anchor ${String(index + 1)}` }));
  server.use(
    http.get(LINKS, ({ request }) => {
      const query = new URL(request.url).searchParams;
      const offset = Number(query.get('offset') ?? 0);
      const limit = Number(query.get('limit') ?? 50);
      const page: ChangeLinkPage = {
        data: all.slice(offset, offset + limit),
        meta: {
          run_id: MOCK_RUN_ID,
          previous_run_id: null,
          change: 'lost',
          link_scope: 'editorial',
          only: 'all',
          total: all.length,
          truncated: false,
        },
      };
      return HttpResponse.json(page);
    }),
  );
}

describe('the Changes tab (spec 7.10)', () => {
  it('shows the alert first, then the counts, with no way to equity', async () => {
    const { container } = open();
    const alert = await screen.findByText(/editorial links? to T1 and T2 pages (was|were) lost since/);
    expect(alert).toHaveTextContent('Alert shown in the app');
    const strip = await screen.findByRole('group', { name: 'Changes since the last crawl' });
    for (const label of ['Editorial links lost', 'Editorial links added', 'Pages added', 'Pages lost']) {
      expect(within(strip).getByText(label)).toBeInTheDocument();
    }
    expect(alert.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await linksTable();
    expect(container.textContent?.toLowerCase()).not.toContain('equity');
    const names = [...container.querySelectorAll('[aria-label]')].map((node) => node.getAttribute('aria-label'));
    expect(names.join(' ').toLowerCase()).not.toContain('equity');
  });

  it('lists the lost links, the most important first, with the priority and where they are still linked', async () => {
    const asked = reads('/changes/links');
    open();
    const table = await linksTable();
    expect(await within(table).findAllByText('Lost to T1')).not.toHaveLength(0);
    expect(within(table).getByText('Still linked from Navigation')).toBeInTheDocument();
    expect(within(table).getAllByText('No longer linked').length).toBeGreaterThan(0);
    for (const name of [
      'Source page',
      'Source tier',
      'Target page',
      'Target tier',
      'Anchor',
      'Link type',
      'Priority',
    ]) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    }
    const read = asked().at(-1);
    expect(read?.get('change')).toBe('lost');
    expect(read?.get('only')).toBe('top');
    expect(read?.get('link_scope')).toBe('editorial');
  });

  it('turns the important tiers filter off and reads every lost link', async () => {
    const asked = reads('/changes/links');
    const { user } = open();
    await linksTable();
    await user.click(screen.getByRole('switch', { name: 'Only to T1 and T2 pages' }));
    await waitFor(() => expect(asked().at(-1)?.get('only')).toBe('all'));
    expect(await screen.findByText('Lower priority')).toBeInTheDocument();
  });

  it('switches to the added links: no priority, no filter', async () => {
    const asked = reads('/changes/links');
    const { user } = open();
    await linksTable();
    await user.click(screen.getByRole('radio', { name: 'Added' }));
    const table = await screen.findByRole('table', { name: 'New links' });
    expect(within(table).queryByRole('columnheader', { name: 'Priority' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /Only to/ })).not.toBeInTheDocument();
    expect(asked().at(-1)?.get('change')).toBe('added');
    expect(asked().at(-1)?.get('only')).toBe('all');
  });

  it('reads the scope of the address and writes it from the menu', async () => {
    const asked = reads('/changes/links');
    const writes: string[] = [];
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: '?tab=changes&cs=all',
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await linksTable();
    expect(asked().at(-1)?.get('link_scope')).toBe('all');
    await user.click(screen.getByRole('button', { name: 'Link scope: All links' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Editorial' }));
    await waitFor(() => expect(writes.at(-1) ?? '').not.toContain('cs=all'));
  });

  it('pages by offset, and a new page size starts again at the first page', async () => {
    manyRows();
    const asked = reads('/changes/links');
    const { user } = open('&cs=all');
    expect(await screen.findByText('Showing 1 to 100 of 120')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Showing 101 to 120 of 120')).toBeInTheDocument();
    expect(asked().some((read) => read.get('offset') === '100')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(await screen.findByText('Showing 1 to 100 of 120')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('Showing 101 to 120 of 120');
    await user.click(screen.getByRole('combobox', { name: 'Rows per page' }));
    await user.click(await screen.findByRole('option', { name: '200 per page' }));
    expect(await screen.findByText('Showing 1 to 120 of 120')).toBeInTheDocument();
    expect(asked().at(-1)?.get('limit')).toBe('200');
    expect(asked().at(-1)?.get('offset')).toBe('0');
  });

  it('lists the pages that moved most, with the sign and the depth', async () => {
    const moved: MovedPageList = {
      data: [
        {
          page: { url_id: '21', url: 'https://eventussecurity.com/x', path: '/x', tier: null },
          depth: 3,
          depth_delta: 1,
          depth_state: null,
          editorial_in: 4,
          editorial_in_delta: 2,
          equity_points: 1.5,
        },
        {
          page: { url_id: '22', url: 'https://eventussecurity.com/y', path: '/y', tier: null },
          depth: null,
          depth_delta: null,
          depth_state: 'lost',
          editorial_in: 0,
          editorial_in_delta: -1,
          equity_points: null,
        },
      ],
      meta: { run_id: MOCK_RUN_ID, previous_run_id: null },
    };
    server.use(http.get(PAGES, () => HttpResponse.json(moved)));
    const { container } = open();
    const table = await screen.findByRole('table', { name: 'Pages that moved most' });
    expect(await within(table).findByText('+2')).toBeInTheDocument();
    expect(within(table).getByText('+1')).toBeInTheDocument();
    expect(within(table).getByText('No longer reachable')).toBeInTheDocument();
    expect(container.textContent).not.toContain('1.5');
  });

  it('says there is nothing to compare on a first crawl, with no Try again', async () => {
    setLinksScenario({ firstCrawl: true });
    open();
    expect(await screen.findByText('This is the first crawl.')).toBeInTheDocument();
    expect(screen.getByText('Changes appear after the next crawl.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Lost links' })).not.toBeInTheDocument();
  });

  it('says the comparison is being worked out and still lists what exists', async () => {
    setLinksScenario({ enrich: 'running' });
    open();
    expect(await screen.findByText('Working out what changed')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Changes since the last crawl' })).not.toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Pages that moved most' })).toBeInTheDocument();
  });

  it('says the comparison could not be worked out, with no Try again', async () => {
    setLinksScenario({ enrich: 'failed' });
    open();
    expect(await screen.findByText('Changes could not be worked out for this crawl')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('does not say "no changes" when the previous crawl had no links to compare', async () => {
    server.use(http.get(SUMMARY, () => HttpResponse.json({ data: EMPTY_READY })));
    open();
    expect(await screen.findByText(/The links of the previous crawl are not stored/)).toBeInTheDocument();
  });

  it('shows the links of this crawl are not stored for a crawl past the last four, and reads no links', async () => {
    // The oldest crawl of the mock has no crawl before it, so its summary is given a comparison here
    server.use(http.get(SUMMARY, () => HttpResponse.json({ data: { ...EMPTY_READY, run_id: OLDEST } })));
    const asked = reads('/changes/links');
    open(`&run=${OLDEST ?? ''}`);
    expect(await screen.findByText('Links of this crawl are not stored')).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Pages that moved most' })).toBeInTheDocument();
    expect(asked()).toEqual([]);
  });

  it('shows the same state when the links read answers 410', async () => {
    server.use(
      http.get(LINKS, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Gone', status: 410, code: 'links_dropped' },
          { status: 410, headers: PROBLEM },
        ),
      ),
    );
    open();
    expect(await screen.findByText('Links of this crawl are not stored')).toBeInTheDocument();
  });

  it('shows an error with Try again when the summary cannot be read', async () => {
    let fail = true;
    server.use(
      http.get(SUMMARY, () =>
        fail
          ? HttpResponse.json(
              { type: 'about:blank', title: 'Server error', status: 500 },
              { status: 500, headers: PROBLEM },
            )
          : undefined,
      ),
    );
    const { user } = open();
    expect(await screen.findByText('The changes could not be loaded')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await linksTable()).toBeInTheDocument();
  });

  it('shows the table error with Try again when the links cannot be read', async () => {
    server.use(
      http.get(LINKS, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Server error', status: 500 },
          { status: 500, headers: PROBLEM },
        ),
      ),
    );
    open();
    expect(await screen.findByText('The lost links could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says nothing was lost, and offers every lost link when only the lower tiers lost some', async () => {
    const empty = (only: string): ChangeLinkPage => ({
      data: [],
      meta: {
        run_id: MOCK_RUN_ID,
        previous_run_id: null,
        change: 'lost',
        link_scope: 'editorial',
        only: only === 'top' ? 'top' : 'all',
        total: 0,
        truncated: false,
      },
    });
    server.use(
      http.get(LINKS, ({ request }) =>
        HttpResponse.json(empty(new URL(request.url).searchParams.get('only') ?? 'all')),
      ),
    );
    const { user } = open();
    expect(await screen.findByText(/No lost link points to T1 and T2 pages/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all lost links' }));
    expect(await screen.findByText(/No editorial links were lost/)).toBeInTheDocument();
  });

  it('opens the inspector on the source page of a row', async () => {
    const writes: string[] = [];
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: '?tab=changes',
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    const table = await linksTable();
    const [first] = await within(table).findAllByRole('button', { name: /^\// });
    if (first === undefined) throw new Error('The table has no page buttons');
    await user.click(first);
    await waitFor(() => expect(writes.some((query) => query.includes('inspect=page'))).toBe(true));
  });

  it('exports the view as the server CSV with no window, and never asks for equity', async () => {
    const { user } = open();
    await linksTable();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export this tab (CSV)' }));
    await waitFor(() => expect(downloadApiFile).toHaveBeenCalledTimes(1));
    const [path, query, name] = vi.mocked(downloadApiFile).mock.calls[0] ?? [];
    expect(path).toBe(CHANGES_PATH);
    expect(query).toEqual({ change: 'lost', link_scope: 'editorial', only: 'top', format: 'csv' });
    expect(name).toBe('internal-links-lost-links.csv');
    expect(JSON.stringify(query).toLowerCase()).not.toContain('equity');
  });

  it('starts no second download while one runs, and says why', async () => {
    let finish = (): void => undefined;
    vi.mocked(downloadApiFile).mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user } = open();
    await linksTable();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export this tab (CSV)' }));
    await user.click(screen.getByRole('button', { name: 'Export' }));
    const again = await screen.findByRole('menuitem', { name: /Export this tab \(CSV\)/ });
    expect(again).toHaveAttribute('aria-disabled', 'true');
    expect(again).toHaveTextContent('The export is being prepared');
    await user.keyboard('{Escape}');
    expect(downloadApiFile).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
      await Promise.resolve();
    });
  });

  it('toasts the problem when the export fails', async () => {
    const { ApiProblem } = await import('@/lib/api/problem');
    vi.mocked(downloadApiFile).mockRejectedValue(
      new ApiProblem({
        status: 500,
        code: 'export_failed',
        title: 'Export failed',
        detail: 'The file could not be built.',
        requestId: null,
        errors: [],
        retryAfterSeconds: null,
        body: { title: 'Export failed' },
      }),
    );
    const { user } = open();
    await linksTable();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export this tab (CSV)' }));
    expect(await screen.findAllByText('The export could not be made')).not.toHaveLength(0);
    expect(await screen.findAllByText('The file could not be built.')).not.toHaveLength(0);
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = open();
    await linksTable();
    await screen.findByRole('table', { name: 'Pages that moved most' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
