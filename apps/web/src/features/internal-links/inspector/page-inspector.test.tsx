import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { READ_LIMIT } from '@/lib/internal-links/journey-layout';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { crawledPage, EVENTUS, MOCK_RUN_ID, neighborsOf, pageRow } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { mockBrowser } from '@/test/mock-api';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const DETAIL = mswPath(`${P}/internal-links/pages/{url_id}`);
const NEIGHBORS = mswPath(`${P}/internal-links/neighbors`);
const RESET = mswPath(`${P}/pages/tiers/reset`);
const TAGS = mswPath(`${P}/pages/tags`);
const SERVER_ERROR = { type: 'about:blank', title: 'Server error', status: 500 };

beforeEach(() => stubWideScreen());
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
  document.documentElement.classList.remove('dark');
});

/** Page 108 of the fixture crawl is /pricing: tiered by hand. */
const OPEN = { searchParams: 'inspect=page:108' };
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

describe('the page inspector (spec 7.4)', () => {
  it('shows the tier with its source, the strip, the linking pages and the flags, and no equity', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), OPEN);
    const panel = await panelOf('/pricing');
    expect(await within(panel).findByText(/^Manual, set by .+ on /)).toBeInTheDocument();
    expect(within(panel).getByRole('group', { name: 'Page summary' })).toHaveTextContent(/Depth\s*1/);
    expect(await within(panel).findByRole('heading', { name: /^Linking pages \(\d+\)$/ })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: /^Outlinks \(\d+\)$/ })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Open in journey' })).toBeInTheDocument();
    expect(panel.textContent ?? '').not.toMatch(/equity/i);
    // Names and titles are read aloud too
    const attributes = [...panel.querySelectorAll('[aria-label], [title]')].map(
      (element) => `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''}`,
    );
    expect(attributes.join(' ')).not.toMatch(/equity/i);
  });

  it('lists the linking pages and the outlinks from the neighbors read, and opens one', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), OPEN);
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
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), OPEN);
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
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), OPEN);
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
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), OPEN);
    const panel = await panelOf('/pricing');
    await user.click(await within(panel).findByRole('button', { name: 'Reset to rule' }));
    expect((await screen.findAllByText('1 page went back to the tier their rule gives.')).length).toBeGreaterThan(0);
    expect(await within(panel).findByText('No tier set by hand and no rule matches.')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Reset to rule' })).toBeNull();
  });

  it('toasts a failed reset, and a later Add tag dialog does not show its error', async () => {
    server.use(http.post(RESET, () => HttpResponse.json(SERVER_ERROR, { status: 500 })));
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), OPEN);
    const panel = await panelOf('/pricing');
    await user.click(await within(panel).findByRole('button', { name: 'Reset to rule' }));
    expect((await screen.findAllByText('The change could not be saved')).length).toBeGreaterThan(0);
    await user.click(within(panel).getByRole('button', { name: 'Add tag' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a tag to 1 page' });
    expect(within(dialog).queryByText('The change could not be saved')).toBeNull();
  });

  it('adds a tag, removes it, and toasts a failed removal without a stale error in a later dialog', async () => {
    await makeTag();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), OPEN);
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
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), OPEN);
    const panel = await panelOf('/pricing');
    await user.click(await within(panel).findByRole('combobox', { name: 'Tier of this page' }));
    await user.click(await screen.findByRole('option', { name: /^T2/ }));
    expect((await screen.findAllByText('Tier set')).length).toBeGreaterThan(0);
  });

  it('is read only for a viewer: no edits, neighbors listed, stepping writes nothing', async () => {
    const seen = writes();
    const { user } = renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS), OPEN);
    const panel = await panelOf('/pricing');
    await within(panel).findByText(/^Manual, set by/);
    expect(within(panel).getByRole('combobox', { name: 'Tier of this page' })).toBeDisabled();
    expect(within(panel).queryByRole('button', { name: 'Reset to rule' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Add tag' })).toBeNull();
    const path = neighborsOf('108', 'in', 'editorial')[0]?.path ?? '';
    expect(await within(panel).findByRole('button', { name: path })).toBeInTheDocument();
    await waitFor(() => expect(within(panel).getByText(/^\d+ of \d+$/)).toBeInTheDocument());
    await user.keyboard('j');
    await user.keyboard('k');
    expect(seen()).toEqual([]);
  });

  it('opens the journey on the page and closes the inspector', async () => {
    const onUrlUpdate = vi.fn();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { ...OPEN, onUrlUpdate });
    const panel = await panelOf('/pricing');
    await user.click(await within(panel).findByRole('button', { name: 'Open in journey' }));
    await waitFor(() => {
      expect(lastQuery(onUrlUpdate)).toContain('tab=journey');
      expect(lastQuery(onUrlUpdate)).toContain('focus=108');
    });
    expect(lastQuery(onUrlUpdate)).not.toContain('inspect');
    expect(lastQuery(onUrlUpdate)).not.toContain('itab');
  });

  it('closes the inspector when View all in Links opens the Links tab', async () => {
    const onUrlUpdate = vi.fn();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { ...OPEN, onUrlUpdate });
    const panel = await panelOf('/pricing');
    const heading = await within(panel).findByRole('heading', { name: /^Linking pages \(\d+\)$/ });
    await user.click(
      within(heading.closest('section') as HTMLElement).getByRole('button', { name: 'View all in Links' }),
    );
    await waitFor(() => expect(lastQuery(onUrlUpdate)).toContain('tab=links'));
    expect(lastQuery(onUrlUpdate)).toContain('tgt=108');
    expect(lastQuery(onUrlUpdate)).not.toContain('inspect');
  });

  it('closes with Close: the address loses the inspector', async () => {
    const onUrlUpdate = vi.fn();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { ...OPEN, onUrlUpdate });
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
      const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { ...OPEN, onUrlUpdate });
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
      const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), OPEN);
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
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'inspect=page:abc' });
    const panel = await panelOf('Page');
    expect(await within(panel).findByText('Page not found')).toBeInTheDocument();
  });

  it('says a page that is not in the crawl is not in it', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'inspect=page:999999' });
    const panel = await panelOf('Page');
    expect(await within(panel).findByText('This page is not in the latest crawl.')).toBeInTheDocument();
  });

  describe.each(['light', 'dark'])('axe in the %s theme', (theme) => {
    beforeEach(() => document.documentElement.classList.toggle('dark', theme === 'dark'));

    it('has no violations for a page', async () => {
      const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), OPEN);
      const panel = await panelOf('/pricing');
      await within(panel).findByText(/^Manual, set by/);
      await within(panel).findAllByRole('button', { name: /^\// });
      expect(await axe(container)).toHaveNoViolations();
    });

    it('has no violations while the page loads', async () => {
      server.use(http.get(DETAIL, () => new Promise<never>(() => undefined)));
      const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), OPEN);
      const panel = await panelOf('Page');
      expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent('Page');
      expect(await axe(container)).toHaveNoViolations();
    });

    it('has no violations for a page that is not found', async () => {
      const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
        searchParams: 'inspect=page:abc',
      });
      const panel = await panelOf('Page');
      await within(panel).findByText('Page not found');
      expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent('Page');
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
