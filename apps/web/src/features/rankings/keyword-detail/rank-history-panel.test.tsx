import { screen, waitFor, within } from '@testing-library/react';
import { getResponse, http, HttpResponse, type HttpHandler } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { HistoryPoint, ProjectEntity, RankHistory } from '@/lib/api/types';
import { handlers } from '@/mocks/handlers';
import { mswPath, problem } from '@/mocks/respond';
import { PROJECT_ENTITY, RANK_HISTORY } from '@/test/api-shapes';
import { DETAIL_KEYWORDS, keywordDetailAs } from '@/test/keyword-detail-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

// jsdom has no canvas: the frame draws a stand-in, and the options the chart is given are kept for reading
const drawn = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock('@/components/app/chart/echart', async () => {
  const { readChartTokens } = await import('@/lib/design/read-tokens');
  return {
    EChart: ({ option }: { option: (tokens: ReturnType<typeof readChartTokens>) => unknown }) => {
      drawn.options.push(option(readChartTokens()));
      return <div data-testid="echart-canvas" />;
    },
  };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/keywords',
}));

const HISTORY =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/{tracked_keyword_id}/rank-history';
const ENTITIES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities';
const HISTORY_ANSWER = z.object({ data: RANK_HISTORY });
const ENTITIES_KEY = ['ws'] as const;
const ENTITIES_ANSWER = z.object({ data: z.array(PROJECT_ENTITY) });

beforeEach(() => {
  stubWideScreen();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
  drawn.options.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreWideScreen();
  server.events.removeAllListeners();
});

/** The route's own answer, changed by `change`: for a world the fixtures do not hold. */
function answerHistoryWith(change: (history: RankHistory) => RankHistory): HttpHandler {
  return http.get(mswPath(HISTORY), async ({ request }) => {
    const real = await getResponse([...handlers], new Request(request.url, { headers: request.headers }));
    return HttpResponse.json({ data: change(HISTORY_ANSWER.parse(await real?.json()).data) });
  });
}

function answerEntitiesWith(change: (rows: ProjectEntity[]) => ProjectEntity[]): HttpHandler {
  return http.get(mswPath(ENTITIES), async ({ request }) => {
    const real = await getResponse([...handlers], new Request(request.url, { headers: request.headers }));
    return HttpResponse.json({ data: change(ENTITIES_ANSWER.parse(await real?.json()).data) });
  });
}

/** What the page asked of the rank history route, and what it was told. */
function recordHistory(): { urls: URL[]; answers: RankHistory[] } {
  const record: { urls: URL[]; answers: RankHistory[] } = { urls: [], answers: [] };
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/rank-history')) record.urls.push(url);
  });
  server.events.on('response:mocked', async ({ request, response }) => {
    if (!new URL(request.url).pathname.endsWith('/rank-history')) return;
    record.answers.push(HISTORY_ANSWER.parse(await response.clone().json()).data);
  });
  return record;
}

/** Extra competitors for the project, named so that they sort after the five it has. */
function withCompetitors(rows: ProjectEntity[], count: number): ProjectEntity[] {
  const template = rows.find((row) => row.role === 'competitor');
  if (template === undefined) throw new Error('The project has no competitor to copy');
  const extra = Array.from({ length: count }, (_, n): ProjectEntity => {
    const id = `0192f0a1-3c44-7e10-9b1d-1f2a3b4c5${String(100 + n)}`;
    return {
      ...template,
      entity: { ...template.entity, entity_id: id, canonical_name: `Zed Media ${String.fromCharCode(65 + n)}` },
    };
  });
  return [...rows, ...extra];
}

