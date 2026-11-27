import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLinksScenario } from '@/mocks/internal-links-world';
import { mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { EVENTUS_LINKS } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { pagesAs } from '@/test/pages-harness';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/pages/all',
  useSearchParams: () => new URLSearchParams(),
}));

const SUGGESTIONS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/tier-suggestions';
const ACCEPT = mswPath(`${SUGGESTIONS}/accept`);
const DISMISS = mswPath(`${SUGGESTIONS}/dismiss`);

beforeEach(() => stubWideScreen());
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
  document.documentElement.classList.remove('dark');
});

/** The bodies posted to the suggestion routes, in order. */
function posts(): () => { route: string; body: unknown }[] {
  const seen: { route: string; body: unknown }[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname.includes('/tier-suggestions/')) {
      void request
        .clone()
        .json()
        .then((body: unknown) => seen.push({ route: url.pathname.split('/').at(-1) ?? '', body }));
    }
  });
  return () => seen;
}

/** The row of the popover table for a page, found by its path. */
const rowOf = async (path: string): Promise<HTMLElement> => {
  const table = await screen.findByRole('table', { name: 'Suggested tiers' });
  const row = within(table)
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryByText(path) !== null);
  if (row === undefined) throw new Error(`No row for ${path}`);
  return row;
};
const actionOf = async (path: string, name: string): Promise<HTMLElement> =>
  within(await rowOf(path)).getByRole('button', { name });

const chip = (): Promise<HTMLElement> => screen.findByRole('button', { name: /^Suggested tiers \d+$/ });

