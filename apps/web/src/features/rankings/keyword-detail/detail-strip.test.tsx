import { screen, waitFor, within } from '@testing-library/react';
import { getResponse, http, HttpResponse, type HttpHandler } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { AioHistoryItem, RankHistory, TrackedKeywordDetail } from '@/lib/api/types';
import { formatDecimal, formatTableDateTime } from '@/lib/format';
import { handlers } from '@/mocks/handlers';
import { mswPath, problem } from '@/mocks/respond';
import { AIO_HISTORY, RANK_HISTORY, TRACKED_KEYWORD_DETAIL } from '@/test/api-shapes';
import { DETAIL_KEYWORDS, keywordDetailAs } from '@/test/keyword-detail-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

// jsdom has no canvas: the chart of the page next to the strip draws a stand-in
vi.mock('@/components/app/chart/echart', () => ({
  EChart: () => <div data-testid="echart-canvas" />,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/keywords',
}));

const DETAIL = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/{tracked_keyword_id}';
const HISTORY = `${DETAIL}/rank-history`;
const AIO = `${DETAIL}/aio-history`;
const DETAIL_ANSWER = z.object({ data: TRACKED_KEYWORD_DETAIL });
const HISTORY_ANSWER = z.object({ data: RANK_HISTORY });
const AIO_ANSWER = z.object({ data: AIO_HISTORY });
const TIME_ZONE = 'Europe/Berlin';
const STRIP = 'Summary for this keyword';

beforeEach(() => {
  stubWideScreen();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreWideScreen();
  server.events.removeAllListeners();
});

/** The route's own answer, parsed through the API's shape. */
async function realAnswer<T>(request: Request, parse: (body: unknown) => T): Promise<T> {
  const real = await getResponse([...handlers], new Request(request.url, { headers: request.headers }));
  return parse(await real?.json());
}

/** The keyword's detail with the state changed by `change`, for a world the fixtures do not hold. */
function answerDetailWith(change: (detail: TrackedKeywordDetail) => TrackedKeywordDetail): HttpHandler {
  return http.get(mswPath(DETAIL), async ({ request }) => {
    const detail = await realAnswer(request, (body) => DETAIL_ANSWER.parse(body).data);
    return HttpResponse.json({ data: change(detail) });
  });
}

function answerAioWith(change: (items: AioHistoryItem[]) => AioHistoryItem[]): HttpHandler {
  return http.get(mswPath(AIO), async ({ request }) => {
    const items = await realAnswer(request, (body) => AIO_ANSWER.parse(body).data);
    return HttpResponse.json({ data: change(items) });
  });
}

/** What each read of the page saw and was told, by the last segment of its path. */
function record(): {
  requests: URL[];
  detail: TrackedKeywordDetail[];
  history: RankHistory[];
  aio: AioHistoryItem[][];
} {
  const seen: ReturnType<typeof record> = { requests: [], detail: [], history: [], aio: [] };
  server.events.on('request:start', ({ request }) => {
    seen.requests.push(new URL(request.url));
  });
  server.events.on('response:mocked', async ({ request, response }) => {
    const path = new URL(request.url).pathname;
    if (request.method !== 'GET' || !response.ok) return;
    const body: unknown = await response.clone().json();
    if (path.endsWith('/rank-history')) seen.history.push(HISTORY_ANSWER.parse(body).data);
    else if (path.endsWith('/aio-history')) seen.aio.push(AIO_ANSWER.parse(body).data);
    else if (path.endsWith(`/tracked-keywords/${DETAIL_KEYWORDS.ranked.id}`))
      seen.detail.push(DETAIL_ANSWER.parse(body).data);
  });
  return seen;
}

const reads = (seen: { requests: URL[] }, suffix: string): URL[] =>
  seen.requests.filter((url) => url.pathname.endsWith(suffix));

/** The page of `keyword` and its strip, once the strip has its figures (or has been told they will not come). */
async function renderStrip(
  keyword: { id: string; text: string } = DETAIL_KEYWORDS.ranked,
  searchParams = '',
  { settled = true }: { settled?: boolean } = {},
): Promise<{ strip: HTMLElement; user: ReturnType<typeof renderWithProviders>['user'] }> {
  const { user } = renderWithProviders(keywordDetailAs('editor', keyword.id), { searchParams });
  await screen.findByRole('heading', { level: 1, name: keyword.text });
  const strip = await screen.findByRole('group', { name: STRIP });
  if (settled) await waitFor(() => expect(strip).not.toHaveAttribute('aria-busy'));
  return { strip, user };
}

