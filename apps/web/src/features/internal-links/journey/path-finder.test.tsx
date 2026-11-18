import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HISTORY_RUN_IDS, setLinksScenario } from '@/mocks/internal-links-world';
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

const PATHS = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/paths');
const PROBLEM = { 'content-type': 'application/problem+json' };
const DROPPED_TEXT = /This crawl’s links are no longer stored\. Pick a newer crawl\./;
const KEPT_RUN = HISTORY_RUN_IDS[1] ?? '';
const DROPPED_RUN = HISTORY_RUN_IDS[4] ?? '';

beforeEach(() => stubWideScreen());
afterEach(() => {
  restoreWideScreen();
  server.resetHandlers();
  server.events.removeAllListeners();
  setLinksScenario({ latestLinksDropped: false });
  document.documentElement.classList.remove('dark');
});

const open = (query = '', onUrlUpdate?: (update: { queryString: string; options: { history: string } }) => void) =>
  renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
    searchParams: `tab=journey&jv=paths${query}`,
    ...(onUrlUpdate === undefined ? {} : { onUrlUpdate }),
  });
const pathReads = (): (() => URLSearchParams[]) => {
  const seen: URLSearchParams[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/internal-links/paths')) seen.push(url.searchParams);
  });
  return () => seen;
};
const step = (path: string, id: string, anchor: string | null): object => ({
  page: { path, url: `https://eventussecurity.com${path}`, url_id: id, tier: null },
  status_code: 200,
  anchor,
  placement: anchor === null ? null : 'content',
  scope: anchor === null ? null : 'editorial',
  via_redirect: false,
});
const target = { path: '/x', url: 'https://eventussecurity.com/x', url_id: '120', tier: null };

describe('the Path finder (spec 7.10)', () => {
  it('shows the route over any link and over editorial links only for the focus page', async () => {
    open('&focus=103');
    expect(await screen.findByRole('heading', { name: 'Over any link 1 click' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Over editorial links only 1 click' })).toBeInTheDocument();
    expect(screen.getAllByRole('list')).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/equity/i);
  });

  it('says so when only menus and auto generated links lead to the page', async () => {
    open('&focus=114');
    expect(await screen.findByRole('heading', { name: 'Over any link 2 clicks' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'No editorial links lead here from the home page. It is reached only through menus or auto-generated links.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Over editorial links only/ })).not.toBeInTheDocument();
  });

  it('says so when the page cannot be reached from the home page', async () => {
    open('&focus=117');
    expect(await screen.findByText('This page cannot be reached from the home page.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('says how many clicks the menus save when the editorial route is longer', async () => {
    server.use(
      http.get(PATHS, () =>
        HttpResponse.json({
          data: {
            target,
            any: { clicks: 1, steps: [step('/', '101', null), step('/x', '120', 'X')] },
            editorial: {
              clicks: 3,
              steps: [step('/', '101', null), step('/a', '121', 'A'), step('/b', '122', 'B'), step('/x', '120', 'X')],
            },
          },
        }),
      ),
    );
    open('&focus=103');
    expect(
      await screen.findByText('Menus make this page 2 clicks closer than the editorial links do.'),
    ).toBeInTheDocument();
  });

  it('has one page picker, named for the way in this view and for the focus in the others', async () => {
    open('&focus=103');
    await screen.findByRole('heading', { name: 'Over any link 1 click' });
    expect(screen.getAllByRole('combobox', { name: /^(Find the way to|Focus page): / })).toHaveLength(1);
    expect(
      screen.getByRole('combobox', { name: 'Find the way to: /services/soc-as-a-service. Change it.' }),
    ).toBeInTheDocument();
  });

  it('keeps the focus page picker in the canvas view', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=journey&focus=103' });
    expect(
      await screen.findByRole('combobox', { name: 'Focus page: /services/soc-as-a-service. Change it.' }),
    ).toBeInTheDocument();
  });

  it('hides the layout switch and the lane chips, which belong to the canvas', async () => {
    open('&focus=103&jl=tier');
    await screen.findByRole('heading', { name: 'Over any link 1 click' });
    expect(screen.queryByRole('radiogroup', { name: /layout/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^By tier/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /tiers/i })).not.toBeInTheDocument();
  });

  it('is reached from the view switch', async () => {
    const seen: string[] = [];
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
      onUrlUpdate: (update) => seen.push(decodeURIComponent(update.queryString)),
    });
    const radios = await screen.findByRole('radiogroup', { name: 'View' });
    await user.click(within(radios).getByRole('radio', { name: 'Path finder' }));
    await waitFor(() => expect(seen.at(-1)).toContain('jv=paths'));
  });

  it('opens the focus page in the canvas, dropping the view from the address', async () => {
    const seen: string[] = [];
    const { user } = open('&focus=114', (update) => seen.push(decodeURIComponent(update.queryString)));
    await user.click(await screen.findByRole('button', { name: 'Open in canvas' }));
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen.at(-1)).toContain('focus=114');
    expect(seen.at(-1)).not.toContain('jv=');
  });

  it('sends the crawl in view with the read', async () => {
    const asked = pathReads();
    open(`&focus=103&run=${KEPT_RUN}`);
    await screen.findByRole('heading', { name: 'Over any link 1 click' });
    expect(asked().at(-1)?.get('run')).toBe(KEPT_RUN);
    expect(asked().at(-1)?.get('url_id')).toBe('103');
  });

  it('shows the error with Try again, and reads again on it', async () => {
    server.use(
      http.get(
        PATHS,
        () => HttpResponse.json({ type: 'about:blank', title: 'Oops', status: 500 }, { status: 500, headers: PROBLEM }),
        { once: true },
      ),
    );
    const { user } = open('&focus=103');
    expect(await screen.findByText('The route could not be loaded.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Over any link 1 click' })).toBeInTheDocument();
  });

  it('shows a neutral not found, without Try again, for a page the crawl does not hold', async () => {
    server.use(
      http.get(PATHS, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Not found', status: 404, code: 'not_found' },
          { status: 404, headers: PROBLEM },
        ),
      ),
    );
    open('&focus=103');
    expect(await screen.findByText('This page is not in the crawl')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('shows the links dropped state when the read answers 410', async () => {
    server.use(
      http.get(PATHS, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Gone', status: 410, code: 'links_dropped' },
          { status: 410, headers: PROBLEM },
        ),
      ),
    );
    open('&focus=103');
    expect(await screen.findByText(DROPPED_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('makes no read for a crawl whose links were dropped', async () => {
    const asked = pathReads();
    open(`&focus=103&run=${DROPPED_RUN}`);
    expect(await screen.findByText(DROPPED_TEXT)).toBeInTheDocument();
    expect(asked()).toHaveLength(0);
  });

  it('shows the existing not found state for a focus that is no page id, and makes no read', async () => {
    const asked = pathReads();
    open('&focus=12x');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(asked()).toHaveLength(0);
  });

  it('has no accessibility violations in the light and the dark theme', async () => {
    const { container } = open('&focus=103');
    await screen.findByRole('heading', { name: 'Over any link 1 click' });
    expect(await axe(container)).toHaveNoViolations();
    document.documentElement.classList.add('dark');
    expect(await axe(container)).toHaveNoViolations();
  });
});
