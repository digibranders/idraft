import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { GAP_SORT_DEFAULT, lostTip, markLines, markTone, sortGapRows, visibleGapRows } from './gap-model';
import messages from '../../../../messages/en.json';
import type { CitationGapRow } from '@/lib/citations/board-queries';

const t = createTranslator({ locale: 'en', messages, namespace: 'citations' });
type Brand = CitationGapRow['you'];
const brand = (cells: readonly [number, number, number][]): Brand => {
  const codes = ['chatgpt_web', 'gemini_web'] as const;
  const engines = cells.map(([answers, cited, mentioned], index) => ({
    engine_code: codes[index] ?? 'chatgpt_web',
    answers,
    cited,
    mentioned,
    state:
      answers === 0
        ? ('none' as const)
        : cited > 0
          ? ('cited' as const)
          : mentioned > 0
            ? ('mentioned' as const)
            : ('not' as const),
  }));
  const total = engines.reduce(
    (sum, cell) => ({
      answers: sum.answers + cell.answers,
      cited: sum.cited + cell.cited,
      mentioned: sum.mentioned + cell.mentioned,
    }),
    { answers: 0, cited: 0, mentioned: 0 },
  );
  return {
    engines,
    total: {
      ...total,
      state: total.answers === 0 ? 'none' : total.cited > 0 ? 'cited' : total.mentioned > 0 ? 'mentioned' : 'not',
    },
    platforms: engines.filter((cell) => cell.answers > 0).length,
    cited_on: engines.filter((cell) => cell.cited > 0).length,
  };
};
const row = (
  text: string,
  topic: string | null,
  gap: number,
  you: Brand,
  extra: Partial<CitationGapRow> = {},
): CitationGapRow => ({
  prompt_id: text,
  text,
  topic: topic === null ? null : { term_id: topic, name: topic },
  you,
  competitors: [{ ...brand([[4, 2, 2]]), entity_id: 'c1' }],
  gap,
  lost_on: gap > 0 ? ['chatgpt_web'] : [],
  lost_to: gap > 0 ? ['c1'] : [],
  competitor_answers: 2,
  ...extra,
});
const ROWS = [
  row(
    'Best CRM?',
    'Pricing',
    1,
    brand([
      [4, 0, 1],
      [3, 1, 1],
    ]),
  ),
  row('CRM for startups', null, 0, brand([[4, 2, 2]])),
  row(
    'Cheap CRM',
    'Pricing',
    2,
    brand([
      [4, 0, 0],
      [2, 0, 0],
    ]),
    { lost_to: ['c1', 'c2'] },
  ),
];

describe('the gap analysis rows', () => {
  it('keeps only gaps by default and searches prompts and groups (C 612)', () => {
    expect(visibleGapRows(ROWS, { gapsOnly: true, search: '' }).map((r) => r.text)).toEqual(['Best CRM?', 'Cheap CRM']);
    expect(visibleGapRows(ROWS, { gapsOnly: false, search: 'PRICING' })).toHaveLength(2);
    expect(visibleGapRows(ROWS, { gapsOnly: false, search: 'startups' })).toHaveLength(1);
  });

  it('sorts Lost on by gap, then lost to, then competitor answers, ties by text (C 615)', () => {
    expect(GAP_SORT_DEFAULT).toEqual({ key: 'gap', dir: 'desc' });
    expect(sortGapRows(ROWS, GAP_SORT_DEFAULT).map((r) => r.text)).toEqual([
      'Cheap CRM',
      'Best CRM?',
      'CRM for startups',
    ]);
  });

  it('compares each field in turn, whatever its size: a thousand answers do not outrank a second competitor', () => {
    const base = ROWS[0];
    if (base === undefined) throw new Error('No row');
    const many = {
      ...base,
      prompt_id: 'many',
      text: 'Many answers',
      gap: 1,
      lost_to: ['c1'],
      competitor_answers: 1500,
    };
    const wide = {
      ...base,
      prompt_id: 'wide',
      text: 'Wide loss',
      gap: 1,
      lost_to: ['c1', 'c2'],
      competitor_answers: 2,
    };
    expect(sortGapRows([many, wide], GAP_SORT_DEFAULT).map((r) => r.text)).toEqual(['Wide loss', 'Many answers']);
    const loud = { ...many, you: brand([[2000, 1500, 0]]) };
    const cited = {
      ...many,
      text: 'Cited on two',
      you: brand([
        [4, 1, 0],
        [3, 1, 0],
      ]),
    };
    expect(sortGapRows([loud, cited], { key: 'you', dir: 'desc' }).map((r) => r.text)).toEqual([
      'Cited on two',
      'Many answers',
    ]);
  });

  it('sorts you by state, then engines cited on, then citing answers', () => {
    expect(sortGapRows(ROWS, { key: 'you', dir: 'desc' }).map((r) => r.text)).toEqual([
      'CRM for startups',
      'Best CRM?',
      'Cheap CRM',
    ]);
  });

  it('sorts a competitor by its citing answers', () => {
    const first = ROWS[0];
    const second = ROWS[1];
    if (first === undefined || second === undefined) throw new Error('No row');
    const more = { ...second, competitors: [{ ...brand([[4, 3, 3]]), entity_id: 'c1' }] };
    expect(sortGapRows([first, more], { key: 'c:c1', dir: 'desc' }).map((r) => r.text)).toEqual([
      'CRM for startups',
      'Best CRM?',
    ]);
  });

  it('sorts a group by name and keeps No group last both ways (D-10)', () => {
    expect(
      sortGapRows(ROWS, { key: 'topic', dir: 'asc' })
        .map((r) => r.text)
        .at(-1),
    ).toBe('CRM for startups');
    expect(
      sortGapRows(ROWS, { key: 'topic', dir: 'desc' })
        .map((r) => r.text)
        .at(-1),
    ).toBe('CRM for startups');
  });

  it('writes the mark tooltip one sentence per engine (C 582 to 587)', () => {
    const labelOf = (code: string): string => (code === 'chatgpt_web' ? 'ChatGPT' : 'Gemini');
    expect(
      markLines(
        brand([
          [4, 0, 1],
          [3, 1, 1],
        ]),
        labelOf,
        t,
      ),
    ).toBe('ChatGPT: mentioned in 1 of 4 answers, never cited. Gemini: cited in 1 of 3 answers');
    expect(
      markLines(
        brand([
          [0, 0, 0],
          [1, 0, 0],
        ]),
        labelOf,
        t,
      ),
    ).toBe('ChatGPT: no answers. Gemini: not cited in 1 answer');
  });

  it('tones only your mark (C 596 to 598)', () => {
    expect(markTone('cited', { own: true, lost: false })).toBe('text-positive-text');
    expect(markTone('cited', { own: true, lost: true })).toBe('text-warning-text');
    expect(markTone('not', { own: true, lost: true })).toBe('text-negative-text');
    expect(markTone('mentioned', { own: true, lost: false })).toBe('text-foreground-tertiary');
    expect(markTone('cited', { own: false, lost: false })).toBe('text-foreground');
    expect(markTone('not', { own: false, lost: false })).toBe('text-foreground-tertiary');
  });

  it('says where and to whom a prompt is lost (C 661)', () => {
    const third = ROWS[2];
    if (third === undefined) throw new Error('No row');
    expect(
      lostTip(
        third,
        () => 'ChatGPT',
        (id) => (id === 'c1' ? 'HubSpot' : 'Pipedrive'),
        t,
      ),
    ).toBe('Lost on ChatGPT to HubSpot, Pipedrive');
  });
});
