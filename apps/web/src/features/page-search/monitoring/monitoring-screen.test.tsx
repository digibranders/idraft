import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MonitoringScreen } from './monitoring-screen';
import type { PageNumbers, PageQueries, TrackedPageRow } from '../types';
import type { Schemas } from '@/lib/api/types';
import { downloadBlob } from '@/lib/csv/csv-write';
import { MINUS } from '@/lib/format';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/acme/eventus/seo/pages/monitoring',
  useSearchParams: () => new URLSearchParams(),
}));
// The real file save needs a browser; the test reads what the screen asks it to download
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/csv/csv-write')>()),
  downloadBlob: vi.fn(),
}));
// jsdom has no canvas: the chart frame and the sparkline draw stand-ins
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));

type Answer = Schemas['TrackedPagesResponse'];
type Role = Parameters<typeof membershipFactory>[0];

const LIST = '*/api/v1/workspaces/:w/projects/:p/fp/tracked-pages';
const REMOVE = '*/api/v1/workspaces/:w/projects/:p/fp/tracked-pages/remove';
const TIERS = '*/api/v1/workspaces/:w/page-tiers';
const DETAIL = '*/api/v1/workspaces/:w/projects/:p/fp/page-search/:id';
const WINDOW = { from: '2026-10-01', to: '2026-10-31', days: 31 };
const COMPARE = { from: '2026-09-01', to: '2026-09-30', days: 30 };
const PROJECT = { id: 'p1', slug: 'eventus', name: 'Eventus', timeZone: 'Europe/Berlin', host: 'eventussecurity.com' };

const numbers = (clicks: number, impressions: number, position: number | null = 5): PageNumbers => ({
  clicks,
  impressions,
  ctr: impressions === 0 ? null : clicks / impressions,
  position,
});
const verdict = (value: Schemas['PageHealth']['verdict']): Schemas['PageHealth'] => ({
  verdict: value,
  basis: 'clicks',
  change: null,
  absolute: 0,
  small: false,
  flags: [],
});
const queries = (value: number, previous: number | null, capped = false): PageQueries => ({ value, previous, capped });

function row(path: string, patch: Partial<TrackedPageRow> = {}): TrackedPageRow {
  return {
    url_id: path.slice(1),
    url: `https://eventussecurity.com${path}`,
    path,
    title: null,
    tier_id: null,
    added_at: '2026-11-01T00:00:00Z',
    history: 'ready',
    current: numbers(10, 100),
    previous: numbers(10, 100),
    health: verdict('stable'),
    queries: queries(50, 50),
    cannibalization: null,
    trend: [1, 2, 3],
    ...patch,
  };
}

const ROWS: TrackedPageRow[] = [
  row('/growing', {
    health: verdict('growing'),
    tier_id: 't2',
    current: numbers(500, 20_000, 3.8),
    previous: numbers(400, 20_000, 5.9),
    queries: queries(1240, 1105),
  }),
  row('/declining', {
    health: verdict('declining'),
    title: 'Plans and pricing',
    tier_id: 't1',
    current: numbers(317, 41_200, 5.9),
    previous: numbers(412, 39_000, 3.4),
    queries: queries(12, 17),
  }),
  row('/lost', { health: verdict('lost'), tier_id: null, queries: queries(25_000, null, true) }),
  row('/steady', { health: verdict('stable'), tier_id: 't1', queries: queries(0, null) }),
  row('/loading', { health: null, current: null, previous: null, history: 'loading', trend: null, queries: null }),
  row('/nocount', { health: verdict('new'), queries: null }),
];

const META: Answer['meta'] = {
  state: 'ok',
  property: 'sc-domain:eventussecurity.com',
  final_through: '2026-11-24',
  window: WINDOW,
  compare_window: COMPARE,
  limit: 200,
  tracked: ROWS.length,
};

interface Serving {
  rows?: TrackedPageRow[];
  meta?: Partial<Answer['meta']>;
}

