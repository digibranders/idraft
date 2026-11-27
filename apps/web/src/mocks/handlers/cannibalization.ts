import { HttpResponse, type HttpHandler } from 'msw';

import { mock, problem } from '../respond';
import {
  cannCheck,
  cannConflicts,
  cannDetail,
  cannKeyword,
  cannPage,
  cannPairs,
  cannSwitchRow,
  cannSwitches,
} from '../cannibalization-fixture';
import type { CannKeyword, CannStripCell } from '@/lib/api/types';

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/cannibalization';
const BASE_DAYS = 30;
const END = Date.UTC(2026, 10, 26);
const DAY = 86_400_000;
const isoOf = (time: number): string => new Date(time).toISOString().slice(0, 10);

export interface MockScope {
  device: 'desktop' | 'mobile';
  days: 14 | 30 | 90;
  /** A keyword group id, or `null` for every group. */
  group: string | null;
}

/** Which page ranks on day `index` of the 30 day story, and at what rank: the illustrative history of each keyword. */
type Day = { page: 'a' | 'b'; rank: number; together?: boolean } | null;
const SCENARIOS: Record<string, (index: number) => Day> = {
  'best soc service provider': (i) => (Math.floor(i / 3) % 2 === 0 ? { page: 'a', rank: 4 } : { page: 'b', rank: 11 }),
  'soc providers': () => ({ page: 'a', rank: 6, together: true }),
  'managed detection': (i) => (Math.floor(i / 4) % 2 === 0 ? { page: 'a', rank: 8 } : { page: 'b', rank: 8 }),
  'soc vendors': (i) => (i < 15 ? { page: 'a', rank: 9 } : { page: 'b', rank: 7 }),
  'mdr pricing': (i) => (i < 24 ? null : { page: 'a', rank: 14 }),
};
const VERDICT: Record<string, CannKeyword['verdict']> = {
  'best soc service provider': 'likely',
  'soc providers': 'co_ranking',
  'managed detection': 'unstable',
  'soc vendors': 'none',
  'mdr pricing': 'insufficient',
};
/** On a phone the story differs: another keyword is the likely case, and every rank sits a few places lower. */
const MOBILE_VERDICT: Record<string, CannKeyword['verdict']> = {
  ...VERDICT,
  'best soc service provider': 'unstable',
  'soc vendors': 'likely',
  'mdr pricing': 'none',
};
const MOBILE_RANK_OFFSET = 3;

export const mockPeriod = (days: number): { from: string; to: string } => ({
  from: isoOf(END - (days - 1) * DAY),
  to: isoOf(END),
});

/** Stretches the 30 day story over any period: day `index` of `days` reads the story at the same point of its course. */
const storyIndex = (index: number, days: number): number =>
  Math.min(BASE_DAYS - 1, Math.floor((index * BASE_DAYS) / days));

const stripOf = (day: (index: number) => Day, scope: MockScope): CannStripCell[] =>
  Array.from({ length: scope.days }, (_, i) => {
    const date = isoOf(END - (scope.days - 1 - i) * DAY);
    const d = day(storyIndex(i, scope.days));
    const rank = d === null ? null : d.rank + (scope.device === 'mobile' ? MOBILE_RANK_OFFSET : 0);
    return d === null
      ? { date, kind: 'none', url_id: null, rank: null, together: false }
      : { date, kind: 'page', url_id: d.page, rank, together: d.together === true };
  });

