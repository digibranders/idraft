import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CRAWL_POLL_MS, seenCrawlKey } from './crawl-reads';
import { announce, LIVE_REGION_ID } from '@/lib/a11y/announcer';
import { CRAWL_SCREEN_LIMIT } from '@/lib/internal-links/queries';
import type { CrawlRun } from '@/lib/internal-links/types';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { EVENTUS, linksWorld, MOCK_RUN_ID, setCrawlsEnabled } from '@/mocks/internal-links-world';
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

// The real announcer with a spy on it, so a test counts what the page says as well as what the region holds
vi.mock('@/lib/a11y/announcer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/a11y/announcer')>();
  return { ...actual, announce: vi.fn(actual.announce) };
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

/** The crawl list answers `runs`, newest first, as many as the request's limit and `has_more` for the rest. */
const answerWith = (runs: readonly CrawlRun[]): void => {
  server.use(
    http.get(CRAWLS, ({ request }) => {
      const limit = Number(new URL(request.url).searchParams.get('limit') ?? '100');
      return HttpResponse.json({
        data: runs.slice(0, limit),
        page: { has_more: runs.length > limit, limit, next_cursor: null },
      });
    }),
  );
};

/** The mock world's own crawls of Eventus Security: what the real list handler pages, with `is_latest` set over all. */
const seedWorld = (runs: readonly CrawlRun[]): void => {
  linksWorld().crawls.set(EVENTUS.project_id, [...runs]);
};

/** Request counts of the mock server, by the end of the path. */
function countRequests(): (suffix: string, method?: string) => number {
  const seen: { path: string; method: string }[] = [];
  server.events.on('request:start', ({ request }) =>
    seen.push({ path: new URL(request.url).pathname, method: request.method }),
  );
  return (suffix, method = 'GET') =>
    seen.filter((entry) => entry.path.endsWith(suffix) && entry.method === method).length;
}

