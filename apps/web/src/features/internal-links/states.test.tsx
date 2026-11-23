import { screen, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CrawlRun } from '@/lib/internal-links/types';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { EVENTUS, MOCK_RUN_ID, setLinksScenario, tierFlow } from '@/mocks/internal-links-world';
import { mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { EVENTUS_LINKS, FYNIX_LINKS, NO_WEBSITE, internalLinksAs } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

/**
 * Every state of the Internal links screens (spec 9 and 11) in both themes and both table densities: loading,
 * empty, error with Try again, no crawl, crawling, failed, cancelled, crawls off, no permission and not found.
 * Axe checks structure only (jsdom has no layout and no painting, so colour contrast is off in `@/test/axe`); the
 * assertions say what each state shows. Equity share, which the API sends, is never on screen.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

const P = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS.project_id}`;
const CRAWLS = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/link-crawls');
const PAGES = mswPath(`${P}/internal-links/pages`);
const EDGES = mswPath(`${P}/internal-links/edges`);
const FLOW = mswPath(`${P}/internal-links/tier-flow`);
/** An address of a page the API would refuse as an id. */
const NOT_AN_ID = 'abc';
const SYSTEM_TEXT = 'Cancelled by the system: the project was paused';

const run = (over: Partial<CrawlRun>): CrawlRun => ({
  pages_blocked: null,
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
  links_available: true,
  previous_run_id: null,
  enrich_state: 'done',
  ...over,
});
const answerWith = (runs: readonly CrawlRun[]): void => {
  server.use(
    http.get(CRAWLS, () => HttpResponse.json({ data: runs, page: { has_more: false, limit: 50, next_cursor: null } })),
  );
};
/** A list with no rows, as the API answers one (with its page and meta). */
const emptyBody = (): { data: never[]; page: object; meta: object } => ({
  data: [],
  page: { has_more: false, limit: 100, next_cursor: null },
  meta: { run_id: MOCK_RUN_ID, scope: 'editorial', total: 0 },
});

const THEMES = ['light', 'dark'] as const;
const DENSITIES = ['compact', 'default'] as const;
const setTheme = (theme: (typeof THEMES)[number]): void => {
  document.documentElement.classList.toggle('dark', theme === 'dark');
};
const noEquity = (container: HTMLElement): void => {
  expect(container.textContent).not.toMatch(/equity/i);
};

beforeEach(() => {
  stubWideScreen();
});
afterEach(() => {
  server.events.removeAllListeners();
  restoreWideScreen();
  document.documentElement.classList.remove('dark');
});

describe('the lists with their data, in both themes and both densities', () => {
  describe.each(THEMES)('%s theme', (theme) => {
    it.each(DENSITIES)('Pages and Links at %s density have no axe violations and no equity', async (density) => {
      setTheme(theme);
      const densityQuery = density === 'default' ? '&density=default' : '';
      const pages = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
        searchParams: `?${densityQuery.slice(1)}`,
      });
      await within(await screen.findByRole('grid', { name: 'Pages' })).findAllByRole('rowheader');
      expect(await axe(pages.container)).toHaveNoViolations();
      noEquity(pages.container);
      pages.unmount();

      const links = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
        searchParams: `?tab=links${densityQuery}`,
      });
      await within(await screen.findByRole('grid', { name: 'Links' })).findAllByRole('rowheader');
      expect(await axe(links.container)).toHaveNoViolations();
      noEquity(links.container);
    });

    it('the Journey and the Tier flow have no axe violations and no equity', async () => {
      setTheme(theme);
      const flow = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=flow' });
      await screen.findByRole('table', { name: 'Links between tiers' });
      expect(await axe(flow.container)).toHaveNoViolations();
      noEquity(flow.container);
      flow.unmount();

      const journey = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=journey' });
      await screen.findByRole('group', { name: /Link journey canvas/ });
      expect(await axe(journey.container)).toHaveNoViolations();
      noEquity(journey.container);
    });
  });
});

