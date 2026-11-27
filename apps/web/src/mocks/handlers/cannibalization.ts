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
const DAYS = 30;
const END = Date.UTC(2026, 10, 26);
const dateOf = (index: number): string => new Date(END - (DAYS - 1 - index) * 86_400_000).toISOString().slice(0, 10);

/** Which page ranks on day `index`, and at what rank: the illustrative history behind each mock keyword. */
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

const stripOf = (day: (index: number) => Day): CannStripCell[] =>
  Array.from({ length: DAYS }, (_, i) => {
    const d = day(i);
    return d === null
      ? { date: dateOf(i), kind: 'none', url_id: null, rank: null, together: false }
      : { date: dateOf(i), kind: 'page', url_id: d.page, rank: d.rank, together: d.together === true };
  });

const rows = (): CannKeyword[] =>
  Object.entries(SCENARIOS).map(([text, day], index) => {
    const verdict = VERDICT[text] ?? 'none';
    const strip = stripOf(day);
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
    return cannKeyword(text, verdict, {
      // An inspector address holds no spaces, as the real ids (UUIDs) hold none
      tracked_keyword_id: text.replaceAll(' ', '-'),
      volume: 1900 - index * 300,
      checks: verdict === 'insufficient' ? 6 : DAYS,
      ranked_checks: verdict === 'insufficient' ? 6 : DAYS,
      pages: [
        cannPage('a', 'A', 28, {
          path: '/services/soc',
          url: 'https://eventus.example/services/soc',
          title: 'SOC as a service',
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
      switch_rate: switches.length / DAYS,
      switches,
      flip_flops: 0,
      current_url_id: strip[DAYS - 1]?.url_id ?? 'a',
      current_rank: strip[DAYS - 1]?.rank ?? 6,
      strip,
    });
  });

/** Illustrative answers for the Cannibalization routes in the mocked app (the real routes are in the API). */
export const cannibalizationHandlers: HttpHandler[] = [
  mock('get', P, ({ request }) => {
    const verdict = new URL(request.url).searchParams.get('verdict') ?? 'conflicts';
    const all = rows();
    const items = all.filter((row) =>
      verdict === 'all'
        ? true
        : verdict === 'conflicts'
          ? ['likely', 'co_ranking', 'unstable'].includes(row.verdict)
          : row.verdict === verdict,
    );
    const body = cannConflicts(all);
    return HttpResponse.json({ data: { ...body, items, meta: { ...body.meta, total: items.length } } });
  }),
  mock('get', `${P}/pairs`, () => HttpResponse.json({ data: cannPairs() })),
  mock('get', `${P}/switches`, () =>
    HttpResponse.json({
      data: cannSwitches(
        rows().flatMap((row) =>
          row.switches.map((event) =>
            cannSwitchRow(row.keyword, {
              event,
              rank_change: event.rank_before - event.rank_after,
              volume: row.volume,
            }),
          ),
        ),
      ),
    }),
  ),
  mock('get', `${P}/keywords/{tracked_keyword_id}`, ({ request, params }) => {
    const row = rows().find((entry) => entry.tracked_keyword_id === params.tracked_keyword_id);
    if (row === undefined) return problem(request, 'not_found');
    const checks = row.strip.map((cell) =>
      cell.url_id === null ? cannCheck(cell.date, {}) : cannCheck(cell.date, { [cell.url_id]: cell.rank ?? 0 }),
    );
    return HttpResponse.json({ data: cannDetail(row, checks) });
  }),
];
