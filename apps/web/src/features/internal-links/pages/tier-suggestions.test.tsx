import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLinksScenario } from '@/mocks/internal-links-world';
import { mswPath, problem } from '@/mocks/respond';
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

const chip = (): Promise<HTMLElement> => screen.findByRole('button', { name: /^Suggested tiers \d+$/ });

describe('the Suggested tiers chip and popover', () => {
  it('lists each page with its tier now, the suggested tier and the reasons in words', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await chip());
    const table = await screen.findByRole('table', { name: 'Suggested tiers' });
    for (const name of ['Page', 'Now', 'Suggested', 'Why']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    }
    expect(within(table).getByText('/blog/what-is-a-soc')).toBeInTheDocument();
    expect(table).toHaveTextContent(/Clicks in 28 days: 1,810/);
    expect(table).toHaveTextContent(/Ranks #\d+ for “.+” \(.+ searches a month\)/);
    expect(document.body.textContent).not.toMatch(/equity/i);
  });

  it('accepts one page, says how many moved, and the row leaves the list', async () => {
    const sent = posts();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await chip());
    await user.click(await screen.findByRole('button', { name: 'Accept the suggestion for /blog/soc-vs-mdr' }));
    expect(await screen.findByText('1 page moved')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Accept the suggestion for /blog/soc-vs-mdr' })).toBeNull(),
    );
    expect(sent()).toEqual([{ route: 'accept', body: { url_ids: ['113'] } }]);
    // The chip counts the rest
    expect(await screen.findByRole('button', { name: 'Suggested tiers 2' })).toBeInTheDocument();
  });

  it('dismisses one page and accepts all the rest', async () => {
    const sent = posts();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await chip());
    await user.click(await screen.findByRole('button', { name: 'Dismiss the suggestion for /blog' }));
    expect(await screen.findByText('1 suggestion dismissed')).toBeInTheDocument();
    await waitFor(() => expect(sent()).toHaveLength(1));
    await user.click(await screen.findByRole('button', { name: 'Accept all' }));
    expect(await screen.findByText('2 pages moved')).toBeInTheDocument();
    await waitFor(() => expect(sent().map((entry) => entry.route)).toEqual(['dismiss', 'accept']));
    // The ids of the rows shown go out, never all: the server would move a suggestion that appeared unseen
    expect(sent()[1]?.body).toEqual({ url_ids: expect.arrayContaining([expect.stringMatching(/^\d+$/)]) });
    expect(sent()[1]?.body).not.toHaveProperty('all'); // Nothing left: the chip goes, and focus goes to All pages
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Suggested tiers/ })).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'All pages' })).toHaveFocus());
  });

  it('says what the answer says: a count that differs from the rows, and a neutral line for none', async () => {
    server.use(
      http.post(ACCEPT, () => HttpResponse.json({ data: { matched: 3, changed: 1 } })),
      http.post(DISMISS, () => HttpResponse.json({ data: { matched: 1, changed: 0 } })),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await chip());
    await user.click(await screen.findByRole('button', { name: 'Accept all' }));
    expect(await screen.findByText('1 page moved')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Dismiss the suggestion for /blog' }));
    expect(await screen.findByText('No suggestions dismissed')).toBeInTheDocument();
  });

  it('says none moved when the answer changed no page', async () => {
    server.use(http.post(ACCEPT, () => HttpResponse.json({ data: { matched: 1, changed: 0 } })));
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await chip());
    await user.click(await screen.findByRole('button', { name: 'Accept the suggestion for /blog' }));
    expect(await screen.findByText('No pages moved')).toBeInTheDocument();
  });

  it('shows the reason of a refused change (409), and a plain sentence for a failure, and the buttons work again', async () => {
    server.use(
      http.post(ACCEPT, ({ request }) =>
        problem(request, 'invalid_state_transition', { detail: 'The crawl moved on.' }),
      ),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await chip());
    const accept = await screen.findByRole('button', { name: 'Accept the suggestion for /blog' });
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
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await screen.findByRole('button', { name: 'All pages' });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Suggested tiers/ })).toBeNull());
  });

  it('says only ranks are used when Search Console is not connected', async () => {
    setLinksScenario({ gsc: 'not_connected' });
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await chip());
    expect(
      await screen.findByText('Search Console is not connected, so only tracked keyword ranks are used.'),
    ).toBeInTheDocument();
  });

  it('shows a viewer the rows without Accept, Dismiss or Accept all', async () => {
    const { user } = renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS));
    await user.click(await chip());
    const table = await screen.findByRole('table', { name: 'Suggested tiers' });
    expect(within(table).getByText('/blog/what-is-a-soc')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Dismiss/ })).toBeNull();
  });

  it.each(['light', 'dark'])('has no axe violations with the popover open, in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await chip());
    const table = await screen.findByRole('table', { name: 'Suggested tiers' });
    expect(await axe(table.closest('[data-slot="popover"]') ?? table)).toHaveNoViolations();
  });
});
