import { screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadBlob } from '@/lib/csv/csv-write';
import { formatInteger, formatPercent } from '@/lib/format';
import type { ChangesSummary, PagesOverview } from '@/lib/internal-links/types';
import { overviewModel } from '@/lib/pages/overview-model';
import { pagesTabPath, withQuery } from '@/lib/routes/paths';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { overviewOf } from '@/mocks/internal-links-inventory';
import { crawledPages, EVENTUS, HISTORY_RUN_IDS, MOCK_RUN_ID, pageRow } from '@/mocks/internal-links-world';
import { mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { EVENTUS_LINKS } from '@/test/internal-links-harness';
import { pagesAs } from '@/test/pages-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/pages',
  useSearchParams: () => new URLSearchParams(),
}));

const seam = vi.hoisted(() => ({
  totals: { state: 'unavailable' } as
    | { state: 'unavailable' }
    | { state: 'ready'; data: { withIssue: number; error: number; warning: number; notice: number } },
}));
vi.mock('@/lib/pages/issue-source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pages/issue-source')>()),
  useIssueTotals: () => seam.totals,
}));
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/csv/csv-write')>()),
  downloadBlob: vi.fn(),
}));

const CHANGES = mswPath(
  `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS.project_id}/internal-links/changes/summary`,
);
const OVERVIEW = mswPath(
  `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS.project_id}/internal-links/overview`,
);
const OLDER_RUN = HISTORY_RUN_IDS[1] ?? '';
const rows = crawledPages().map((page) => pageRow(page, 'all'));
const fixture = overviewOf(rows, { run_id: MOCK_RUN_ID, finished_at: null, sitemap: true });
/** The address of All pages for a query, as the screen builds it. */
const allPages = (query: Record<string, string>): ReturnType<typeof withQuery> =>
  withQuery(pagesTabPath(MOCK_WORKSPACE.slug, EVENTUS_LINKS.slug, 'all'), new URLSearchParams(query).toString());

const TITLES = [
  'Addresses by status',
  'From crawled to indexable',
  'Pages by section',
  'Pages by tier',
  'Click depth',
  'Sitemap coverage',
] as const;

function serve(overview: PagesOverview): void {
  server.use(http.get(OVERVIEW, () => HttpResponse.json({ data: overview })));
}
/** The card once its numbers have arrived (a loading card is a region too). */
async function card(title: string): Promise<HTMLElement> {
  const region = await screen.findByRole('region', { name: title });
  await waitFor(() => expect(region).not.toHaveAttribute('aria-busy'));
  return region;
}
const opens = (label: string, count: number): string => `${label}, ${formatInteger(count)}. Opens All pages`;

beforeEach(() => stubWideScreen());
afterEach(() => {
  seam.totals = { state: 'unavailable' };
  vi.mocked(downloadBlob).mockClear();
  restoreWideScreen();
  server.resetHandlers();
});

