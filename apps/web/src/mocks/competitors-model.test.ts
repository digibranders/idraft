import { describe, expect, it } from 'vitest';

import {
  entityConfigOf,
  lostPromptsOf,
  MIN_ANSWERS,
  pointOf,
  topCompetitorId,
  topSourcesOf,
  type LostInput,
} from './competitors-model';
import type { CitedAnswer } from './handlers/citations-model';
import type { CitationOut, Schemas } from '@/lib/api/types';

const OWN = '00000000-0000-4000-8000-0000000000a1';
const ACME = '00000000-0000-4000-8000-0000000000b1';
const BOLT = '00000000-0000-4000-8000-0000000000b2';

const PROMPTS: LostInput['prompts'] = new Map([
  ['p1', { text: 'best crm', importance: 5 }],
  ['p2', { text: 'cheap crm', importance: 3 }],
  ['p3', { text: 'alpha crm', importance: 3 }],
  ['p4', { text: 'crm for agencies', importance: 1 }],
]);

let counter = 0;
function answer(
  promptId: string,
  named: readonly string[],
  valid = true,
  citations: readonly CitationOut[] = [],
): CitedAnswer {
  counter += 1;
  return { id: String(counter), at: counter, promptId, engine: 'chatgpt_web', valid, citations, named };
}
const times = (count: number, make: () => CitedAnswer): CitedAnswer[] => Array.from({ length: count }, make);

function citation(host: string, entity: string | null, url = `https://${host}/a`): CitationOut {
  return {
    answer_block_index: null,
    citation_index: 1,
    citation_kind: 'web',
    domain_role: entity === null ? 'third_party' : 'competitor',
    first_char_offset: null,
    flags: [],
    host,
    occurrences: 1,
    raw_url: url,
    referral_tag: null,
    role_entity_id: entity,
    source_name: null,
    title: null,
    url,
  };
}

const lostInput = (answers: readonly CitedAnswer[], limit = 10): LostInput => ({
  answers,
  prompts: PROMPTS,
  ownIds: new Set([OWN]),
  limit,
});

describe('topCompetitorId', () => {
  it('is the most share of voice, then the most mentions, then the name case-folded, then the id', () => {
    const base = { sov: 3, mention: 2 };
    expect(
      topCompetitorId([
        { entity_id: ACME, name: 'Acme', ...base },
        { entity_id: BOLT, name: 'Bolt', sov: 4, mention: 1 },
      ]),
    ).toBe(BOLT);
    expect(
      topCompetitorId([
        { entity_id: ACME, name: 'Acme', sov: 3, mention: 2 },
        { entity_id: BOLT, name: 'Bolt', sov: 3, mention: 5 },
      ]),
    ).toBe(BOLT);
    expect(
      topCompetitorId([
        { entity_id: BOLT, name: 'acme', ...base },
        { entity_id: ACME, name: 'Acme', ...base },
      ]),
    ).toBe(ACME);
  });

  it('compares share of voice at 9 decimals', () => {
    expect(
      topCompetitorId([
        { entity_id: ACME, name: 'Acme', sov: 1 / 3, mention: 1 },
        { entity_id: BOLT, name: 'Bolt', sov: 0.333333333, mention: 4 },
      ]),
    ).toBe(BOLT);
  });

  it('is none when nobody was named', () => {
    expect(topCompetitorId([{ entity_id: ACME, name: 'Acme', sov: 0, mention: 0 }])).toBeNull();
    expect(topCompetitorId([])).toBeNull();
  });
});

