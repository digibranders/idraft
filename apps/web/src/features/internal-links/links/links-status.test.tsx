import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadApiFile } from '@/lib/api/download';
import type { ChangeLinkPage } from '@/lib/internal-links/types';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { changePage } from '@/mocks/internal-links-changes-world';
import { edgeRows, EVENTUS, HISTORY_RUN_IDS, MOCK_RUN_ID, setLinksScenario } from '@/mocks/internal-links-world';
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

const CHANGES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/changes/links';
const CHANGE_LINKS = mswPath(CHANGES);
const PROBLEM = { 'content-type': 'application/problem+json' };
const LOST_TITLE = 'Lost links';

beforeEach(() => {
  stubWideScreen();
  vi.mocked(downloadApiFile).mockReset();
  vi.mocked(downloadApiFile).mockImplementation(() => Promise.resolve());
});
afterEach(() => {
  server.events.removeAllListeners();
  restoreWideScreen();
  document.documentElement.classList.remove('dark');
});

const open = (search: string): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: `?tab=links${search}` });
/** Every read the screen made has answered, so an absence is a result and not a read still on its way. */
const settled = (client: { isFetching: () => number }): Promise<void> =>
  waitFor(() => expect(client.isFetching()).toBe(0));
const grid = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Links' });
const statusButton = (): Promise<HTMLElement> => screen.findByRole('button', { name: /^Link status: / });

/** The query strings of the reads of the changes links the tab makes. */
function changeReads(): () => URLSearchParams[] {
  const seen: URLSearchParams[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/changes/links')) seen.push(url.searchParams);
  });
  return () => seen;
}

/** An added links answer holding the pair of the first editorial edge, and claiming `total` links in all. */
function addedAnswer(total: number): ChangeLinkPage {
  const [first] = edgeRows('editorial');
  if (first === undefined) throw new Error('The fixture has no edges');
  return {
    data: [
      {
        source: changePage(first.source.path),
        target: changePage(first.target.path),
        anchor: first.anchor,
        placement: 'content',
        priority: 'none',
        still_linked_by: null,
      },
    ],
    meta: {
      run_id: MOCK_RUN_ID,
      previous_run_id: null,
      change: 'added',
      link_scope: 'all',
      only: 'all',
      total,
      truncated: false,
    },
  };
}

describe('the Status menu of the Links tab', () => {
  it('offers Active, Lost since last crawl and All, and writes ls', async () => {
    const writes: string[] = [];
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: '?tab=links',
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await grid();
    await user.click(await screen.findByRole('button', { name: 'Link status: Active' }));
    expect(await screen.findByRole('menuitemradio', { name: 'Active' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'All' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitemradio', { name: 'Lost since last crawl' }));
    await waitFor(() => expect(writes.at(-1)).toContain('ls=lost'));
  });

  it('is not there for a first crawl, and the address ls reads as Active', async () => {
    setLinksScenario({ firstCrawl: true });
    const reads = changeReads();
    const { queryClient } = open('&ls=lost');
    await grid();
    await settled(queryClient);
    expect(screen.queryByRole('button', { name: /^Link status: / })).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: LOST_TITLE })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^Added/ })).not.toBeInTheDocument();
    // No added read is made without a comparison
    expect(reads().filter((search) => search.get('change') === 'added')).toEqual([]);
  });

  it('is not there when the comparison is unavailable', async () => {
    setLinksScenario({ enrich: 'failed' });
    const { queryClient } = open('');
    await grid();
    await settled(queryClient);
    expect(screen.queryByRole('button', { name: /^Link status: / })).not.toBeInTheDocument();
  });
});