/** The labels of the cells, without the badge some carry beside the label. */
const labels = (strip: HTMLElement): string[] =>
  within(strip)
    .getAllByRole('term')
    .map((term) => term.firstElementChild?.textContent ?? '');
/** The value and context of the cell named `label`. */
function cell(strip: HTMLElement, label: string): HTMLElement {
  const terms = within(strip).getAllByRole('term');
  const index = terms.findIndex((term) => (term.textContent ?? '').startsWith(label));
  expect(index, `a cell named ${label}`).toBeGreaterThanOrEqual(0);
  const value = within(strip).getAllByRole('definition')[index];
  if (value === undefined) throw new Error(`The cell ${label} has no value`);
  return value;
}

const ownPoints = (history: RankHistory): RankHistory['series'] =>
  (history.series ?? []).filter((entry) => entry.entity.role === 'own');

describe('The metric strip', () => {
  it('is a group named for the keyword with six cells in the order of the page', async () => {
    const { strip } = await renderStrip();
    expect(labels(strip)).toEqual(['Rank', 'Best rank', 'Average rank', 'Days in top 10', 'Volume', 'AI Overview']);
  });

  it('shows the rank of the keyword with its change and when it was checked', async () => {
    const seen = record();
    const { strip } = await renderStrip();
    await waitFor(() => expect(seen.detail).toHaveLength(1));
    const state = seen.detail[0]?.state;
    if (state === undefined) throw new Error('The keyword was not read');
    expect(state.current.state).toBe('ranked');
    expect(state.change.label).toBe('numeric');
    const places = Math.abs(state.change.value ?? 0);
    expect(places).toBeGreaterThan(0);
    const rank = cell(strip, 'Rank');
    expect(rank.textContent).toMatch(new RegExp(`^${String(state.current.rank)}`));
    expect(rank).toHaveTextContent(
      new RegExp(`${(state.change.value ?? 0) > 0 ? 'improved' : 'declined'} ${String(places)} position`),
    );
    expect(rank).toHaveTextContent(`Checked ${formatTableDateTime(state.current.observed_at ?? '', TIME_ZONE)}`);
  });

  it('gives the best rank of the keyword with its date, not of the window', async () => {
    const seen = record();
    const { strip } = await renderStrip();
    await waitFor(() => expect(seen.detail).toHaveLength(1));
    const state = seen.detail[0]?.state;
    expect(state?.best_rank).not.toBeNull();
    const best = cell(strip, 'Best rank');
    expect(best.textContent).toMatch(new RegExp(`^${String(state?.best_rank)}`));
    expect(best).toHaveTextContent(/[A-Z][a-z]{2} \d{1,2}/);
  });

  it('takes the average from the API and counts the days in the top 10 from the own checks, each over its own base', async () => {
    const seen = record();
    const { strip } = await renderStrip();
    await waitFor(() => expect(seen.history).toHaveLength(1));
    const history = seen.history[0];
    if (history === undefined) throw new Error('The history was not read');
    const points = ownPoints(history)?.flatMap((entry) => entry.points) ?? [];
    const checked = points.filter((point) => point.state !== 'failed');
    const days = new Set(checked.map((point) => point.date));
    const topTen = new Set(
      checked.filter((point) => point.rank !== null && point.rank <= 10).map((point) => point.date),
    );
    expect(days.size).toBeGreaterThan(10);
    const average = history.summary.average_rank?.value;
    expect(average).toBeTypeOf('number');
    const averageCell = cell(strip, 'Average rank');
    expect(averageCell.textContent).toMatch(new RegExp(`^${formatDecimal(average, 1)}`));
    expect(averageCell).toHaveTextContent(
      `${String(history.summary.ranked_checks)} of ${String(history.summary.checks)} checks`,
    );
    const topTenCell = cell(strip, 'Days in top 10');
    expect(topTenCell.textContent).toMatch(new RegExp(`^${String(topTen.size)}`));
    expect(topTenCell).toHaveTextContent(`of ${String(days.size)} days checked`);
  });

  it.each([
    [true, 1],
    [false, 0],
  ] as const)('shows the Estimate badge on the volume when is_estimate is %s', async (estimate, badges) => {
    server.use(
      answerDetailWith((detail) => {
        const volume = detail.metrics?.search_volume;
        if (detail.metrics === null || detail.metrics === undefined || volume === null || volume === undefined) {
          throw new Error('The fixture keyword has no volume');
        }
        return { ...detail, metrics: { ...detail.metrics, search_volume: { ...volume, is_estimate: estimate } } };
      }),
    );
    const { strip } = await renderStrip();
    const term = within(strip).getAllByRole('term')[4];
    if (term === undefined) throw new Error('The strip has no fifth cell');
    expect(term.firstElementChild).toHaveTextContent('Volume');
    expect(within(term).queryAllByText('Estimate')).toHaveLength(badges);
    expect(cell(strip, 'Volume').textContent).toMatch(/^[\d,]+/);
  });

  describe('the AI Overview cell', () => {
    const withAio = (aio: TrackedKeywordDetail['state']['aio']): HttpHandler =>
      answerDetailWith((detail) => ({ ...detail, state: { ...detail.state, aio } }));

    it.each([
      ['cited at 2', { state: 'present_cited', citation_position: 2, observation_id: null }, 'Cited #2'],
      [
        'present, not cited',
        { state: 'present_not_cited', citation_position: null, observation_id: null },
        'Present, not cited',
      ],
      ['absent', { state: 'absent', citation_position: null, observation_id: null }, 'No AIO'],
    ] as const)('reads %s like the table cell', async (_name, aio, text) => {
      server.use(withAio(aio));
      const { strip } = await renderStrip();
      expect(cell(strip, 'AI Overview')).toHaveTextContent(text);
    });

    it('counts the checks of the window that could be read', async () => {
      const seen = record();
      const { strip } = await renderStrip();
      await waitFor(() => expect(seen.aio).toHaveLength(1));
      const items = seen.aio[0] ?? [];
      const readable = items.filter((item) =>
        ['absent', 'present_cited', 'present_not_cited'].includes(item.ai_overview_state),
      );
      const present = readable.filter((item) => item.ai_overview_state !== 'absent');
      expect(readable.length).toBeGreaterThan(0);
      expect(cell(strip, 'AI Overview')).toHaveTextContent(
        `${String(present.length)} of ${String(readable.length)} checks`,
      );
    });

    it('says so when no check of the window could be read', async () => {
      server.use(answerAioWith(() => []));
      const { strip } = await renderStrip();
      expect(await within(strip).findByText('No readable checks in this window')).toBeInTheDocument();
    });
  });

  it('says a stale keyword is stale and when its last good check was', async () => {
    const seen = record();
    const stale = DETAIL_KEYWORDS.stale;
    server.events.on('response:mocked', async ({ request, response }) => {
      if (new URL(request.url).pathname.endsWith(`/tracked-keywords/${stale.id}`)) {
        seen.detail.push(DETAIL_ANSWER.parse(await response.clone().json()).data);
      }
    });
    const { strip } = await renderStrip(stale);
    await waitFor(() => expect(seen.detail.length).toBeGreaterThan(0));
    const observed = seen.detail.at(-1)?.state.current.observed_at;
    expect(observed).toBeTruthy();
    expect(cell(strip, 'Rank')).toHaveTextContent(
      `Stale, last good check ${formatTableDateTime(observed ?? '', TIME_ZONE)}`,
    );
  });

  it('says a keyword that was never checked has not been, and shows n/a, not zeros, elsewhere', async () => {
    const { strip } = await renderStrip(DETAIL_KEYWORDS.pending);
    await waitFor(() => expect(cell(strip, 'Rank')).toHaveTextContent('Not checked yet'));
    for (const label of ['Best rank', 'Average rank', 'Days in top 10', 'AI Overview']) {
      expect(cell(strip, label).textContent, label).toBe('n/a');
    }
  });

  it('says a keyword whose every check failed has failed, with n/a for the figures', async () => {
    const { strip } = await renderStrip(DETAIL_KEYWORDS.failed);
    await waitFor(() => expect(cell(strip, 'Rank')).toHaveTextContent('Check failed'));
    for (const label of ['Best rank', 'Average rank', 'Days in top 10']) {
      expect(cell(strip, label).textContent, label).toBe('n/a');
    }
  });

  it('keeps the labels and draws the values as bars while the history loads', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(mswPath(HISTORY), async ({ request }) => {
        await held;
        const history = await realAnswer(request, (body) => HISTORY_ANSWER.parse(body).data);
        return HttpResponse.json({ data: history });
      }),
    );
    const { strip } = await renderStrip(DETAIL_KEYWORDS.ranked, '', { settled: false });
    expect(strip).toHaveAttribute('aria-busy', 'true');
    expect(labels(strip)).toHaveLength(6);
    expect(within(strip).queryByText('Best rank')).toBeInTheDocument();
    release();
    await waitFor(() => expect(strip).not.toHaveAttribute('aria-busy'));
    expect(cell(strip, 'Rank').textContent).toMatch(/^\d/);
  });

  describe('when a read fails', () => {
    const banner = async (): Promise<HTMLElement> => {
      const title = await screen.findByText('Some figures did not load');
      const box = title.closest<HTMLElement>('[data-slot="inline-error"]');
      if (box === null) throw new Error('The notice is not an inline error');
      return box;
    };

    it('shows n/a for the figures of the history, one notice, and re-reads only what failed', async () => {
      let failures = 1;
      server.use(
        http.get(mswPath(HISTORY), async ({ request }) => {
          if (failures > 0) {
            failures -= 1;
            return problem(request, 'provider_paused');
          }
          const history = await realAnswer(request, (body) => HISTORY_ANSWER.parse(body).data);
          return HttpResponse.json({ data: history });
        }),
      );
      const seen = record();
      const { strip, user } = await renderStrip();
      const notice = await banner();
      expect(screen.getAllByText('Some figures did not load')).toHaveLength(1);
      expect(cell(strip, 'Average rank').textContent).toBe('n/a');
      expect(cell(strip, 'Days in top 10').textContent).toBe('n/a');
      expect(cell(strip, 'Rank').textContent).toMatch(/^\d/);
      const detailBefore = reads(seen, `/tracked-keywords/${DETAIL_KEYWORDS.ranked.id}`).length;
      const aioBefore = reads(seen, '/aio-history').length;
      const historyBefore = reads(seen, '/rank-history').length;
      await user.click(within(notice).getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(cell(strip, 'Average rank').textContent).toMatch(/^\d/));
      expect(reads(seen, '/rank-history').length).toBeGreaterThan(historyBefore);
      expect(reads(seen, `/tracked-keywords/${DETAIL_KEYWORDS.ranked.id}`)).toHaveLength(detailBefore);
      expect(reads(seen, '/aio-history')).toHaveLength(aioBefore);
      expect(screen.queryByText('Some figures did not load')).not.toBeInTheDocument();
    });

    it('keeps the AI Overview of the keyword and shows n/a for its count when the checks did not load', async () => {
      server.use(http.get(mswPath(AIO), ({ request }) => problem(request, 'provider_paused')));
      const { strip } = await renderStrip();
      await banner();
      const aio = cell(strip, 'AI Overview');
      expect(aio.textContent).toMatch(/Cited|Present|No AIO/);
      expect(aio).toHaveTextContent('n/a');
      expect(cell(strip, 'Average rank').textContent).toMatch(/^\d/);
    });
  });

  describe('the requests', () => {
    it('reads the history once for the chart and the strip together, and the AI Overview checks of the window', async () => {
      const seen = record();
      const { strip } = await renderStrip();
      await waitFor(() => expect(cell(strip, 'Average rank').textContent).toMatch(/^\d/));
      expect(reads(seen, '/rank-history')).toHaveLength(1);
      const aio = reads(seen, '/aio-history');
      expect(aio).toHaveLength(1);
      // 90 days ending on the project's local day, both ends included
      expect(aio[0]?.searchParams.get('from')).toBe('2026-08-05');
      expect(aio[0]?.searchParams.get('to')).toBe('2026-11-02');
    });

    it('follows the window of the page', async () => {
      const seen = record();
      const { strip } = await renderStrip(DETAIL_KEYWORDS.ranked, 'win=30d');
      await waitFor(() => expect(cell(strip, 'Average rank').textContent).toMatch(/^\d/));
      expect(reads(seen, '/rank-history')[0]?.searchParams.get('window')).toBe('last_30d');
      const aio = reads(seen, '/aio-history');
      expect(aio[0]?.searchParams.get('from')).toBe('2026-10-04');
      expect(aio[0]?.searchParams.get('to')).toBe('2026-11-02');
      const daysChecked = /of (\d+) days checked/.exec(cell(strip, 'Days in top 10').textContent ?? '')?.[1];
      expect(Number(daysChecked)).toBeLessThanOrEqual(30);
      expect(Number(daysChecked)).toBeGreaterThan(0);
    });
  });
});
