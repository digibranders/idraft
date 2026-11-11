import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '../../../../messages/en.json';
import type { RankEventOut, RankEventPage } from '@/lib/api/types';
import { FEATURE_MESSAGE_KEYS, isFeatureType } from '@/lib/keywords/serp-features';
import { KEYWORD_TABLE } from '@/mocks/keyword-table';
import { mockId } from '@/mocks/mock-ids';
import { mswPath, problem } from '@/mocks/respond';
import { RANK_EVENT_PAGE } from '@/test/api-shapes';
import { DETAIL_KEYWORDS, keywordDetailAs } from '@/test/keyword-detail-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

// jsdom has no canvas: the chart is not what these tests are about
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/keywords',
}));

const EVENTS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/seo/rank-events';

/** The fixture keyword whose rank events include a change of the ranking URL, and the text it is shown by. */
const WITH_URL_CHANGE = (() => {
  const row = KEYWORD_TABLE[10];
  if (row === undefined) throw new Error('The fixture table has no eleventh keyword');
  return { id: mockId('tracked', 11), text: row.text };
})();

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

/** What the page asked of the rank events route, and what it was told, page by page. */
function recordEvents(): { urls: URL[]; pages: RankEventPage[] } {
  const record: { urls: URL[]; pages: RankEventPage[] } = { urls: [], pages: [] };
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/seo/rank-events')) record.urls.push(url);
  });
  server.events.on('response:mocked', async ({ request, response }) => {
    if (!new URL(request.url).pathname.endsWith('/seo/rank-events')) return;
    record.pages.push(RANK_EVENT_PAGE.parse(await response.clone().json()));
  });
  return record;
}

async function renderEvents(
  keyword: { id: string; text: string } = DETAIL_KEYWORDS.ranked,
  searchParams = '',
  onUrlUpdate?: (event: { queryString: string }) => void,
): Promise<{
  region: HTMLElement;
  user: ReturnType<typeof renderWithProviders>['user'];
}> {
  const { user } = renderWithProviders(keywordDetailAs('editor', keyword.id), {
    searchParams,
    ...(onUrlUpdate === undefined ? {} : { onUrlUpdate }),
  });
  await screen.findByRole('heading', { level: 1, name: keyword.text });
  return { region: await screen.findByRole('region', { name: 'Events' }), user };
}

const rows = (region: HTMLElement): HTMLElement[] => within(region).queryAllByRole('listitem');
/** The sentence of a row: its first paragraph. */
const sentenceOf = (row: HTMLElement): string => row.querySelector('p')?.textContent ?? '';
const sentences = (region: HTMLElement): string[] => rows(region).map(sentenceOf);
const rank = (value: number | null): string => (value === null ? 'not ranked' : `#${String(value)}`);

const featureName = (type: string | null): string => {
  if (type === null || !isFeatureType(type)) throw new Error(`Not a feature type: ${String(type)}`);
  return messages.rankings.features.names[FEATURE_MESSAGE_KEYS[type]];
};

/** The events of `page` of one type, which a test then looks for in the list. */
const ofType = (page: RankEventPage, type: string): RankEventOut[] =>
  page.data.filter((event) => event.event_type === type);

const firstPage = (record: { pages: RankEventPage[] }): RankEventPage => {
  const page = record.pages[0];
  if (page === undefined) throw new Error('The route has not answered');
  return page;
};

