import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { Route } from 'next';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DrawerIssuesTab } from './drawer-issues-tab';

import { READ_LIMIT } from '@/lib/internal-links/journey-layout';
import type { PageIssue, Seam } from '@/lib/pages/issue-source';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import {
  crawledPage,
  EVENTUS,
  HISTORY_RUN_IDS,
  MOCK_RUN_ID,
  neighborsOf,
  pageRow,
  setLinksScenario,
} from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { chartSummaryText } from '@/test/chart-summary';
import { EVENTUS_LINKS } from '@/test/internal-links-harness';
import { mockBrowser } from '@/test/mock-api';
import { server } from '@/test/msw';
import { pagesAs } from '@/test/pages-harness';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/pages/all',
  useSearchParams: () => new URLSearchParams(),
}));

/** The Issues session's seam, which answers `unavailable` on this branch: a test sets it to see the other states. */
const seam = vi.hoisted(() => ({ current: { state: 'unavailable' } as Seam<readonly PageIssue[]> }));
vi.mock('@/lib/pages/issue-source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pages/issue-source')>()),
  usePageIssues: (): Seam<readonly PageIssue[]> => seam.current,
}));

/** The daily read answers `unavailable` only once the Search Console session's seam says so: a test forces it. */
const daily = vi.hoisted(() => ({ unavailable: false }));
vi.mock('@/lib/pages/search-daily', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/pages/search-daily')>();
  return {
    ...original,
    usePageSearchDaily: (
      ...args: Parameters<typeof original.usePageSearchDaily>
    ): ReturnType<typeof original.usePageSearchDaily> => {
      const read = original.usePageSearchDaily(...args);
      return daily.unavailable ? { state: 'unavailable' } : read;
    },
  };
});

/** The Search Console session's slot: a test turns its marker on to see where the tab draws it. */
const slot = vi.hoisted(() => ({ marker: false, props: [] as unknown[] }));
vi.mock('@/lib/pages/search-detail-slot', () => ({
  PageSearchDetailSlot: (props: unknown): ReactElement | null => {
    slot.props.push(props);
    return slot.marker ? <p>Slot marker</p> : null;
  },
}));

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const SEARCH = mswPath(`${P}/internal-links/pages/{url_id}/search`);
const DETAIL = mswPath(`${P}/internal-links/pages/{url_id}`);
const NEIGHBORS = mswPath(`${P}/internal-links/neighbors`);
const SUMMARY = mswPath(`${P}/internal-links/changes/summary`);
const RESET = mswPath(`${P}/pages/tiers/reset`);
const TAGS = mswPath(`${P}/pages/tags`);
const SERVER_ERROR = { type: 'about:blank', title: 'Server error', status: 500 };

beforeEach(() => {
  stubWideScreen();
  seam.current = { state: 'unavailable' };
  daily.unavailable = false;
  slot.marker = false;
  slot.props.length = 0;
});
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
  document.documentElement.classList.remove('dark');
});

/** Page 108 of the fixture crawl is /pricing: tiered by hand. */
const OPEN = { searchParams: 'inspect=page:108' };
/** The same page on one tab of the drawer. */
const openTab = (tab: string, extra = ''): { searchParams: string } => ({
  searchParams: `inspect=page:108&itab=${tab}${extra}`,
});
const LINKS = openTab('links');
/** A tab by its name: the Notes tab of the fixture page carries its count after the word. */
const tabNamed = (name: string): RegExp => new RegExp(`^${name}`);
const TAB_NAMES = ['Overview', 'Search', 'Outline', 'Issues', 'AI', 'Links', 'Notes'] as const;
/** The label of a tab without the unseen heavier copy that reserves its width. */
const tabLabel = (tab: HTMLElement): string => (tab.firstElementChild?.firstElementChild?.textContent ?? '').trim();
const selectedTab = (panel: HTMLElement): string | undefined => {
  const chosen = within(panel)
    .getAllByRole('tab')
    .find((tab) => tab.getAttribute('aria-selected') === 'true');
  return chosen === undefined ? undefined : tabLabel(chosen);
};
const panelOf = (name: string): Promise<HTMLElement> => screen.findByRole('complementary', { name });
type UrlUpdate = { queryString: string };
const lastQuery = (spy: ReturnType<typeof vi.fn>): string => (spy.mock.calls.at(-1)?.[0] as UrlUpdate).queryString;

/** A tag vocabulary with one term, made through the mock API (its state travels in cookies). */
async function makeTag(): Promise<void> {
  const jar = new Map<string, string>();
  const editor = mockBrowser('editor', jar);
  const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
  const vocabulary = await editor.call('POST', `${W}/vocabularies`, {
    kind: 'tag',
    name: 'Page tags',
    project_id: EVENTUS.project_id,
  });
  const vocabularyId = (vocabulary.body as { data: { vocabulary_id: string } }).data.vocabulary_id;
  await editor.call('POST', `${W}/vocabularies/${vocabularyId}/terms`, { name: 'Cornerstone' });
  for (const [name, value] of jar) document.cookie = `${name}=${value}; Path=/; Secure`;
}

/** The non-GET requests the page makes. */
function writes(): () => string[] {
  const seen: string[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method !== 'GET') seen.push(`${request.method} ${new URL(request.url).pathname}`);
  });
  return () => seen;
}

/** The page 108 read with some of its parts changed: the tiles then do not depend on the fixture's numbers. */
const withOverview = (page: Record<string, unknown>, gsc: Record<string, unknown>): void =>
  server.use(
    http.get(DETAIL, () =>
      HttpResponse.json({
        data: {
          page: {
            ...pageRow(crawledPage('108') as NonNullable<ReturnType<typeof crawledPage>>, 'editorial'),
            ...page,
          },
          linking_by_tier: [],
          linking_by_placement: [],
          top_anchors: [],
          links_available: true,
          linking_pages: [],
          outlinks: [],
          linking_pages_total: 0,
          outlinks_total: 0,
          notes_count: 0,
          extras: {
            anchors: { total: 0, distinct: 0, generic: 0, generic_share: 0, matches_keyword: null, top: [] },
            change: null,
            citations: { chatgpt: 1, gemini: 0, ai_mode: 0, total: 1 },
            gsc: { state: 'ok', clicks: 1240, impressions: 30500, window_start: null, window_end: null, ...gsc },
            keywords: [],
          },
        },
      }),
    ),
  );

