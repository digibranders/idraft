import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { OnUrlUpdateFunction } from 'nuqs/adapters/testing';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PageSearchPanel } from './page-search-panel';
import type { PageNumbers, PageSearchDetail, PageSearchMeta } from '../types';
import type { Role, Schemas } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { axe } from '@/test/axe';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

// jsdom has no canvas: the chart frame draws a stand-in for the ECharts canvas
vi.mock('@/components/app/chart/echart', () => ({
  EChart: () => <div data-testid="echart-canvas" />,
}));

type Answer = Schemas['PageSearchResponse'];

const ROUTE = '*/api/v1/workspaces/:w/projects/:p/fp/page-search/:id';
const WINDOW = { from: '2026-10-01', to: '2026-10-31', days: 31 };
const COMPARE = { from: '2026-09-01', to: '2026-09-30', days: 30 };

const numbers = (clicks: number, impressions: number, position: number | null): PageNumbers => ({
  clicks,
  impressions,
  ctr: impressions === 0 ? null : clicks / impressions,
  position,
});

const NOW = numbers(317, 41_200, 5.9);
const BEFORE = numbers(412, 39_000, 3.8);
const DAYS = ['2026-10-01', '2026-10-02', '2026-10-03'];
const series = (clicks: number): PageSearchDetail['series'] =>
  DAYS.map((date, index) => ({ date, clicks: clicks + index, impressions: 1000 + index, position: 5 }));

const META: PageSearchMeta = {
  state: 'ok',
  property: 'sc-domain:eventussecurity.com',
  final_through: '2026-11-24',
  window: WINDOW,
  compare_window: COMPARE,
  history_from: '2026-08-27',
  retry_after: null,
};

function answer(data: Partial<PageSearchDetail> = {}, meta: Partial<PageSearchMeta> = {}): Answer {
  return {
    data: {
      url_id: '902',
      url: 'https://eventussecurity.com/pricing',
      path: '/pricing',
      title: 'Pricing',
      tier_id: null,
      tracked: true,
      current: NOW,
      previous: BEFORE,
      health: { verdict: 'declining', basis: 'clicks', change: -0.26, absolute: -95, small: false, flags: [] },
      series: series(10),
      previous_series: series(12),
      ...data,
    },
    meta: { ...META, ...meta },
  };
}

/** The requests the panel made, and the answer to each: the compare choice shapes it as the API does. */
function serve(build: (url: URL) => Answer = () => answer()): URL[] {
  const seen: URL[] = [];
  server.use(
    http.get(ROUTE, ({ request }) => {
      const url = new URL(request.url);
      seen.push(url);
      const body = build(url);
      return HttpResponse.json(
        url.searchParams.get('compare') === 'none'
          ? {
              ...body,
              data: { ...body.data, previous: null, previous_series: [] },
              meta: { ...body.meta, compare_window: null },
            }
          : body,
      );
    }),
  );
  return seen;
}

interface Options {
  role?: Role;
  statusCode?: number | null;
  searchParams?: string;
  onUrlUpdate?: OnUrlUpdateFunction;
}

function renderPanel({ role = 'owner', statusCode = 200, searchParams, onUrlUpdate }: Options = {}): ReturnType<
  typeof renderWithProviders
> {
  const ui: ReactElement = (
    <PermissionProvider membership={membershipFactory(role)}>
      <PageSearchPanel
        workspaceId="w1"
        projectId="p1"
        workspaceSlug="acme"
        projectSlug="eventus"
        urlId="902"
        statusCode={statusCode}
        timeZone="Europe/Berlin"
      />
    </PermissionProvider>
  );
  return renderWithProviders(ui, {
    ...(searchParams === undefined ? {} : { searchParams }),
    ...(onUrlUpdate === undefined ? {} : { onUrlUpdate }),
  });
}

const strip = async (): Promise<HTMLElement> => screen.findByRole('group', { name: 'Search numbers for the period' });

beforeEach(() => {
  stubViewport();
});