describe('lostPromptsOf', () => {
  it('counts a prompt lost when the competitor is named in a valid answer that does not name the own brand', () => {
    const answers = [
      ...times(3, () => answer('p1', [ACME])),
      ...times(2, () => answer('p1', [ACME, OWN])),
      ...times(1, () => answer('p2', [ACME])),
      answer('p3', [OWN]),
    ];
    const lost = lostPromptsOf(ACME, 'chatgpt_web', lostInput(answers));
    expect(lost.total).toBe(2);
    expect(lost.prompts.map((row) => row.prompt_id)).toEqual(['p1', 'p2']);
    expect(lost.prompts[0]?.lost).toMatchObject({ numerator: 3, denominator: 5, n_observations: 5 });
  });

  it('keeps the clear total to prompts with 4 valid answers and no answer naming the own brand, never above the judged count', () => {
    const answers = [
      // clear: 4 valid answers, Acme named, own brand never
      ...times(4, () => answer('p1', [ACME])),
      // not clear: own brand is named in one answer
      ...times(3, () => answer('p2', [ACME])),
      answer('p2', [OWN]),
      // lost, but under 4 valid answers
      ...times(2, () => answer('p3', [ACME])),
      // 4 answers, 2 invalid: 2 valid only
      ...times(2, () => answer('p4', [ACME], false)),
      ...times(2, () => answer('p4', [ACME])),
    ];
    const lost = lostPromptsOf(ACME, 'chatgpt_web', lostInput(answers));
    expect(MIN_ANSWERS).toBe(4);
    expect(lost.withMinAnswers).toBe(2);
    expect(lost.clearTotal).toBe(1);
    expect(lost.clearTotal).toBeLessThanOrEqual(lost.withMinAnswers);
    expect(lost.total).toBe(4);
  });

  it('sorts by importance, lost answers, text and id, and cuts at the limit while the total stays whole', () => {
    const answers = [
      ...times(2, () => answer('p2', [ACME])),
      ...times(2, () => answer('p3', [ACME])),
      ...times(1, () => answer('p1', [ACME])),
      ...times(3, () => answer('p4', [ACME])),
    ];
    const lost = lostPromptsOf(ACME, 'chatgpt_web', lostInput(answers, 3));
    expect(lost.prompts.map((row) => row.prompt_id)).toEqual(['p1', 'p3', 'p2']);
    expect(lost.total).toBe(4);
  });

  it('counts only the engine asked for and leaves an invalid answer out of the lost count', () => {
    const other: CitedAnswer = { ...answer('p1', [ACME]), engine: 'gemini_web' };
    const lost = lostPromptsOf(ACME, 'chatgpt_web', lostInput([other, answer('p2', [ACME], false)]));
    expect(lost).toEqual({ prompts: [], total: 0, withMinAnswers: 0, clearTotal: 0 });
  });
});

describe('topSourcesOf', () => {
  it('lists the domains cited with the entity by citation units, then domain, cut at the limit', () => {
    const answers = [
      answer('p1', [], true, [
        citation('www.b.com', ACME, 'https://b.com/1'),
        citation('b.com', ACME, 'https://b.com/2'),
      ]),
      answer('p1', [], true, [citation('a.com', ACME), citation('z.com', BOLT), citation('c.com', ACME)]),
      answer('p1', [], false, [citation('a.com', ACME)]),
    ];
    expect(topSourcesOf(ACME, answers, 2)).toEqual([
      { registrable_domain: 'b.com', citation_units: 2, answers: 1 },
      { registrable_domain: 'a.com', citation_units: 1, answers: 1 },
    ]);
    expect(topSourcesOf(OWN, answers, 3)).toEqual([]);
  });
});

