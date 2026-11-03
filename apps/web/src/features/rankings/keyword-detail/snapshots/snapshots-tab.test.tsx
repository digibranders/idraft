import { screen, waitFor, within } from '@testing-library/react';
import { getResponse, http, HttpResponse, type HttpHandler } from 'msw';
import type { UrlUpdateEvent } from 'nuqs/adapters/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { SerpCurrent, SerpSnapshotDetail, SerpSnapshotPage } from '@/lib/api/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '@/mocks/fixtures';
import { handlers } from '@/mocks/handlers';
import { mockId } from '@/mocks/mock-ids';
import { mswPath, problem } from '@/mocks/respond';
import { SERP_CURRENT, SERP_SNAPSHOT_DETAIL, SERP_SNAPSHOT_PAGE } from '@/test/api-shapes';
import { axe } from '@/test/axe';
import { DETAIL_KEYWORDS, keywordDetailAs } from '@/test/keyword-detail-harness';
import { dataOf, mockBrowser } from '@/test/mock-api';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

// jsdom has no canvas: the rank history chart on the Overview tab draws a stand-in
vi.mock('@/components/app/chart/echart', () => ({
  EChart: () => <div data-testid="echart-canvas" />,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/keywords',
}));

const CURRENT =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/{tracked_keyword_id}/serp-current';
const SNAPSHOTS =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/{tracked_keyword_id}/serp-snapshots';
const SNAPSHOT = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/serp-snapshots/{serp_snapshot_id}';
const CURRENT_ANSWER = z.object({ data: SERP_CURRENT });
const PAGE_ANSWER = SERP_SNAPSHOT_PAGE;
const DETAIL_ANSWER = z.object({ data: SERP_SNAPSHOT_DETAIL });

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The project fixtures are empty');
const FYNIX_ID = fynix.project_id;
/** A keyword that sits beyond its depth in the latest check and ranked 25th in an earlier, deeper one. */
const BEYOND = mockId('tracked', 3);
/** A keyword whose ranking URL changed twice in the 30 checks the mock keeps. */
const URL_CHANGER = mockId('tracked', 16);

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

/** The route's own answer for the keyword, read through the mock handlers. */
async function realAnswer(request: Request): Promise<Response> {
  const real = await getResponse([...handlers], new Request(request.url, { headers: request.headers }));
  if (real === undefined) throw new Error(`No mock handler answered ${request.url}`);
  return real;
}

function answerCurrentWith(change: (current: SerpCurrent) => SerpCurrent): HttpHandler {
  return http.get(mswPath(CURRENT), async ({ request }) =>
    HttpResponse.json({ data: change(CURRENT_ANSWER.parse(await (await realAnswer(request)).json()).data) }),
  );
}

function answerDetailWith(change: (detail: SerpSnapshotDetail) => SerpSnapshotDetail): HttpHandler {
  return http.get(mswPath(SNAPSHOT), async ({ request }) =>
    HttpResponse.json({ data: change(DETAIL_ANSWER.parse(await (await realAnswer(request)).json()).data) }),
  );
}

/** The snapshot list the mock gives, paged by `size` with a cursor of its own that the test controls. */
function pagedSnapshots(size: number): HttpHandler {
  return http.get(mswPath(SNAPSHOTS), async ({ request }) => {
    const url = new URL(request.url);
    url.searchParams.delete('cursor');
    url.searchParams.set('limit', '50');
    const all = PAGE_ANSWER.parse(await (await realAnswer(new Request(url, { headers: request.headers }))).json());
    const cursor = new URL(request.url).searchParams.get('cursor');
    const start = cursor === null ? 0 : Number(cursor);
    const end = start + size;
    const page: SerpSnapshotPage = {
      data: all.data.slice(start, end),
      page: { limit: size, has_more: end < all.data.length, next_cursor: end < all.data.length ? String(end) : null },
    };
    return HttpResponse.json(page);
  });
}

/** The paths of the requests the page makes, with their query strings. */
function recordRequests(): string[] {
  const asked: string[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    asked.push(`${url.pathname}${url.search}`);
  });
  return asked;
}