describe('PageSearchPanel', () => {
  it('shows the four numbers of the period with their change', async () => {
    serve();
    renderPanel();
    const numbersOf = within(await strip());
    expect(numbersOf.getByText('317')).toBeInTheDocument();
    expect(numbersOf.getByText('41.2K')).toBeInTheDocument();
    expect(numbersOf.getByText('0.8%')).toBeInTheDocument();
    expect(numbersOf.getByText('5.9')).toBeInTheDocument();
    expect(numbersOf.getByText('Before 412')).toBeInTheDocument();
    expect(numbersOf.getByText('slipped 2.1')).toBeInTheDocument();
  });

  it('draws a chart for clicks and for impressions by default, and one more when CTR is ticked', async () => {
    const { user } = renderPanelWith();
    expect(await screen.findByRole('img', { name: 'Clicks' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Impressions' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'CTR' })).not.toBeInTheDocument();
    const toggles = within(screen.getByRole('group', { name: 'Over time' }));
    expect(toggles.getByRole('button', { name: 'Clicks' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggles.getByRole('button', { name: 'CTR' }));
    expect(await screen.findByRole('img', { name: 'CTR' })).toBeInTheDocument();
  });

  it('keeps at least one metric ticked', async () => {
    const { user } = renderPanelWith();
    const toggles = within(await screen.findByRole('group', { name: 'Over time' }));
    await user.click(toggles.getByRole('button', { name: 'Impressions' }));
    expect(toggles.getByRole('button', { name: 'Clicks' })).toBeDisabled();
    expect(toggles.getByRole('button', { name: 'Impressions' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('asks again when the comparison changes, and drops the Before values and the previous line', async () => {
    const seen = serve();
    const { user } = renderPanel();
    expect(await within(await strip()).findByText('Before 412')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: /^Compare with/ }));
    await user.click(await screen.findByRole('option', { name: 'No comparison' }));
    await waitFor(() => expect(seen.some((url) => url.searchParams.get('compare') === 'none')).toBe(true));
    await waitFor(() => expect(screen.queryByText(/^Before /)).not.toBeInTheDocument());
  });

  it('reads the last full month first, with no dates, and sends the chosen days afterwards', async () => {
    const seen = serve();
    renderPanel();
    await strip();
    expect(seen[0]?.searchParams.has('from')).toBe(false);
    expect(seen[0]?.searchParams.get('compare')).toBe('previous_period');
  });

  it('writes its own address keys and never win, from or to', async () => {
    serve();
    const onUrlUpdate = vi.fn();
    const { user } = renderPanel({ onUrlUpdate });
    await user.click(await screen.findByRole('button', { name: /^Period:/ }));
    await user.click(await screen.findByRole('button', { name: 'Last 7 days' }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    const written = new URLSearchParams(onUrlUpdate.mock.calls.at(-1)?.[0].queryString);
    expect(written.get('sp_win')).toBe('7d');
    expect(written.has('win')).toBe(false);
    expect(written.has('from')).toBe(false);
    expect(written.has('to')).toBe(false);
  });

  it('sends the period of a link as dates once it knows the last final day', async () => {
    const seen = serve();
    renderPanel({ searchParams: 'sp_win=7d' });
    await waitFor(() => expect(seen.some((url) => url.searchParams.get('from') === '2026-11-18')).toBe(true));
    expect(seen.find((url) => url.searchParams.has('from'))?.searchParams.get('to')).toBe('2026-11-24');
  });

  describe('states', () => {
    it('says Search Console is not connected, with the way to connect it for a member who can', async () => {
      serve(() =>
        answer(
          { current: null, previous: null, health: null, series: [], previous_series: [] },
          { state: 'not_connected', final_through: null, window: null, compare_window: null, property: null },
        ),
      );
      renderPanel({ role: 'owner' });
      expect(await screen.findByText('Connect Search Console to see how your pages perform.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Open Integrations' })).toHaveAttribute(
        'href',
        '/acme/eventus/integrations/google',
      );
    });

    it('asks a member who cannot manage integrations to ask an admin', async () => {
      serve(() =>
        answer(
          { current: null, previous: null, health: null, series: [], previous_series: [] },
          { state: 'not_connected', final_through: null, window: null, compare_window: null, property: null },
        ),
      );
      renderPanel({ role: 'viewer' });
      expect(await screen.findByText('Ask an owner or admin to connect Search Console.')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Open Integrations' })).not.toBeInTheDocument();
    });

    it('says the first numbers are on their way while the first days are stored', async () => {
      serve(() =>
        answer(
          { current: null, previous: null, health: null, series: [], previous_series: [] },
          { state: 'pending', final_through: null, window: null, compare_window: null },
        ),
      );
      renderPanel();
      expect(
        await screen.findByText('Not collected yet. The first numbers arrive within minutes.'),
      ).toBeInTheDocument();
    });

    it('warns that the sign-in is stale and still shows the stored numbers', async () => {
      serve(() => answer({}, { state: 'reauth_required' }));
      renderPanel();
      expect(
        await screen.findByText('Search Console needs a new sign-in. The numbers stop at Nov 24, 2026.'),
      ).toBeInTheDocument();
      expect(within(await strip()).getByText('317')).toBeInTheDocument();
    });

    it('shows only the not live sentence for a page that does not answer 200, and asks nothing', async () => {
      const seen = serve();
      renderPanel({ statusCode: 404 });
      expect(await screen.findByText('Only a page that answers 200 has search data.')).toBeInTheDocument();
      expect(seen).toHaveLength(0);
    });

    it('says a page with no impressions has none, and shows n/a for CTR and position with the reason', async () => {
      serve(() =>
        answer({
          current: numbers(0, 0, null),
          previous: numbers(4, 90, 8),
          health: { verdict: 'no_data', basis: 'clicks', change: null, absolute: 0, small: false, flags: [] },
        }),
      );
      renderPanel();
      const reason = 'Google reported no impressions for this page in this period.';
      const numbersOf = within(await strip());
      const missing = await numbersOf.findAllByText('n/a');
      expect(missing).toHaveLength(2);
      for (const value of missing) expect(value.closest('dd')).toHaveAccessibleDescription(reason);
      expect(screen.getAllByText(reason).length).toBeGreaterThan(0);
    });

    it('says Google is busy when the history could not be fetched, with Retry and no numbers', async () => {
      const seen = serve(() =>
        answer(
          { current: null, previous: null, health: null, series: [], previous_series: [] },
          { history_from: null, retry_after: 20 },
        ),
      );
      const { user } = renderPanel();
      expect(await screen.findByText('Google is busy. Trying again in 20 s.')).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Search numbers for the period' })).not.toBeInTheDocument();
      const before = seen.length;
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(seen.length).toBeGreaterThan(before));
    });
  });

  it('has no accessibility violations', async () => {
    serve();
    const { container } = renderPanel();
    await strip();
    expect(await axe(container)).toHaveNoViolations();
  });
});

/** The loaded panel with the default answer, for the tests that start from numbers on screen. */
function renderPanelWith(): ReturnType<typeof renderWithProviders> {
  serve();
  return renderPanel();
}
