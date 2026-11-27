import { describe, expect, it } from 'vitest';

import {
  causesOf,
  evidenceSentence,
  groupNames,
  internalLinksQuery,
  pageRefs,
  rankLines,
  switchList,
  targetChoices,
  timelineLanes,
  titleOverlap,
} from './cann-evidence';
import type { CannKeyword } from '@/lib/api/types';
import { cannCheck, cannDetail, cannKeyword, cannPage } from '@/mocks/cannibalization-fixture';

const guide = cannPage('a', 'A', 12, { title: 'Guide to endpoint security tools', path: '/blog/endpoint-guide' });
const compared = cannPage('b', 'B', 9, { title: 'Endpoint security tools compared', path: '/blog/endpoint-compared' });
const pages = [guide, compared, cannPage('c', 'C', 1, { path: '/pricing' })];
const switchEvent = (date: string, from: string, to: string, flip = false) => ({
  date,
  from_url_id: from,
  to_url_id: to,
  rank_before: 4,
  rank_after: 9,
  held_days: 5,
  is_flip_flop: flip,
});
const keyword = (verdict: CannKeyword['verdict'], extra: Partial<CannKeyword> = {}): CannKeyword =>
  cannKeyword('endpoint security', verdict, { pages, ...extra });
const strip = (...ids: (string | null)[]) =>
  ids.map((id, index) => ({
    date: `2026-11-0${String(index + 1)}`,
    kind: id === null ? ('none' as const) : ('page' as const),
    url_id: id,
    rank: id === null ? null : 3,
    together: false,
  }));

describe('evidenceSentence', () => {
  it('says only what was seen for each verdict', () => {
    const likely = keyword('likely', {
      rank_gap: 6.4,
      switches: [switchEvent('2026-11-03', 'a', 'b'), switchEvent('2026-11-09', 'b', 'a')],
    });
    expect(evidenceSentence(cannDetail(likely), 30)).toEqual({
      key: 'likely',
      values: { a: '/blog/endpoint-guide', b: '/blog/endpoint-compared', count: 2, gap: 6 },
    });
    const together = keyword('co_ranking', { together_rate: 0.6 });
    expect(evidenceSentence(cannDetail(together), 30)).toEqual({
      key: 'coRanking',
      values: { a: '/blog/endpoint-guide', aMedian: 4, b: '/blog/endpoint-compared', bMedian: 4, share: '60%' },
    });
    expect(
      evidenceSentence(cannDetail(keyword('unstable', { switches: [switchEvent('2026-11-03', 'a', 'b')] })), 30),
    ).toEqual({
      key: 'unstable',
      values: { count: 1 },
    });
  });

  it('names the steady page, or the changes that are not enough to call a conflict', () => {
    expect(evidenceSentence(cannDetail(keyword('none')), 30)).toEqual({
      key: 'noneSteady',
      values: { page: '/blog/endpoint-guide' },
    });
    const moved = keyword('none', { switches: [switchEvent('2026-11-03', 'a', 'b')], current_url_id: 'b' });
    expect(evidenceSentence(cannDetail(moved), 30)).toEqual({
      key: 'noneChanged',
      values: { page: '/blog/endpoint-compared', count: 1 },
    });
  });

  it('explains the two states with nothing to judge', () => {
    expect(evidenceSentence(cannDetail(keyword('unranked')), 14)).toEqual({ key: 'unranked', values: { days: 14 } });
    expect(evidenceSentence(cannDetail(keyword('insufficient', { ranked_checks: 4 })), 30)).toEqual({
      key: 'insufficient',
      values: { count: 4, min: 10 },
    });
  });
});

describe('causesOf', () => {
  it('offers hypotheses only from what is known', () => {
    const likely = keyword('likely', { on_target: false, target_url_id: 'c', current_url_id: 'a' });
    const keys = causesOf(cannDetail(likely)).map((cause) => cause.key);
    expect(keys).toEqual(['titleOverlap', 'sameSection', 'offTarget', 'internalLinks']);
  });

  it('leaves out the title cause when a title is unknown, and the target cause when on target', () => {
    const noTitle = [{ ...guide, title: null }, compared];
    const detail = cannDetail(keyword('likely', { pages: noTitle, on_target: true }));
    expect(causesOf(detail).map((cause) => cause.key)).toEqual(['sameSection', 'internalLinks']);
  });

  it('names pages of different sections, and says a second page in the top 20 can be fine for co-ranking', () => {
    const mixed = [guide, { ...compared, path: '/services/endpoint', title: 'Managed detection' }];
    const detail = cannDetail(keyword('co_ranking', { pages: mixed }));
    expect(causesOf(detail).map((cause) => cause.key)).toEqual(['differentSections', 'coRanking', 'internalLinks']);
  });

  it('has only the links cause for a keyword with one page', () => {
    const one = keyword('none', { pages: [guide] });
    expect(causesOf(cannDetail(one)).map((cause) => cause.key)).toEqual(['internalLinks']);
  });
});

describe('titleOverlap', () => {
  it('is the share of words two titles have in common', () => {
    expect(titleOverlap('Endpoint security tools', 'Endpoint security tools')).toBe(1);
    expect(titleOverlap('Endpoint security tools', 'Pricing plans')).toBe(0);
    expect(titleOverlap('Guide to endpoint security', 'Endpoint security compared')).toBeCloseTo(0.5);
  });
});

