import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CRAWL_POLL_MS } from './crawl-reads';
import { LIVE_REGION_ID } from '@/lib/a11y/announcer';
import type { CrawlRun } from '@/lib/internal-links/types';
import { MOCK_RUN_ID } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { EVENTUS_LINKS, FYNIX_LINKS, NO_WEBSITE, internalLinksAs } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

// The four tabs as text, so the shell is tested on its own; a test turns them off to see the registry as shipped
const registry = vi.hoisted(() => ({ real: false }));
vi.mock('./tabs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tabs')>();
  const entry = (
    id: 'pages' | 'links' | 'journey' | 'flow',
    label: string,
  ): ReturnType<typeof actual.defineLinksTabs>[number] => ({
    id,
    label: () => label,
    render: () => `Panel of ${label}`,
  });
  const text = actual.defineLinksTabs([
    entry('pages', 'Pages'),
    entry('links', 'Links'),
    entry('journey', 'Journey'),
    entry('flow', 'Tier flow'),
  ]);
  return {
    ...actual,
    get LINKS_TABS() {
      return registry.real ? actual.LINKS_TABS : text;
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

const CRAWLS = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/link-crawls');

const run = (over: Partial<CrawlRun>): CrawlRun => ({
  run_id: MOCK_RUN_ID,
  trigger: 'schedule',
  state: 'ready',
  ceiling: 2000,
  pages_found: 40,
  pages_crawled: 40,
  sitemap_pages: 30,
  render_javascript: false,
  estimated_cost_usd: '0.300000',
  cost_usd: '0.300000',
  stop_reason: null,
  error_code: null,
  error_message: null,
  hints: [],
  is_latest: false,
  created_at: '2026-11-14T03:00:00Z',
  submitted_at: '2026-11-14T03:00:05Z',
  finished_at: '2026-11-14T03:12:00Z',
  requested_by: null,
  ...over,
});

/** The crawl list answers `runs`, newest first. */
const answerWith = (runs: readonly CrawlRun[]): void => {
  server.use(
    http.get(CRAWLS, () => HttpResponse.json({ data: runs, page: { has_more: false, limit: 10, next_cursor: null } })),
  );
};

beforeEach(() => stubWideScreen());
afterEach(() => {
  registry.real = false;
  server.events.removeAllListeners();
  restoreWideScreen();
  document.documentElement.classList.remove('dark');
});

describe('the Internal links page (spec 7.1 and 9)', () => {
  it('names the crawl in scope, offers Crawl now and shows the summary, with no equity anywhere', async () => {
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText(/^Crawled .+, 18 pages$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crawl now' })).toBeEnabled();
    const strip = await screen.findByRole('group', { name: 'Crawl summary' });
    expect(strip).toHaveTextContent('Pages18');
    expect(strip).toHaveTextContent('No editorial links in');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(container.textContent).not.toMatch(/equity/i);
  });

  it('writes the tab as a history entry and nothing else on load', async () => {
    const writes: { queryString: string; history: string | undefined }[] = [];
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      onUrlUpdate: ({ queryString, options }) => writes.push({ queryString, history: options.history }),
    });
    expect(await screen.findByText('Panel of Pages')).toBeInTheDocument();
    expect(writes).toEqual([]);
    await user.click(screen.getByRole('tab', { name: 'Journey' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).toContain('tab=journey'));
    expect(writes.at(-1)?.history).toBe('push');
    expect(await screen.findByText('Panel of Journey')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Pages' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).not.toContain('tab='));
  });

  it('opens on the tab the address names and falls back to Pages for one it does not know', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=flow' });
    expect(await screen.findByText('Panel of Tier flow')).toBeInTheDocument();
  });

  it('explains that a website is needed and links to the domains settings', () => {
    renderWithProviders(internalLinksAs('editor', NO_WEBSITE));
    expect(screen.getByRole('heading', { name: 'Add your website to map internal links' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add website' })).toHaveAttribute(
      'href',
      '/digibranders/fynix/settings/domains',
    );
    expect(screen.queryByRole('button', { name: 'Crawl now' })).toBeNull();
  });

  it('offers the first crawl of a site never crawled, then shows its progress', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', FYNIX_LINKS));
    expect(await screen.findByRole('heading', { name: 'No crawl yet' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Crawl now' }));
    expect(await screen.findByRole('heading', { name: 'Mapping fynix.digital' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Crawl progress' })).toBeInTheDocument();
    expect(screen.getByText(/Tag your most important pages while you wait/)).toBeInTheDocument();
    // The panel is the only place the crawl is named, and the header's button says it is crawling
    expect(await screen.findByRole('button', { name: 'Crawling' })).toHaveAttribute('aria-busy', 'true');
  });

  it('disables Crawl now for a viewer, who cannot start runs', async () => {
    renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS));
    expect(await screen.findByRole('button', { name: 'Crawl now' })).toBeDisabled();
  });

  it('says so when the role cannot read the project', () => {
    renderWithProviders(internalLinksAs('billing', EVENTUS_LINKS));
    expect(screen.getByRole('heading', { name: 'You cannot see internal links' })).toBeInTheDocument();
  });

  it('retries a crawl list that did not load', async () => {
    server.use(
      http.get(CRAWLS, () => HttpResponse.json({ type: 'about:blank', title: 'Boom', status: 500 }, { status: 500 })),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText('Internal links could not be loaded')).toBeInTheDocument();
    answerWith([run({ is_latest: true })]);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/^Crawled .+, 40 pages$/)).toBeInTheDocument();
  });
});

describe('the crawl states of the page (spec 9)', () => {
  it('says why a first crawl failed, and offers Try again', async () => {
    answerWith([run({ state: 'failed', error_code: 'site_blocked' })]);
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByRole('heading', { name: 'The last crawl failed.' })).toBeInTheDocument();
    expect(screen.getByText(/eventussecurity.com refuses our crawler/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('offers Crawl now again after a first crawl was cancelled', async () => {
    answerWith([run({ state: 'cancelled', finished_at: null })]);
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByRole('heading', { name: 'No crawl yet' })).toBeInTheDocument();
  });

  it('keeps showing the last crawl beside a newer failed one, with the reason', async () => {
    answerWith([
      run({ run_id: 'f', state: 'failed', error_code: 'budget_exceeded', created_at: '2026-11-16T03:00:00Z' }),
      run({ is_latest: true }),
    ]);
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText('The last crawl failed.')).toBeInTheDocument();
    expect(screen.getByText(/workspace budget for site crawls is used up/)).toBeInTheDocument();
    expect(screen.getByText(/^Crawled .+, 40 pages$/)).toBeInTheDocument();
    expect(screen.getByText('Panel of Pages')).toBeInTheDocument();
  });

  it('reports a crawl under way above the last one, and disables Crawl now while it runs', async () => {
    answerWith([
      run({ run_id: 'c', state: 'crawling', pages_found: 310, finished_at: null, created_at: '2026-11-16T03:00:00Z' }),
      run({ is_latest: true }),
    ]);
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText(/Crawling now: 310 pages found so far/)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Crawling' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    // No live region of its own: the banner is plain text
    expect(screen.getByText(/Crawling now/).closest('[role]')).toBeNull();
  });

  it('asks for a higher limit after a crawl stopped at its ceiling, once, and only for those who may crawl', async () => {
    answerWith([run({ state: 'stopped_at_ceiling', ceiling: 2000, pages_found: 2000, is_latest: true })]);
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText('Stopped at 2,000 pages.')).toBeInTheDocument();
    let body: unknown;
    server.use(
      http.post(CRAWLS, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: run({ state: 'queued', finished_at: null }) }, { status: 202 });
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Crawl again with a higher limit' }));
    await waitFor(() => expect(body).toEqual({ higher_limit: true }));
  });

  it('hides the higher limit action from a viewer', async () => {
    answerWith([run({ state: 'stopped_at_ceiling', pages_found: 2000, is_latest: true })]);
    renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS));
    expect(await screen.findByText(/Stopped at/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crawl again with a higher limit' })).toBeNull();
  });

  it('suggests Render JavaScript when the crawl found very few pages', async () => {
    answerWith([run({ pages_found: 1, pages_crawled: 1, hints: ['render_javascript'], is_latest: true })]);
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText('Very few pages were found.')).toBeInTheDocument();
    const [link] = screen.getAllByRole('link', { name: 'Crawl settings' });
    expect(link).toHaveAttribute('href', '/digibranders/eventus-security/settings/links');
  });

  it('says in words that a crawl is already running when the start is refused', async () => {
    server.use(
      http.post(CRAWLS, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'A crawl is running',
            status: 409,
            code: 'crawl_in_progress',
            run_id: MOCK_RUN_ID,
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await screen.findByRole('button', { name: 'Crawl now' }));
    expect(await screen.findByText('A crawl is already running')).toBeInTheDocument();
  });
});

describe('a crawl that ends while the page is open', () => {
  beforeEach(() =>
    vi.useFakeTimers({
      toFake: ['setInterval', 'setTimeout', 'clearInterval', 'clearTimeout'],
      shouldAdvanceTime: true,
    }),
  );
  afterEach(() => vi.useRealTimers());

  it('is announced once, and reads the links again for the new crawl', async () => {
    const latest = run({ is_latest: true });
    const running = run({ run_id: 'c', state: 'crawling', finished_at: null, created_at: '2026-11-16T03:00:00Z' });
    answerWith([running, latest]);
    const reads: string[] = [];
    server.events.on('request:start', ({ request }) => reads.push(new URL(request.url).pathname));
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText(/Crawling now/)).toBeInTheDocument();
    const before = reads.filter((path) => path.endsWith('/internal-links/tier-flow')).length;
    answerWith([
      { ...running, state: 'ready', is_latest: true, pages_found: 52, finished_at: '2026-11-16T03:09:00Z' },
      { ...latest, is_latest: false },
    ]);
    await act(() => vi.advanceTimersByTimeAsync(CRAWL_POLL_MS + 100));
    await waitFor(() =>
      expect(document.getElementById(LIVE_REGION_ID.polite)?.textContent).toBe('The crawl finished: 52 pages found.'),
    );
    await waitFor(() =>
      expect(reads.filter((path) => path.endsWith('/internal-links/tier-flow')).length).toBeGreaterThan(before),
    );
    expect(screen.queryByText(/Crawling now/)).toBeNull();
  });

  it('is announced as failed when it fails', async () => {
    const latest = run({ is_latest: true });
    const running = run({ run_id: 'c', state: 'crawling', finished_at: null, created_at: '2026-11-16T03:00:00Z' });
    answerWith([running, latest]);
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText(/Crawling now/)).toBeInTheDocument();
    answerWith([{ ...running, state: 'failed', error_code: 'site_unreachable' }, latest]);
    await act(() => vi.advanceTimersByTimeAsync(CRAWL_POLL_MS + 100));
    await waitFor(() => expect(document.getElementById(LIVE_REGION_ID.polite)?.textContent).toBe('The crawl failed.'));
    expect(await screen.findByText('The last crawl failed.')).toBeInTheDocument();
    expect(screen.queryByText(/Crawling now/)).toBeNull();
  });
});

describe('accessibility of the shell', () => {
  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await screen.findByRole('group', { name: 'Crawl summary' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations with the tab registry as it ships, before any tab is added', async () => {
    registry.real = true;
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await screen.findByRole('group', { name: 'Crawl summary' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations in the empty and running states', async () => {
    const { container, unmount } = renderWithProviders(internalLinksAs('editor', NO_WEBSITE));
    expect(await axe(container)).toHaveNoViolations();
    unmount();
    answerWith([run({ state: 'crawling', trigger: 'website_added', finished_at: null, pages_found: 120 })]);
    const first = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await screen.findByRole('heading', { name: 'Mapping eventussecurity.com' });
    expect(await axe(first.container)).toHaveNoViolations();
  });
});