const picker = (): Promise<HTMLElement> => screen.findByRole('combobox', { name: 'Snapshot' });
const grid = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Organic results' });
const optionNames = (): string[] => screen.getAllByRole('option').map((option) => option.textContent ?? '');

/** Opens the picker and waits until the snapshots, not only "Latest check", are in its list. */
async function openPicker(user: ProvidedRender['user'], count: number): Promise<string[]> {
  await user.click(await picker());
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(count));
  return optionNames();
}

/** The tab on the ranked keyword, which ranks 10th in its latest check, for an editor. */
function openTab(
  searchParams = '?tab=snapshots',
  keyword: string = DETAIL_KEYWORDS.ranked.id,
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(keywordDetailAs('editor', keyword), { searchParams });
}

/** What the mock says the keyword's last check found: the table must show exactly this. */
async function currentOf(keyword: string): Promise<SerpCurrent> {
  const answer = await mockBrowser('editor').call(
    'GET',
    `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${FYNIX_ID}/tracked-keywords/${keyword}/serp-current`,
  );
  return dataOf(answer, SERP_CURRENT);
}

describe('The latest check', () => {
  it('shows the top 20 of the last check as a table: rank, title, address, entity and snippet', async () => {
    openTab();
    const table = await grid();
    const expected = await currentOf(DETAIL_KEYWORDS.ranked.id);
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(21));
    expect(expected.results).toHaveLength(20);
    const first = expected.results[0];
    if (first === undefined) throw new Error('The latest check has no first result');
    const row = within(table)
      .getByRole('rowheader', { name: first.title ?? '' })
      .closest('tr');
    if (row === null) throw new Error('The first result has no row');
    expect(within(row).getByRole('gridcell', { name: '1' })).toBeInTheDocument();
    expect(within(row).getByText(first.snippet ?? '')).toBeInTheDocument();
    const link = within(row).getByRole('link', { name: `Open ${first.domain.host}${first.url.path} in a new tab` });
    expect(link).toHaveAttribute('href', first.url.canonical_url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(link).toHaveTextContent(`${first.domain.host}${first.url.path}`);
  });

  it('names the own result "You" once and each competitor result by its name, with Not tracked for the rest', async () => {
    openTab();
    const table = await grid();
    const expected = await currentOf(DETAIL_KEYWORDS.ranked.id);
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(21));
    const own = within(table).getAllByRole('gridcell', { name: 'You' });
    expect(own).toHaveLength(1);
    const ownRow = own[0]?.closest('tr');
    const ownResult = expected.results.find((result) => result.entity?.role === 'own');
    if (ownRow === null || ownRow === undefined || ownResult === undefined) throw new Error('No own result');
    expect(ownRow).toContainElement(within(ownRow).getByRole('rowheader', { name: ownResult.title ?? '' }));
    expect(within(ownRow).getByRole('gridcell', { name: String(ownResult.organic_rank) })).toBeInTheDocument();
    const competitors = expected.results.filter((result) => result.entity?.role === 'competitor');
    expect(competitors).toHaveLength(2);
    for (const result of competitors) {
      expect(within(table).getAllByRole('gridcell', { name: result.entity?.canonical_name ?? '' })).toHaveLength(1);
    }
    // Everything else belongs to no tracked entity; the cell says so for assistive technology
    expect(within(table).getAllByText('Not tracked')).toHaveLength(17);
  });

  it('puts the own row on the accent tone and no other', async () => {
    openTab();
    const table = await grid();
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(21));
    expect(table.querySelectorAll('tr[data-tone="own"]')).toHaveLength(1);
    expect(within(table).getByRole('gridcell', { name: 'You' }).closest('tr')).toHaveAttribute('data-tone', 'own');
  });

  it('heads the table with the time of the check and keeps its panel in the tab order', async () => {
    openTab();
    await grid();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Latest check, Nov 2, 2026 · 03:00 GMT+1' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'SERP snapshots' })).toHaveAttribute('tabindex', '0');
  });

  it('filters the results by title, address and entity', async () => {
    const { user } = openTab();
    const table = await grid();
    const expected = await currentOf(DETAIL_KEYWORDS.ranked.id);
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(21));
    await user.type(screen.getByRole('searchbox', { name: 'Search in table' }), 'Brightwave');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    expect(within(table).getAllByRole('gridcell', { name: 'Brightwave Digital' })).toHaveLength(1);
    expect(expected.results.filter((r) => r.entity?.canonical_name === 'Brightwave Digital')).toHaveLength(1);
  });

  it('marks a watched entity by its name and a Watched badge', async () => {
    server.use(
      answerCurrentWith((current) => ({
        ...current,
        results: current.results.map((result) =>
          result.organic_rank === 3
            ? {
                ...result,
                entity: {
                  entity_id: '0192f0a1-3c44-7e10-9b1d-1f2a3b4c5d77',
                  canonical_name: 'Zapier',
                  entity_type: 'organization',
                  role: 'watch',
                  color_index: 4,
                },
              }
            : result,
        ),
      })),
    );
    openTab();
    const table = await grid();
    const cell = await within(table).findByRole('gridcell', { name: /^Zapier\s*Watched$/ });
    expect(within(cell).getByText('Watched')).toBeInTheDocument();
    expect(cell.closest('tr')).not.toHaveAttribute('data-tone');
  });

  it('shows an address that is not a web address as text, never as a link', async () => {
    server.use(
      answerCurrentWith((current) => ({
        ...current,
        results: current.results.map((result) =>
          result.organic_rank === 1
            ? { ...result, url: { ...result.url, canonical_url: 'javascript:alert(1)', path: '/danger' } }
            : result,
        ),
      })),
    );
    openTab();
    const table = await grid();
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(21));
    expect(within(table).getAllByRole('link')).toHaveLength(19);
    expect(within(table).queryByRole('link', { name: /\/danger/ })).toBeNull();
    expect(table).toHaveTextContent(/\/danger/);
  });

  it('says in the rank cell description where a result sits counting the features above it', async () => {
    server.use(
      answerCurrentWith((current) => ({
        ...current,
        results: current.results.map((result) =>
          result.organic_rank === 4
            ? { ...result, absolute_rank: 7 }
            : { ...result, absolute_rank: result.organic_rank },
        ),
      })),
    );
    openTab();
    const table = await grid();
    const cell = await within(table).findByRole('gridcell', { name: '4' });
    expect(cell).toHaveAccessibleDescription('Position 7 counting the SERP features above it');
    expect(within(table).getByRole('gridcell', { name: '5' })).not.toHaveAccessibleDescription();
  });

  it('has no accessibility violations', async () => {
    const { container } = openTab();
    const table = await grid();
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(21));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('A keyword with no snapshot', () => {
  it('says a never checked keyword has none yet, and reads no snapshot', async () => {
    const asked = recordRequests();
    openTab('?tab=snapshots', DETAIL_KEYWORDS.pending.id);
    expect(await screen.findByRole('heading', { level: 2, name: 'No SERP snapshot yet' })).toBeInTheDocument();
    expect(screen.getByText('The first check creates one.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Snapshot' })).toBeNull();
    expect(asked.filter((path) => path.includes('serp-'))).toEqual([]);
  });

  it('says a keyword whose every check failed has no snapshot because the check failed', async () => {
    const asked = recordRequests();
    openTab('?tab=snapshots', DETAIL_KEYWORDS.failed.id);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'The check failed, so there is no snapshot' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Check now tries again.')).toBeInTheDocument();
    expect(asked.filter((path) => path.includes('serp-'))).toEqual([]);
  });

  it('shows the snapshots of an archived keyword that was checked before', async () => {
    const { user } = openTab('?tab=snapshots', DETAIL_KEYWORDS.archived.id);
    // Six checks were made before it was archived: the latest and five older ones
    expect(await openPicker(user, 6)).toHaveLength(6);
    await user.keyboard('{Escape}');
    expect(await grid()).toBeInTheDocument();
  });
});