/** The illustrative keywords for a scope. A group keeps some of them, so choosing a group changes what the page shows. */
export function mockKeywordRows(scope: MockScope): CannKeyword[] {
  const verdicts = scope.device === 'mobile' ? MOBILE_VERDICT : VERDICT;
  const seed = scope.group === null ? 0 : [...scope.group].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Object.entries(SCENARIOS)
    .map(([text, day], index) => ({ text, day, index }))
    .filter(({ index }) => scope.group === null || (index + seed) % 2 === 0)
    .map(({ text, day, index }) => {
      const verdict = verdicts[text] ?? 'none';
      const strip = stripOf(day, scope);
      const switches = strip.flatMap((cell, i) => {
        const before = strip[i - 1];
        if (i === 0 || before?.url_id == null || cell.url_id == null || before.url_id === cell.url_id) return [];
        return [
          {
            date: cell.date,
            from_url_id: before.url_id,
            to_url_id: cell.url_id,
            rank_before: before.rank ?? 0,
            rank_after: cell.rank ?? 0,
            held_days: 3,
            is_flip_flop: false,
          },
        ];
      });
      const checks = verdict === 'insufficient' ? 6 : scope.days;
      // Every other keyword has a target page (A), so the target marks and the target column have something to show
      const target = index % 2 === 0 ? 'a' : null;
      const current = strip[scope.days - 1]?.url_id ?? 'a';
      return cannKeyword(text, verdict, {
        // An inspector address holds no spaces, as the real ids (UUIDs) hold none
        tracked_keyword_id: text.replaceAll(' ', '-'),
        device: scope.device,
        volume: (scope.device === 'mobile' ? 1400 : 1900) - index * 300,
        checks,
        ranked_checks: checks,
        pages: [
          cannPage('a', 'A', 28, {
            path: '/services/soc',
            url: 'https://eventus.example/services/soc',
            title: 'SOC as a service',
            is_target: target === 'a',
          }),
          cannPage('b', 'B', verdict === 'none' ? 15 : 14, {
            path: '/blog/soc-guide',
            url: 'https://eventus.example/blog/soc-guide',
            title: 'SOC guide for buyers',
            is_target: false,
          }),
        ],
        rank_gap: verdict === 'likely' ? 7 : 0,
        together_rate: verdict === 'co_ranking' ? 1 : 0,
        switch_rate: switches.length / scope.days,
        switches,
        flip_flops: 0,
        current_url_id: current,
        target_url_id: target,
        on_target: target === null ? null : current === target,
        current_rank: strip[scope.days - 1]?.rank ?? 6,
        strip,
      });
    });
}

const scopeOf = (request: Request): MockScope => {
  const query = new URL(request.url).searchParams;
  const days = Number(query.get('days'));
  return {
    device: query.get('device') === 'mobile' ? 'mobile' : 'desktop',
    days: days === 14 || days === 90 ? days : 30,
    group: query.get('group_id'),
  };
};

/** An answer's meta for the scope asked: its period and device, the page's own. */
const metaOf = (scope: MockScope, total: number) => {
  const { from, to } = mockPeriod(scope.days);
  return { days: scope.days, device: scope.device, date_from: from, date_to: to, total };
};

/** Illustrative answers for the Cannibalization routes in the mocked app (the real routes are in the API). */
export const cannibalizationHandlers: HttpHandler[] = [
  mock('get', P, ({ request }) => {
    const scope = scopeOf(request);
    const verdict = new URL(request.url).searchParams.get('verdict') ?? 'conflicts';
    const all = mockKeywordRows(scope);
    const items = all.filter((row) =>
      verdict === 'all'
        ? true
        : verdict === 'conflicts'
          ? ['likely', 'co_ranking', 'unstable'].includes(row.verdict)
          : row.verdict === verdict,
    );
    const body = cannConflicts(all);
    return HttpResponse.json({ data: { ...body, items, meta: { ...body.meta, ...metaOf(scope, items.length) } } });
  }),
  mock('get', `${P}/pairs`, ({ request }) => {
    const scope = scopeOf(request);
    const body = cannPairs();
    return HttpResponse.json({ data: { ...body, meta: { ...body.meta, ...metaOf(scope, body.items.length) } } });
  }),
  mock('get', `${P}/switches`, ({ request }) => {
    const scope = scopeOf(request);
    const body = cannSwitches(
      mockKeywordRows(scope).flatMap((row) =>
        row.switches.map((event) =>
          cannSwitchRow(row.keyword, {
            tracked_keyword_id: row.tracked_keyword_id,
            event,
            left_target: row.target_url_id === event.from_url_id,
            rank_change: event.rank_before - event.rank_after,
            volume: row.volume,
          }),
        ),
      ),
    );
    return HttpResponse.json({ data: { ...body, meta: { ...body.meta, ...metaOf(scope, body.items.length) } } });
  }),
  mock('get', `${P}/keywords/{tracked_keyword_id}`, ({ request, params }) => {
    const scope = scopeOf(request);
    const row = mockKeywordRows({ ...scope, group: null }).find(
      (entry) => entry.tracked_keyword_id === params.tracked_keyword_id,
    );
    if (row === undefined) return problem(request, 'not_found');
    const checks = row.strip.map((cell) =>
      cell.url_id === null ? cannCheck(cell.date, {}) : cannCheck(cell.date, { [cell.url_id]: cell.rank ?? 0 }),
    );
    const detail = cannDetail(row, checks);
    return HttpResponse.json({ data: { ...detail, meta: { ...detail.meta, ...metaOf(scope, 1) } } });
  }),
];
