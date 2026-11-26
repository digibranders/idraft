import { screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_REGION_ID } from '@/lib/a11y/announcer';
import { formatInteger } from '@/lib/format';
import type { PagesOverview } from '@/lib/internal-links/types';
import { crawledPages, MOCK_RUN_ID, pageRow } from '@/mocks/internal-links-world';
import { overviewOf } from '@/mocks/internal-links-inventory';
import { mswPath } from '@/mocks/respond';
import { EVENTUS_LINKS } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { pagesAs } from '@/test/pages-harness';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRenderOptions } from '@/test/render';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/pages/all',
  useSearchParams: () => new URLSearchParams(),
}));

const BASE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links';
const OVERVIEW = mswPath(`${BASE}/overview`);
const WORKLISTS = mswPath(`${BASE}/worklists`);

beforeEach(() => stubWideScreen());
afterEach(() => {
  push.mockClear();
  restoreWideScreen();
  server.events.removeAllListeners();
});

const overview = (sitemap = true): PagesOverview =>
  overviewOf(
    crawledPages().map((page) => pageRow(page, 'all')),
    { run_id: MOCK_RUN_ID, finished_at: null, sitemap },
  );
const serve = (value: PagesOverview): void => server.use(http.get(OVERVIEW, () => HttpResponse.json({ data: value })));

const trigger = (name: string): Promise<HTMLElement> => screen.findByRole('button', { name });
/** Opens the menu once its counts have come. */
async function open(user: ReturnType<typeof renderWithProviders>['user'], current = 'View: All pages'): Promise<void> {
  await user.click(await trigger(current));
  const menu = await screen.findByRole('menu');
  await waitFor(() =>
    expect(within(menu).getByRole('menuitemradio', { name: 'Live pages' })).toHaveAccessibleDescription(/\d/),
  );
}
const render = (search = '', extra: Partial<ProvidedRenderOptions> = {}): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: search, ...extra });
const names = (): string[] =>
  screen.getAllByRole('menuitemradio').map((item) => item.querySelector('span.flex-1')?.textContent ?? '');