describe('The events panel', () => {
  it('is the last panel of the Overview and lists the 50 newest events of the keyword', async () => {
    const record = recordEvents();
    const { region } = await renderEvents();
    await waitFor(() => expect(rows(region)).toHaveLength(50));
    expect(record.urls).toHaveLength(1);
    const params = record.urls[0]?.searchParams;
    expect(params?.get('filter[tracked_keyword_id]')).toBe(DETAIL_KEYWORDS.ranked.id);
    expect(params?.get('limit')).toBe('50');
    expect(params?.has('filter[event_type_in]')).toBe(false);
    expect(firstPage(record).data).toHaveLength(50);
    expect(firstPage(record).page.has_more).toBe(true);
    const panel = screen.getByRole('tabpanel', { name: 'Overview' });
    const regions = within(panel).getAllByRole('region');
    expect(regions.at(-1)).toBe(region);
    expect(within(region).getByRole('heading', { level: 2, name: 'Events' })).toBeInTheDocument();
  });

  it('words each event with its real ranks, pages, feature and competitor', async () => {
    const record = recordEvents();
    const { region } = await renderEvents();
    await waitFor(() => expect(rows(region)).toHaveLength(50));
    const shown = sentences(region);
    const page = firstPage(record);

    const gains = ofType(page, 'rank_gain');
    expect(gains.length).toBeGreaterThan(0);
    for (const event of gains) {
      expect(shown).toContain(`Rank improved from ${rank(event.from_rank)} to ${rank(event.to_rank)}`);
    }
    const drops = ofType(page, 'rank_drop');
    expect(drops.length).toBeGreaterThan(0);
    for (const event of drops) {
      expect(shown).toContain(`Rank dropped from ${rank(event.from_rank)} to ${rank(event.to_rank)}`);
    }
    const features = ofType(page, 'feature_gained');
    expect(features.length).toBeGreaterThan(0);
    for (const event of features) expect(shown).toContain(`You now own ${featureName(event.feature_type)}`);
    const passed = ofType(page, 'overtaken_by');
    expect(passed.length).toBeGreaterThan(0);
    for (const event of passed) {
      expect(shown).toContain(
        `${event.other_entity?.canonical_name ?? 'no name'} passed you, from ${rank(event.from_rank)} to ${rank(event.to_rank)}`,
      );
    }
    const overtook = ofType(page, 'overtook');
    expect(overtook.length).toBeGreaterThan(0);
    for (const event of overtook) {
      expect(shown).toContain(
        `You passed ${event.other_entity?.canonical_name ?? 'no name'}, now at ${rank(event.to_rank)}`,
      );
    }
  });

  it('gives every event a link to its snapshot on the SERP snapshots tab', async () => {
    const record = recordEvents();
    const { region } = await renderEvents();
    await waitFor(() => expect(rows(region)).toHaveLength(50));
    const links = within(region).getAllByRole('link', { name: /^Open snapshot of / });
    expect(links).toHaveLength(50);
    const page = firstPage(record);
    links.forEach((link, index) => {
      const event = page.data[index];
      expect(link).toHaveTextContent('Open snapshot');
      expect(link.getAttribute('href')).toBe(
        `/digibranders/fynix/seo/keywords/${DETAIL_KEYWORDS.ranked.id}?tab=snapshots&obs=${event?.serp_snapshot_id ?? 'no snapshot'}`,
      );
    });
  });

  it('shows the events newest first', async () => {
    const { region } = await renderEvents();
    await waitFor(() => expect(rows(region)).toHaveLength(50));
    const instants = Array.from(region.querySelectorAll('time')).map((time) => Date.parse(time.dateTime));
    expect(instants).toHaveLength(50);
    for (let index = 1; index < instants.length; index += 1) {
      expect(instants[index - 1]).toBeGreaterThanOrEqual(instants[index] ?? Number.POSITIVE_INFINITY);
    }
  });

  it('filters by the Ranking URL toggle: asks for url_changed, writes events=url and lists only URL changes', async () => {
    const record = recordEvents();
    const updates: string[] = [];
    const { region, user } = await renderEvents(WITH_URL_CHANGE, '', (event) => updates.push(event.queryString));
    await waitFor(() => expect(rows(region).length).toBeGreaterThan(1));
    const everything = rows(region).length;

    await user.click(within(region).getByRole('button', { name: 'Ranking URL' }));
    await waitFor(() => expect(record.urls.at(-1)?.searchParams.get('filter[event_type_in]')).toBe('url_changed'));
    expect(updates.at(-1)).toBe('?events=url');
    expect(within(region).getByRole('button', { name: 'Ranking URL' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(region).getByRole('button', { name: 'All events' })).toHaveAttribute('aria-pressed', 'false');

    await waitFor(() => expect(rows(region)).toHaveLength(1));
    expect(rows(region).length).toBeLessThan(everything);
    const change = record.pages.at(-1)?.data[0];
    expect(change?.event_type).toBe('url_changed');
    expect(sentences(region)).toEqual([
      `Ranking URL changed from ${change?.from_url?.path ?? 'no path'} to ${change?.to_url?.path ?? 'no path'}`,
    ]);

    await user.click(within(region).getByRole('button', { name: 'All events' }));
    await waitFor(() => expect(rows(region)).toHaveLength(everything));
    expect(updates.at(-1)).toBe('');
  });

  it('restores the kinds from the address', async () => {
    const { region } = await renderEvents(WITH_URL_CHANGE, '?events=url');
    await waitFor(() => expect(rows(region)).toHaveLength(1));
    expect(within(region).getByRole('button', { name: 'Ranking URL' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('loads the next 50 with Show older events, appends them without reordering, and then ends', async () => {
    const record = recordEvents();
    const { region, user } = await renderEvents();
    await waitFor(() => expect(rows(region)).toHaveLength(50));
    const before = sentences(region);
    const times = Array.from(region.querySelectorAll('time')).map((time) => time.dateTime);

    await user.click(within(region).getByRole('button', { name: 'Show older events' }));
    await waitFor(() => expect(rows(region)).toHaveLength(63));
    expect(record.urls).toHaveLength(2);
    expect(record.urls[1]?.searchParams.get('cursor')).toBe(firstPage(record).page.next_cursor);
    expect(sentences(region).slice(0, 50)).toEqual(before);
    expect(
      Array.from(region.querySelectorAll('time'))
        .map((time) => time.dateTime)
        .slice(0, 50),
    ).toEqual(times);
    expect(record.pages[1]?.data).toHaveLength(13);

    expect(within(region).queryByRole('button', { name: 'Show older events' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(within(region).getByRole('heading', { level: 2, name: 'Events' }));
    expect(document.getElementById('live-region-polite')).toHaveTextContent('13 more events loaded');
  });

  it('says No events yet with the first check needed for a keyword that was never checked', async () => {
    const { region } = await renderEvents(DETAIL_KEYWORDS.pending);
    expect(await within(region).findByRole('heading', { name: 'No events yet' })).toBeInTheDocument();
    expect(
      within(region).getByText('This keyword has not been checked yet. Events appear after the first check.'),
    ).toBeInTheDocument();
    expect(rows(region)).toHaveLength(0);
  });

  it('says why a keyword whose every check failed has no events', async () => {
    const { region } = await renderEvents(DETAIL_KEYWORDS.failed);
    expect(await within(region).findByRole('heading', { name: 'No events yet' })).toBeInTheDocument();
    expect(
      within(region).getByText('Every check of this keyword has failed, so no event can be recorded.'),
    ).toBeInTheDocument();
  });

  it('says nothing has changed for a checked keyword with no events', async () => {
    server.use(
      http.get(mswPath(EVENTS), () =>
        HttpResponse.json({ data: [], page: { limit: 50, next_cursor: null, has_more: false } }),
      ),
    );
    const { region } = await renderEvents();
    expect(await within(region).findByRole('heading', { name: 'No events yet' })).toBeInTheDocument();
    expect(within(region).getByText('Nothing has changed since tracking began.')).toBeInTheDocument();
  });

  it('says no event matches when a filter leaves nothing, and keeps the filter to clear', async () => {
    const { region, user } = await renderEvents();
    await waitFor(() => expect(rows(region)).toHaveLength(50));
    await user.click(within(region).getByRole('button', { name: 'Ranking URL' }));
    expect(await within(region).findByRole('heading', { name: 'No matching events' })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'All events' })).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: 'All events' }));
    await waitFor(() => expect(rows(region)).toHaveLength(50));
  });

  it('shows its own error with Try again and leaves the rest of the page alone', async () => {
    let fail = true;
    server.use(http.get(mswPath(EVENTS), ({ request }) => (fail ? problem(request, 'provider_paused') : undefined)));
    const { region, user } = await renderEvents();
    expect(await within(region).findByText('The events did not load.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: DETAIL_KEYWORDS.ranked.text })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Rank history' })).toBeInTheDocument();
    expect(within(region).queryByRole('heading', { name: 'No events yet' })).not.toBeInTheDocument();
    fail = false;
    await user.click(within(region).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(rows(region)).toHaveLength(50));
    expect(within(region).queryByText('The events did not load.')).not.toBeInTheDocument();
  });

  it('keeps the events on show and says so when the next page does not load', async () => {
    let fail = false;
    server.use(
      http.get(mswPath(EVENTS), ({ request }) =>
        fail && new URL(request.url).searchParams.has('cursor') ? problem(request, 'provider_paused') : undefined,
      ),
    );
    const { region, user } = await renderEvents();
    await waitFor(() => expect(rows(region)).toHaveLength(50));
    fail = true;
    await user.click(within(region).getByRole('button', { name: 'Show older events' }));
    expect(await within(region).findByText('More events did not load.')).toBeInTheDocument();
    expect(rows(region)).toHaveLength(50);
    fail = false;
    await user.click(within(region).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(rows(region)).toHaveLength(63));
  });

  it('shows a loading state while the first page is on its way, not the empty state', async () => {
    server.use(http.get(mswPath(EVENTS), () => new Promise<never>(() => undefined)));
    const { region } = await renderEvents();
    expect(within(region).getByRole('status', { name: 'Loading the events' })).toHaveAttribute('aria-busy', 'true');
    expect(within(region).queryByRole('heading', { name: 'No events yet' })).not.toBeInTheDocument();
  });
});