describe('The snapshot picker', () => {
  it('lists the latest check first and then the older snapshots, newest first, with depth and own rank', async () => {
    const { user } = openTab();
    const names = await openPicker(user, 30);
    expect(names[0]).toBe('Latest checkNov 2, 03:00 · top 20 · rank 10');
    expect(names[1]).toBe('Nov 1, 03:00 · top 50 · rank 8');
    expect(names[2]).toBe('Oct 31, 03:00 · top 100 · rank 12');
  });

  it('says not in the top N where the own site was beyond the depth', async () => {
    const { user } = openTab('?tab=snapshots', BEYOND);
    const names = await openPicker(user, 30);
    expect(names.slice(0, 3)).toEqual([
      'Latest checkNov 2, 03:00 · top 20 · not in top 20',
      'Nov 1, 03:00 · top 20 · not in top 20',
      'Oct 31, 03:00 · top 100 · rank 25',
    ]);
  });

  it('adds "ranking URL changed" to the snapshot where the ranking URL differs from the next older one', async () => {
    const { user } = openTab('?tab=snapshots', URL_CHANGER);
    const names = await openPicker(user, 30);
    const flagged = names.filter((name) => name.endsWith(' · ranking URL changed'));
    // The mock moves this keyword to another ranking page twice in its 30 checks
    expect(flagged).toHaveLength(2);
    for (const name of flagged)
      expect(name).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d\d:\d\d · top \d+ · rank \d+ · ranking URL changed$/);
    expect(names.filter((name) => !name.endsWith(' · ranking URL changed'))).toHaveLength(28);
  });

  it('shows an older snapshot from its own read: writes obs, names it, loads it with titles and the month hint', async () => {
    const writes: string[] = [];
    const asked = recordRequests();
    const { user } = renderWithProviders(keywordDetailAs('editor'), {
      searchParams: '?tab=snapshots',
      onUrlUpdate: (event: UrlUpdateEvent) => writes.push(event.queryString),
    });
    await openPicker(user, 30);
    await user.click(screen.getByRole('option', { name: 'Nov 1, 03:00 · top 50 · rank 8' }));
    await waitFor(() => expect(writes.at(-1)).toBe('?tab=snapshots&obs=3228817417'));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Snapshot of Nov 1, 2026 · 03:00 GMT+1' }),
    ).toBeInTheDocument();
    const reads = asked.filter((path) => /\/serp-snapshots\/\d+\?/.test(path));
    expect(reads).toHaveLength(1);
    const query = new URLSearchParams(reads[0]?.split('?')[1]);
    expect(query.get('include')).toBe('titles');
    expect(query.get('observed_at')).toBe('2026-11-01T02:00:00.000Z');
    const table = await grid();
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(51));
  });

  it('clears obs when the latest check is chosen again', async () => {
    const writes: string[] = [];
    const { user } = renderWithProviders(keywordDetailAs('editor'), {
      searchParams: '?tab=snapshots&obs=3228817417',
      onUrlUpdate: (event: UrlUpdateEvent) => writes.push(event.queryString),
    });
    expect(await screen.findByRole('heading', { level: 2, name: /^Snapshot of / })).toBeInTheDocument();
    await openPicker(user, 30);
    await user.click(screen.getByRole('option', { name: /^Latest check/ }));
    await waitFor(() => expect(writes.at(-1)).toBe('?tab=snapshots'));
    expect(await screen.findByRole('heading', { level: 2, name: /^Latest check, / })).toBeInTheDocument();
  });

  it('treats an obs equal to the latest check as the latest check', async () => {
    openTab('?tab=snapshots&obs=677996746');
    expect(await screen.findByRole('heading', { level: 2, name: /^Latest check, / })).toBeInTheDocument();
  });

  it('steps with Previous snapshot and Next snapshot, and stops at the ends with the reason', async () => {
    const writes: string[] = [];
    const { user } = renderWithProviders(keywordDetailAs('editor'), {
      searchParams: '?tab=snapshots',
      onUrlUpdate: (event: UrlUpdateEvent) => writes.push(event.queryString),
    });
    await picker();
    const previous = await screen.findByRole('button', { name: 'Previous snapshot' });
    const next = screen.getByRole('button', { name: 'Next snapshot' });
    expect(next).toHaveAttribute('aria-disabled', 'true');
    expect(next).toHaveAccessibleDescription('This is the newest snapshot');
    expect(previous).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(next);
    expect(writes).toEqual([]);
    await user.click(previous);
    await waitFor(() => expect(writes.at(-1)).toBe('?tab=snapshots&obs=3228817417'));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Snapshot of Nov 1, 2026 · 03:00 GMT+1' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next snapshot' })).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Next snapshot' }));
    await waitFor(() => expect(writes.at(-1)).toBe('?tab=snapshots'));
  });

  it('disables Previous snapshot at the oldest snapshot loaded and says why', async () => {
    const oldest = '3228817417';
    server.use(
      http.get(mswPath(SNAPSHOTS), async ({ request }) => {
        const all = PAGE_ANSWER.parse(await (await realAnswer(request)).json());
        return HttpResponse.json({
          data: all.data.slice(0, 2),
          page: { limit: 50, has_more: false, next_cursor: null },
        });
      }),
    );
    openTab(`?tab=snapshots&obs=${oldest}`);
    const previous = await screen.findByRole('button', { name: 'Previous snapshot' });
    await waitFor(() => expect(previous).toHaveAttribute('aria-disabled', 'true'));
    expect(previous).toHaveAccessibleDescription('This is the oldest snapshot loaded');
  });

  it('offers Load older snapshots only while the API has more, and appends them without losing the choice', async () => {
    server.use(pagedSnapshots(10));
    const { user } = openTab('?tab=snapshots&obs=3228817417');
    await screen.findByRole('button', { name: 'Load older snapshots' });
    await openPicker(user, 10);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
    await user.click(screen.getByRole('button', { name: 'Load older snapshots' }));
    // A second page of 10 arrives and the API still has more
    await openPicker(user, 20);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
    await user.click(screen.getByRole('button', { name: 'Load older snapshots' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load older snapshots' })).toBeNull());
    await openPicker(user, 30);
    // The snapshot chosen before is still the one on show
    expect(
      screen.getByRole('heading', { level: 2, name: 'Snapshot of Nov 1, 2026 · 03:00 GMT+1' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Nov 1, 03:00 · top 50 · rank 8', selected: true })).toBeInTheDocument();
  });

  it('has no Load older snapshots button when the list is whole', async () => {
    openTab();
    await picker();
    expect(screen.queryByRole('button', { name: 'Load older snapshots' })).toBeNull();
  });

  it('says where the list of snapshots failed, offers Try again, and still shows the latest results', async () => {
    let fail = true;
    server.use(http.get(mswPath(SNAPSHOTS), ({ request }) => (fail ? problem(request, 'provider_paused') : undefined)));
    const { user } = openTab();
    expect(await screen.findByText('The list of snapshots did not load')).toBeInTheDocument();
    const table = await grid();
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(21));
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await picker()).toBeInTheDocument();
    expect(screen.queryByText('The list of snapshots did not load')).toBeNull();
  });
});

describe('The results of a dated snapshot', () => {
  const OLDER = '?tab=snapshots&obs=3483549563';

  it('shows an older snapshot with titles for the entity rows only, and says so', async () => {
    openTab(OLDER);
    const table = await grid();
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(101));
    expect(
      screen.getByText('Titles are kept only for your pages, your competitors and the latest results.'),
    ).toBeInTheDocument();
    // A result without a title is named by its address
    expect(within(table).getAllByRole('rowheader').length).toBeGreaterThan(0);
  });

  it('shows rows by address with the note when no title is kept', async () => {
    server.use(
      answerDetailWith((detail) => ({
        ...detail,
        titles_source: 'unavailable',
        organic: detail.organic.map((item) => ({ ...item, title: null, snippet: null })),
      })),
    );
    openTab(OLDER);
    const table = await grid();
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(101));
    expect(screen.getByText(/^Titles are kept only for your pages/)).toBeInTheDocument();
    const firstHeader = within(table).getAllByRole('rowheader')[0];
    expect(firstHeader?.textContent).toMatch(/^[a-z0-9.-]+\.[a-z]+\//);
  });

  it('leaves the note out for the latest results, which carry their titles', async () => {
    openTab();
    const table = await grid();
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(21));
    expect(screen.queryByText(/^Titles are kept only for your pages/)).toBeNull();
  });

  it('says how many results were returned when fewer than the depth asked for', async () => {
    server.use(
      answerDetailWith((detail) => ({
        ...detail,
        depth_returned: 17,
        organic: detail.organic.slice(0, 17),
      })),
    );
    openTab(OLDER);
    const table = await grid();
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(18));
    expect(screen.getByText('17 of the top 100 results were returned.')).toBeInTheDocument();
  });

  it('says nothing about returned results when all of them came', async () => {
    openTab(OLDER);
    const table = await grid();
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(101));
    expect(screen.queryByText(/results (was|were) returned/)).toBeNull();
  });

  it('says a snapshot with no organic result has none, instead of an empty table', async () => {
    server.use(answerDetailWith((detail) => ({ ...detail, depth_returned: 0, organic: [] })));
    openTab(OLDER);
    expect(await screen.findByText('This snapshot has no organic results')).toBeInTheDocument();
    expect(screen.getByText('The provider returned none for this check.')).toBeInTheDocument();
  });
});