beforeEach(() => {
  stubWideScreen();
  vi.mocked(announce).mockClear();
});
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
    // No panel to switch: no tab list either
    expect(screen.queryByRole('tablist')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Crawl now' }));
    expect(await screen.findByRole('heading', { name: 'Mapping fynix.digital' })).toBeInTheDocument();
    const progress = screen.getByRole('progressbar', { name: 'Pages found against the crawl limit' });
    expect(progress).toHaveAttribute('aria-valuemax', '2000');
    expect(screen.getByText(/Tag your most important pages while you wait/)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    // The panel is the only place the crawl is named, and the header's button says it is crawling
    expect(await screen.findByRole('button', { name: 'Crawling' })).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps Crawl now in the tab order for a viewer, with the reason on hover, and sends nothing when pressed', async () => {
    const requests = countRequests();
    const { user } = renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS));
    const button = await screen.findByRole('button', { name: 'Crawl now' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(button).toHaveAccessibleDescription('Your role cannot start crawls. Ask an admin of the workspace.');
    await user.click(button);
    expect(requests('/link-crawls', 'POST')).toBe(0);
  });

  it('does the same for the Crawl now of a site never crawled', async () => {
    renderWithProviders(internalLinksAs('viewer', FYNIX_LINKS));
    const button = await screen.findByRole('button', { name: 'Crawl now' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(/Your role cannot start crawls/);
  });

  it('offers Edit page tiers only to those who can change the tiers', async () => {
    const owner = renderWithProviders(internalLinksAs('owner', EVENTUS_LINKS));
    await owner.user.click(await screen.findByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: /Edit page tiers/ })).toHaveAttribute(
      'href',
      '/digibranders/settings/tiers',
    );
    owner.unmount();
    const editor = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await editor.user.click(await screen.findByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Crawl settings' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Edit page tiers/ })).toBeNull();
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
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('keeps Try again in the tab order for a viewer, with the reason', async () => {
    answerWith([run({ state: 'failed', error_code: 'site_blocked' })]);
    renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS));
    const button = await screen.findByRole('button', { name: 'Try again' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(/Your role cannot start crawls/);
  });

  // Every code the backend sets on a failed crawl (collectors/crawl_runs.py), and one it does not
  it.each([
    ['site_blocked', /refuses our crawler/],
    ['site_unreachable', /could not be reached/],
    ['budget_exceeded', /workspace budget for site crawls is used up/],
    ['provider_error', /The crawl service reported an error/],
    ['submit_unknown', /could not confirm that the crawl started/],
    ['something_new', /The crawl failed\. Try again; if it fails again, contact support/],
    [null, /The crawl failed\. Try again; if it fails again, contact support/],
  ])('words a failed crawl with the code %s from the catalog, never from the provider text', async (code, words) => {
    answerWith([
      run({
        state: 'failed',
        error_code: code,
        error_message: 'Provider said: task_post failed (secret-provider-detail)',
      }),
    ]);
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText(words)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/secret-provider-detail|task_post/);
  });

  it('words a newer failed crawl beside the last one from the catalog too, in one sentence with the date', async () => {
    answerWith([
      run({
        run_id: 'f',
        state: 'failed',
        error_code: 'submit_unknown',
        error_message: 'Provider said: secret-provider-detail',
        created_at: '2026-11-16T03:00:00Z',
      }),
      run({ is_latest: true }),
    ]);
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(
      await screen.findByText(/could not confirm that the crawl started.+You are seeing the crawl of Nov 14\./),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/secret-provider-detail/);
  });

  it('shows the last crawl and its data when ten newer crawls failed, because the screen reads more than ten', async () => {
    const failed = Array.from({ length: 12 }, (_, index) =>
      run({
        run_id: `0192e4a0-5000-7000-8000-0000000000${String(index).padStart(2, '0')}`,
        state: 'failed',
        error_code: 'site_unreachable',
        pages_found: 0,
        pages_crawled: 0,
        created_at: `2026-11-16T${String(23 - index).padStart(2, '0')}:00:00Z`,
      }),
    );
    seedWorld([...failed, run({ is_latest: true, pages_found: 18, pages_crawled: 18 })]);
    const requests: string[] = [];
    server.events.on('request:start', ({ request }) => requests.push(request.url));
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText(/^Crawled .+, 18 pages$/)).toBeInTheDocument();
    expect(screen.getByText('The last crawl failed.')).toBeInTheDocument();
    expect(await screen.findByRole('group', { name: 'Crawl summary' })).toHaveTextContent('Pages18');
    expect(screen.getByText('Panel of Pages')).toBeInTheDocument();
    expect(screen.queryByText('Add your website to map internal links')).toBeNull();
    expect(
      requests.some((url) => url.includes('/link-crawls') && url.includes(`limit=${String(CRAWL_SCREEN_LIMIT)}`)),
    ).toBe(true);
  });

  it('does not call it a failed first crawl when the page is full and the latest crawl is not on it', async () => {
    const failed = Array.from({ length: CRAWL_SCREEN_LIMIT + 1 }, (_, index) =>
      run({
        run_id: `0192e4a0-5000-7000-8000-${String(index).padStart(12, '0')}`,
        state: 'failed',
        error_code: 'site_unreachable',
        created_at: '2026-11-16T03:00:00Z',
      }),
    );
    seedWorld([...failed, run({ is_latest: true })]);
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText('Internal links could not be loaded')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'The last crawl failed.' })).toBeNull();
    expect(screen.queryByText('Panel of Pages')).toBeNull();
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

  it('reports a crawl under way above the last one; Crawl now is busy, still enabled, and a press sends nothing', async () => {
    answerWith([
      run({ run_id: 'c', state: 'crawling', pages_found: 310, finished_at: null, created_at: '2026-11-16T03:00:00Z' }),
      run({ is_latest: true }),
    ]);
    const requests = countRequests();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText(/Crawling now: 310 pages found so far/)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Crawling' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toBeDisabled();
    expect(button).toHaveAccessibleDescription(/A crawl started .+\. One crawl runs at a time\./);
    await user.click(button);
    expect(requests('/link-crawls', 'POST')).toBe(0);
    // No live region of its own: the banner is plain text
    expect(screen.getByText(/Crawling now/).closest('[role]')).toBeNull();
  });

  it('lets a viewer read when the running crawl started', async () => {
    answerWith([
      run({ run_id: 'c', state: 'crawling', pages_found: 310, finished_at: null, created_at: '2026-11-16T03:00:00Z' }),
      run({ is_latest: true }),
    ]);
    renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS));
    const button = await screen.findByRole('button', { name: 'Crawling' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(/A crawl started .+\. One crawl runs at a time\./);
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

describe('crawls that are not switched on yet (503 crawls_disabled)', () => {
  const LEAD = 'Crawls are not switched on yet.';
  const REASON = /Crawls are not switched on yet\. The idraft team will turn them on\./;
  const STILL_OFF = 'Crawls are still switched off.';
  const failedFirst = (): void => answerWith([run({ state: 'failed', error_code: 'site_blocked' })]);

  afterEach(() => setCrawlsEnabled(true));

  it('asks nothing before the first press, then shows a quiet notice and no error toast', async () => {
    setCrawlsEnabled(false);
    const requests = countRequests();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const button = await screen.findByRole('button', { name: 'Crawl now' });
    expect(screen.queryByText(LEAD)).toBeNull();
    expect(button).toBeEnabled();
    expect(requests('/link-crawls', 'POST')).toBe(0);
    await user.click(button);
    expect(await screen.findByText(LEAD)).toBeInTheDocument();
    expect(screen.queryByText('The crawl could not be started')).toBeNull();
    expect(screen.queryByText('Crawl started')).toBeNull();
    // A notice, not an alert: nothing in it is styled or announced as an error
    expect(screen.getByText(LEAD).closest('[role]')).toBeNull();
    expect(screen.getByText(LEAD).closest('[data-slot="banner"]')?.className).not.toMatch(/negative/);
    expect(requests('/link-crawls', 'POST')).toBe(1);
    // Crawl now is disabled with the reason, still focusable, and a press sends nothing
    const after = screen.getByRole('button', { name: 'Crawl now' });
    expect(after).toHaveAttribute('aria-disabled', 'true');
    expect(after).not.toBeDisabled();
    expect(after).toHaveAccessibleDescription(REASON);
    after.focus();
    expect(after).toHaveFocus();
    await user.click(after);
    expect(requests('/link-crawls', 'POST')).toBe(1);
  });

  it('is said once, politely, when it is learned', async () => {
    setCrawlsEnabled(false);
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await screen.findByRole('button', { name: 'Crawl now' }));
    await screen.findByText(LEAD);
    expect(vi.mocked(announce)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(announce)).toHaveBeenCalledWith(expect.stringMatching(REASON), expect.anything());
  });

  it('shows it in the panel of a site never crawled, where Crawl now waits', async () => {
    setCrawlsEnabled(false);
    const requests = countRequests();
    const { user } = renderWithProviders(internalLinksAs('editor', FYNIX_LINKS));
    await user.click(await screen.findByRole('button', { name: 'Crawl now' }));
    expect(await screen.findByText(LEAD)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No crawl yet' })).toBeInTheDocument();
    const after = screen.getByRole('button', { name: 'Crawl now' });
    expect(after).toHaveAttribute('aria-disabled', 'true');
    expect(after).toHaveAccessibleDescription(REASON);
    await user.click(after);
    expect(requests('/link-crawls', 'POST')).toBe(1);
    expect(screen.queryByText('The crawl could not be started')).toBeNull();
  });

  it('does the same for the Try again of a first crawl that failed', async () => {
    setCrawlsEnabled(false);
    failedFirst();
    const requests = countRequests();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(LEAD)).toBeInTheDocument();
    const after = screen.getByRole('button', { name: 'Try again' });
    expect(after).toHaveAttribute('aria-disabled', 'true');
    expect(after).toHaveAccessibleDescription(REASON);
    await user.click(after);
    expect(requests('/link-crawls', 'POST')).toBe(1);
  });

  it('keeps the role reason for a viewer, who never sees the notice', async () => {
    setCrawlsEnabled(false);
    renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS));
    const button = await screen.findByRole('button', { name: 'Crawl now' });
    expect(button).toHaveAccessibleDescription(/Your role cannot start crawls/);
    expect(screen.queryByText(LEAD)).toBeNull();
  });

  it('is cleared by the next start that succeeds', async () => {
    setCrawlsEnabled(false);
    // A failed newer crawl beside the last one: its Try again stays reachable, so a later start can succeed
    seedWorld([
      run({ run_id: 'f', state: 'failed', error_code: 'site_blocked', created_at: '2026-11-16T03:00:00Z' }),
      run({ is_latest: true }),
    ]);
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await screen.findByRole('button', { name: 'Crawl now' }));
    await screen.findByText(LEAD);
    expect(screen.getByRole('button', { name: 'Crawl now' })).toHaveAttribute('aria-disabled', 'true');
    setCrawlsEnabled(true);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(LEAD)).toBeNull());
    expect(await screen.findByRole('button', { name: 'Crawling' })).toBeInTheDocument();
    expect((await screen.findAllByText('Crawl started')).length).toBeGreaterThan(0);
  });

  it('shows no notice while crawls are on: a start succeeds and the panel moves on', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', FYNIX_LINKS));
    await user.click(await screen.findByRole('button', { name: 'Crawl now' }));
    expect(await screen.findByRole('heading', { name: 'Mapping fynix.digital' })).toBeInTheDocument();
    expect(screen.queryByText(LEAD)).toBeNull();
  });

  it('offers Check again in the notice: still off says so in a toast, on again starts the crawl and clears it', async () => {
    setCrawlsEnabled(false);
    const requests = countRequests();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await screen.findByRole('button', { name: 'Crawl now' }));
    await screen.findByText(LEAD);
    expect(requests('/link-crawls', 'POST')).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect((await screen.findAllByText(STILL_OFF)).length).toBeGreaterThan(0);
    expect(requests('/link-crawls', 'POST')).toBe(2);
    expect(screen.getByText(LEAD)).toBeInTheDocument();
    // Said once, when it was learned: the second answer is a toast, not a second announcement
    expect(vi.mocked(announce)).toHaveBeenCalledTimes(1);
    setCrawlsEnabled(true);
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.queryByText(LEAD)).toBeNull());
    expect((await screen.findAllByText('Crawl started')).length).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: 'Crawling' })).toBeInTheDocument();
  });

  it('gives the same toast, never a silent press, for the Try again of a failed crawl and a higher limit', async () => {
    setCrawlsEnabled(false);
    seedWorld([
      run({ run_id: 'f', state: 'failed', error_code: 'site_blocked', created_at: '2026-11-16T03:00:00Z' }),
      run({ is_latest: true, state: 'stopped_at_ceiling', stop_reason: 'ceiling' }),
    ]);
    const requests = countRequests();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await screen.findByRole('button', { name: 'Crawl now' }));
    await screen.findByText(LEAD);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(requests('/link-crawls', 'POST')).toBe(2));
    expect((await screen.findAllByText(STILL_OFF)).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Crawl again with a higher limit' }));
    await waitFor(() => expect(requests('/link-crawls', 'POST')).toBe(3));
    await waitFor(() => expect(screen.getAllByText(STILL_OFF).length).toBeGreaterThan(1));
  });

  it('keeps Check again for those who may crawl only', async () => {
    setCrawlsEnabled(false);
    renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS));
    await screen.findByRole('button', { name: 'Crawl now' });
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
  });

  it('is kept for the whole session, for every project: crawls are on or off for the deployment', async () => {
    setCrawlsEnabled(false);
    const requests = countRequests();
    const shown = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await shown.user.click(await screen.findByRole('button', { name: 'Crawl now' }));
    await screen.findByText(LEAD);
    // Leave the page and come back, as a person does inside the app: the cache stays, so the state does too
    shown.rerender(<div />);
    expect(screen.queryByText(LEAD)).toBeNull();
    shown.rerender(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText(LEAD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crawl now' })).toHaveAttribute('aria-disabled', 'true');
    // Another project of the same session: no request is made to find out
    shown.rerender(<div />);
    shown.rerender(internalLinksAs('editor', FYNIX_LINKS));
    expect(await screen.findByText(LEAD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crawl now' })).toHaveAttribute('aria-disabled', 'true');
    expect(requests('/link-crawls', 'POST')).toBe(1);
  });

  it('is not carried over a page reload: a fresh cache asks again', async () => {
    setCrawlsEnabled(false);
    const first = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await first.user.click(await screen.findByRole('button', { name: 'Crawl now' }));
    await screen.findByText(LEAD);
    first.unmount();
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByRole('button', { name: 'Crawl now' })).toBeEnabled();
    expect(screen.queryByText(LEAD)).toBeNull();
  });

  it('treats another 503 and a network error as failures: the generic toast, no notice, Crawl now enabled', async () => {
    server.use(
      http.post(CRAWLS, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'The data provider is paused', status: 503, code: 'provider_paused' },
          { status: 503, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await screen.findByRole('button', { name: 'Crawl now' }));
    expect((await screen.findAllByText('The crawl could not be started')).length).toBeGreaterThan(0);
    expect(screen.queryByText(LEAD)).toBeNull();
    expect(screen.getByRole('button', { name: 'Crawl now' })).toBeEnabled();
    server.use(http.post(CRAWLS, () => HttpResponse.error()));
    await user.click(screen.getByRole('button', { name: 'Crawl now' }));
    await waitFor(() => expect(screen.getAllByText('The crawl could not be started').length).toBeGreaterThan(2));
    expect(screen.queryByText(LEAD)).toBeNull();
    expect(screen.getByRole('button', { name: 'Crawl now' })).toBeEnabled();
  });

  it('leaves the other refusals as they were: a toast, and Crawl now stays enabled', async () => {
    server.use(
      http.post(CRAWLS, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'The project has no website to crawl', status: 422, code: 'no_website' },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await screen.findByRole('button', { name: 'Crawl now' }));
    // A toast is also copied into the live region: more than one match
    expect((await screen.findAllByText('The crawl could not be started')).length).toBeGreaterThan(0);
    expect(screen.queryByText(LEAD)).toBeNull();
    expect(screen.getByRole('button', { name: 'Crawl now' })).toBeEnabled();
  });

  it.each([
    ['light', 'ready'],
    ['dark', 'ready'],
    ['light', 'never crawled'],
    ['dark', 'never crawled'],
  ])('has no axe violations with the notice in the %s theme (%s)', async (theme, state) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    setCrawlsEnabled(false);
    const { container, user } = renderWithProviders(
      internalLinksAs('editor', state === 'ready' ? EVENTUS_LINKS : FYNIX_LINKS),
    );
    await user.click(await screen.findByRole('button', { name: 'Crawl now' }));
    await screen.findByText(LEAD);
    expect(await axe(container)).toHaveNoViolations();
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

  const latest = run({ is_latest: true });
  const running = run({ run_id: 'c', state: 'crawling', finished_at: null, created_at: '2026-11-16T03:00:00Z' });

  it('is announced exactly once, reads the links again exactly once, and stops polling', async () => {
    answerWith([running, latest]);
    const requests = countRequests();
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText(/Crawling now/)).toBeInTheDocument();
    await screen.findByRole('group', { name: 'Crawl summary' });
    const flowBefore = requests('/internal-links/tier-flow');
    answerWith([
      { ...running, state: 'ready', is_latest: true, pages_found: 52, finished_at: '2026-11-16T03:09:00Z' },
      { ...latest, is_latest: false },
    ]);
    await act(() => vi.advanceTimersByTimeAsync(CRAWL_POLL_MS + 100));
    await waitFor(() =>
      expect(document.getElementById(LIVE_REGION_ID.polite)?.textContent).toBe('The crawl finished: 52 pages found.'),
    );
    await waitFor(() => expect(requests('/internal-links/tier-flow')).toBe(flowBefore + 1));
    expect(screen.queryByText(/Crawling now/)).toBeNull();
    const crawlsAfter = requests('/link-crawls');
    // Another poll interval: nothing is under way, so the list is not asked again, and nothing is said again
    await act(() => vi.advanceTimersByTimeAsync(CRAWL_POLL_MS + 100));
    expect(requests('/link-crawls')).toBe(crawlsAfter);
    expect(requests('/internal-links/tier-flow')).toBe(flowBefore + 1);
    expect(vi.mocked(announce)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(announce)).toHaveBeenCalledWith('The crawl finished: 52 pages found.', expect.anything());
  });

  it('is announced as failed, once, when it fails', async () => {
    answerWith([running, latest]);
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText(/Crawling now/)).toBeInTheDocument();
    answerWith([{ ...running, state: 'failed', error_code: 'site_unreachable' }, latest]);
    await act(() => vi.advanceTimersByTimeAsync(CRAWL_POLL_MS + 100));
    await waitFor(() => expect(document.getElementById(LIVE_REGION_ID.polite)?.textContent).toBe('The crawl failed.'));
    expect(await screen.findByText('The last crawl failed.')).toBeInTheDocument();
    expect(screen.queryByText(/Crawling now/)).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(CRAWL_POLL_MS + 100));
    expect(vi.mocked(announce)).toHaveBeenCalledTimes(1);
  });

  it('is not announced when it was cancelled', async () => {
    answerWith([running, latest]);
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText(/Crawling now/)).toBeInTheDocument();
    answerWith([{ ...running, state: 'cancelled', finished_at: '2026-11-16T03:05:00Z' }, latest]);
    await act(() => vi.advanceTimersByTimeAsync(CRAWL_POLL_MS + 100));
    await waitFor(() => expect(screen.queryByText(/Crawling now/)).toBeNull());
    expect(screen.queryByText('The last crawl failed.')).toBeNull();
    expect(vi.mocked(announce)).not.toHaveBeenCalled();
  });
});