describe('the View menu', () => {
  it('reads "View: All pages" with no view and lists the sections and views of spec 7.3, each with its count', async () => {
    const { user } = render();
    await open(user);
    const menu = screen.getByRole('menu');
    for (const section of ['Pages', 'Sitemap', 'Reach', 'Link problems']) {
      expect(within(menu).getByText(section)).toBeInTheDocument();
    }
    const listed = names();
    expect(listed.slice(0, 4)).toEqual(['All pages', 'Live pages', 'Indexable', 'Not indexable']);
    expect(listed).toEqual(expect.arrayContaining(['Indexable and in the sitemap', 'Reachable by links', 'Orphans']));
    expect(listed.indexOf('Reachable by links')).toBeGreaterThan(listed.indexOf('Missing from the sitemap'));
    expect(listed.indexOf('Orphans')).toBeGreaterThan(listed.indexOf('Not reachable by links'));
    const data = overview();
    expect(within(menu).getByRole('menuitemradio', { name: 'Live pages' })).toHaveAccessibleDescription(
      formatInteger(data.status.live),
    );
    expect(within(menu).getByRole('menuitemradio', { name: 'All pages' })).toHaveAccessibleDescription(
      formatInteger(data.addresses - data.status.variant),
    );
    expect(within(menu).getByRole('menuitemradio', { name: 'All pages' })).toBeChecked();
  });

  it('hides a view that counts 0 unless it is the active one', async () => {
    serve({ ...overview(), status: { ...overview().status, redirected: 0 } });
    const first = render();
    await open(first.user);
    expect(names()).not.toContain('Redirects');
    first.unmount();
    // The same view is listed when the address chooses it
    const second = render('?view=redirects');
    await open(second.user, 'View: Redirects');
    expect(names()).toContain('Redirects');
  });

  it('has no Sitemap section when the crawl found no sitemap, and still names the active view on the trigger', async () => {
    serve(overview(false));
    const { user } = render('?view=not_in_sitemap');
    await user.click(await trigger('View: Missing from the sitemap'));
    await screen.findByRole('menu');
    await waitFor(() =>
      expect(screen.getByRole('menuitemradio', { name: 'Live pages' })).toHaveAccessibleDescription(/\d/),
    );
    expect(screen.queryByText('Sitemap')).toBeNull();
    expect(names()).not.toContain('Missing from the sitemap');
  });

  it('lists Client errors only while the address chooses it, and Parameter variants while they are counted', async () => {
    serve({ ...overview(), status: { ...overview().status, variant: 148 } });
    const first = render();
    await open(first.user);
    expect(names()).not.toContain('Client errors');
    expect(names()).toContain('Parameter variants');
    first.unmount();
    const active = render('?view=client_errors');
    await open(active.user, 'View: Client errors');
    expect(names()).toContain('Client errors');
    active.unmount();
    serve({ ...overview(), status: { ...overview().status, variant: 0 } });
    const none = render();
    await open(none.user);
    expect(names()).not.toContain('Parameter variants');
  });

  it('writes the view with a history entry, announces its total, and All pages clears it', async () => {
    const updates: { queryString: string; history: string | undefined }[] = [];
    const { user } = render('', {
      onUrlUpdate: ({ queryString, options }) => updates.push({ queryString, history: options.history }),
    });
    await open(user);
    await user.click(screen.getByRole('menuitemradio', { name: 'Live pages' }));
    await waitFor(() => expect(updates.at(-1)?.queryString).toContain('view=live'));
    expect(updates.at(-1)?.history).toBe('push');
    await waitFor(() =>
      expect(document.getElementById(LIVE_REGION_ID.polite)).toHaveTextContent(/^Live pages: [\d,]+ pages?$/),
    );
    await user.click(await trigger('View: Live pages'));
    await user.click(await screen.findByRole('menuitemradio', { name: 'All pages' }));
    await waitFor(() => expect(updates.at(-1)?.queryString).not.toContain('view='));
    expect(await trigger('View: All pages')).toBeInTheDocument();
  });

  it('sends the server view as filter[view] and a page worklist as filter[worklist], never both', async () => {
    const reads: URLSearchParams[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/internal-links/pages')) reads.push(url.searchParams);
    });
    const { user } = render('?view=live');
    await screen.findByRole('grid', { name: 'Pages' });
    await waitFor(() => expect(reads.some((read) => read.get('filter[view]') === 'live')).toBe(true));
    await user.click(await trigger('View: Live pages'));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Orphans' }));
    await waitFor(() => expect(reads.some((read) => read.get('filter[worklist]') === 'orphans')).toBe(true));
    for (const read of reads) expect(read.has('filter[view]') && read.has('filter[worklist]')).toBe(false);
  });

  it('narrows to a page worklist from the menu and back to all pages', async () => {
    const { user } = render();
    await open(user);
    await user.click(screen.getByRole('menuitemradio', { name: 'Orphans' }));
    expect(await trigger('View: Orphans')).toBeInTheDocument();
    expect(
      await within(await screen.findByRole('grid', { name: 'Pages' })).findByRole('rowheader', { name: '/partners' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('grid', { name: 'Pages' })).queryByText('/pricing')).toBeNull());
    await user.click(await trigger('View: Orphans'));
    await user.click(await screen.findByRole('menuitemradio', { name: 'All pages' }));
    expect(
      await within(await screen.findByRole('grid', { name: 'Pages' })).findByRole('rowheader', { name: '/pricing' }),
    ).toBeInTheDocument();
  });

  it('writes the tier filter for Untiered and clears the view', async () => {
    const updates: string[] = [];
    const { user } = render('?view=live', { onUrlUpdate: ({ queryString }) => updates.push(queryString) });
    await open(user, 'View: Live pages');
    await user.click(screen.getByRole('menuitemradio', { name: 'Untiered' }));
    await waitFor(() => expect(updates.some((query) => query.includes('tier=none'))).toBe(true));
    await waitFor(() => expect(updates.at(-1)).not.toContain('view='));
    expect(await trigger('View: Untiered')).toBeInTheDocument();
  });

  it('opens Internal links, Links for the two link lists', async () => {
    const { user } = render();
    await open(user);
    const edge = screen.getByRole('menuitem', { name: 'Broken and redirected links' });
    expect(edge).toHaveAccessibleDescription('Opens Internal links, Links');
    await user.click(edge);
    await waitFor(() => expect(push).toHaveBeenCalled());
    const [address] = push.mock.calls.at(-1) as [string];
    expect(address).toContain('lview=broken_and_redirected');
  });

  it('shows no counts while they load and still lets a view be chosen', async () => {
    server.use(
      http.get(OVERVIEW, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    const updates: string[] = [];
    const { user } = render('', { onUrlUpdate: ({ queryString }) => updates.push(queryString) });
    await user.click(await trigger('View: All pages'));
    const live = await screen.findByRole('menuitemradio', { name: 'Live pages' });
    expect(live).not.toHaveAccessibleDescription();
    await user.click(live);
    await waitFor(() => expect(updates.at(-1)).toContain('view=live'));
  });

  it('says in its last line that the counts may be incomplete, and when no link list has an issue', async () => {
    server.use(
      http.get(WORKLISTS, () =>
        HttpResponse.json({
          data: {
            run_id: MOCK_RUN_ID,
            may_be_incomplete: true,
            under_linked_t1: 0,
            orphans: 0,
            editorial_orphans: 0,
            deep_only_through_auto: 0,
            lost_links_top: 0,
            weak_outlinks: 0,
            broken_and_redirected: 0,
            links_to_non_indexable: 0,
          },
        }),
      ),
    );
    const { user } = render();
    await user.click(await trigger('View: All pages'));
    const menu = await screen.findByRole('menu');
    const last = await within(menu).findByText('May be incomplete');
    expect(within(menu).getByText('No issues')).toBeInTheDocument();
    const all = within(menu).getAllByRole('menuitem');
    expect(all.at(-1)).toContainElement(last);
    // Reachable and announced by its name: not disabled, and no description that points at nothing
    const line = within(menu).getByRole('menuitem', { name: 'May be incomplete' });
    expect(line).not.toHaveAttribute('aria-disabled', 'true');
    expect(line).not.toHaveAttribute('aria-describedby');
    expect(within(menu).getByRole('menuitem', { name: 'No issues' })).not.toHaveAttribute('aria-describedby');
  });

  it('opens with the keyboard, picks with Enter and gives focus back to the trigger', async () => {
    const updates: string[] = [];
    const { user } = render('', { onUrlUpdate: ({ queryString }) => updates.push(queryString) });
    const button = await trigger('View: All pages');
    button.focus();
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    await waitFor(() =>
      expect(within(menu).getByRole('menuitemradio', { name: 'Live pages' })).toHaveAccessibleDescription(/\d/),
    );
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(updates.at(-1)).toContain('view='));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(await screen.findByRole('button', { name: /^View: / })).toHaveFocus();
  });
});