describe('pageRefs', () => {
  it('keeps the API order and gives each letter its chart token', () => {
    const refs = pageRefs(cannDetail(keyword('likely')));
    expect(refs.map((ref) => [ref.letter, ref.token])).toEqual([
      ['A', 'chart-1'],
      ['B', 'chart-2'],
      ['C', 'chart-3'],
    ]);
  });

  it('adds a page named only by a check, with the plus letter', () => {
    const detail = cannDetail(keyword('likely'));
    detail.urls.push({ url_id: 'z', url: 'https://example.com/z', path: '/z', title: null });
    const extra = pageRefs(detail).at(-1);
    expect(extra).toMatchObject({ id: 'z', letter: '+', token: 'chart-other', ranked: 0 });
  });
});

describe('rankLines', () => {
  const checks = [
    cannCheck('2026-11-01', { a: 3, b: 12 }),
    cannCheck('2026-11-02', { a: 3 }, { readable: false }),
    cannCheck('2026-11-03', { b: 5 }),
  ];

  it('has one line per page that ranked on enough checks, with a gap where it did not rank', () => {
    const detail = cannDetail(keyword('likely'), checks);
    const { dates, lines } = rankLines(detail, pageRefs(detail));
    expect(dates).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(lines.map((line) => line.page.letter)).toEqual(['A', 'B']);
    expect(lines[0]?.values).toEqual([3, null, null]);
    expect(lines[1]?.values).toEqual([12, null, 5]);
  });
});

describe('timelineLanes', () => {
  it('marks the ranking page, the page beside it, no rank and an unreadable check', () => {
    const checks = [
      cannCheck('2026-11-01', { a: 3, b: 8 }),
      cannCheck('2026-11-02', { a: 3 }),
      cannCheck('2026-11-03', {}, { readable: false }),
    ];
    const detail = cannDetail(keyword('likely', { strip: strip('a', 'a', null) }), checks);
    const lanes = timelineLanes(detail, pageRefs(detail));
    expect(lanes.map((lane) => lane.page.letter)).toEqual(['A', 'B', 'C']);
    expect(lanes[0]?.cells.map((cell) => cell.kind)).toEqual(['ranking', 'ranking', 'unreadable']);
    expect(lanes[1]?.cells.map((cell) => cell.kind)).toEqual(['beside', 'none', 'unreadable']);
    expect(lanes[0]?.rankingChecks).toBe(2);
  });
});

describe('switchList', () => {
  it('lists the confirmed switches newest first with the pages by letter', () => {
    const likely = keyword('likely', {
      switches: [switchEvent('2026-11-03', 'a', 'b'), switchEvent('2026-11-09', 'b', 'a', true)],
    });
    const detail = cannDetail(likely);
    const list = switchList(detail, pageRefs(detail));
    expect(list.map((item) => [item.date, item.from.letter, item.to.letter, item.flipFlop])).toEqual([
      ['2026-11-09', 'B', 'A', true],
      ['2026-11-03', 'A', 'B', false],
    ]);
  });

  it('skips a switch that names a page the answer does not carry', () => {
    const odd = keyword('likely', { switches: [switchEvent('2026-11-03', 'a', 'gone')] });
    const detail = cannDetail(odd);
    expect(switchList(detail, pageRefs(detail))).toEqual([]);
  });
});

describe('targetChoices', () => {
  it("lists the keyword's own pages and leaves out a page only a check names", () => {
    const detail = cannDetail(keyword('likely', { target_url_id: 'b' }));
    detail.urls.push({ url_id: 'z', url: 'https://x.example/z', path: '/z', title: null });
    expect(targetChoices(detail).map((page) => [page.id, page.isTarget])).toEqual([
      ['a', false],
      ['b', false],
      ['c', false],
    ]);
  });
  it('marks the page that is the target', () => {
    const marked = [{ ...guide, is_target: true }, compared];
    const detail = cannDetail(keyword('likely', { pages: marked, target_url_id: 'a' }));
    expect(targetChoices(detail).map((page) => page.isTarget)).toEqual([true, false]);
  });
});

describe('internalLinksQuery', () => {
  const detail = (a: string, b: string) =>
    cannDetail(
      keyword('likely', {
        pages: [cannPage(a, 'A', 12, { path: '/a' }), cannPage(b, 'B', 9, { path: '/b' })],
      }),
    );
  it('points the Links tab at the pair, the page to compare with first', () => {
    expect(internalLinksQuery(detail('101', '202'))).toBe('tab=links&src=101&tgt=202');
  });
  it('is empty when an id is not a url id, and null when there is no second page', () => {
    expect(internalLinksQuery(detail('a', 'b'))).toBe('');
    expect(internalLinksQuery(cannDetail(keyword('none', { pages: [guide] })))).toBeNull();
  });
});

describe('groupNames', () => {
  it("names the groups in the keyword's order and skips an id that has no group", () => {
    const groups = [
      { id: 'g1', name: 'Services / Audits' },
      { id: 'g2', name: 'Blog' },
    ];
    expect(groupNames(['g2', 'gone', 'g1'], groups)).toEqual(['Blog', 'Services / Audits']);
    expect(groupNames([], groups)).toEqual([]);
  });
});

describe('causesOf sections', () => {
  it('says different sections when the first folders differ', () => {
    const detail = cannDetail(
      keyword('likely', {
        pages: [cannPage('a', 'A', 12, { path: '/services/soc' }), cannPage('b', 'B', 9, { path: '/blog/guide' })],
      }),
    );
    expect(causesOf(detail).find((cause) => cause.key === 'differentSections')?.values).toEqual({
      a: '/services/',
      b: '/blog/',
    });
  });
});