describe('the Suggested tiers chip and popover', () => {
  it('sits in the table toolbar, after the View menu', async () => {
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    const found = await chip();
    const view = screen.getByRole('button', { name: 'View: All pages' });
    // The menu's trigger is a direct child of the toolbar's bar, so the chip is in the bar when it is inside it
    expect(view.parentElement).toContainElement(found);
    expect(view.compareDocumentPosition(found) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lists each page with its tier now, the suggested tier and the reasons in words', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await user.click(await chip());
    const table = await screen.findByRole('table', { name: 'Suggested tiers' });
    for (const name of ['Page', 'Tier']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    }
    expect(within(table).getByText('/blog/what-is-a-soc')).toBeInTheDocument();
    expect(table).toHaveTextContent(/Clicks in 28 days: 1,810/);
    expect(table).toHaveTextContent(/Ranks #\d+ for “.+” \(.+ searches a month\)/);
    expect(document.body.textContent).not.toMatch(/equity/i);
  });

  it('names the page: its address links to it in a new tab, the title and the reason sit under it, and the tiers read from to', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await user.click(await chip());
    const row = await rowOf('/blog/what-is-a-soc');
    const link = within(row).getByRole('link', { name: /what-is-a-soc/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('/blog/what-is-a-soc'));
    expect(link).toHaveAttribute('target', '_blank');
    expect(row).toHaveTextContent(/T3.*to.*T2/);
    expect(row).toHaveTextContent('What is a SOC?');
    expect(row).toHaveTextContent(/Clicks in 28 days: 1,810/);
    // The row actions are icon buttons that carry their names
    expect(within(row).getByRole('button', { name: 'Accept suggestion' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Dismiss suggestion' })).toBeInTheDocument();
    expect(within(row).queryByText('Accept')).toBeNull();
  });

  it('accepts one page, says how many moved, and the row leaves the list', async () => {
    const sent = posts();
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await user.click(await chip());
    await user.click(await actionOf('/blog/soc-vs-mdr', 'Accept suggestion'));
    expect(await screen.findByText('1 page moved')).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Suggested tiers' });
    await waitFor(() => expect(within(table).queryByText('/blog/soc-vs-mdr')).toBeNull());
    expect(sent()).toEqual([{ route: 'accept', body: { url_ids: ['113'] } }]);
    // The chip counts the rest
    expect(await screen.findByRole('button', { name: 'Suggested tiers 2' })).toBeInTheDocument();
  });

  it('dismisses one page and accepts all the rest', async () => {
    const sent = posts();
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await user.click(await chip());
    await user.click(await actionOf('/blog', 'Dismiss suggestion'));
    expect(await screen.findByText('1 suggestion dismissed')).toBeInTheDocument();
    await waitFor(() => expect(sent()).toHaveLength(1));
    await user.click(await screen.findByRole('button', { name: 'Accept all' }));
    expect(await screen.findByText('2 pages moved')).toBeInTheDocument();
    await waitFor(() => expect(sent().map((entry) => entry.route)).toEqual(['dismiss', 'accept']));
    // The ids of the rows shown go out, never all: the server would move a suggestion that appeared unseen
    expect(sent()[1]?.body).toEqual({ url_ids: expect.arrayContaining([expect.stringMatching(/^\d+$/)]) });
    expect(sent()[1]?.body).not.toHaveProperty('all'); // Nothing left: the chip goes, and focus goes to All pages
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Suggested tiers/ })).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'View: All pages' })).toHaveFocus());
  });

  it('says what the answer says: a count that differs from the rows, and a neutral line for none', async () => {
    server.use(
      http.post(ACCEPT, () => HttpResponse.json({ data: { matched: 3, changed: 1 } })),
      http.post(DISMISS, () => HttpResponse.json({ data: { matched: 1, changed: 0 } })),
    );
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await user.click(await chip());
    await user.click(await screen.findByRole('button', { name: 'Accept all' }));
    expect(await screen.findByText('1 page moved')).toBeInTheDocument();
    await user.click(await actionOf('/blog', 'Dismiss suggestion'));
    expect(await screen.findByText('No suggestions dismissed')).toBeInTheDocument();
  });

  it('says none moved when the answer changed no page', async () => {
    server.use(http.post(ACCEPT, () => HttpResponse.json({ data: { matched: 1, changed: 0 } })));
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await user.click(await chip());
    await user.click(await actionOf('/blog', 'Accept suggestion'));
    expect(await screen.findByText('No pages moved')).toBeInTheDocument();
  });

  it('shows the reason of a refused change (409), and a plain sentence for a failure, and the buttons work again', async () => {
    server.use(
      http.post(ACCEPT, ({ request }) =>
        problem(request, 'invalid_state_transition', { detail: 'The crawl moved on.' }),
      ),
    );
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await user.click(await chip());
    const accept = await actionOf('/blog', 'Accept suggestion');
    await user.click(accept);
    // The toast is also said once through the announcer, so the text may be on the page twice
    expect((await screen.findAllByText('The suggestion could not be saved')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('The crawl moved on.')).length).toBeGreaterThan(0);
    await waitFor(() => expect(accept).toBeEnabled());
    server.use(http.post(ACCEPT, () => HttpResponse.json({ detail: 'database down' }, { status: 500 })));
    await user.click(accept);
    expect((await screen.findAllByText('Try again in a moment.')).length).toBeGreaterThan(0);
    expect(screen.queryByText('database down')).toBeNull();
    await waitFor(() => expect(accept).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Accept all' })).toBeEnabled();
  });

  it('shows no chip when there is nothing to suggest', async () => {
    setLinksScenario({ noSuggestions: true });
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await screen.findByRole('button', { name: 'View: All pages' });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Suggested tiers/ })).toBeNull());
  });

  it('says only ranks are used when Search Console is not connected', async () => {
    setLinksScenario({ gsc: 'not_connected' });
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await user.click(await chip());
    expect(
      await screen.findByText('Search Console is not connected, so only tracked keyword ranks are used.'),
    ).toBeInTheDocument();
  });

  it('shows a viewer the rows without Accept, Dismiss or Accept all', async () => {
    const { user } = renderWithProviders(pagesAs('viewer', 'all', EVENTUS_LINKS));
    await user.click(await chip());
    const table = await screen.findByRole('table', { name: 'Suggested tiers' });
    expect(within(table).getByText('/blog/what-is-a-soc')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Dismiss/ })).toBeNull();
  });

  it.each(['light', 'dark'])('has no axe violations with the popover open, in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await user.click(await chip());
    const table = await screen.findByRole('table', { name: 'Suggested tiers' });
    expect(await axe(table.closest('[data-slot="popover"]') ?? table)).toHaveNoViolations();
  });
});