describe('When a snapshot cannot be shown', () => {
  it('shows an error with Try again for a failed read, and keeps the picker usable', async () => {
    let failing = true;
    server.use(
      http.get(mswPath(SNAPSHOT), ({ request }) => (failing ? problem(request, 'provider_paused') : undefined)),
    );
    const { user } = openTab('?tab=snapshots&obs=3483549563');
    expect(await screen.findByText('The results did not load')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Snapshot' })).toBeEnabled();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const table = await grid();
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(101));
  });

  it('says a snapshot that does not exist is no longer available, and a button shows the latest check', async () => {
    const writes: string[] = [];
    const { user } = renderWithProviders(keywordDetailAs('editor'), {
      searchParams: '?tab=snapshots&obs=999999',
      onUrlUpdate: (event: UrlUpdateEvent) => writes.push(event.queryString),
    });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'This snapshot is no longer available' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show the latest check' }));
    await waitFor(() => expect(writes.at(-1)).toBe('?tab=snapshots'));
    expect(await screen.findByRole('heading', { level: 2, name: /^Latest check, / })).toBeInTheDocument();
  });
});

describe('The snapshot tab by keyboard', () => {
  it('reaches the picker, Previous snapshot, Next snapshot and then the table, in that order', async () => {
    const { user } = openTab();
    const select = await picker();
    await grid();
    select.focus();
    expect(select).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Previous snapshot' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Next snapshot' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('searchbox', { name: 'Search in table' })).toHaveFocus();
  });

  it('chooses an option with Enter, and the focus is back on the picker', async () => {
    const writes: string[] = [];
    const { user } = renderWithProviders(keywordDetailAs('editor'), {
      searchParams: '?tab=snapshots',
      onUrlUpdate: (event: UrlUpdateEvent) => writes.push(event.queryString),
    });
    const select = await picker();
    await grid();
    select.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(30));
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(writes.at(-1)).toMatch(/obs=\d+/));
    expect(select).toHaveFocus();
  });

  it('steps again with the same key press: the focus stays on the button, and the new snapshot is announced', async () => {
    const { user } = openTab();
    await picker();
    const previous = await screen.findByRole('button', { name: 'Previous snapshot' });
    previous.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('heading', { level: 2, name: 'Snapshot of Nov 1, 2026 · 03:00 GMT+1' });
    expect(screen.getByRole('button', { name: 'Previous snapshot' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await screen.findByRole('heading', { level: 2, name: 'Snapshot of Oct 31, 2026 · 03:00 GMT+1' });
  });
});