describe('loading, empty and error states of the tabs', () => {
  describe.each(THEMES)('%s theme', (theme) => {
    it.each(DENSITIES)('Pages: loading is a busy table, empty names the cause, at %s density', async (density) => {
      setTheme(theme);
      server.use(
        http.get(PAGES, async () => {
          await delay(60);
          return HttpResponse.json(emptyBody());
        }),
      );
      const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
        searchParams: density === 'default' ? '?density=default' : '',
      });
      const grid = await screen.findByRole('grid', { name: 'Pages' });
      expect(grid).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByText('No pages in this crawl')).toBeNull();
      expect(await screen.findByRole('heading', { name: 'No pages in this crawl' })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('Pages: an error has Try again, which reads the list again', async () => {
      setTheme(theme);
      let calls = 0;
      server.use(
        http.get(PAGES, ({ request }) => {
          calls += 1;
          return calls === 1 ? problem(request, 'internal_error') : undefined;
        }),
      );
      const { container, user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
      expect(await screen.findByText('The pages could not be loaded')).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      await within(await screen.findByRole('grid', { name: 'Pages' })).findAllByRole('rowheader');
    });

    it('Links: empty and error', async () => {
      setTheme(theme);
      server.use(http.get(EDGES, () => HttpResponse.json(emptyBody())));
      const empty = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=links' });
      expect(await screen.findByRole('heading', { name: 'No links in this crawl' })).toBeInTheDocument();
      expect(await axe(empty.container)).toHaveNoViolations();
      empty.unmount();

      server.use(http.get(EDGES, ({ request }) => problem(request, 'internal_error')));
      const failed = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=links' });
      expect(await screen.findByText('The links could not be loaded')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
      expect(await axe(failed.container)).toHaveNoViolations();
    });

    it('Tier flow: loading shows rows to come and no table, then an error with Try again, then the stale note', async () => {
      setTheme(theme);
      server.use(
        http.get(FLOW, async () => {
          await delay(60);
          return HttpResponse.json({ data: tierFlow('editorial') });
        }),
      );
      const loading = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=flow' });
      await screen.findByRole('tab', { name: 'Tier flow' });
      expect(screen.queryByRole('table', { name: 'Links between tiers' })).toBeNull();
      await screen.findByRole('table', { name: 'Links between tiers' });
      loading.unmount();

      server.use(http.get(FLOW, ({ request }) => problem(request, 'internal_error')));
      const failed = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=flow' });
      expect(await screen.findByText('The tier flow could not be loaded')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
      expect(await axe(failed.container)).toHaveNoViolations();
      failed.unmount();

      server.use(http.get(FLOW, () => HttpResponse.json({ data: { ...tierFlow('editorial'), stale: true } })));
      const stale = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=flow' });
      expect(
        await screen.findByText('The tier flow is being worked out again after a tier change.'),
      ).toBeInTheDocument();
      expect(await axe(stale.container)).toHaveNoViolations();
    });

    it('Journey: an error with Try again, a page that is not an id reads as not found', async () => {
      setTheme(theme);
      server.use(http.get(PAGES, ({ request }) => problem(request, 'internal_error')));
      const failed = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=journey' });
      expect(await screen.findByText('The journey could not be loaded')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
      expect(await axe(failed.container)).toHaveNoViolations();
      failed.unmount();

      server.resetHandlers();
      const missing = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
        searchParams: `?tab=journey&focus=${NOT_AN_ID}`,
      });
      expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
      expect(await axe(missing.container)).toHaveNoViolations();
    });
  });

  it('shows the empty worklist reason, not the empty crawl, when a worklist matches no page', async () => {
    server.use(http.get(PAGES, () => HttpResponse.json(emptyBody())));
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?view=orphans' });
    expect(await screen.findByRole('heading', { name: 'No orphans' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No pages in this crawl' })).toBeNull();
  });
});

describe('the crawl states of the page, in both themes', () => {
  describe.each(THEMES)('%s theme', (theme) => {
    it('no website, no permission and no crawl yet have no axe violations', async () => {
      setTheme(theme);
      const none = renderWithProviders(internalLinksAs('editor', NO_WEBSITE));
      expect(
        await screen.findByRole('heading', { name: 'Add your website to map internal links' }),
      ).toBeInTheDocument();
      expect(await axe(none.container)).toHaveNoViolations();
      none.unmount();

      const denied = renderWithProviders(internalLinksAs('billing', EVENTUS_LINKS));
      expect(screen.getByRole('heading', { name: 'You cannot see internal links' })).toBeInTheDocument();
      expect(await axe(denied.container)).toHaveNoViolations();
      denied.unmount();

      const never = renderWithProviders(internalLinksAs('editor', FYNIX_LINKS));
      expect(await screen.findByRole('heading', { name: 'No crawl yet' })).toBeInTheDocument();
      expect(await axe(never.container)).toHaveNoViolations();
    });

    it('a first crawl under way shows progress and skeleton rows, never an empty table', async () => {
      setTheme(theme);
      answerWith([run({ state: 'crawling', pages_found: 312, finished_at: null })]);
      const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
      expect(await screen.findByRole('heading', { name: 'Mapping eventussecurity.com' })).toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '312');
      expect(screen.queryByRole('grid')).toBeNull();
      expect(screen.queryByRole('table')).toBeNull();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('a first crawl that failed names the cause, offers Try again and keeps the raw message out', async () => {
      setTheme(theme);
      answerWith([
        run({ state: 'failed', error_code: 'site_blocked', error_message: 'RAW PROVIDER TEXT', finished_at: null }),
      ]);
      const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
      expect(await screen.findByText(/refused our crawler/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
      expect(screen.queryByText(/RAW PROVIDER TEXT/)).toBeNull();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('crawls that are off read as a quiet notice, with the table still there', async () => {
      setTheme(theme);
      answerWith([run({ is_latest: true })]);
      server.use(http.post(CRAWLS, ({ request }) => problem(request, 'crawls_disabled')));
      const { container, user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
      await user.click(await screen.findByRole('button', { name: 'Crawl now' }));
      expect(await screen.findByText('Crawls are not switched on yet.')).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

describe('a crawl the system cancelled (error_code null, an error_message)', () => {
  const systemCancel = (over: Partial<CrawlRun> = {}): CrawlRun =>
    run({ state: 'cancelled', error_code: null, error_message: SYSTEM_TEXT, finished_at: null, ...over });

  it('reads as No crawl yet with Crawl now offered when it was the first crawl, and never prints its message', async () => {
    answerWith([systemCancel()]);
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByRole('heading', { name: 'No crawl yet' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Crawl now' }).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/cancelled by|you cancelled|Cancelled by the system/i);
    expect(screen.queryByText(SYSTEM_TEXT)).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows no banner beside a finished crawl, and no word of it anywhere', async () => {
    answerWith([systemCancel({ run_id: 'c', created_at: '2026-11-16T03:00:00Z' }), run({ is_latest: true })]);
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText(/^Crawled .+, 40 pages$/)).toBeInTheDocument();
    expect(screen.queryByText('The last crawl failed.')).toBeNull();
    expect(container.textContent).not.toMatch(/cancel/i);
    expect(container.textContent).not.toContain(SYSTEM_TEXT);
  });
});

const CHANGES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/changes';
const CHANGES_SUMMARY = mswPath(`${CHANGES}/summary`);
const OPPORTUNITIES = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/opportunities');
const PATHS = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/paths');
const LINKS_DROPPED = /This crawl’s links are no longer stored\. Pick a newer crawl\./;

describe('the Changes, Opportunities and Path finder tabs, in both themes', () => {
  afterEach(() => {
    setLinksScenario({
      enrich: 'done',
      firstCrawl: false,
      latestLinksDropped: false,
      noOpportunities: false,
      noStartPage: false,
    });
  });

  describe.each(THEMES)('%s theme', (theme) => {
    it('Changes: loading is busy, an error has Try again, and the neutral states have no Try again', async () => {
      setTheme(theme);
      server.use(
        http.get(CHANGES_SUMMARY, async () => {
          await delay(60);
          return undefined;
        }),
      );
      const loading = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=changes' });
      expect(await screen.findByText('Loading changes')).toBeInTheDocument();
      await screen.findByRole('table', { name: 'Lost links' });
      loading.unmount();
      server.resetHandlers();

      let calls = 0;
      server.use(
        http.get(CHANGES_SUMMARY, ({ request }) => {
          calls += 1;
          return calls === 1 ? problem(request, 'internal_error') : undefined;
        }),
      );
      const failed = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=changes' });
      expect(await screen.findByText('The changes could not be loaded')).toBeInTheDocument();
      expect(await axe(failed.container)).toHaveNoViolations();
      await failed.user.click(screen.getByRole('button', { name: 'Try again' }));
      await screen.findByRole('table', { name: 'Lost links' });
      noEquity(failed.container);
      failed.unmount();
      server.resetHandlers();

      const neutral: [Parameters<typeof setLinksScenario>[0], string][] = [
        [{ firstCrawl: true }, 'This is the first crawl'],
        [{ enrich: 'running' }, 'Working out what changed'],
        [{ enrich: 'failed' }, 'Changes could not be worked out for this crawl'],
        [{ latestLinksDropped: true }, 'Links of this crawl are not stored'],
      ];
      for (const [scenario, text] of neutral) {
        setLinksScenario(scenario);
        const view = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=changes' });
        expect(await screen.findByText(text)).toBeInTheDocument();
        if (scenario.enrich !== 'running') expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
        expect(await axe(view.container)).toHaveNoViolations();
        noEquity(view.container);
        view.unmount();
        setLinksScenario({ enrich: 'done', firstCrawl: false, latestLinksDropped: false });
      }
    });

    it('Opportunities: loading, empty, error with Try again, and links dropped', async () => {
      setTheme(theme);
      server.use(
        http.get(OPPORTUNITIES, async () => {
          await delay(60);
          return undefined;
        }),
      );
      const loading = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
        searchParams: '?tab=opportunities',
      });
      expect(await screen.findByRole('grid', { name: 'Link opportunities' })).toHaveAttribute('aria-busy', 'true');
      loading.unmount();
      server.resetHandlers();

      setLinksScenario({ noOpportunities: true });
      const empty = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
        searchParams: '?tab=opportunities',
      });
      expect(await screen.findByText('No opportunities')).toBeInTheDocument();
      expect(await axe(empty.container)).toHaveNoViolations();
      empty.unmount();
      setLinksScenario({ noOpportunities: false });

      let calls = 0;
      server.use(
        http.get(OPPORTUNITIES, ({ request }) => {
          calls += 1;
          return calls === 1 ? problem(request, 'internal_error') : undefined;
        }),
      );
      const failed = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
        searchParams: '?tab=opportunities',
      });
      expect(await screen.findByText('The opportunities could not be loaded')).toBeInTheDocument();
      expect(await axe(failed.container)).toHaveNoViolations();
      await failed.user.click(screen.getByRole('button', { name: 'Try again' }));
      await screen.findByRole('grid', { name: 'Link opportunities' });
      noEquity(failed.container);
      failed.unmount();
      server.resetHandlers();

      setLinksScenario({ latestLinksDropped: true });
      const dropped = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
        searchParams: '?tab=opportunities',
      });
      expect(await screen.findByText(LINKS_DROPPED)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(await axe(dropped.container)).toHaveNoViolations();
    });

    it('Path finder: loading, an error with Try again, a page nothing leads to, and links dropped', async () => {
      setTheme(theme);
      const open = (): ReturnType<typeof renderWithProviders> =>
        renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
          searchParams: '?tab=journey&jv=paths&focus=103',
        });
      server.use(
        http.get(PATHS, async () => {
          await delay(60);
          return undefined;
        }),
      );
      const loading = open();
      await screen.findByRole('combobox', { name: /^Find the way to: / });
      expect(screen.queryByRole('heading', { name: /^Over any link/ })).toBeNull();
      await screen.findByRole('heading', { name: /^Over any link/ });
      loading.unmount();
      server.resetHandlers();

      let calls = 0;
      server.use(
        http.get(PATHS, ({ request }) => {
          calls += 1;
          return calls === 1 ? problem(request, 'internal_error') : undefined;
        }),
      );
      const failed = open();
      expect(await screen.findByText('The route could not be loaded.')).toBeInTheDocument();
      expect(await axe(failed.container)).toHaveNoViolations();
      await failed.user.click(screen.getByRole('button', { name: 'Try again' }));
      await screen.findByRole('heading', { name: /^Over any link/ });
      noEquity(failed.container);
      failed.unmount();
      server.resetHandlers();

      setLinksScenario({ noStartPage: true });
      const unreachable = open();
      expect(await screen.findByText('This page cannot be reached from the home page.')).toBeInTheDocument();
      expect(await axe(unreachable.container)).toHaveNoViolations();
      unreachable.unmount();
      setLinksScenario({ noStartPage: false, latestLinksDropped: true });

      const dropped = open();
      expect(await screen.findByText(LINKS_DROPPED)).toBeInTheDocument();
      expect(await axe(dropped.container)).toHaveNoViolations();
    });
  });
});