async function renderPanel(
  keyword: { id: string; text: string } = DETAIL_KEYWORDS.ranked,
  searchParams = '',
  onUrlUpdate?: (event: { queryString: string }) => void,
): Promise<{
  panel: HTMLElement;
  user: ReturnType<typeof renderWithProviders>['user'];
  unmount: () => void;
  queryClient: ReturnType<typeof renderWithProviders>['queryClient'];
}> {
  const { user, unmount, queryClient } = renderWithProviders(keywordDetailAs('editor', keyword.id), {
    searchParams,
    ...(onUrlUpdate === undefined ? {} : { onUrlUpdate }),
  });
  await screen.findByRole('heading', { level: 1, name: keyword.text });
  return { panel: screen.getByRole('tabpanel', { name: 'Overview' }), user, unmount, queryClient };
}

const chart = (panel: HTMLElement): Promise<HTMLElement> =>
  within(panel).findByRole('heading', { level: 2, name: 'Rank history' });
const legend = (panel: HTMLElement): string[] =>
  within(within(panel).getByRole('list', { name: 'Series in Rank history' }))
    .getAllByRole('button')
    .map((button) => button.textContent ?? '');
const firstAnswer = (record: { answers: RankHistory[] }): RankHistory => {
  const answer = record.answers[0];
  if (answer === undefined) throw new Error('The route has not answered');
  return answer;
};
const own = (history: RankHistory): HistoryPoint[] => {
  const series = history.series?.find((entry) => entry.entity.role === 'own');
  if (series === undefined) throw new Error('The history has no own series');
  return series.points;
};

const OPTION = z.object({
  yAxis: z.object({ name: z.string(), axisLabel: z.object({ customValues: z.array(z.number()) }) }),
  series: z.array(
    z.object({
      markArea: z
        .object({ data: z.array(z.tuple([z.object({ name: z.string().optional() }), z.unknown()])) })
        .optional(),
    }),
  ),
});
/** The option the chart was last given. */
const lastOption = (): z.infer<typeof OPTION> => OPTION.parse(drawn.options.at(-1));

/** The own series with its points changed by `change`, which is given the index of each. */
const withOwnPoints = (
  history: RankHistory,
  change: (point: HistoryPoint, index: number) => HistoryPoint,
): RankHistory => ({
  ...history,
  series: (history.series ?? []).map((entry) =>
    entry.entity.role === 'own' ? { ...entry, points: entry.points.map(change) } : entry,
  ),
});
const deepRank = (point: HistoryPoint): HistoryPoint => ({
  ...point,
  state: 'ranked',
  rank: 35,
  absolute_rank: 35,
  depth_requested: 100,
});