describe('the Added column', () => {
  it('marks a link the added list holds with This crawl, and says nothing of the others', async () => {
    server.use(http.get(CHANGE_LINKS, () => HttpResponse.json(addedAnswer(1))));
    open('');
    const table = await grid();
    expect(await within(table).findByRole('columnheader', { name: /^Added/ })).toBeInTheDocument();
    const marked = await within(table).findAllByRole('gridcell', { name: 'This crawl' });
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.length).toBeLessThan(within(table).getAllByRole('rowheader').length);
    // The whole answer was read, so the header makes no claim about a cut list
    expect(within(table).getByRole('columnheader', { name: /^Added/ })).not.toHaveAccessibleDescription(/Marked for/);
  });

  it('says in the header that only the first 200 added links mark rows when there are more', async () => {
    server.use(http.get(CHANGE_LINKS, () => HttpResponse.json(addedAnswer(450))));
    open('');
    const table = await grid();
    await within(table).findAllByRole('gridcell', { name: 'This crawl' });
    expect(await within(table).findByRole('columnheader', { name: /^Added/ })).toHaveAccessibleDescription(
      'Marked for the first 200 of 450 added links',
    );
  });

  it('says in the header that no link is marked when the added list cannot be read', async () => {
    server.use(
      http.get(CHANGE_LINKS, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Broken', status: 500, code: 'internal_error' },
          {
            status: 500,
            headers: PROBLEM,
          },
        ),
      ),
    );
    open('');
    const table = await grid();
    await waitFor(() =>
      expect(within(table).getByRole('columnheader', { name: /^Added/ })).toHaveAccessibleDescription(
        'The list of added links could not be read, so no link is marked.',
      ),
    );
  });

  it('is not drawn when the earlier crawl kept no links', async () => {
    const { queryClient } = open(`&run=${HISTORY_RUN_IDS[3] ?? ''}`);
    const table = await grid();
    await settled(queryClient);
    expect(within(table).queryByRole('columnheader', { name: /^Added/ })).not.toBeInTheDocument();
  });
});

describe('the Lost and All views', () => {
  it('shows the lost links with Lost on and their count, and no Lost and Added switch', async () => {
    open('&ls=lost');
    const table = await screen.findByRole('table', { name: LOST_TITLE });
    expect(within(table).getByRole('columnheader', { name: 'Lost on' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(1);
    expect(await screen.findByRole('button', { name: 'Link status: Lost since last crawl' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Added' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Show lost or added links' })).not.toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: 'Links' })).not.toBeInTheDocument();
  });

  it('shows both under their headings for All', async () => {
    open('&ls=all');
    expect(await screen.findByRole('heading', { name: 'Links in this crawl' })).toBeInTheDocument();
    expect(await grid()).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: LOST_TITLE })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: LOST_TITLE })).toBeInTheDocument();
  });

  it('reads the Links scope as the lost scope: editorial stays editorial, any other reads all links', async () => {
    const reads = changeReads();
    open('&ls=lost&scope=template');
    await screen.findByRole('table', { name: LOST_TITLE });
    expect(
      reads()
        .filter((search) => search.get('change') === 'lost')
        .at(-1)
        ?.get('link_scope'),
    ).toBe('all');
  });

  it('says so instead of an empty list when the previous crawl kept no links', async () => {
    const reads = changeReads();
    open(`&ls=lost&run=${HISTORY_RUN_IDS[3] ?? ''}`);
    expect(
      await screen.findByText(
        'The links of the previous crawl are not stored, so there is nothing to compare the links with.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: LOST_TITLE })).not.toBeInTheDocument();
    expect(reads().filter((search) => search.get('change') === 'lost')).toEqual([]);
  });

  it('shows the links dropped state when the lost read answers 410', async () => {
    server.use(
      http.get(CHANGE_LINKS, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Gone', status: 410, code: 'links_dropped' },
          { status: 410, headers: PROBLEM },
        ),
      ),
    );
    open('&ls=lost');
    expect(await screen.findByText('Links of this crawl are not stored')).toBeInTheDocument();
  });

  it('exports the lost links as the table shows them', async () => {
    const { user } = open('&ls=lost');
    await screen.findByRole('table', { name: LOST_TITLE });
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export this tab (CSV)' }));
    await waitFor(() => expect(downloadApiFile).toHaveBeenCalledTimes(1));
    expect(downloadApiFile).toHaveBeenCalledWith(
      `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS.project_id}/internal-links/changes/links`,
      { change: 'lost', link_scope: 'editorial', only: 'all', format: 'csv' },
      'internal-links-lost-links.csv',
    );
  });

  it.each(['light', 'dark'])(
    'has no axe violations in the %s theme, the Status menu open and closed',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container, user } = open('&ls=all');
      await screen.findByRole('table', { name: LOST_TITLE });
      expect(await axe(container)).toHaveNoViolations();
      await user.click(await statusButton());
      await screen.findByRole('menuitemradio', { name: 'Active' });
      expect(await axe(document.body)).toHaveNoViolations();
    },
  );
});