/** The list answer, and the queries of each request: a period that is not the default month has none stored. */
function serve({ rows = ROWS, meta = {} }: Serving = {}): URL[] {
  const seen: URL[] = [];
  server.use(
    http.get(LIST, ({ request }) => {
      const url = new URL(request.url);
      seen.push(url);
      const month = !url.searchParams.has('from') || url.searchParams.get('from') === WINDOW.from;
      const none = url.searchParams.get('compare') === 'none';
      const data = rows.map((one) => ({
        ...one,
        queries: month ? one.queries : null,
        previous: none ? null : one.previous,
      }));
      const body: Answer = {
        data,
        meta: { ...META, ...meta, compare_window: none ? null : (meta.compare_window ?? COMPARE) },
      };
      return HttpResponse.json(body);
    }),
    http.get(TIERS, () =>
      HttpResponse.json({
        data: [
          {
            tier_id: 't1',
            code: 'T1',
            name: 'Money pages',
            label: 'T1 Money pages',
            position: 1,
            description: '',
            page_count: 2,
            rule_count: 0,
          },
          {
            tier_id: 't2',
            code: 'T2',
            name: 'Guides',
            label: 'T2 Guides',
            position: 2,
            description: '',
            page_count: 1,
            rule_count: 0,
          },
        ],
      }),
    ),
    http.get(DETAIL, () =>
      HttpResponse.json({
        data: {
          url_id: 'declining',
          url: 'https://eventussecurity.com/declining',
          path: '/declining',
          title: 'Plans and pricing',
          tier_id: 't1',
          tracked: true,
          current: numbers(317, 41_200, 5.9),
          previous: numbers(412, 39_000, 3.4),
          health: verdict('declining'),
          series: [{ date: '2026-10-01', clicks: 10, impressions: 100, position: 5 }],
          previous_series: [],
        },
        meta: {
          state: 'ok',
          property: 'sc-domain:eventussecurity.com',
          final_through: '2026-11-24',
          window: WINDOW,
          compare_window: COMPARE,
          history_from: '2026-08-27',
          retry_after: null,
        },
      }),
    ),
  );
  return seen;
}

interface Options {
  role?: Role;
  withoutRead?: boolean;
  searchParams?: string;
  onOpenPage?: (urlId: string) => void;
  onUrlUpdate?: Parameters<typeof renderWithProviders>[1] extends infer O
    ? O extends { onUrlUpdate?: infer U }
      ? U
      : never
    : never;
}

function renderScreen({
  role = 'owner',
  withoutRead = false,
  searchParams,
  onOpenPage,
  onUrlUpdate,
}: Options = {}): ReturnType<typeof renderWithProviders> {
  const membership = membershipFactory(role);
  const ui: ReactElement = (
    <PermissionProvider membership={withoutRead ? { ...membership, permissions: [] } : membership}>
      <MonitoringScreen
        workspaceId="w1"
        workspaceSlug="acme"
        project={PROJECT}
        {...(onOpenPage === undefined ? {} : { onOpenPage })}
      />
    </PermissionProvider>
  );
  return renderWithProviders(ui, {
    ...(searchParams === undefined ? {} : { searchParams }),
    ...(onUrlUpdate === undefined ? {} : { onUrlUpdate }),
  });
}

/** The table once at least one page is in it: it is drawn with skeleton rows while the list is on its way. */
async function grid(): Promise<HTMLElement> {
  const table = await screen.findByRole('grid', { name: 'Tracked pages' });
  await waitFor(() => {
    const names = within(table)
      .queryAllByRole('rowheader')
      .map((cell) => cell.textContent ?? '');
    expect(names.some((name) => name.startsWith('/'))).toBe(true);
  });
  return table;
}
const pathsOf = async (): Promise<string[]> =>
  within(await grid())
    .getAllByRole('rowheader')
    .map((cell) => /^\/[\w/-]*/.exec(cell.textContent ?? '')?.[0] ?? '');
const cellOf = async (path: string, column: string): Promise<HTMLElement> => {
  const table = await grid();
  const header = within(table).getByRole('columnheader', { name: new RegExp(`^${column}`, 'i') });
  const index = within(table).getAllByRole('columnheader').indexOf(header);
  const line = within(table)
    .getByRole('rowheader', { name: new RegExp(`^${path}`) })
    .closest('tr');
  const cell = line?.querySelectorAll<HTMLElement>('td, th')[index];
  if (cell === undefined) throw new Error(`No ${column} cell for ${path}`);
  return cell;
};