describe('the page inspector (spec 7.4)', () => {
  it('shows the tier with its source, the strip, the linking pages and the flags, and no equity', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
    const panel = await panelOf('/pricing');
    expect(await within(panel).findByText(/^Manual, set by .+ on /)).toBeInTheDocument();
    await user.click(within(panel).getByRole('tab', { name: 'Links' }));
    expect(within(panel).getByRole('group', { name: 'Page summary' })).toHaveTextContent(/Depth\s*1/);
    expect(await within(panel).findByRole('heading', { name: /^Linking pages \(\d+\)$/ })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: /^Outlinks \(\d+\)$/ })).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Open in journey' })).toBeInTheDocument();
    expect(panel.textContent ?? '').not.toMatch(/equity/i);
    // Names and titles are read aloud too
    const attributes = [...panel.querySelectorAll('[aria-label], [title]')].map(
      (element) => `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''}`,
    );
    expect(attributes.join(' ')).not.toMatch(/equity/i);
  });

  it('lists the linking pages and the outlinks from the neighbors read, and opens one', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), LINKS);
    const panel = await panelOf('/pricing');
    const heading = await within(panel).findByRole('heading', { name: /^Linking pages \(\d+\)$/ });
    const section = heading.closest('section') as HTMLElement;
    const expected = neighborsOf('108', 'in', 'editorial').map((item) => item.path);
    for (const path of expected) expect(await within(section).findByRole('button', { name: path })).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: expected[0] ?? '' }));
    const opened = crawledPage(neighborsOf('108', 'in', 'editorial')[0]?.url_id ?? '');
    expect(await panelOf(opened?.path ?? '')).toBeInTheDocument();
  });

  it('shows more neighbors a read at a time', async () => {
    const base = pageRow(crawledPage('108') as NonNullable<ReturnType<typeof crawledPage>>, 'editorial');
    const [one] = neighborsOf('108', 'in', 'editorial');
    if (one === undefined) throw new Error('The fixture page has no linking page');
    const make = (offset: number, count: number): unknown[] =>
      Array.from({ length: count }, (_, index) => ({
        ...one,
        url_id: String(9000 + offset + index),
        path: `/generated-${String(offset + index)}`,
      }));
    server.use(
      http.get(DETAIL, () =>
        HttpResponse.json({
          data: {
            page: base,
            linking_by_tier: [],
            linking_by_placement: [],
            top_anchors: [],
            links_available: true,
            extras: {
              anchors: { total: 0, distinct: 0, generic: 0, generic_share: 0, matches_keyword: null, top: [] },
              change: null,
              citations: { chatgpt: 0, gemini: 0, ai_mode: 0, total: 0 },
              gsc: { state: 'pending', clicks: null, impressions: null, window_start: null, window_end: null },
              keywords: [],
            },
            linking_pages: [],
            outlinks: [],
            linking_pages_total: READ_LIMIT + 10,
            outlinks_total: 0,
          },
        }),
      ),
      http.get(NEIGHBORS, ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0);
        return HttpResponse.json({
          data: make(offset, offset === 0 ? READ_LIMIT : 10),
          meta: {
            run_id: MOCK_RUN_ID,
            url_id: '108',
            direction: 'in',
            scope: 'editorial',
            total: READ_LIMIT + 10,
            other_scopes: [],
            focus: { url_id: '108', status_code: 200, redirect_url_id: null },
          },
        });
      }),
    );
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), LINKS);
    const panel = await panelOf('/pricing');
    expect(
      await within(panel).findByRole('button', { name: `/generated-${String(READ_LIMIT - 1)}` }),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: `/generated-${String(READ_LIMIT)}` })).toBeNull();
    await user.click(
      within(panel).getByRole('button', { name: `Show more Linking pages (${String(READ_LIMIT + 10)})` }),
    );
    expect(
      await within(panel).findByRole('button', { name: `/generated-${String(READ_LIMIT + 9)}` }),
    ).toBeInTheDocument();
    // All of them are shown: nothing more to ask for
    expect(within(panel).queryByRole('button', { name: /^Show more/ })).toBeNull();
  });

  it('says the first read of the neighbors failed and reads again on Try again', async () => {
    let fail = true;
    server.use(http.get(NEIGHBORS, () => (fail ? HttpResponse.json(SERVER_ERROR, { status: 500 }) : undefined)));
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), LINKS);
    const panel = await panelOf('/pricing');
    expect((await within(panel).findAllByText('These pages could not be loaded')).length).toBeGreaterThan(0);
    expect(within(panel).queryByText('More pages could not be loaded')).toBeNull();
    fail = false;
    const [retry] = within(panel).getAllByRole('button', { name: 'Try again' });
    if (retry === undefined) throw new Error('No Try again button');
    await user.click(retry);
    const path = neighborsOf('108', 'in', 'editorial')[0]?.path ?? '';
    expect(await within(panel).findByRole('button', { name: path })).toBeInTheDocument();
  });

  it('resets a manual tier to its rule and shows that it changed', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
    const panel = await panelOf('/pricing');
    await user.click(await within(panel).findByRole('button', { name: 'Reset to rule' }));
    expect((await screen.findAllByText('1 page went back to the tier their rule gives.')).length).toBeGreaterThan(0);
    expect(await within(panel).findByText('No tier set by hand and no rule matches.')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Reset to rule' })).toBeNull();
  });

  it('toasts a failed reset, and a later Add tag dialog does not show its error', async () => {
    server.use(http.post(RESET, () => HttpResponse.json(SERVER_ERROR, { status: 500 })));
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
    const panel = await panelOf('/pricing');
    await user.click(await within(panel).findByRole('button', { name: 'Reset to rule' }));
    expect((await screen.findAllByText('The change could not be saved')).length).toBeGreaterThan(0);
    await user.click(within(panel).getByRole('button', { name: 'Add tag' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a tag to 1 page' });
    expect(within(dialog).queryByText('The change could not be saved')).toBeNull();
  });

  it('adds a tag, removes it, and toasts a failed removal without a stale error in a later dialog', async () => {
    await makeTag();
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
    const panel = await panelOf('/pricing');
    await user.click(await within(panel).findByRole('button', { name: 'Add tag' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a tag to 1 page' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Tag' }));
    await user.click(await screen.findByRole('option', { name: 'Cornerstone' }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect((await screen.findAllByText('Cornerstone added to 1 page.')).length).toBeGreaterThan(0);

    // A failed removal is a toast and leaves the tag
    let fail = true;
    server.use(http.put(TAGS, () => (fail ? HttpResponse.json(SERVER_ERROR, { status: 500 }) : undefined)));
    await user.click(await within(panel).findByRole('button', { name: /^Remove tag / }));
    expect((await screen.findAllByText('The change could not be saved')).length).toBeGreaterThan(0);
    expect(within(panel).getByRole('button', { name: /^Remove tag / })).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Add tag' }));
    const again = await screen.findByRole('dialog', { name: 'Add a tag to 1 page' });
    expect(within(again).queryByText('The change could not be saved')).toBeNull();
    await user.click(within(again).getByRole('button', { name: 'Cancel' }));

    // A removal that works takes the tag off
    fail = false;
    await user.click(within(panel).getByRole('button', { name: /^Remove tag / }));
    expect((await screen.findAllByText(/ removed from 1 page\.$/)).length).toBeGreaterThan(0);
    await waitFor(() => expect(within(panel).queryByRole('button', { name: /^Remove tag / })).toBeNull());
  });

  it('sets the tier from the select', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
    const panel = await panelOf('/pricing');
    await user.click(await within(panel).findByRole('combobox', { name: 'Tier of this page' }));
    await user.click(await screen.findByRole('option', { name: /^T2/ }));
    expect((await screen.findAllByText('Tier set')).length).toBeGreaterThan(0);
  });

  it('is read only for a viewer: no edits, neighbors listed, stepping writes nothing', async () => {
    const seen = writes();
    const { user } = renderWithProviders(pagesAs('viewer', 'all', EVENTUS_LINKS), OPEN);
    const panel = await panelOf('/pricing');
    await within(panel).findByText(/^Manual, set by/);
    expect(within(panel).getByRole('combobox', { name: 'Tier of this page' })).toBeDisabled();
    expect(within(panel).queryByRole('button', { name: 'Reset to rule' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Add tag' })).toBeNull();
    await user.click(within(panel).getByRole('tab', { name: 'Links' }));
    const path = neighborsOf('108', 'in', 'editorial')[0]?.path ?? '';
    expect(await within(panel).findByRole('button', { name: path })).toBeInTheDocument();
    await waitFor(() => expect(within(panel).getByText(/^\d+ of \d+$/)).toBeInTheDocument());
    await user.keyboard('j');
    await user.keyboard('k');
    expect(seen()).toEqual([]);
  });

  const BASE = '/digibranders/eventus-security/seo/internal-links';

  it.each([
    ['the latest crawl', OPEN, ''],
    ['an older crawl', { searchParams: `inspect=page:108&run=${HISTORY_RUN_IDS[1]}` }, `&run=${HISTORY_RUN_IDS[1]}`],
  ])('links Open in journey to the journey on the page, for %s', async (_name, search, run) => {
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), search);
    const panel = await panelOf('/pricing');
    const link = await within(panel).findByRole('link', { name: 'Open in journey' });
    expect(link).toHaveAttribute('href', `${BASE}?tab=journey&focus=108${run}`);
  });

  it.each([
    ['the latest crawl', LINKS, ''],
    ['an older crawl', openTab('links', `&run=${HISTORY_RUN_IDS[1]}`), `&run=${HISTORY_RUN_IDS[1]}`],
  ])('links View all in Links to the links into the page, for %s', async (_name, search, run) => {
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), search);
    const panel = await panelOf('/pricing');
    const heading = await within(panel).findByRole('heading', { name: /^Linking pages \(\d+\)$/ });
    const link = within(heading.closest('section') as HTMLElement).getByRole('link', { name: 'View all in Links' });
    expect(link).toHaveAttribute('href', `${BASE}?tab=links&tgt=108${run}`);
  });

  it('closes with Close: the address loses the inspector', async () => {
    const onUrlUpdate = vi.fn();
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { ...OPEN, onUrlUpdate });
    const panel = await panelOf('/pricing');
    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '/pricing' })).toBeNull());
    expect(lastQuery(onUrlUpdate)).not.toContain('inspect');
  });

  describe('stepping through the rows of the Pages tab', () => {
    const rowPaths = async (): Promise<string[]> =>
      (await within(await screen.findByRole('grid', { name: 'Pages' })).findAllByRole('rowheader')).map(
        (cell) => cell.textContent ?? '',
      );

    it('steps to the next row in the table order, and says where it is', async () => {
      const onUrlUpdate = vi.fn();
      const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { ...OPEN, onUrlUpdate });
      const panel = await panelOf('/pricing');
      const paths = await rowPaths();
      const at = paths.indexOf('/pricing');
      expect(at).toBeGreaterThan(-1);
      await waitFor(() =>
        expect(within(panel).getByText(`${String(at + 1)} of ${String(paths.length)}`)).toBeInTheDocument(),
      );
      await user.click(within(panel).getByRole('button', { name: 'Next page' }));
      const next = paths[at + 1] ?? paths[at - 1];
      expect(await panelOf(next ?? '')).toBeInTheDocument();
      expect(
        (await screen.findAllByText(new RegExp(`^Page, ${String(at + 2)} of ${String(paths.length)}$`))).length,
      ).toBeGreaterThan(0);
    });

    it('steps with J and K, and says so at the first row', async () => {
      const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
      await panelOf('/pricing');
      const paths = await rowPaths();
      await user.keyboard('j');
      const after = paths[paths.indexOf('/pricing') + 1];
      expect(await panelOf(after ?? '')).toBeInTheDocument();
      await user.keyboard('k');
      expect(await panelOf('/pricing')).toBeInTheDocument();
      // Open the first row from the table: K there has nowhere to go
      await user.click(
        await within(await screen.findByRole('grid', { name: 'Pages' })).findByRole('rowheader', {
          name: paths[0] ?? '',
        }),
      );
      const first = await panelOf(paths[0] ?? '');
      await within(first).findByText(/^1 of \d+$/);
      await user.keyboard('k');
      expect((await screen.findAllByText('First page in this list')).length).toBeGreaterThan(0);
      expect(await panelOf(paths[0] ?? '')).toBeInTheDocument();
    });
  });

  it('says a hand-edited id is not a page, without throwing', async () => {
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'inspect=page:abc' });
    const panel = await panelOf('Page');
    expect(await within(panel).findByText('Page not found')).toBeInTheDocument();
  });

  it('says a page that is not in the crawl is not in it', async () => {
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'inspect=page:999999' });
    const panel = await panelOf('Page');
    expect(await within(panel).findByText('This page is not in the latest crawl.')).toBeInTheDocument();
  });

  describe('the sections that read the extras', () => {
    const section = async (name: string): Promise<HTMLElement> => {
      const panel = await panelOf('/pricing');
      return (await within(panel).findByRole('heading', { name })).closest('section') as HTMLElement;
    };

    it('puts the Links tab sections in order, the keywords and Google data in Search, and the citations in AI, with no equity or strength', async () => {
      const links = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), LINKS);
      const panel = await panelOf('/pricing');
      await within(panel).findByRole('heading', { name: 'Anchor text pointing here' });
      const order = [
        'Linking pages by tier',
        'Changes since the last crawl',
        'Anchor text pointing here',
        'Linking pages (',
        'Outlinks (',
      ];
      const shown = within(panel)
        .getAllByRole('heading', { level: 3 })
        .map((node) => node.textContent ?? '')
        .map((text) => order.find((name) => text.startsWith(name)))
        .filter((name): name is string => name !== undefined);
      expect(shown).toEqual(order);
      expect(within(panel).queryByRole('heading', { name: 'Tracked keywords' })).toBeNull();
      expect(panel.textContent ?? '').not.toMatch(/equity|strength/i);
      const attributes = [...panel.querySelectorAll('[aria-label], [title]')].map(
        (element) => `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''}`,
      );
      expect(attributes.join(' ')).not.toMatch(/equity|strength/i);
      links.unmount();
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('search'));
      const search = await panelOf('/pricing');
      await within(search).findByRole('heading', { name: 'Search Console, last 28 days' });
      expect(within(search).getByRole('heading', { name: 'Tracked keywords' })).toBeInTheDocument();
      expect(within(search).queryByRole('heading', { name: 'AI citations' })).toBeNull();
    });

    it('shows the Search Console totals of the page in Search and the citation counts in AI', async () => {
      const search = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('search'));
      await section('Search Console, last 28 days');
      const totals = within(await panelOf('/pricing')).getByRole('group', { name: 'Search Console totals' });
      expect(totals).toHaveTextContent('960');
      expect(totals).toHaveTextContent('12,000');
      search.unmount();
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('ai'));
      expect(await section('AI citations')).toHaveTextContent('Cited in 1 answer');
    });

    it('says the Search Console numbers are not collected yet, or that it is not connected', async () => {
      setLinksScenario({ gsc: 'pending' });
      const pending = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('search'));
      expect(await section('Search Console, last 28 days')).toHaveTextContent('Not collected yet');
      pending.unmount();
      setLinksScenario({ gsc: 'not_connected' });
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('search'));
      expect(await section('Search Console, last 28 days')).toHaveTextContent('Search Console is not connected');
    });

    it('has no changes section on a first crawl, and says Updating or Not available while the comparison is not ready', async () => {
      setLinksScenario({ firstCrawl: true });
      const first = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), LINKS);
      await section('Linking pages by tier');
      expect(screen.queryByRole('heading', { name: 'Changes since the last crawl' })).toBeNull();
      first.unmount();
      setLinksScenario({ firstCrawl: false, enrich: 'running' });
      const running = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), LINKS);
      expect(await section('Changes since the last crawl')).toHaveTextContent('Updating');
      running.unmount();
      setLinksScenario({ enrich: 'failed' });
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), LINKS);
      await waitFor(async () =>
        expect(await section('Changes since the last crawl')).toHaveTextContent('Not available'),
      );
    });

    it('shows no changes card while the summary is pending, nor when it fails, nor on a first crawl, and the card once it is ready', async () => {
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      server.use(
        http.get(SUMMARY, async () => {
          await held;
          return undefined;
        }),
      );
      const pending = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), LINKS);
      await section('Linking pages by tier');
      expect(screen.queryByRole('heading', { name: 'Changes since the last crawl' })).toBeNull();
      release();
      pending.unmount();
      server.resetHandlers();
      server.use(http.get(SUMMARY, () => HttpResponse.json(SERVER_ERROR, { status: 500 })));
      setLinksScenario({ firstCrawl: true });
      const failed = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), LINKS);
      await section('Linking pages by tier');
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Changes since the last crawl' })).toBeNull());
      failed.unmount();
      server.resetHandlers();
      const first = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), LINKS);
      await section('Linking pages by tier');
      expect(screen.queryByRole('heading', { name: 'Changes since the last crawl' })).toBeNull();
      first.unmount();
      setLinksScenario({ firstCrawl: false });
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), LINKS);
      expect(await section('Changes since the last crawl')).toBeInTheDocument();
    });

    it('shows Not stored, and no anchors, for a dropped crawl even when the old top anchors field is sent', async () => {
      server.use(
        http.get(DETAIL, () => {
          const base = pageRow(crawledPage('108') as NonNullable<ReturnType<typeof crawledPage>>, 'editorial');
          return HttpResponse.json({
            data: {
              page: base,
              linking_by_tier: [],
              linking_by_placement: [],
              top_anchors: [{ anchor: 'old anchor text', links: 3 }],
              links_available: false,
              linking_pages: [],
              outlinks: [],
              linking_pages_total: 0,
              outlinks_total: 0,
              extras: {
                anchors: { total: 3, distinct: null, generic: 1, generic_share: 0.3, matches_keyword: null, top: null },
                change: null,
                citations: { chatgpt: 0, gemini: 0, ai_mode: 0, total: 0 },
                gsc: { state: 'pending', clicks: null, impressions: null, window_start: null, window_end: null },
                keywords: [],
              },
            },
          });
        }),
      );
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), LINKS);
      const anchors = await section('Anchor text pointing here');
      expect(anchors).toHaveTextContent('Not stored');
      expect(within(anchors).queryByRole('table')).toBeNull();
      expect(screen.queryByText(/old anchor text/)).toBeNull();
    });

    it('says Not stored for the anchors of a crawl whose links were dropped', async () => {
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
        searchParams: `inspect=page:108&itab=links&run=${HISTORY_RUN_IDS[4] ?? ''}`,
      });
      expect(await section('Anchor text pointing here')).toHaveTextContent('Not stored');
    });
  });

  describe('the tabs', () => {
    it('lists the seven tabs of the owner in order under the name Page sections, Overview first', async () => {
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
      const panel = await panelOf('/pricing');
      const list = within(panel).getByRole('tablist', { name: 'Page sections' });
      expect(within(list).getAllByRole('tab').map(tabLabel)).toEqual([...TAB_NAMES]);
      expect(selectedTab(panel)).toBe('Overview');
    });

    it.each([
      ['links', 'Links'],
      ['outline', 'Outline'],
      ['notes', 'Notes'],
    ])('selects %s from the address, and Overview for an unknown tab', async (itab, name) => {
      const first = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab(itab));
      expect(selectedTab(await panelOf('/pricing'))).toBe(name);
      first.unmount();
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('nope'));
      expect(selectedTab(await panelOf('/pricing'))).toBe('Overview');
    });

    it('writes the chosen tab to the address without a history entry, and drops it for Overview', async () => {
      const onUrlUpdate = vi.fn();
      const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { ...OPEN, onUrlUpdate });
      const panel = await panelOf('/pricing');
      await user.click(within(panel).getByRole('tab', { name: 'Search' }));
      await waitFor(() => expect(lastQuery(onUrlUpdate)).toContain('itab=search'));
      expect((onUrlUpdate.mock.calls.at(-1)?.[0] as { options: { history: string } }).options.history).toBe('replace');
      await user.click(within(panel).getByRole('tab', { name: 'Overview' }));
      await waitFor(() => expect(lastQuery(onUrlUpdate)).not.toContain('itab'));
    });

    it('moves the last tabs into More sections when the row is narrow, and a tab chosen there is selected and written', async () => {
      const onUrlUpdate = vi.fn();
      // jsdom has no layout: every tab measures 60 px, the More button 32 px and the row 400 px
      const widths = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        const kind = this.getAttribute('data-measure');
        return kind === 'tab' ? 60 : kind === 'more' ? 32 : 0;
      });
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(private readonly callback: ResizeObserverCallback) {}
          observe(target: Element): void {
            const entry = { target, contentRect: { width: 400 } };
            this.callback([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
          }
          unobserve(): void {}
          disconnect(): void {}
        },
      );
      try {
        const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { ...OPEN, onUrlUpdate });
        const panel = await panelOf('/pricing');
        const row = within(within(panel).getByRole('tablist', { name: 'Page sections' })).getAllByRole('tab');
        expect(row.map(tabLabel)).toEqual(['Overview', 'Search', 'Outline', 'Issues']);
        await user.click(within(panel).getByRole('button', { name: 'More sections' }));
        const menu = await screen.findByRole('menu');
        expect(
          within(menu)
            .getAllByRole('menuitem')
            .map((item) => item.textContent),
        ).toEqual(['AI', 'Links', 'Notes3']);
        await user.click(within(menu).getByRole('menuitem', { name: 'Links' }));
        await waitFor(() => expect(lastQuery(onUrlUpdate)).toContain('itab=links'));
        expect(selectedTab(panel)).toBe('Links');
      } finally {
        widths.mockRestore();
      }
    });

    it('holds the tier and tags and what needs attention in Overview, and no Track control anywhere', async () => {
      const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
      const panel = await panelOf('/pricing');
      expect(await within(panel).findByRole('combobox', { name: 'Tier of this page' })).toBeInTheDocument();
      expect(within(panel).getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
      for (const name of TAB_NAMES) {
        await user.click(within(panel).getByRole('tab', { name: tabNamed(name) }));
        expect(within(panel).queryByRole('button', { name: /^Track(?!ed keywords:)/ })).toBeNull();
      }
    });

    it('draws a skeleton, never an empty panel, on the tabs that need the page while it loads', async () => {
      server.use(http.get(DETAIL, () => new Promise<never>(() => undefined)));
      for (const [tab, title] of [
        ['overview', 'Needs attention'],
        ['search', 'Tracked keywords'],
        ['issues', 'Flags'],
        ['ai', 'AI citations'],
      ] as const) {
        const view = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab(tab));
        const panel = await panelOf('Page');
        const heading = await within(panel).findByRole('heading', { name: title });
        expect(heading.closest('section')).toHaveAttribute('aria-busy', 'true');
        view.unmount();
      }
    });

    it('holds the strip, the tier and placement cards, the anchors, the changes and the neighbors in Links', async () => {
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), LINKS);
      const panel = await panelOf('/pricing');
      expect(await within(panel).findByRole('group', { name: 'Page summary' })).toHaveTextContent(/Depth\s*1/);
      expect(within(panel).getByRole('heading', { name: 'Linking pages by tier' })).toBeInTheDocument();
      expect(await within(panel).findByRole('heading', { name: 'Anchor text pointing here' })).toBeInTheDocument();
      expect(within(panel).getByRole('heading', { name: 'Changes since the last crawl' })).toBeInTheDocument();
      const heading = await within(panel).findByRole('heading', { name: /^Outlinks \(\d+\)$/ });
      expect(
        within(heading.closest('section') as HTMLElement).getByRole('link', { name: 'View all in Links' }),
      ).toBeInTheDocument();
      expect(within(panel).queryByRole('combobox', { name: 'Tier of this page' })).toBeNull();
    });

    it('holds the citations in AI, and says so when no AI answer cited the page', async () => {
      const cited = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('ai'));
      const panel = await panelOf('/pricing');
      expect(await within(panel).findByRole('heading', { name: 'AI citations' })).toBeInTheDocument();
      cited.unmount();
      server.use(
        http.get(DETAIL, () =>
          HttpResponse.json({
            data: {
              page: pageRow(crawledPage('108') as NonNullable<ReturnType<typeof crawledPage>>, 'editorial'),
              linking_by_tier: [],
              linking_by_placement: [],
              top_anchors: [],
              links_available: true,
              linking_pages: [],
              outlinks: [],
              linking_pages_total: 0,
              outlinks_total: 0,
              extras: {
                anchors: { total: 0, distinct: 0, generic: 0, generic_share: 0, matches_keyword: null, top: [] },
                change: null,
                citations: { chatgpt: 0, gemini: 0, ai_mode: 0, total: 0 },
                gsc: { state: 'pending', clicks: null, impressions: null, window_start: null, window_end: null },
                keywords: [],
              },
            },
          }),
        ),
      );
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('ai'));
      expect(
        await within(await panelOf('/pricing')).findByText('No AI answer cited this page in the last 28 days'),
      ).toBeInTheDocument();
    });

    it('holds the Search Console days and the tracked keywords in Search, and the flags in Issues', async () => {
      const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('search'));
      const panel = await panelOf('/pricing');
      expect(await within(panel).findByRole('heading', { name: 'Tracked keywords' })).toBeInTheDocument();
      expect(await within(panel).findByRole('heading', { name: 'Search Console, last 28 days' })).toBeInTheDocument();
      await user.click(within(panel).getByRole('tab', { name: 'Issues' }));
      expect(await within(panel).findByRole('heading', { name: 'Flags' })).toBeInTheDocument();
    });

    it('draws the Outline tab, and the Notes tab with its box and the seeded notes', async () => {
      const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('outline'));
      const panel = await panelOf('/pricing');
      expect(await within(panel).findByRole('group', { name: 'Outline numbers' })).toBeInTheDocument();
      expect(within(panel).queryByText('The outline of this page appears here')).toBeNull();
      await user.click(within(panel).getByRole('tab', { name: /^Notes/ }));
      expect(await within(panel).findByRole('textbox', { name: 'Add a note to /pricing' })).toBeInTheDocument();
      expect(await within(panel).findByRole('list', { name: 'Notes, newest first' })).toBeInTheDocument();
    });

    it('counts the notes on the tab from the page detail, and asks for them only once the tab is selected', async () => {
      const asked: string[] = [];
      server.events.on('request:start', ({ request }) => {
        if (request.url.includes('/notes')) asked.push(request.method);
      });
      const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('overview'));
      const panel = await panelOf('/pricing');
      const tab = await within(panel).findByRole('tab', { name: /^Notes\s*3$/ });
      expect(asked).toEqual([]);
      await user.click(tab);
      await within(panel).findByRole('list', { name: 'Notes, newest first' });
      expect(asked).toEqual(['GET']);
    });

    it('has no count on the Notes tab of a page without notes, and has the tab for a redirect and a 404 row', async () => {
      for (const id of ['106', '107']) {
        const { unmount } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
          searchParams: `inspect=page:${id}&itab=notes`,
        });
        const panel = await screen.findByRole('complementary');
        expect(await within(panel).findByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
        expect(await within(panel).findByText('No notes on this page yet.')).toBeInTheDocument();
        unmount();
      }
    });

    it('asks for the outline only once the Outline tab is selected', async () => {
      const asked: string[] = [];
      server.events.on('request:start', ({ request }) => {
        if (request.url.includes('/outline')) asked.push(request.url);
      });
      const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('overview'));
      const panel = await panelOf('/pricing');
      await within(panel).findByRole('group', { name: 'Page numbers' });
      expect(asked).toEqual([]);
      await user.click(within(panel).getByRole('tab', { name: 'Outline' }));
      await within(panel).findByRole('group', { name: 'Outline numbers' });
      expect(asked).toHaveLength(1);
    });

    it('keeps the tab and the header when stepping with J and K', async () => {
      const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), LINKS);
      const panel = await panelOf('/pricing');
      await within(panel).findByRole('heading', { name: /^Outlinks \(\d+\)$/ });
      for (const name of ['Previous page', 'Next page', 'Copy URL', 'Visit page']) {
        expect(within(panel).getByRole('button', { name })).toBeInTheDocument();
      }
      await user.keyboard('j');
      const next = await screen.findByRole('complementary', { name: (name) => name !== '/pricing' });
      expect(selectedTab(next)).toBe('Links');
    });
  });

  describe('the Overview tab (spec 9.4)', () => {
    it('draws the chips from the page row, with Parameter variant only for a variant', async () => {
      withOverview(
        { status_code: 200, is_indexable: true, in_sitemap: false, flags: ['variant'] },
        { state: 'ok', clicks: 1240, impressions: 30500 },
      );
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
      const chips = within(await panelOf('/pricing')).getByRole('list', { name: 'Page facts' });
      for (const text of ['200', 'Indexable', 'Not in sitemap', 'Parameter variant']) {
        expect(await within(chips).findByText(text)).toBeInTheDocument();
      }
    });

    it('draws seven tiles as buttons with full names, and a tile opens its tab and writes itab', async () => {
      withOverview({}, { state: 'ok', clicks: 1240, impressions: 30500 });
      const onUrlUpdate = vi.fn();
      const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { ...OPEN, onUrlUpdate });
      const panel = await panelOf('/pricing');
      const group = await within(panel).findByRole('group', { name: 'Page numbers' });
      expect(within(group).getAllByRole('button')).toHaveLength(7);
      await user.click(
        within(group).getByRole('button', { name: 'Clicks: 1,240, last 28 days. Opens the Search tab.' }),
      );
      await waitFor(() => expect(lastQuery(onUrlUpdate)).toContain('itab=search'));
      expect(selectedTab(panel)).toBe('Search');
      await user.click(within(panel).getByRole('tab', { name: 'Overview' }));
      await user.click(within(panel).getByRole('button', { name: /^AI citations: .*Opens the AI tab\.$/ }));
      expect(selectedTab(panel)).toBe('AI');
      await user.click(within(panel).getByRole('tab', { name: 'Overview' }));
      await user.click(within(panel).getByRole('button', { name: /^Links in: .*Opens the Links tab\.$/ }));
      expect(selectedTab(panel)).toBe('Links');
    });

    it.each([
      ['not_connected', 'Clicks: Not connected. Opens the Search tab.'],
      ['pending', 'Clicks: Not collected yet. Opens the Search tab.'],
    ])('reads a Search Console tile as words, never 0, when the state is %s', async (state, name) => {
      withOverview({}, { state, clicks: null, impressions: null });
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
      const group = await within(await panelOf('/pricing')).findByRole('group', { name: 'Page numbers' });
      expect(within(group).getByRole('button', { name })).toBeInTheDocument();
    });

    it('says a page no link reaches is not reachable, not depth 0', async () => {
      withOverview({ click_depth: null }, {});
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
      const group = await within(await panelOf('/pricing')).findByRole('group', { name: 'Page numbers' });
      expect(
        within(group).getByRole('button', { name: 'Depth: Not reachable by links. Opens the Links tab.' }),
      ).toBeInTheDocument();
    });

    it('lists the flags under Needs attention, and says so when the page has none', async () => {
      withOverview({ flags: ['orphan'] }, {});
      const first = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
      const card = (await within(await panelOf('/pricing')).findByRole('heading', { name: 'Needs attention' })).closest(
        'section',
      ) as HTMLElement;
      await waitFor(() => expect(within(card).getAllByRole('listitem').length).toBeGreaterThan(0));
      first.unmount();
      withOverview({ flags: [], broken_outlinks: 0, redirect_outlinks: 0, linking_pages: 50 }, {});
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
      expect(await screen.findByText('No flags. This page has no linking problems.')).toBeInTheDocument();
    });

    it('shows About: the title, the address with a copy button, the canonical, the redirect target and the crawl date', async () => {
      withOverview({ canonical_url: 'https://example.com/canon', redirect_url: 'https://example.com/new' }, {});
      const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
      const about = (await within(await panelOf('/pricing')).findByRole('heading', { name: 'About' })).closest(
        'section',
      ) as HTMLElement;
      expect(within(about).getByText('Plans and pricing')).toBeInTheDocument();
      expect(within(about).getByText('https://example.com/canon')).toBeInTheDocument();
      expect(within(about).getByText('Redirects to')).toBeInTheDocument();
      expect(within(about).getByText('https://example.com/new')).toBeInTheDocument();
      expect(within(about).getByText('Last crawled')).toBeInTheDocument();
      await user.click(within(about).getByRole('button', { name: 'Copy URL' }));
      expect((await screen.findAllByText('URL copied')).length).toBeGreaterThan(0);
    });

    describe('with the Issues seam ready', () => {
      const issue = (severity: string, checkId: string): PageIssue => ({
        checkId,
        severity: severity as PageIssue['severity'],
        detail: `Found by ${checkId}`,
      });

      it('draws eight tiles, the five most severe issues first, and See all issues opens the Issues tab', async () => {
        seam.current = {
          state: 'ready',
          data: [
            issue('notice', 'n1'),
            issue('warning', 'w1'),
            issue('error', 'e1'),
            issue('notice', 'n2'),
            issue('warning', 'w2'),
            issue('notice', 'n3'),
            issue('error', 'e2'),
          ],
        };
        const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
        const panel = await panelOf('/pricing');
        const group = await within(panel).findByRole('group', { name: 'Page numbers' });
        expect(within(group).getAllByRole('button')).toHaveLength(8);
        expect(
          within(group).getByRole('button', { name: 'Issues: 2, 2 errors. Opens the Issues tab.' }),
        ).toBeInTheDocument();
        const card = within(panel).getByRole('heading', { name: 'Needs attention' }).closest('section') as HTMLElement;
        const items = within(card).getAllByRole('listitem');
        expect(items).toHaveLength(5);
        expect(items[0]).toHaveTextContent('Error');
        expect(items[0]).toHaveTextContent('e1');
        expect(items[2]).toHaveTextContent('Warning');
        expect(items[4]).toHaveTextContent('Notice');
        await user.click(within(card).getByRole('button', { name: 'See all issues' }));
        expect(selectedTab(panel)).toBe('Issues');
      });

      it('names an issue by its detail first, with the raw check id only as the small line after it', async () => {
        seam.current = { state: 'ready', data: [issue('error', 'missing_h1')] };
        renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
        const panel = await panelOf('/pricing');
        const card = (await within(panel).findByRole('heading', { name: 'Needs attention' })).closest(
          'section',
        ) as HTMLElement;
        const [item] = within(card).getAllByRole('listitem');
        const lines = [...(item?.querySelectorAll('span.type-body, span.type-meta') ?? [])].map(
          (line) => line.textContent,
        );
        expect(lines).toEqual(['Found by missing_h1', 'missing_h1']);
      });

      it('reads a failed Issues read on its tile as Could not load, not as not collected', async () => {
        seam.current = { state: 'error', retry: vi.fn() };
        renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
        const group = await within(await panelOf('/pricing')).findByRole('group', { name: 'Page numbers' });
        expect(
          within(group).getByRole('button', { name: 'Issues: Could not load. Opens the Issues tab.' }),
        ).toBeInTheDocument();
      });

      it('says nothing needs attention when the page has no issue', async () => {
        seam.current = { state: 'ready', data: [] };
        renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
        expect(await screen.findByText('Nothing needs attention on this page')).toBeInTheDocument();
      });
    });
  });

  describe('the Search tab (spec 9.4, 9.5)', () => {
    const day = (index: number, clicks: number, impressions: number): Record<string, unknown> => ({
      date: new Date(Date.UTC(2026, 9, 28 + index)).toISOString().slice(0, 10),
      clicks,
      impressions,
    });
    const okDays = Array.from({ length: 28 }, (_, index) => day(index, index + 1, (index + 1) * 10));
    const serveSearch = (data: Record<string, unknown>): void =>
      server.use(http.get(SEARCH, () => HttpResponse.json({ data })));
    const ok = (days: Record<string, unknown>[], clicks: number, impressions: number): Record<string, unknown> => ({
      state: 'ok',
      window_start: '2026-10-28',
      window_end: '2026-11-24',
      clicks,
      impressions,
      days,
    });
    const section = async (panel: HTMLElement): Promise<HTMLElement> =>
      (await within(panel).findByRole('heading', { name: 'Search Console, last 28 days' })).closest(
        'section',
      ) as HTMLElement;

    it('draws the Search Console section, then the slot, then the tracked keywords, in that order', async () => {
      slot.marker = true;
      serveSearch(ok(okDays, 406, 4060));
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('search'));
      const panel = await panelOf('/pricing');
      const heading = await within(panel).findByRole('heading', { name: 'Search Console, last 28 days' });
      const marker = await within(panel).findByText('Slot marker');
      const keywords = await within(panel).findByRole('heading', { name: 'Tracked keywords' });
      expect(heading.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(marker.compareDocumentPosition(keywords) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(slot.props.at(-1)).toMatchObject({ urlId: '108', url: expect.stringContaining('/pricing') });
    });

    it('draws nothing for the slot while it is empty, and no Google card on any tab', async () => {
      slot.marker = false;
      serveSearch(ok(okDays, 406, 4060));
      const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('search'));
      const panel = await panelOf('/pricing');
      await section(panel);
      for (const name of TAB_NAMES) {
        await user.click(within(panel).getByRole('tab', { name: tabNamed(name) }));
        expect(within(panel).queryByRole('heading', { name: 'Google' })).toBeNull();
        expect(within(panel).queryByRole('heading', { name: 'Google Search Console' })).toBeNull();
      }
    });

    it('gives the slot the scope and the time zone of the drawer', async () => {
      serveSearch(ok(okDays, 406, 4060));
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('search'));
      const panel = await panelOf('/pricing');
      await section(panel);
      expect(slot.props.at(-1)).toMatchObject({
        scope: expect.objectContaining({ workspaceId: expect.any(String), projectId: expect.any(String) }),
        timeZone: expect.any(String),
      });
    });

    it('shows the two totals and a chart of the 28 days with a Table view of 28 rows', async () => {
      serveSearch(ok(okDays, 406, 4060));
      const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('search'));
      const panel = await panelOf('/pricing');
      const region = await section(panel);
      const totals = within(panel).getByRole('group', { name: 'Search Console totals' });
      expect(totals).toHaveTextContent('Clicks');
      expect(totals).toHaveTextContent('406');
      expect(totals).toHaveTextContent('Impressions');
      expect(totals).toHaveTextContent('4,060');
      expect(chartSummaryText(within(panel).getByRole('heading', { name: 'Search Console, last 28 days' }))).toBe(
        '406 clicks and 4,060 impressions from Oct 28, 2026 to Nov 24, 2026',
      );
      await user.click(within(region).getByRole('button', { name: 'Table' }));
      const table = within(region).getByRole('table');
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((header) => header.textContent),
      ).toEqual(['Day', 'Clicks', 'Impressions']);
      expect(within(table).getAllByRole('row')).toHaveLength(29);
    });

    it('draws a marker shape in the legend of each line, not only a colour', async () => {
      serveSearch(ok(okDays, 406, 4060));
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('search'));
      const panel = await panelOf('/pricing');
      const region = await section(panel);
      const legend = within(region).getByRole('list', { name: /^Series in / });
      for (const name of ['Clicks', 'Impressions']) {
        const item = within(legend).getByText(name).closest('li') as HTMLElement;
        expect(item.querySelector('svg[aria-hidden="true"] path')).not.toBeNull();
      }
    });

    it('says the numbers are not available yet while the seam is unavailable, never a skeleton for ever', async () => {
      daily.unavailable = true;
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('search'));
      const panel = await panelOf('/pricing');
      expect(
        await within(panel).findByText('The Search Console numbers of this page are not available yet.'),
      ).toBeInTheDocument();
      expect(within(panel).queryByRole('group', { name: 'Search Console totals' })).toBeNull();
    });

    it('reads 0 and says Google reported nothing, instead of drawing a flat chart', async () => {
      serveSearch(
        ok(
          Array.from({ length: 28 }, (_, index) => day(index, 0, 0)),
          0,
          0,
        ),
      );
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('search'));
      const panel = await panelOf('/pricing');
      expect(
        await within(panel).findByText('Google reported no clicks or impressions for this page in these 28 days'),
      ).toBeInTheDocument();
      expect(within(panel).getByRole('group', { name: 'Search Console totals' })).toHaveTextContent('0');
      expect(within(panel).queryByRole('button', { name: 'Table' })).toBeNull();
    });

    it('says Search Console is not connected, with the Integrations link only for a member who may connect', async () => {
      const gone = {
        state: 'not_connected',
        window_start: null,
        window_end: null,
        clicks: null,
        impressions: null,
        days: [],
      };
      serveSearch(gone);
      const first = renderWithProviders(pagesAs('admin', 'all', EVENTUS_LINKS), openTab('search'));
      const panel = await panelOf('/pricing');
      expect(await within(panel).findByText('Search Console is not connected')).toBeInTheDocument();
      expect(
        within(panel).getByText("Connect Search Console to see this page's clicks and impressions."),
      ).toBeInTheDocument();
      expect(within(panel).getByRole('link', { name: 'Open Integrations' })).toHaveAttribute(
        'href',
        expect.stringContaining('/integrations/google'),
      );
      first.unmount();
      serveSearch(gone);
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('search'));
      expect(await screen.findByText('Search Console is not connected')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Open Integrations' })).toBeNull();
    });

    it('says the numbers are not collected yet while Search Console has not answered', async () => {
      serveSearch({
        state: 'pending',
        window_start: null,
        window_end: null,
        clicks: null,
        impressions: null,
        days: [],
      });
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('search'));
      const panel = await panelOf('/pricing');
      expect(await within(panel).findByText('Not collected yet')).toBeInTheDocument();
      expect(
        within(panel).getByText('The page numbers arrive after the next Search Console update.'),
      ).toBeInTheDocument();
    });

    it('shows an inline error when the read fails, and its retry reads again', async () => {
      let calls = 0;
      server.use(
        http.get(SEARCH, () => {
          calls += 1;
          return calls === 1
            ? HttpResponse.json(SERVER_ERROR, { status: 500 })
            : HttpResponse.json({ data: ok(okDays, 406, 4060) });
        }),
      );
      const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('search'));
      const panel = await panelOf('/pricing');
      expect(await within(panel).findByText('The Search Console numbers could not be loaded')).toBeInTheDocument();
      await user.click(within(panel).getByRole('button', { name: 'Try again' }));
      expect(await within(panel).findByRole('group', { name: 'Search Console totals' })).toHaveTextContent('406');
    });

    it('holds a skeleton, not an empty panel, while the numbers load', async () => {
      server.use(http.get(SEARCH, () => new Promise<never>(() => undefined)));
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('search'));
      const panel = await panelOf('/pricing');
      expect(await within(panel).findByRole('heading', { name: 'Search Console, last 28 days' })).toBeInTheDocument();
      expect(within(panel).getByRole('tabpanel')).not.toBeEmptyDOMElement();
    });
  });

  describe('the Issues tab (spec 9.4, 10.1)', () => {
    it('says the checks are not available yet and lists the flags of the page, never empty', async () => {
      withOverview({ flags: ['orphan'] }, {});
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab('issues'));
      const panel = await panelOf('/pricing');
      expect(
        await within(panel).findByText('Checks from the Issues page appear here once they are available'),
      ).toBeInTheDocument();
      const flags = within(panel).getByRole('heading', { name: 'Flags' }).closest('section') as HTMLElement;
      await waitFor(() => expect(within(flags).getAllByRole('listitem').length).toBeGreaterThan(0));
    });

    it('lists each issue with a severity word, its words, and the link only when the route exists', async () => {
      const issues: PageIssue[] = [
        { checkId: 'a', severity: 'warning', detail: 'Two H1 headings' },
        { checkId: 'b', severity: 'error', detail: null },
      ];
      const { rerender } = renderWithProviders(
        <DrawerIssuesTab
          issues={{ state: 'ready', data: issues }}
          detail={null}
          linkScope="editorial"
          issueHref={() => '/issues/a' as Route}
        />,
      );
      const items = screen.getAllByRole('listitem');
      expect(items[0]).toHaveTextContent('Error');
      expect(items[1]).toHaveTextContent('Warning');
      expect(items[1]).toHaveTextContent('Two H1 headings');
      expect(screen.getAllByRole('link', { name: /^See all pages with this issue/ })).toHaveLength(2);
      // An issue with neither a label nor a detail is not named by its raw check id
      expect(screen.getByRole('link', { name: 'See all pages with this issue' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /: b$/ })).toBeNull();
      expect(screen.getByRole('link', { name: 'See all pages with this issue: Two H1 headings' })).toBeInTheDocument();
      rerender(
        <DrawerIssuesTab
          issues={{ state: 'ready', data: issues }}
          detail={null}
          linkScope="editorial"
          issueHref={() => null}
        />,
      );
      expect(screen.queryByRole('link', { name: /See all pages with this issue/ })).toBeNull();
    });

    it('says no issues were found for a page with none', () => {
      renderWithProviders(
        <DrawerIssuesTab
          issues={{ state: 'ready', data: [] }}
          detail={null}
          linkScope="editorial"
          issueHref={() => null}
        />,
      );
      expect(screen.getByText('No issues found on this page')).toBeInTheDocument();
    });

    it('shows an inline error with a retry that calls the seam', async () => {
      const retry = vi.fn();
      const { user } = renderWithProviders(
        <DrawerIssuesTab
          issues={{ state: 'error', retry }}
          detail={null}
          linkScope="editorial"
          issueHref={() => null}
        />,
      );
      expect(screen.getByText('The issues of this page could not be loaded')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(retry).toHaveBeenCalledOnce();
    });

    it('keeps Outline between Search and Issues and Notes last', async () => {
      renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
      const panel = await panelOf('/pricing');
      const names = within(panel).getAllByRole('tab').map(tabLabel);
      expect(names).toEqual([...TAB_NAMES]);
    });
  });

  describe.each(['light', 'dark'])('axe in the %s theme', (theme) => {
    beforeEach(() => document.documentElement.classList.toggle('dark', theme === 'dark'));

    it.each(TAB_NAMES)('has no violations for a page on the %s tab', async (name) => {
      const { container } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), openTab(name.toLowerCase()));
      const panel = await panelOf('/pricing');
      await within(panel).findByRole('tab', { name: tabNamed(name) });
      await waitFor(() => expect(within(panel).getByRole('tabpanel')).not.toBeEmptyDOMElement());
      expect(await axe(container)).toHaveNoViolations();
    });

    it('has no violations while the page loads', async () => {
      server.use(http.get(DETAIL, () => new Promise<never>(() => undefined)));
      const { container } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), OPEN);
      const panel = await panelOf('Page');
      expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent('Page');
      expect(await axe(container)).toHaveNoViolations();
    });

    it('has no violations for a page that is not found', async () => {
      const { container } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
        searchParams: 'inspect=page:abc',
      });
      const panel = await panelOf('Page');
      await within(panel).findByText('Page not found');
      expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent('Page');
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
