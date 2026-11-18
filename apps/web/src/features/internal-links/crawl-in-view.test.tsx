import { screen, waitFor } from '@testing-library/react';
import { http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { HISTORY_RUN_IDS, setLinksScenario } from '@/mocks/internal-links-world';
import { mswPath, problem } from '@/mocks/respond';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

const LATEST = HISTORY_RUN_IDS[0] ?? '';
const OLDER = HISTORY_RUN_IDS[1] ?? '';
const DROPPED = HISTORY_RUN_IDS[4] ?? '';
const DROPPED_TEXT = /This crawl’s links are no longer stored\. Pick a newer crawl\./;
const PAGES = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages');
const READS = [
  '/internal-links/pages',
  '/internal-links/edges',
  '/internal-links/tier-flow',
  '/internal-links/worklists',
];

beforeEach(() => stubWideScreen());
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
});

/** The internal links reads the screen makes, by route and query. */
function reads(): () => URL[] {
  const seen: URL[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (READS.some((route) => url.pathname.endsWith(route))) seen.push(url);
  });
  return () => seen;
}
const routeOf = (url: URL): string => READS.find((route) => url.pathname.endsWith(route)) ?? '';

describe('the crawl in view', () => {
  it('sends the chosen crawl with every read of the Pages tab: the list, the summary strip and the worklist chips', async () => {
    const seen = reads();
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: `?run=${OLDER}` });
    await screen.findByRole('grid', { name: 'Pages' });
    await waitFor(() => {
      const routes = new Set(seen().map(routeOf));
      expect(routes).toEqual(
        new Set(['/internal-links/pages', '/internal-links/tier-flow', '/internal-links/worklists']),
      );
    });
    for (const url of seen()) expect(url.searchParams.get('run')).toBe(OLDER);
  });

  it('sends the chosen crawl with the reads of the Links and Tier flow tabs', async () => {
    const seen = reads();
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: `?tab=links&run=${OLDER}` });
    await screen.findByRole('grid', { name: 'Links' });
    expect(seen().filter((url) => routeOf(url) === '/internal-links/edges').length).toBeGreaterThan(0);
    for (const url of seen()) expect(url.searchParams.get('run')).toBe(OLDER);
  });

  it('sends no run for the latest crawl, named or not, so its reads are the ones it always made', async () => {
    const seen = reads();
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: `?tab=links&run=${LATEST}` });
    await screen.findByRole('grid', { name: 'Links' });
    expect(seen().length).toBeGreaterThan(0);
    for (const url of seen()) expect(url.searchParams.has('run')).toBe(false);
  });

  it('shows not found for a malformed or unknown crawl id, reads no tab and does not throw', async () => {
    for (const run of ['not-a-uuid', '0192e4a0-1000-7000-8000-0000000000ff']) {
      const seen = reads();
      const { unmount } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
        searchParams: `?run=${run}`,
      });
      await screen.findByRole('heading', { name: 'That crawl was not found' });
      // The header still reads the latest crawl; the Pages tab reads nothing
      await waitFor(() => expect(seen().length).toBeGreaterThan(0));
      expect(seen().some((url) => routeOf(url) === '/internal-links/pages')).toBe(false);
      for (const url of seen()) expect(url.searchParams.has('run')).toBe(false);
      unmount();
      server.events.removeAllListeners();
    }
  });

  it('says plainly that the links of a crawl past the last four are no longer stored, with no Try again', async () => {
    const seen = reads();
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: `?tab=links&run=${DROPPED}` });
    expect(await screen.findByText(DROPPED_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(seen().some((url) => routeOf(url) === '/internal-links/edges')).toBe(false);
  });

  it('shows the same message on the Journey tab of such a crawl, and none on a crawl that kept its links', async () => {
    const { unmount } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: `?tab=journey&run=${DROPPED}`,
    });
    expect(await screen.findByText(DROPPED_TEXT)).toBeInTheDocument();
    unmount();
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: `?tab=journey&run=${OLDER}` });
    await waitFor(() => expect(document.getElementById('journey-title')).not.toBeNull());
    expect(screen.queryByText(DROPPED_TEXT)).not.toBeInTheDocument();
  });
});

describe('a crawl whose links are gone', () => {
  afterEach(() => setLinksScenario({ latestLinksDropped: false }));

  it('makes no neighbors read from the inspector, and says so in its link sections', async () => {
    const seen: string[] = [];
    server.events.on('request:start', ({ request }) => {
      seen.push(new URL(request.url).pathname);
    });
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: `?run=${DROPPED}&inspect=page:108`,
    });
    expect((await screen.findAllByText(DROPPED_TEXT)).length).toBe(2);
    expect(seen.some((path) => path.endsWith('/internal-links/neighbors'))).toBe(false);
  });

  it('is the same when it is also the latest crawl: no run is sent and the Links tab shows the message', async () => {
    setLinksScenario({ latestLinksDropped: true });
    const seen = reads();
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=links' });
    expect(await screen.findByText(DROPPED_TEXT)).toBeInTheDocument();
    expect(seen().some((url) => routeOf(url) === '/internal-links/edges')).toBe(false);
    for (const url of seen()) expect(url.searchParams.has('run')).toBe(false);
  });

  it('shows the message, not an error, when the Pages list itself answers 410', async () => {
    server.use(http.get(PAGES, ({ request }) => problem(request, 'links_dropped')));
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: `?run=${OLDER}` });
    expect(await screen.findByText(DROPPED_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('falls back to Pages for a tab id with no tab yet (?tab=opportunities)', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=opportunities' });
    expect(await screen.findByRole('grid', { name: 'Pages' })).toBeInTheDocument();
  });
});