/** The field in the open "Add a filter" popover: the table has a column of the same name, drawn before it. */
const pickField = async (name: string): Promise<HTMLElement> => {
  await screen.findAllByRole('button', { name });
  const found = screen.getAllByRole('button', { name });
  const last = found.at(-1);
  if (last === undefined) throw new Error(`No ${name} field`);
  return last;
};

beforeEach(() => {
  stubWideScreen();
  vi.mocked(downloadBlob).mockReset();
});
afterEach(() => {
  restoreWideScreen();
});

describe('MonitoringScreen', () => {
  it('lists the tracked pages, the ones that need attention first, the pages without numbers last', async () => {
    serve();
    renderScreen();
    expect(await pathsOf()).toEqual(['/lost', '/declining', '/steady', '/growing', '/nocount', '/loading']);
  });

  it('has one row above the table, the filters inside it, and nothing else', async () => {
    serve();
    renderScreen();
    const table = await grid();
    let panel: HTMLElement | null = table;
    while (panel !== null && !panel.parentElement?.querySelector('[data-slot="page-toolbar"]'))
      panel = panel.parentElement;
    const before: string[] = [];
    for (const sibling of Array.from(panel?.parentElement?.children ?? [])) {
      if (sibling === panel) break;
      before.push(sibling.getAttribute('data-slot') ?? sibling.getAttribute('aria-label') ?? sibling.tagName);
    }
    expect(before).toEqual(['page-toolbar']);
    expect(
      panel?.parentElement?.querySelector('[data-slot="page-toolbar"] [aria-label="Period and filters"]'),
    ).not.toBeNull();
  });

  it('filters by tier and by health, keeps both in the address, and counts each verdict', async () => {
    serve();
    const onUrlUpdate = vi.fn();
    const { user } = renderScreen({ onUrlUpdate });
    await grid();
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    await user.click(await pickField('Health'));
    // One page of each of five verdicts has numbers; the page still loading has none and is counted nowhere
    expect(await screen.findByRole('radio', { name: 'Declining (1)' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Declining (1)' }));
    await waitFor(async () => expect(await pathsOf()).toEqual(['/declining']));
    const written = new URLSearchParams(onUrlUpdate.mock.calls.at(-1)?.[0].queryString);
    expect(written.get('health')).toBe('declining');
    expect(written.has('q')).toBe(false);
  });

  it('filters by tier from the address, including Untiered', async () => {
    serve();
    renderScreen({ searchParams: 'tier=t1' });
    await waitFor(async () => expect(await pathsOf()).toEqual(['/declining', '/steady']));
  });

  it('filters by the text typed in the search box, which is not in the address', async () => {
    serve();
    const onUrlUpdate = vi.fn();
    const { user } = renderScreen({ onUrlUpdate });
    await grid();
    await user.type(screen.getByRole('searchbox'), 'pricing');
    await waitFor(async () => expect(await pathsOf()).toEqual(['/declining']));
    expect(onUrlUpdate.mock.calls.some(([update]) => String(update.queryString).includes('pricing'))).toBe(false);
  });

  it('draws skeleton numbers for a row whose history is loading, and leaves it out of the counts', async () => {
    serve();
    const { user } = renderScreen();
    await grid();
    const cell = await cellOf('/loading', 'Clicks');
    expect(cell.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    await user.click(await pickField('Health'));
    await screen.findAllByRole('radio');
    const options = screen.getAllByText(/\(\d+\)$/);
    // Five rows have a verdict, of five kinds: the one still loading is counted under none
    expect(options).toHaveLength(5);
    const total = options.reduce(
      (sum, option) => sum + Number(/\((\d+)\)$/.exec(option.textContent ?? '')?.[1] ?? 0),
      0,
    );
    expect(total).toBe(5);
  });

  it('sorts by a column and writes the sort to the address', async () => {
    serve();
    const onUrlUpdate = vi.fn();
    const { user } = renderScreen({ onUrlUpdate });
    const table = await grid();
    await user.click(
      within(table)
        .getByRole('columnheader', { name: /^Impressions/i })
        .querySelector('button') as HTMLElement,
    );
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    const written = new URLSearchParams(onUrlUpdate.mock.calls.at(-1)?.[0].queryString);
    expect(written.get('sort')).toBe('-impressions');
  });

  describe('the owner requirement for the number cells', () => {
    it.each(['Clicks', 'Impressions', 'CTR', 'Average position', 'Queries'])(
      'sets the change of %s in a smaller font than its value',
      async (column) => {
        serve();
        renderScreen();
        await grid();
        const cell = await cellOf('/declining', column);
        const small = cell.querySelector('.type-meta');
        expect(small, `${column} has a change`).not.toBeNull();
        expect(small?.previousElementSibling).not.toHaveClass('type-meta');
      },
    );

    it('shows Queries after Average position, with its change beside it', async () => {
      serve();
      renderScreen();
      const table = await grid();
      const names = within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent ?? '');
      const queriesAt = names.findIndex((name) => /^Queries/i.test(name));
      expect(names.findIndex((name) => /^Average position/i.test(name))).toBe(queriesAt - 1);
      const cell = await cellOf('/growing', 'Queries');
      expect(within(cell).getByText('1,240')).toBeInTheDocument();
      expect(within(cell).getByText('+135')).toHaveClass('type-meta');
      expect(within(await cellOf('/declining', 'Queries')).getByText(`${MINUS}5`)).toHaveClass('type-meta');
    });

    it('says slipped or improved for the average position', async () => {
      serve();
      renderScreen();
      await grid();
      expect(within(await cellOf('/declining', 'Average position')).getByText('slipped 2.5')).toBeInTheDocument();
      expect(within(await cellOf('/growing', 'Average position')).getByText('improved 2.1')).toBeInTheDocument();
    });
  });

  it('sorts by Queries, the page without a count last in both directions', async () => {
    serve();
    renderScreen({ searchParams: 'sort=queries' });
    // Rows tied on no value come in the order of their ids
    await waitFor(async () => expect((await pathsOf()).slice(-2)).toEqual(['/loading', '/nocount']));
    expect((await pathsOf())[0]).toBe('/steady');
  });

  it('sorts by Queries descending, the capped page first and the ones without a count last', async () => {
    serve();
    renderScreen({ searchParams: 'sort=-queries' });
    await waitFor(async () => expect((await pathsOf())[0]).toBe('/lost'));
    expect((await pathsOf()).slice(-2)).toEqual(['/loading', '/nocount']);
    expect(within(await cellOf('/lost', 'Queries')).getByText('25,000+')).toBeInTheDocument();
  });

  it('reads Not collected yet in Queries for a period that is not a stored month, and never 0', async () => {
    serve();
    const { user } = renderScreen();
    await grid();
    await user.click(await screen.findByRole('button', { name: /^Period:/ }));
    await user.click(await screen.findByRole('button', { name: 'Last 7 days' }));
    await waitFor(async () => {
      expect(within(await cellOf('/declining', 'Queries')).getByText('Not collected yet')).toBeInTheDocument();
    });
    expect(within(await cellOf('/steady', 'Queries')).queryByText('0')).not.toBeInTheDocument();
  });

  it('hides Cannibalization while every row has null, and draws it when the API fills it', async () => {
    serve();
    const first = renderScreen();
    const table = await grid();
    expect(within(table).queryByRole('columnheader', { name: /Cannibalization/i })).not.toBeInTheDocument();
    first.unmount();
    serve({
      rows: ROWS.map((one) =>
        one.path === '/declining'
          ? { ...one, cannibalization: { keywords: 3, likely: 1, co_ranking: 1, unstable: 1 } }
          : one.path === '/growing'
            ? { ...one, cannibalization: { keywords: 1, likely: 0, co_ranking: 1, unstable: 0 } }
            : one,
      ),
    });
    renderScreen({ searchParams: 'sort=-cannibalization' });
    const filled = await grid();
    expect(await within(filled).findByRole('columnheader', { name: /Cannibalization/i })).toBeInTheDocument();
    expect(within(await cellOf('/declining', 'Cannibalization')).getByText('3 keywords')).toBeInTheDocument();
    // The count opens the project's Cannibalization page, so it is a button and not plain text
    expect(within(await cellOf('/declining', 'Cannibalization')).getByRole('button')).toBeInTheDocument();
    await waitFor(async () => expect((await pathsOf()).slice(0, 2)).toEqual(['/declining', '/growing']));
  });

  it('opens a row in the inspector with the page search detail, and steps to the next row', async () => {
    serve();
    const onUrlUpdate = vi.fn();
    const { user } = renderScreen({ onUrlUpdate });
    const table = await grid();
    await user.click(within(table).getByRole('rowheader', { name: /^\/declining/ }));
    const detail = await screen.findByRole('complementary');
    expect(within(detail).getByRole('heading', { name: '/declining' })).toBeInTheDocument();
    expect(await within(detail).findByText('Over time')).toBeInTheDocument();
    const written = new URLSearchParams(onUrlUpdate.mock.calls.at(-1)?.[0].queryString);
    expect(written.get('inspect')).toBe('page:declining');
    await user.click(within(detail).getByRole('button', { name: /^Next/ }));
    await waitFor(() => {
      expect(new URLSearchParams(onUrlUpdate.mock.calls.at(-1)?.[0].queryString).get('inspect')).toBe('page:steady');
    });
  });

  it('calls onOpenPage instead of the inspector when it is given', async () => {
    serve();
    const onOpenPage = vi.fn();
    const { user } = renderScreen({ onOpenPage });
    const table = await grid();
    await user.click(within(table).getByRole('rowheader', { name: /^\/declining/ }));
    expect(onOpenPage).toHaveBeenCalledWith('declining');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('stops tracking the selected pages, with a toast, and the rows are gone', async () => {
    const rows = [...ROWS];
    let removed: string[] = [];
    serve({ rows });
    server.use(
      http.post(REMOVE, async ({ request }) => {
        removed = ((await request.json()) as { url_ids: string[] }).url_ids;
        const gone = rows.findIndex((one) => one.url_id === removed[0]);
        if (gone !== -1) rows.splice(gone, 1);
        return HttpResponse.json({ data: { removed: removed.length } });
      }),
    );
    const { user } = renderScreen();
    const table = await grid();
    await user.click(within(table).getByRole('checkbox', { name: /Select \/steady/ }));
    await user.click(await screen.findByRole('button', { name: 'Stop tracking' }));
    await waitFor(() => expect(removed).toEqual(['steady']));
    expect(await screen.findByText('Stopped tracking 1 page')).toBeInTheDocument();
    await waitFor(async () => expect(await pathsOf()).not.toContain('/steady'));
  });

  it('exports the rows shown, with Queries and without the Cannibalization columns', async () => {
    serve();
    const { user } = renderScreen();
    await grid();
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    const blob = vi.mocked(downloadBlob).mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    const text = await (blob as Blob).text();
    // The file starts with a byte order mark for spreadsheets
    const [header = '', ...lines] = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim().split('\r\n');
    expect(header).toContain('Queries,Queries before');
    expect(header).not.toContain('Cannibalization');
    expect(lines).toHaveLength(ROWS.length);
    expect(lines[0]).toMatch(/^\/lost,/);
  });

  describe('states', () => {
    it('says Search Console is not connected, with no table, and the way to connect it for an owner', async () => {
      serve({ rows: [], meta: { state: 'not_connected', final_through: null, window: null, property: null } });
      renderScreen();
      expect(await screen.findByText('Connect Search Console to see how your pages perform.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Open Integrations' })).toBeInTheDocument();
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    });

    it('asks a member who cannot manage integrations to ask an admin', async () => {
      serve({ rows: [], meta: { state: 'not_connected', final_through: null, window: null, property: null } });
      renderScreen({ role: 'viewer' });
      expect(await screen.findByText('Ask an owner or admin to connect Search Console.')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Open Integrations' })).not.toBeInTheDocument();
    });

    it('shows an empty state with no pages tracked', async () => {
      serve({ rows: [], meta: { tracked: 0 } });
      renderScreen();
      expect(await screen.findByText('Add the pages that matter')).toBeInTheDocument();
      expect(screen.getByText(/up to 200 pages/)).toBeInTheDocument();
    });

    describe('Add pages', () => {
      const serveAdd = (): void =>
        server.use(
          http.get('*/api/v1/workspaces/:w/projects/:p/fp/tracked-pages/ids', () =>
            HttpResponse.json({ data: [], meta: { limit: 200 } }),
          ),
        );

      it('opens from the toolbar', async () => {
        serve();
        serveAdd();
        const { user } = renderScreen();
        await grid();
        await user.click(screen.getByRole('button', { name: 'Add pages' }));
        expect(await screen.findByRole('dialog', { name: 'Add pages' })).toBeInTheDocument();
      });

      it('opens from the empty state, the second button of the same name', async () => {
        serve({ rows: [], meta: { tracked: 0 } });
        serveAdd();
        const { user } = renderScreen();
        await screen.findByText('Add the pages that matter');
        expect(screen.getAllByRole('button', { name: 'Add pages' })).toHaveLength(2);
        await user.click(screen.getAllByRole('button', { name: 'Add pages' })[1] as HTMLElement);
        expect(await screen.findByRole('dialog', { name: 'Add pages' })).toBeInTheDocument();
      });

      it('is not offered to a member who cannot edit the project', async () => {
        serve();
        renderScreen({ role: 'viewer' });
        await grid();
        expect(screen.queryByRole('button', { name: 'Add pages' })).not.toBeInTheDocument();
      });
    });

    it('shows a banner and skeleton numbers while Search Console loads the first days', async () => {
      serve({
        rows: ROWS.map((one) => ({ ...one, current: null, previous: null, health: null, history: 'loading' as const })),
        meta: { state: 'pending', final_through: null, window: null, compare_window: null },
      });
      renderScreen();
      expect(await screen.findByText('Search Console is loading the last 28 days.')).toBeInTheDocument();
      expect((await cellOf('/lost', 'Clicks')).querySelector('[data-slot="skeleton"]')).not.toBeNull();
    });

    it('warns that the sign-in is stale and still shows the numbers', async () => {
      serve({ meta: { state: 'reauth_required' } });
      renderScreen();
      expect(
        await screen.findByText('Search Console needs a new sign-in. The numbers stop at Nov 24, 2026.'),
      ).toBeInTheDocument();
      expect(within(await cellOf('/declining', 'Clicks')).getByText('317')).toBeInTheDocument();
    });

    it('asks again every ten seconds while a row loads, and shows its numbers when they arrive', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const seen = serve({ rows: [ROWS[4] as TrackedPageRow] });
      renderScreen();
      await grid();
      const before = seen.length;
      server.use(http.get(LIST, () => HttpResponse.json({ data: [ROWS[1]], meta: META })));
      await vi.advanceTimersByTimeAsync(10_500);
      await waitFor(async () =>
        expect(within(await cellOf('/declining', 'Clicks')).getByText('317')).toBeInTheDocument(),
      );
      expect(seen.length).toBeGreaterThanOrEqual(before);
      vi.useRealTimers();
    });

    it('shows the no access state to a member without data:read', async () => {
      serve();
      renderScreen({ withoutRead: true });
      expect(await screen.findByText('You do not have access to Monitoring')).toBeInTheDocument();
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    });

    it('offers no selection and no Stop tracking to a member without projects:write', async () => {
      serve();
      renderScreen({ role: 'viewer' });
      const table = await grid();
      expect(within(table).queryByRole('checkbox')).not.toBeInTheDocument();
    });
  });

  describe('pinned columns', () => {
    class RegionObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element): void {
        const entry = { target, contentRect: { width: 1000, height: 600 } };
        this.callback([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve(): void {}
      disconnect(): void {}
    }

    it('keeps the select and Page columns pinned at the left when the table is wider than its region', async () => {
      vi.stubGlobal('ResizeObserver', RegionObserver);
      serve();
      renderScreen({ role: 'owner' });
      const table = await grid();
      const header = within(table).getByRole('columnheader', { name: /^Page/ });
      expect(header.style.left).toBe('40px');
      const cell = within(table).getByRole('rowheader', { name: /^\/lost/ });
      expect(cell.style.left).toBe('40px');
      expect(cell).toHaveClass('sticky');
    });

    it('pins the Page column at 0 for a member who has no select column', async () => {
      vi.stubGlobal('ResizeObserver', RegionObserver);
      serve();
      renderScreen({ role: 'viewer' });
      const table = await grid();
      expect(within(table).getByRole('columnheader', { name: /^Page/ }).style.left).toBe('0px');
    });
  });

  it('has no accessibility violations', async () => {
    serve();
    const { container } = renderScreen();
    await grid();
    expect(await axe(container)).toHaveNoViolations();
  });
});