describe('the Overview cards (spec 6.4)', () => {
  it('draws the six cards with their titles, in the order of the spec', async () => {
    serve(fixture);
    renderWithProviders(pagesAs('viewer', 'overview'));
    await card(TITLES[0]);
    const drawn = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(drawn.filter((name) => TITLES.some((title) => title === name))).toEqual([...TITLES]);
  });

  it('makes every row that names pages a link to the view the backend counts', async () => {
    serve(fixture);
    renderWithProviders(pagesAs('viewer', 'overview'));
    const model = overviewModel(fixture, allPages);
    const status = await card('Addresses by status');
    const live = within(status).getAllByRole('link', { name: opens('Live pages', fixture.status.live) });
    expect(live.every((link) => link.getAttribute('href') === allPages({ view: 'live' }))).toBe(true);
    const funnel = await card('From crawled to indexable');
    expect(
      within(funnel)
        .getByRole('link', { name: opens('Indexable', fixture.indexable) })
        .getAttribute('href'),
    ).toBe(allPages({ view: 'indexable' }));
    const depth = await card('Click depth');
    const unreachable = model.depth.at(-1);
    expect(unreachable?.href).toBe(allPages({ view: 'unreachable' }));
    expect(
      within(depth)
        .getByRole('link', { name: opens('Not reachable by links', fixture.unreachable) })
        .getAttribute('href'),
    ).toBe(allPages({ view: 'unreachable' }));
    const sitemap = await card('Sitemap coverage');
    const missing = within(sitemap).getAllByRole('link', {
      name: opens('Indexable, missing from the sitemap', fixture.sitemap.indexable_missing ?? 0),
    });
    expect(missing[0]?.getAttribute('href')).toBe(allPages({ view: 'not_in_sitemap' }));
    const tiers = await card('Pages by tier');
    for (const row of model.tiers) {
      const link = within(tiers)
        .getAllByRole('link')
        .find((candidate) => candidate.getAttribute('href') === row.href);
      expect(link).toBeDefined();
    }
  });

  it('opens a section on live pages of that folder, and leaves the folded row without a link', async () => {
    const sections = Array.from({ length: 10 }, (_, index) => ({ section: `/s${String(index)}/`, pages: 10 - index }));
    serve({ ...fixture, sections, sections_total: 10 });
    renderWithProviders(pagesAs('viewer', 'overview'));
    const region = await card('Pages by section');
    const first = within(region).getByRole('link', { name: opens('/s0/', 10) });
    expect(first.getAttribute('href')).toBe(allPages({ view: 'live', folder: '/s0/' }));
    const folded = within(region)
      .getAllByRole('listitem')
      .find((item) => item.textContent.includes('Other sections (2)'));
    expect(folded).toBeDefined();
    expect(within(folded as HTMLElement).queryByRole('link')).toBeNull();
  });

  it('draws the ring with the live count in the middle, and leaves a group of 0 out of the legend but in the table', async () => {
    serve({ ...fixture, status: { ...fixture.status, blocked: 0 } });
    const { user } = renderWithProviders(pagesAs('viewer', 'overview'));
    const region = await card('Addresses by status');
    expect(within(region).getByText(`${formatInteger(fixture.status.live)} live`)).toBeInTheDocument();
    const legend = within(region).getByRole('list', { name: 'Addresses by status' });
    expect(within(legend).queryByRole('link', { name: /^Blocked/ })).toBeNull();
    expect(within(legend).getAllByRole('link').length).toBeGreaterThan(1);
    await user.click(within(region).getByRole('button', { name: 'Table' }));
    const table = within(region).getByRole('table', { name: 'Addresses by status' });
    const blocked = within(table).getByRole('row', { name: /Blocked/ });
    expect(within(blocked).getByRole('cell', { name: '0' })).toBeInTheDocument();
  });

  it.each(TITLES)(
    'switches %s between the chart and the table with the same rows, by keyboard, keeping focus',
    async (title) => {
      serve(fixture);
      const { user } = renderWithProviders(pagesAs('viewer', 'overview'));
      const region = await card(title);
      const links = within(region).getAllByRole('link');
      const labelsBefore = links.map((link) => link.getAttribute('href'));
      const toggle = within(region).getByRole('button', { name: 'Table' });
      toggle.focus();
      await user.keyboard('{Enter}');
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      expect(toggle).toHaveFocus();
      // The sitemap card also keeps the stacked bar's own legend table; the card's table is the one headed Group
      const table = within(region)
        .getAllByRole('table')
        .find((candidate) => within(candidate).queryByRole('columnheader', { name: 'Group' }) !== null);
      expect(table).toBeDefined();
      const headers = within(table as HTMLElement)
        .getAllByRole('columnheader')
        .map((header) => header.textContent);
      expect(headers).toEqual(['Group', 'Pages', 'Share']);
      // Every address the chart's links open, the table's links open too (it also keeps the groups of 0)
      const tableHrefs = within(table as HTMLElement)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'));
      for (const href of labelsBefore) expect(tableHrefs).toContain(href);
      await user.keyboard('{Enter}');
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(toggle).toHaveFocus();
    },
  );

  it('shows counts and shares in the table of the status card', async () => {
    serve(fixture);
    const { user } = renderWithProviders(pagesAs('viewer', 'overview'));
    const region = await card('Addresses by status');
    await user.click(within(region).getByRole('button', { name: 'Table' }));
    const live = within(within(region).getByRole('table')).getByRole('row', { name: /Live pages/ });
    expect(within(live).getByRole('cell', { name: formatInteger(fixture.status.live) })).toBeInTheDocument();
    expect(
      within(live).getByRole('cell', { name: formatPercent(fixture.status.live / fixture.addresses) }),
    ).toBeInTheDocument();
  });

  it('names the base of a share in the tooltip: every address for a status, live pages for a section', async () => {
    serve(fixture);
    const { user } = renderWithProviders(pagesAs('viewer', 'overview'));
    const status = await card('Addresses by status');
    await user.hover(within(status).getByRole('link', { name: opens('Live pages', fixture.status.live) }));
    expect((await screen.findAllByText(/of every address/)).length).toBeGreaterThan(0);
    await user.unhover(within(status).getByRole('link', { name: opens('Live pages', fixture.status.live) }));
    const sections = await card('Pages by section');
    const [first] = within(sections).getAllByRole('link');
    await user.hover(first as HTMLElement);
    expect((await screen.findAllByText(/of live pages/)).length).toBeGreaterThan(0);
  });

  it('says the crawl found no sitemap in card 6 and draws three rows in card 2', async () => {
    serve(overviewOf(rows, { run_id: MOCK_RUN_ID, finished_at: null, sitemap: false }));
    renderWithProviders(pagesAs('viewer', 'overview'));
    const sitemap = await card('Sitemap coverage');
    expect(within(sitemap).getByText('The crawl found no sitemap')).toBeInTheDocument();
    expect(within(sitemap).getByText('Add a sitemap to the website, then crawl again.')).toBeInTheDocument();
    const funnel = await card('From crawled to indexable');
    expect(
      within(within(funnel).getByRole('list', { name: 'From crawled to indexable' })).getAllByRole('listitem'),
    ).toHaveLength(3);
  });

  it('draws skeleton cards while the read loads, and the error and no card when it fails', async () => {
    server.use(
      http.get(OVERVIEW, async () => {
        await delay(300);
        return HttpResponse.json({ data: fixture });
      }),
    );
    const { container, unmount } = renderWithProviders(pagesAs('viewer', 'overview'));
    await waitFor(() => expect(container.querySelectorAll('section[aria-busy="true"]')).toHaveLength(6));
    await card(TITLES[0]);
    unmount();
    server.use(http.get(OVERVIEW, ({ request }) => problem(request, 'internal_error')));
    renderWithProviders(pagesAs('viewer', 'overview'));
    expect(await screen.findByText('The page counts could not be loaded')).toBeInTheDocument();
    for (const title of TITLES) expect(screen.queryByRole('region', { name: title })).toBeNull();
  });

  it('follows the crawl chosen in the picker', async () => {
    server.use(
      http.get(OVERVIEW, ({ request }) =>
        HttpResponse.json({
          data:
            new URL(request.url).searchParams.get('run') === OLDER_RUN
              ? { ...fixture, status: { ...fixture.status, live: fixture.status.live - 3 } }
              : fixture,
        }),
      ),
    );
    renderWithProviders(pagesAs('viewer', 'overview'), { searchParams: `?run=${OLDER_RUN}` });
    const region = await card('Addresses by status');
    expect(within(region).getByText(`${formatInteger(fixture.status.live - 3)} live`)).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    serve(fixture);
    const { container } = renderWithProviders(pagesAs('viewer', 'overview'));
    await card(TITLES[5]);
    expect(await axe(container)).toHaveNoViolations();
  });
});

