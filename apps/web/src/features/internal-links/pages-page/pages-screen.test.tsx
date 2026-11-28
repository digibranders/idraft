import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import type { CrawlRun } from '@/lib/internal-links/types';
import { crawledPages, EVENTUS, HISTORY_RUN_IDS, MOCK_RUN_ID, pageRow } from '@/mocks/internal-links-world';
import { overviewOf } from '@/mocks/internal-links-inventory';
import { mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { EVENTUS_LINKS, FYNIX_LINKS, NO_WEBSITE } from '@/test/internal-links-harness';
import { pagesAs } from '@/test/pages-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/pages',
  useSearchParams: () => new URLSearchParams(),
}));

const OVERVIEW = mswPath(
  `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS.project_id}/internal-links/overview`,
);
const ALL = `/${MOCK_WORKSPACE.slug}/${EVENTUS_LINKS.slug}/seo/pages/all`;
const CRAWLS = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/link-crawls');
/** A first crawl under way: the only crawl of the project. */
const RUNNING: CrawlRun = {
  pages_blocked: null,
  pages: 0,
  pages_variant: null,
  run_id: MOCK_RUN_ID,
  trigger: 'manual',
  state: 'crawling',
  ceiling: 2000,
  pages_found: 312,
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
  finished_at: null,
  requested_by: null,
  links_available: true,
  previous_run_id: null,
  enrich_state: 'done',
  html_reader_stale: false,
  pages_links_suspect: null,
};
const fixture = overviewOf(
  crawledPages().map((page) => pageRow(page, 'all')),
  { run_id: MOCK_RUN_ID, finished_at: null, sitemap: false },
);

beforeEach(() => stubWideScreen());
afterEach(() => {
  restoreWideScreen();
  server.resetHandlers();
});

const strip = async (): Promise<HTMLElement> => screen.findByRole('group', { name: 'Page counts of this crawl' });