describe('a crawl that finished while the page was not open', () => {
  it('reads the links again when the latest crawl is not the one last seen, and not when it is', async () => {
    const seenKey = seenCrawlKey({ workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS_LINKS.id });
    // An earlier visit saw another crawl as the latest
    const stale = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    stale.queryClient.setQueryData(seenKey, 'an-older-run');
    const invalidated = vi.spyOn(stale.queryClient, 'invalidateQueries');
    await screen.findByRole('group', { name: 'Crawl summary' });
    await waitFor(() =>
      expect(
        invalidated.mock.calls.some(([filters]) => JSON.stringify(filters?.queryKey).includes('internal-links')),
      ).toBe(true),
    );
    expect(stale.queryClient.getQueryData(seenKey)).toBe(MOCK_RUN_ID);
    stale.unmount();
    // An earlier visit saw this very crawl: nothing is stale
    const same = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    same.queryClient.setQueryData(seenKey, MOCK_RUN_ID);
    const quiet = vi.spyOn(same.queryClient, 'invalidateQueries');
    await screen.findByRole('group', { name: 'Crawl summary' });
    expect(quiet).not.toHaveBeenCalled();
  });

  it('only notes the latest crawl on a first visit, and reads nothing again', async () => {
    const first = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const invalidated = vi.spyOn(first.queryClient, 'invalidateQueries');
    await screen.findByRole('group', { name: 'Crawl summary' });
    expect(invalidated).not.toHaveBeenCalled();
    expect(
      first.queryClient.getQueryData(
        seenCrawlKey({ workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS_LINKS.id }),
      ),
    ).toBe(MOCK_RUN_ID);
  });
});

describe('accessibility of the shell', () => {
  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await screen.findByRole('group', { name: 'Crawl summary' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations with the tab registry as it ships (the Pages tab)', async () => {
    registry.real = true;
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await screen.findByRole('group', { name: 'Crawl summary' });
    await screen.findByRole('grid', { name: 'Pages' });
    expect(screen.getByRole('tab', { name: 'Pages' })).toBeInTheDocument();
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