const SUMMARY: ChangesSummary = {
  run_id: MOCK_RUN_ID,
  previous_run_id: OLDER_RUN,
  previous_finished_at: null,
  state: 'ready',
  links_compared: true,
  editorial_lost: 3,
  editorial_added: 7,
  all_lost: 4,
  all_added: 9,
  lost_to_top: 2,
  important_max_position: 2,
  pages_added: 12,
  pages_lost: 5,
  alert: null,
};
function serveChanges(summary: ChangesSummary): void {
  server.use(http.get(CHANGES, () => HttpResponse.json({ data: summary })));
}
const opensChanges = (label: string, value: string): string => `${label}, ${value}. Opens Internal links, Changes`;

describe('the Issues and Since the last crawl cards (spec 6.4, 10.1)', () => {
  it('shows four lines from the changes read, each a link to the Changes tab of Internal links', async () => {
    serve(fixture);
    serveChanges(SUMMARY);
    renderWithProviders(pagesAs('viewer', 'overview'));
    const region = await card('Since the last crawl');
    const lines = [
      ['Pages added', formatInteger(SUMMARY.pages_added)],
      ['Pages removed', formatInteger(SUMMARY.pages_lost)],
      [
        'Editorial links added and lost',
        `${formatInteger(SUMMARY.editorial_added)} added, ${formatInteger(SUMMARY.editorial_lost)} lost`,
      ],
      ['Links lost to important tiers', formatInteger(SUMMARY.lost_to_top)],
    ] as const;
    for (const [label, value] of lines) {
      const link = await within(region).findByRole('link', { name: opensChanges(label, value) });
      expect(link.getAttribute('href')).toContain('tab=changes');
    }
  });

  it('keeps the crawl chosen in the picker on the lines of the changes card', async () => {
    serve(fixture);
    serveChanges(SUMMARY);
    renderWithProviders(pagesAs('viewer', 'overview'), { searchParams: `?run=${OLDER_RUN}` });
    const region = await card('Since the last crawl');
    const link = await within(region).findByRole('link', {
      name: opensChanges('Pages added', formatInteger(SUMMARY.pages_added)),
    });
    expect(link.getAttribute('href')).toContain(`run=${OLDER_RUN}`);
  });

  it('says the first crawl has nothing to compare, and the comparison is pending, in one sentence each', async () => {
    serve(fixture);
    serveChanges({ ...SUMMARY, state: 'first_crawl', previous_run_id: null });
    const first = renderWithProviders(pagesAs('viewer', 'overview'));
    expect(await screen.findByText('This is the first crawl. Changes appear after the next one.')).toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Since the last crawl' });
    expect(within(region).queryByRole('link')).toBeNull();
    first.unmount();
    serveChanges({ ...SUMMARY, state: 'pending' });
    renderWithProviders(pagesAs('viewer', 'overview'));
    expect(await screen.findByText('Comparing with the crawl before')).toBeInTheDocument();
  });

  it('uses the words of the Changes tab when the changes could not be worked out', async () => {
    serve(fixture);
    serveChanges({ ...SUMMARY, state: 'unavailable' });
    renderWithProviders(pagesAs('viewer', 'overview'));
    expect(await screen.findByText('Changes could not be worked out for this crawl')).toBeInTheDocument();
    expect(screen.getByText('The crawl is still complete. Crawl again to compare.')).toBeInTheDocument();
  });

  it('draws no Issues card and five strip numbers while the Issues seam is unavailable', async () => {
    serve(fixture);
    serveChanges(SUMMARY);
    renderWithProviders(pagesAs('viewer', 'overview'));
    await card('Addresses by status');
    await card('Since the last crawl');
    expect(screen.queryByRole('region', { name: 'Issues' })).toBeNull();
    const strip = await screen.findByRole('group', { name: 'Page counts of this crawl' });
    expect(within(strip).getAllByRole('link')).toHaveLength(5);
  });

  it('draws the Issues card from the seam only, with three rows that open the Issues page by severity', async () => {
    seam.totals = { state: 'ready', data: { withIssue: 31, error: 4, warning: 17, notice: 22 } };
    serve(fixture);
    serveChanges(SUMMARY);
    renderWithProviders(pagesAs('viewer', 'overview'));
    const region = await card('Issues');
    const rows = [
      ['Pages with an error', 4, 'error'],
      ['Pages with a warning', 17, 'warning'],
      ['Pages with a notice', 22, 'notice'],
    ] as const;
    for (const [label, count, severity] of rows) {
      const link = within(region).getByRole('link', { name: `${label}, ${formatInteger(count)}. Opens Issues` });
      expect(link.getAttribute('href')).toMatch(new RegExp(`/seo/issues\\?severity=${severity}$`));
    }
    const strip = await screen.findByRole('group', { name: 'Page counts of this crawl' });
    expect(within(strip).getAllByRole('link')).toHaveLength(6);
    expect(within(strip).getByText(formatInteger(31))).toBeInTheDocument();
  });

  it('downloads pages-overview.csv with the header and the live count from the page Export', async () => {
    serve(fixture);
    serveChanges(SUMMARY);
    const { user } = renderWithProviders(pagesAs('viewer', 'overview'));
    await card('Addresses by status');
    await user.click(await screen.findByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export this tab (CSV)' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0] ?? [];
    expect(name).toBe('pages-overview.csv');
    const text = await (blob as Blob).text();
    expect(text).toContain('Card,Row,Count');
    expect(text).toContain(`Addresses by status,Live pages,${String(fixture.status.live)}`);
  });

  it('ends a failed download in the error toast and lets Export run again', async () => {
    serve(fixture);
    serveChanges(SUMMARY);
    vi.mocked(downloadBlob).mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const { user } = renderWithProviders(pagesAs('viewer', 'overview'));
    await card('Addresses by status');
    const run = async (): Promise<void> => {
      await user.click(await screen.findByRole('button', { name: 'Export' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Export this tab (CSV)' }));
    };
    await run();
    expect((await screen.findAllByText('The export could not be made')).length).toBeGreaterThan(0);
    await run();
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(2));
  });
});