describe('the Pages screen, Overview', () => {
  it('lists Overview, All pages and Monitoring as tabs, Monitoring linking to its route', async () => {
    renderWithProviders(pagesAs('viewer', 'overview'));
    await strip();
    const nav = screen.getByRole('navigation', { name: 'Pages views' });
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'All pages' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: 'Monitoring' })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/seo\/pages\/monitoring$/),
    );
  });

  it('shows the five numbers of the overview read, each a link to All pages, and the sixth from Issues, a link to Issues', async () => {
    renderWithProviders(pagesAs('viewer', 'overview'));
    const group = await strip();
    await within(group).findByText(String(fixture.addresses));
    const expected: [RegExp, number, string][] = [
      [/Addresses crawled/, fixture.addresses, '?variants=1'],
      [/Live pages/, fixture.status.live, '?view=live'],
      [/Indexable/, fixture.indexable, '?view=indexable'],
      [/Orphan pages/, fixture.orphans, '?view=orphans'],
      [/Error pages/, fixture.status.client_error + fixture.status.server_error, '?view=errors'],
    ];
    for (const [name, count, query] of expected) {
      const link = within(group).getByRole('link', { name });
      expect(link).toHaveAttribute('href', `${ALL}${query}`);
      expect(link.closest('div')?.textContent).toContain(count.toLocaleString('en-US'));
    }
    // The sixth number is the Issues read's own, and it links to the Issues page
    const withIssue = await within(group).findByRole('link', { name: /Pages with an issue/ });
    expect(withIssue).toHaveAttribute('href', `/${MOCK_WORKSPACE.slug}/${EVENTUS_LINKS.slug}/seo/issues`);
    expect(within(group).getAllByRole('link')).toHaveLength(6);
  });

  it('carries the crawl in view to All pages, and nothing else', async () => {
    const run = HISTORY_RUN_IDS[1] ?? '';
    renderWithProviders(pagesAs('viewer', 'overview'), { searchParams: `?run=${run}&sort=-pages&q=pricing` });
    const group = await strip();
    const nav = screen.getByRole('navigation', { name: 'Pages views' });
    expect(within(nav).getByRole('link', { name: 'All pages' })).toHaveAttribute('href', `${ALL}?run=${run}`);
    expect(await within(group).findByRole('link', { name: /Live pages/ })).toHaveAttribute(
      'href',
      `${ALL}?view=live&run=${run}`,
    );
  });

  it('says so, with a retry that works, when the overview cannot be read', async () => {
    let calls = 0;
    server.use(
      http.get(OVERVIEW, ({ request }) => {
        calls += 1;
        return calls === 1 ? problem(request, 'internal_error') : undefined;
      }),
    );
    const { user, container } = renderWithProviders(pagesAs('viewer', 'overview'));
    expect(await screen.findByText('The page counts could not be loaded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await within(await strip()).findByText(String(fixture.addresses));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations', async () => {
    const { container } = renderWithProviders(pagesAs('viewer', 'overview'));
    await within(await strip()).findByText(String(fixture.addresses));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the Pages screen, All pages', () => {
  it('renders the grid named Pages with rows, and has no axe violations', async () => {
    const { container } = renderWithProviders(pagesAs('viewer', 'all'));
    const grid = await screen.findByRole('grid', { name: 'Pages' });
    expect(await within(grid).findAllByRole('rowheader')).not.toHaveLength(0);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the More menu of the Pages screen', () => {
  it.each(['overview', 'all'] as const)(
    'offers the tier rules, the CSV import and the client summary to an editor on %s',
    async (tab) => {
      const { user } = renderWithProviders(pagesAs('editor', tab));
      await user.click(await screen.findByRole('button', { name: 'More actions' }));
      expect(await screen.findByRole('menuitem', { name: 'Tier rules' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Import tiers from CSV' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Crawl settings' })).toBeInTheDocument();
      await user.click(screen.getByRole('menuitem', { name: 'Tier rules' }));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    },
  );

  it('leaves the CSV import out for a viewer, who still reads the tier rules', async () => {
    const { user } = renderWithProviders(pagesAs('viewer', 'all'));
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Tier rules' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Import tiers from CSV' })).toBeNull();
  });

  it('scrolls the Overview body alone: its scroller is the positioned ancestor of what it holds', async () => {
    const { container } = renderWithProviders(pagesAs('viewer', 'overview'));
    await strip();
    const scroller = container.querySelector('.overflow-y-auto');
    expect(scroller).toHaveClass('relative', 'min-h-0', 'flex-1');
  });
});

describe('the crawl states of the Pages screen', () => {
  it('shows the no access state without data:read', () => {
    renderWithProviders(pagesAs('billing', 'overview'));
    expect(screen.getByRole('heading', { name: 'You cannot see internal links' })).toBeInTheDocument();
  });

  it('shows no website, and never crawled', async () => {
    const none = renderWithProviders(pagesAs('editor', 'overview', NO_WEBSITE));
    expect(await screen.findByRole('heading', { name: 'Add your website to map internal links' })).toBeInTheDocument();
    none.unmount();
    renderWithProviders(pagesAs('editor', 'overview', FYNIX_LINKS));
    expect(await screen.findByRole('heading', { name: 'No crawl yet' })).toBeInTheDocument();
  });

  it('shows the first crawl under way', async () => {
    server.use(
      http.get(CRAWLS, () =>
        HttpResponse.json({
          data: [{ ...RUNNING, run_id: MOCK_RUN_ID }],
          page: { has_more: false, limit: 50, next_cursor: null },
        }),
      ),
    );
    renderWithProviders(pagesAs('editor', 'all'));
    expect(await screen.findByRole('heading', { name: 'Mapping eventussecurity.com' })).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('shows the crawl not found state, and no drawer, for an unknown crawl', async () => {
    renderWithProviders(pagesAs('editor', 'overview'), {
      searchParams: '?run=0192e4a0-1000-7000-8000-0000000000ff&inspect=page:108',
    });
    expect(await screen.findByRole('heading', { name: 'That crawl was not found' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

describe('the page drawer of the Pages screen', () => {
  it.each(['overview', 'all'] as const)('opens from ?inspect=page:108 on the %s tab', async (tab) => {
    renderWithProviders(pagesAs('editor', tab), { searchParams: '?inspect=page:108' });
    expect(await screen.findByRole('complementary', { name: '/pricing' })).toBeInTheDocument();
  });

  it('keeps a non-default scope on the View all in Links addresses', async () => {
    renderWithProviders(pagesAs('editor', 'all'), { searchParams: '?inspect=page:108&itab=links&scope=all' });
    const panel = await screen.findByRole('complementary', { name: '/pricing' });
    const hrefOf = async (title: RegExp): Promise<string | null> => {
      const heading = await within(panel).findByRole('heading', { name: title });
      return within(heading.closest('section') as HTMLElement)
        .getByRole('link', { name: 'View all in Links' })
        .getAttribute('href');
    };
    const links = `/${MOCK_WORKSPACE.slug}/${EVENTUS_LINKS.slug}/seo/internal-links`;
    expect(await hrefOf(/^Linking pages \(\d+\)$/)).toBe(`${links}?tab=links&tgt=108&scope=all`);
    expect(await hrefOf(/^Outlinks \(\d+\)$/)).toBe(`${links}?tab=links&src=108&scope=all`);
  });

  it('renders the prompt drawer for ?inspect=prompt:<id> instead of the page drawer', async () => {
    const stub = <aside aria-label="Prompt drawer stub">Prompt</aside>;
    renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS, stub), { searchParams: '?inspect=prompt:p1' });
    expect(await screen.findByRole('complementary', { name: 'Prompt drawer stub' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: '/pricing' })).toBeNull();
  });
});
