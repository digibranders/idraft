import type {
  CannConflictList,
  CannKeyword,
  CannMeta,
  CannPage,
  CannPairList,
  CannSwitchList,
  CannSwitchRow,
} from '@/lib/api/types';

/** Builders of the Cannibalization API's answers for tests: each takes only what the test is about. */

export const cannPage = (url_id: string, letter: string, ranked = 10, extra: Partial<CannPage> = {}): CannPage => ({
  url_id,
  url: `https://example.com/${url_id}`,
  path: `/${url_id}`,
  title: null,
  letter,
  is_primary: letter === 'A',
  is_target: false,
  is_sub_result: false,
  ranked,
  share: 0.5,
  best_count: 5,
  median: 4,
  best_ever: 2,
  last_date: '2026-11-26',
  last_rank: 4,
  ...extra,
});

export const cannKeyword = (
  text: string,
  verdict: CannKeyword['verdict'],
  extra: Partial<CannKeyword> = {},
): CannKeyword => ({
  tracked_keyword_id: text,
  keyword: text,
  group_ids: [],
  device: 'desktop',
  volume: 100,
  verdict,
  previous_verdict: null,
  checks: 30,
  unreadable_checks: 0,
  ranked_checks: 30,
  pages: [cannPage('a', 'A'), cannPage('b', 'B', 2)],
  rank_gap: 0,
  switch_rate: 0,
  together_rate: 0,
  switches: [],
  one_check_changes: 0,
  flip_flops: 0,
  longest_hold_days: 0,
  held_now_days: 0,
  current_url_id: 'a',
  current_rank: 3,
  target_url_id: null,
  on_target: null,
  strip: [],
  ...extra,
});

export const cannMeta = (days: 14 | 30 | 90 = 30, extra: Partial<CannMeta> = {}): CannMeta => ({
  days,
  device: 'desktop',
  method_version: 2,
  min_checks: 10,
  date_from: '2026-10-28',
  date_to: '2026-11-26',
  has_previous: true,
  total: 0,
  ...extra,
});

export const cannConflicts = (items: readonly CannKeyword[]): CannConflictList => {
  const count = (verdict: CannKeyword['verdict']): number => items.filter((row) => row.verdict === verdict).length;
  const conflicts = count('likely') + count('co_ranking') + count('unstable');
  return {
    meta: cannMeta(30, { total: items.length }),
    headline: {
      ranked_keywords: items.filter((row) => row.verdict !== 'unranked' && row.verdict !== 'insufficient').length,
      conflicts: { value: conflicts, before: conflicts + 2 },
      likely: { value: count('likely'), before: count('likely') },
      together: { value: count('co_ranking'), before: null },
      unstable: { value: count('unstable'), before: count('unstable') },
      volume_at_risk: items.filter((row) => row.verdict === 'likely').reduce((sum, row) => sum + (row.volume ?? 0), 0),
      volume_keywords: count('likely'),
      typical_rank_gap: count('likely') > 0 ? 6 : null,
    },
    counts: {
      all: items.length,
      conflicts,
      likely: count('likely'),
      co_ranking: count('co_ranking'),
      unstable: count('unstable'),
      none: count('none'),
      unranked: count('unranked'),
      insufficient: count('insufficient'),
    },
    items: [...items],
  };
};

export const cannSwitchRow = (keyword: string, extra: Partial<CannSwitchRow> = {}): CannSwitchRow => ({
  tracked_keyword_id: keyword,
  keyword,
  volume: 100,
  event: {
    date: '2026-11-10',
    from_url_id: 'a',
    to_url_id: 'b',
    rank_before: 5,
    rank_after: 4,
    held_days: 6,
    is_flip_flop: false,
  },
  rank_change: 1,
  left_target: false,
  from_title: null,
  to_title: null,
  from_url: 'https://example.com/a',
  to_url: 'https://example.com/b',
  ...extra,
});

export const cannSwitches = (items: readonly CannSwitchRow[]): CannSwitchList => ({
  meta: cannMeta(30, { total: items.length }),
  headline: {
    ranked_keywords: items.length,
    switches: { value: items.length, before: null },
    keywords: new Set(items.map((row) => row.tracked_keyword_id)).size,
    flip_flop_keywords: items.filter((row) => row.event.is_flip_flop).length,
    left_target: items.filter((row) => row.left_target).length,
    improved: items.filter((row) => row.rank_change > 0).length,
    dropped: items.filter((row) => row.rank_change < 0).length,
    one_check_changes: 0,
  },
  weeks: [
    { starts_on: '2026-11-02', improved: 1, same: 0, dropped: 0 },
    { starts_on: '2026-11-09', improved: 0, same: 1, dropped: 2 },
  ],
  items: [...items],
});

export const cannPairs = (): CannPairList => ({
  meta: cannMeta(),
  items: [
    {
      a: { url_id: 'a', url: 'https://example.com/a', path: '/a', title: 'Page a' },
      b: { url_id: 'b', url: 'https://example.com/b', path: '/b', title: null },
      keywords: 3,
      likely: 1,
      volume: 900,
      a_leads: 2,
      b_leads: 1,
      title_overlap: 0.4,
      tracked_keyword_ids: ['alpha', 'beta', 'gamma'],
    },
  ],
});