describe('entityConfigOf', () => {
  const window = { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' };

  it('is one version, with no changes, when no boundary falls in the window', () => {
    expect(entityConfigOf({ window, first: '2026-08-20', boundaries: [] })).toEqual({ versions: [1], changes: null });
    expect(entityConfigOf({ window, first: '2026-08-20', boundaries: ['2026-11-13'] })).toEqual({
      versions: [1],
      changes: null,
    });
  });

  it('lists each version in the window with the day it first derived an answer, oldest first', () => {
    expect(entityConfigOf({ window, first: '2026-08-20', boundaries: ['2026-11-04', '2026-10-22'] })).toEqual({
      versions: [1, 2, 3],
      changes: [
        { version: 1, from: '2026-08-20' },
        { version: 2, from: '2026-10-22' },
        { version: 3, from: '2026-11-04' },
      ],
    });
  });

  it('leaves out a version that ended before the window, a boundary on or before the first answer, and repeated days', () => {
    expect(
      entityConfigOf({
        window,
        first: '2026-08-20',
        boundaries: ['2026-08-20', '2026-10-01', '2026-10-22', '2026-10-22'],
      }),
    ).toEqual({
      versions: [2, 3],
      changes: [
        { version: 2, from: '2026-10-01' },
        { version: 3, from: '2026-10-22' },
      ],
    });
  });

  it('is no version when nothing was ever answered', () => {
    expect(entityConfigOf({ window, first: null, boundaries: ['2026-10-22'] })).toEqual({
      versions: [],
      changes: null,
    });
  });
});

describe('pointOf', () => {
  const cell = (numerator: number, denominator: number): Schemas['MetricCell'] => ({
    numerator,
    denominator,
    n_observations: denominator + 1,
    value: denominator === 0 ? null : numerator / denominator,
  });
  const week = (start: string, extra: Partial<Schemas['WeekCells']> = {}): Schemas['WeekCells'] => ({
    week_start: start,
    prompts: 3,
    is_pooled: false,
    cited: cell(0, 0),
    mentioned: cell(1, 3),
    share_of_voice: cell(2, 4),
    entities: [
      {
        entity_id: ACME,
        mentioned: { ...cell(1, 3), pooled: { successes: 2, trials: 6 } },
        share_of_voice: cell(2, 4),
      },
    ],
    ...extra,
  });
  const range = { from: '2026-10-16', to: '2026-11-12' };

  it('is partial when the week is cut by a window bound or holds today', () => {
    const today = '2026-11-12';
    expect(pointOf(week('2026-10-12'), ACME, 'ai.share_of_voice', range, today).is_partial).toBe(true);
    expect(pointOf(week('2026-10-19'), ACME, 'ai.share_of_voice', range, today).is_partial).toBe(false);
    expect(pointOf(week('2026-11-09'), ACME, 'ai.share_of_voice', range, '2026-11-20').is_partial).toBe(true);
    expect(
      pointOf(week('2026-11-09'), ACME, 'ai.share_of_voice', { ...range, to: '2026-11-15' }, '2026-11-20').is_partial,
    ).toBe(false);
    expect(
      pointOf(week('2026-11-09'), ACME, 'ai.share_of_voice', { ...range, to: '2026-11-15' }, '2026-11-11').is_partial,
    ).toBe(true);
  });

  it('gives share of voice no pooled and mention rate its pooled answers', () => {
    expect(pointOf(week('2026-10-19'), ACME, 'ai.share_of_voice', range, '2026-11-20')).toEqual({
      t: '2026-10-19',
      value: 0.5,
      numerator: 2,
      denominator: 4,
      n_observations: 5,
      n_prompts: 3,
      is_partial: false,
      is_pooled: false,
    });
    expect(pointOf(week('2026-10-19'), ACME, 'ai.mention_rate', range, '2026-11-20')).toMatchObject({
      pooled: { successes: 2, trials: 6 },
      denominator: 3,
    });
  });

  it('carries is_pooled and the pool, and a week with no answer has a null value, never 0', () => {
    const pool = {
      weeks: 4,
      window: { from: '2026-10-16', to: '2026-11-09', timezone: 'UTC' },
      reason: 'few_prompts' as const,
      below_prompts: 10,
    };
    const pooled = pointOf(
      week('2026-11-02', { is_pooled: true, pool }),
      ACME,
      'ai.share_of_voice',
      range,
      '2026-11-20',
    );
    expect(pooled).toMatchObject({ is_pooled: true, pool });
    const empty = pointOf(
      week('2026-10-19', { entities: [{ entity_id: ACME, mentioned: cell(0, 0), share_of_voice: cell(0, 0) }] }),
      ACME,
      'ai.share_of_voice',
      range,
      '2026-11-20',
    );
    expect(empty.value).toBeNull();
    expect(empty.denominator).toBe(0);
  });
});