describe('The rank history panel', () => {
  it('asks for 90 days with every competitor by name, the absolute rank and the events, in one request', async () => {
    const record = recordHistory();
    const { panel } = await renderPanel();
    await chart(panel);
    expect(record.urls).toHaveLength(1);
    const params = record.urls[0]?.searchParams;
    expect(params?.get('window')).toBe('last_90d');
    expect(params?.get('include')).toBe('absolute,events');
    await waitFor(() => expect(record.answers).toHaveLength(1));
    const answered = (record.answers[0]?.series ?? []).map((entry) => entry.entity);
    expect(answered.length).toBe(6);
    // own first, then the competitors by name: the request names exactly the entities that came back
    expect(params?.get('entity_ids')?.split(',')).toEqual(['own', ...answered.slice(1).map((e) => e.entity_id)]);
    const names = answered.slice(1).map((e) => e.canonical_name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(legend(panel)).toEqual(['Fynix (you)', ...names]);
  });

  it('names the real first, last and best ranks in the chart description', async () => {
    const record = recordHistory();
    const { panel } = await renderPanel();
    const description = (await within(panel).findByRole('img', { name: 'Rank history' })).getAttribute(
      'aria-describedby',
    );
    await waitFor(() => expect(record.answers).toHaveLength(1));
    const ranks = own(firstAnswer(record)).flatMap((p) => (p.rank === null ? [] : [p.rank]));
    expect(ranks.length).toBeGreaterThan(5);
    const first = ranks[0];
    const last = ranks.at(-1);
    const best = Math.min(...ranks);
    const text = document.getElementById(description ?? '')?.textContent;
    expect(text).toContain(`from ${String(first)} to ${String(last)}, best ${String(best)}.`);
    expect(text).toContain('5 competitors are shown too.');
  });

  it("says the best, worst, median and average of the checks, the average being the API's", async () => {
    const { panel } = await renderPanel();
    await chart(panel);
    expect(
      within(panel).getByText('Best 8, worst 19, median 15.0, average 14.5 over 29 of 30 checks'),
    ).toBeInTheDocument();
    expect(within(panel).getByText(/^Last 90 days · 30 checks, 29 ranked · deep check Monday$/)).toBeInTheDocument();
  });

  it('says so when no check found the site, counts the checks that are drawn, and gives no best or median', async () => {
    server.use(
      answerHistoryWith((history) => ({
        ...history,
        series: (history.series ?? []).map((entry) => ({
          ...entry,
          points: entry.points.map((p): HistoryPoint => ({
            ...p,
            state: 'beyond_depth',
            rank: null,
            absolute_rank: null,
            depth_requested: 20,
          })),
        })),
        summary: {
          ...history.summary,
          ranked_checks: 0,
          beyond_depth_checks: history.summary.checks,
          average_rank: null,
        },
      })),
    );
    const { panel } = await renderPanel();
    await chart(panel);
    expect(within(panel).getByText('Not ranked in any of the 30 checks in this window')).toBeInTheDocument();
    expect(within(panel).queryByText(/^Best /)).toBeNull();
  });

  it('asks for 30 days when the window is changed, and keeps the choice in the address', async () => {
    const record = recordHistory();
    const writes: string[] = [];
    const { panel, user } = await renderPanel(DETAIL_KEYWORDS.ranked, '', (event) => writes.push(event.queryString));
    await chart(panel);
    await user.click(within(panel).getByRole('button', { name: 'Table' }));
    await user.click(within(panel).getByRole('combobox', { name: 'Window' }));
    await user.click(await screen.findByRole('option', { name: 'Last 30 days' }));
    // The card stays while the new window loads: the Table view is still the view
    expect(within(panel).getByRole('table', { name: 'Rank history' })).toBeInTheDocument();
    await waitFor(() => expect(record.urls).toHaveLength(2));
    expect(record.urls[1]?.searchParams.get('window')).toBe('last_30d');
    await waitFor(() => expect(writes.at(-1)).toBe('?win=30d'));
    expect(await within(panel).findByText(/^Last 30 days · \d+ checks/)).toBeInTheDocument();
    expect(await within(panel).findByText(/over the last 30 days/, { selector: 'p' })).toBeInTheDocument();
    expect(within(panel).getByRole('table', { name: 'Rank history' })).toBeInTheDocument();
  });

  it('opens on the window, competitors and layers of the address', async () => {
    const record = recordHistory();
    const { panel } = await renderPanel(DETAIL_KEYWORDS.ranked, '?win=7d&show=absolute,deep');
    await chart(panel);
    expect(record.urls[0]?.searchParams.get('window')).toBe('last_7d');
    expect(within(panel).getByRole('button', { name: 'Absolute' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getByRole('button', { name: 'Deep checks' })).toHaveAttribute('aria-pressed', 'true');
    expect(legend(panel)).toContain('Fynix (you) (absolute)');
  });

  it('draws only the competitors of the address, and none for an empty choice', async () => {
    const record = recordHistory();
    const first = await renderPanel();
    await chart(first.panel);
    await waitFor(() => expect(record.answers).toHaveLength(1));
    const rival = firstAnswer(record).series?.[2]?.entity;
    if (rival === undefined) throw new Error('The history holds no third series');
    first.unmount();
    const { panel, unmount } = await renderPanel(DETAIL_KEYWORDS.ranked, `?comp=${rival.entity_id}`);
    await chart(panel);
    expect(legend(panel)).toEqual(['Fynix (you)', rival.canonical_name]);
    unmount();
    const none = await renderPanel(DETAIL_KEYWORDS.ranked, '?comp=none');
    await chart(none.panel);
    expect(within(none.panel).queryByRole('list', { name: 'Series in Rank history' })).toBeNull();
  });

  it('adds the absolute rank to the legend and the table without a new request', async () => {
    const record = recordHistory();
    const writes: string[] = [];
    const { panel, user } = await renderPanel(DETAIL_KEYWORDS.ranked, '', (event) => writes.push(event.queryString));
    await chart(panel);
    const button = within(panel).getByRole('button', { name: 'Absolute' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(legend(panel)).not.toContain('Fynix (you) (absolute)');
    await user.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(legend(panel)).toContain('Fynix (you) (absolute)');
    await user.click(within(panel).getByRole('button', { name: 'Table' }));
    expect(within(panel).getByRole('columnheader', { name: 'Fynix (you) (absolute)' })).toBeInTheDocument();
    await waitFor(() => expect(writes.at(-1)).toBe('?show=absolute'));
    expect(record.urls).toHaveLength(1);
  });

  it('hides the deep checks by default, counts them in the toggle, and draws them when it is on', async () => {
    server.use(
      answerHistoryWith((history) => {
        const deepAt = '2026-10-10';
        return {
          ...history,
          series: (history.series ?? []).map((entry) =>
            entry.entity.role === 'own'
              ? {
                  ...entry,
                  points: entry.points.map((p): HistoryPoint =>
                    p.date === deepAt
                      ? { ...p, state: 'ranked', rank: 35, absolute_rank: 35, depth_requested: 100 }
                      : p,
                  ),
                }
              : entry,
          ),
        };
      }),
    );
    const record = recordHistory();
    const { panel, user } = await renderPanel();
    await chart(panel);
    const toggle = within(panel).getByRole('button', { name: 'Deep checks (1 hidden)' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(within(panel).getByRole('button', { name: 'Table' }));
    const row = (): HTMLElement => within(panel).getByRole('row', { name: /^Oct 10/ });
    expect(row()).not.toHaveTextContent('35');
    await user.click(toggle);
    const on = within(panel).getByRole('button', { name: 'Deep checks' });
    expect(on).toHaveAttribute('aria-pressed', 'true');
    expect(row()).toHaveTextContent('35');
    expect(record.urls).toHaveLength(1);
  });

  it('draws at most five competitors: at the limit an unchosen one is disabled and says why', async () => {
    server.use(answerEntitiesWith((rows) => withCompetitors(rows, 2)));
    const writes: string[] = [];
    const { panel, user } = await renderPanel(DETAIL_KEYWORDS.ranked, '', (event) => writes.push(event.queryString));
    await chart(panel);
    expect(legend(panel)).toHaveLength(6);
    await user.click(within(panel).getByRole('button', { name: 'Competitors (5)' }));
    const list = await screen.findByRole('list', { name: 'Competitors on the chart' });
    const rows = within(list).getAllByRole('checkbox');
    expect(rows.filter((box) => box.getAttribute('aria-checked') === 'true')).toHaveLength(5);
    const sixth = within(list).getByRole('checkbox', { name: 'Zed Media A' });
    expect(sixth).toHaveAttribute('aria-disabled', 'true');
    expect(sixth).toHaveAccessibleDescription('At most 5 competitors on the chart');
    // Taking one off frees the others
    await user.click(within(list).getByRole('checkbox', { name: 'SEO Weekly' }));
    await waitFor(() => expect(new URLSearchParams(writes.at(-1)).get('comp')?.split(',')).toHaveLength(4));
    expect(within(list).getByRole('checkbox', { name: 'Zed Media A' })).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(within(list).getByRole('checkbox', { name: 'Zed Media B' }));
    await waitFor(() => expect(new URLSearchParams(writes.at(-1)).get('comp')?.split(',')).toHaveLength(5));
    expect(await screen.findByRole('button', { name: 'Competitors (5)' })).toBeInTheDocument();
  });

  it('lists the chosen competitors first, in the order of the address, then the rest by name, each with a colour', async () => {
    const record = recordHistory();
    const first = await renderPanel();
    await chart(first.panel);
    await waitFor(() => expect(record.answers).toHaveLength(1));
    const [, a, b, c] = (firstAnswer(record).series ?? []).map((entry) => entry.entity);
    if (a === undefined || b === undefined || c === undefined) throw new Error('The history holds too few series');
    first.unmount();
    const { panel, user } = await renderPanel(DETAIL_KEYWORDS.ranked, `?comp=${c.entity_id},${a.entity_id}`);
    await chart(panel);
    expect(legend(panel)).toEqual(['Fynix (you)', c.canonical_name, a.canonical_name]);
    await user.click(within(panel).getByRole('button', { name: 'Competitors (2)' }));
    const list = await screen.findByRole('list', { name: 'Competitors on the chart' });
    const names = within(list)
      .getAllByRole('checkbox')
      .map((box) => document.getElementById(box.getAttribute('aria-labelledby') ?? '')?.textContent ?? '');
    expect(names.slice(0, 2)).toEqual([c.canonical_name, a.canonical_name]);
    expect(names).toHaveLength(5);
    expect(names.slice(2)).toEqual(names.slice(2).sort((x, y) => x.localeCompare(y)));
    expect(b.canonical_name).toBeTruthy();
  });

  it('asks for the first ten competitors by name and says how many it shows', async () => {
    server.use(answerEntitiesWith((rows) => withCompetitors(rows, 7)));
    const record = recordHistory();
    const { panel } = await renderPanel();
    await chart(panel);
    expect(within(panel).getByText('Showing 10 of 12 competitors')).toBeInTheDocument();
    expect(record.urls[0]?.searchParams.get('entity_ids')?.split(',')).toHaveLength(11);
  });

  it('shows its own error with Try again and leaves the rest of the page alone', async () => {
    let fail = true;
    server.use(http.get(mswPath(HISTORY), ({ request }) => (fail ? problem(request, 'provider_paused') : undefined)));
    const { panel, user } = await renderPanel();
    expect(await within(panel).findByText('The rank history did not load.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: DETAIL_KEYWORDS.ranked.text })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Keyword sections' })).toBeInTheDocument();
    expect(within(panel).queryByRole('heading', { level: 2, name: 'Rank history' })).toBeNull();
    fail = false;
    await user.click(within(panel).getByRole('button', { name: 'Try again' }));
    expect(await chart(panel)).toBeInTheDocument();
  });

  it.each([
    ['pending', DETAIL_KEYWORDS.pending, 'This keyword has not been checked yet. This fills in after the first check.'],
    ['failed', DETAIL_KEYWORDS.failed, 'Every check of this keyword has failed, so there is nothing to show.'],
    [
      'stale',
      DETAIL_KEYWORDS.stale,
      'No check falls in this window, and the last good one is older. Choose a longer window.',
    ],
    [
      'archived',
      DETAIL_KEYWORDS.archived,
      'This keyword is archived and no longer checked. No check falls in this window.',
    ],
    ['live', DETAIL_KEYWORDS.ranked, 'No check falls in this window. Choose a longer window.'],
  ] as const)(
    'says "No checks yet" and why for a %s keyword with no check in the window',
    async (_kind, keyword, reason) => {
      server.use(
        answerHistoryWith((history) => ({
          ...history,
          series: [],
          bands: [],
          summary: { ...history.summary, checks: 0, ranked_checks: 0, beyond_depth_checks: 0, failed_checks: 0 },
        })),
      );
      const { panel } = await renderPanel(keyword);
      expect(await within(panel).findByRole('heading', { name: 'No checks yet' })).toBeInTheDocument();
      expect(within(panel).getByText(reason)).toBeInTheDocument();
      expect(within(panel).queryByRole('img', { name: 'Rank history' })).toBeNull();
    },
  );

  it('reaches the controls in the order window, competitors, layers, views, and Space toggles a layer', async () => {
    const { panel, user } = await renderPanel();
    await chart(panel);
    within(panel).getByRole('combobox', { name: 'Window' }).focus();
    await user.tab();
    expect(within(panel).getByRole('button', { name: 'Competitors (5)' })).toHaveFocus();
    await user.tab();
    const absolute = within(panel).getByRole('button', { name: 'Absolute' });
    expect(absolute).toHaveFocus();
    await user.keyboard(' ');
    expect(absolute).toHaveAttribute('aria-pressed', 'true');
    await user.tab();
    expect(within(panel).getByRole('button', { name: 'Deep checks' })).toHaveFocus();
    await user.tab();
    expect(within(panel).getByRole('button', { name: 'Table' })).toHaveFocus();
  });

  it('counts only the drawn checks in the footnote, and says how many deep checks are not drawn', async () => {
    // Two ordinary checks (ranks as the world has them, depth 20) and every other check a deep one at rank 35
    server.use(
      answerHistoryWith((history) =>
        withOwnPoints(history, (point, index) =>
          index < 2 ? { ...point, state: 'ranked', rank: index === 0 ? 5 : 9, depth_requested: 20 } : deepRank(point),
        ),
      ),
    );
    const { panel, user } = await renderPanel();
    await chart(panel);
    expect(within(panel).getByText('Best 5, worst 9, median 7.0 over 2 of 2 checks')).toBeInTheDocument();
    expect(within(panel).getByText('28 deep checks are not drawn.')).toBeInTheDocument();
    // With deep checks on, they count, and the note goes
    await user.click(within(panel).getByRole('button', { name: 'Deep checks (28 hidden)' }));
    expect(
      within(panel).getByText(/^Best 5, worst 35, median 35.0, average .* over 30 of 30 checks$/),
    ).toBeInTheDocument();
    expect(within(panel).queryByText(/deep checks are not drawn/)).toBeNull();
  });

  it('gives no best, worst or median when every ranked check is a hidden deep check, only the note', async () => {
    server.use(answerHistoryWith((history) => withOwnPoints(history, deepRank)));
    const { panel } = await renderPanel();
    await chart(panel);
    expect(within(panel).getByText('30 deep checks are not drawn.')).toBeInTheDocument();
    expect(within(panel).queryByText(/^Best /)).toBeNull();
    expect(within(panel).queryByText(/^Not ranked in any/)).toBeNull();
  });

  it('says every check failed for a keyword whose checks all failed, and not that it never ranked', async () => {
    const { panel } = await renderPanel(DETAIL_KEYWORDS.failed);
    await chart(panel);
    expect(within(panel).getByText('Every check in this window failed.')).toBeInTheDocument();
    expect(within(panel).queryByText(/Not ranked in any/)).toBeNull();
    expect(within(panel).getByText(/, all failed/, { selector: 'p' })).toBeInTheDocument();
  });

  it('keeps the window select where the window holds no check, so a longer one can be chosen', async () => {
    server.use(
      answerHistoryWith((history) => ({
        ...history,
        series: [],
        bands: [],
        summary: { ...history.summary, checks: 0, ranked_checks: 0, beyond_depth_checks: 0, failed_checks: 0 },
      })),
    );
    const record = recordHistory();
    const { panel, user } = await renderPanel(DETAIL_KEYWORDS.archived, '?win=7d');
    expect(await within(panel).findByRole('heading', { name: 'No checks yet' })).toBeInTheDocument();
    const select = within(panel).getByRole('combobox', { name: 'Window' });
    expect(select).toHaveTextContent('Last 7 days');
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: 'Last 365 days' }));
    await waitFor(() => expect(record.urls.at(-1)?.searchParams.get('window')).toBe('last_365d'));
  });

  it('offers no window to a keyword that has not been checked yet', async () => {
    const { panel } = await renderPanel(DETAIL_KEYWORDS.pending);
    expect(await within(panel).findByRole('heading', { name: 'No checks yet' })).toBeInTheDocument();
    expect(within(panel).queryByRole('combobox', { name: 'Window' })).toBeNull();
  });

  it('turns a layer off again when its toggle is pressed twice', async () => {
    const writes: string[] = [];
    const { panel, user } = await renderPanel(DETAIL_KEYWORDS.ranked, '', (event) => writes.push(event.queryString));
    await chart(panel);
    const absolute = within(panel).getByRole('button', { name: 'Absolute' });
    await user.click(absolute);
    expect(absolute).toHaveAttribute('aria-pressed', 'true');
    expect(legend(panel)).toContain('Fynix (you) (absolute)');
    await user.click(absolute);
    expect(absolute).toHaveAttribute('aria-pressed', 'false');
    expect(legend(panel)).not.toContain('Fynix (you) (absolute)');
    await waitFor(() => expect(writes.at(-1)).toBe(''));
  });

  it('names the group of layer toggles and holds the two layers in it', async () => {
    const { panel } = await renderPanel();
    await chart(panel);
    const group = within(panel).getByRole('group', { name: 'Chart layers' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Absolute', 'Deep checks']);
  });

  it('does not say how many competitors it shows when it shows them all', async () => {
    const { panel } = await renderPanel();
    await chart(panel);
    expect(within(panel).queryByText(/^Showing /)).toBeNull();
  });

  it('shows the error of the competitors it could not read, with Try again, and no chart', async () => {
    let fail = true;
    server.use(http.get(mswPath(ENTITIES), ({ request }) => (fail ? problem(request, 'provider_paused') : undefined)));
    const { panel, user } = await renderPanel();
    expect(await within(panel).findByText('The rank history did not load.')).toBeInTheDocument();
    expect(within(panel).queryByRole('heading', { level: 2, name: 'Rank history' })).toBeNull();
    fail = false;
    await user.click(within(panel).getByRole('button', { name: 'Try again' }));
    expect(await chart(panel)).toBeInTheDocument();
  });

  it('keeps the card while the next window loads, with the canvas replaced by a loading state', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    server.use(
      http.get(mswPath(HISTORY), async ({ request }) => {
        if (new URL(request.url).searchParams.get('window') === 'last_30d') {
          held = true;
          await gate;
        }
        return undefined;
      }),
    );
    const { panel, user } = await renderPanel();
    await chart(panel);
    expect(within(panel).getByTestId('echart-canvas')).toBeInTheDocument();
    await user.click(within(panel).getByRole('combobox', { name: 'Window' }));
    await user.click(await screen.findByRole('option', { name: 'Last 30 days' }));
    await waitFor(() => expect(held).toBe(true));
    const card = (await chart(panel)).closest('section');
    expect(card).toHaveAttribute('aria-busy', 'true');
    expect(within(panel).queryByTestId('echart-canvas')).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Absolute' })).toBeInTheDocument();
    release();
    await waitFor(() => expect(within(panel).getByTestId('echart-canvas')).toBeInTheDocument());
    expect(card).not.toHaveAttribute('aria-busy');
  });

  it('keeps showing the chart when a later read fails, and says so above it', async () => {
    let fail = false;
    server.use(http.get(mswPath(HISTORY), ({ request }) => (fail ? problem(request, 'provider_paused') : undefined)));
    const { panel, queryClient } = await renderPanel();
    await chart(panel);
    fail = true;
    await queryClient.invalidateQueries();
    expect(await within(panel).findByText('The rank history did not load.')).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { level: 2, name: 'Rank history' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Table' })).toBeInTheDocument();
  });

  it('names the rank axis, ticks 50 and 100 on a deep axis, and labels at most one of many bands', async () => {
    server.use(
      answerHistoryWith((history) => {
        const own = (history.series ?? []).find((entry) => entry.entity.role === 'own');
        if (own === undefined) throw new Error('No own series');
        const bands: RankHistory['bands'] = own.points
          .filter((_, index) => index % 3 === 0)
          .map((point) => ({
            entity_id: own.entity.entity_id,
            from: point.date,
            to: point.date,
            depth_requested: 100,
            kind: 'beyond_depth',
            label: 'Not in top 100',
          }));
        return {
          ...withOwnPoints(history, (point, index) => (index === 4 ? deepRank({ ...point, rank: 85 }) : point)),
          bands,
        };
      }),
    );
    const { panel } = await renderPanel(DETAIL_KEYWORDS.ranked, '?show=deep');
    await chart(panel);
    await waitFor(() => expect(drawn.options.length).toBeGreaterThan(0));
    const option = lastOption();
    expect(option.yAxis.name).toBe('Rank (1 = best)');
    expect(option.yAxis.axisLabel.customValues).toEqual([1, 10, 20, 50, 100]);
    const corners = option.series[0]?.markArea?.data.map(([corner]) => corner) ?? [];
    expect(corners).toHaveLength(10);
    expect(corners.filter((corner) => corner.name !== undefined).length).toBeLessThanOrEqual(1);
  });

  it('draws a competitor once when the address names it twice', async () => {
    const rival = '0192d1a8-e001-7a10-8e01-000000000002';
    const { panel } = await renderPanel(DETAIL_KEYWORDS.ranked, `?comp=${rival},${rival}`);
    await chart(panel);
    expect(legend(panel)).toHaveLength(2);
    expect(within(panel).getByRole('button', { name: 'Competitors (1)' })).toBeInTheDocument();
  });

  it('gives each drawn competitor one colour, distinct from the others, in the legend and in the picker', async () => {
    const { panel, user } = await renderPanel();
    await chart(panel);
    const legendColours = within(within(panel).getByRole('list', { name: 'Series in Rank history' }))
      .getAllByRole('button')
      .slice(1)
      .map((button) => ({
        name: button.textContent ?? '',
        index: /--chart-(\d)/.exec(button.querySelector('span')?.getAttribute('style') ?? '')?.[1],
      }));
    expect(legendColours).toHaveLength(5);
    expect(new Set(legendColours.map((entry) => entry.index)).size).toBe(5);
    await user.click(within(panel).getByRole('button', { name: 'Competitors (5)' }));
    const list = await screen.findByRole('list', { name: 'Competitors on the chart' });
    const swatches = within(list)
      .getAllByRole('listitem')
      .map((row) => ({
        name: row.textContent ?? '',
        index: row.querySelector('[data-color-index]')?.getAttribute('data-color-index'),
      }));
    for (const entry of legendColours) {
      expect(swatches.find((row) => row.name.startsWith(entry.name))?.index).toBe(entry.index);
    }
  });

  it('keeps the chart and says so above it when the competitors cannot be read again', async () => {
    let fail = false;
    server.use(http.get(mswPath(ENTITIES), ({ request }) => (fail ? problem(request, 'provider_paused') : undefined)));
    const { panel, queryClient } = await renderPanel();
    await chart(panel);
    fail = true;
    await queryClient.invalidateQueries({ queryKey: ENTITIES_KEY });
    expect(await within(panel).findByText('The rank history did not load.')).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { level: 2, name: 'Rank history' })).toBeInTheDocument();
  });

  it('says "3 checks, all failed" in the meta line of a keyword whose checks all failed', async () => {
    const { panel } = await renderPanel(DETAIL_KEYWORDS.failed);
    await chart(panel);
    expect(within(panel).getByText(/^Last 90 days · 3 checks, all failed · deep check Monday$/)).toBeInTheDocument();
    expect(within(panel).queryByText(/0 checks/)).toBeNull();
  });
});
