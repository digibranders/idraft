import { describe, expect, it } from 'vitest';

import messages from '../../../../../messages/en.json';
import { engineCells, promptRow, summaryOf } from './engines-fixtures';
import { buildFacts, factNumbers, limitFacts, type Comparison, type Fact, type FactsInput } from './facts-model';
import { pairPrompts } from './prompt-pairs';
import { buildAggregates, type OverviewAggregates } from '../../data/aggregates';
import { projectEngine } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { EngineCode, PromptsSummary, PromptSummaryRow } from '@/lib/api/types';

const ALL: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];

function aggregatesOf(
  current: PromptsSummary,
  previous: PromptsSummary | null = null,
  on: readonly EngineCode[] = current.engine_codes as EngineCode[],
): OverviewAggregates {
  return buildAggregates({
    current,
    previous,
    engines: ALL.map((code) => ({ ...projectEngine(code), is_enabled: on.includes(code) })),
    chosenEngines: null,
    topicsKept: null,
    sources: null,
    fanout: null,
  });
}

const summary = (rows: readonly PromptSummaryRow[], codes: readonly EngineCode[]): PromptsSummary =>
  summaryOf(rows, { codes });

interface Setup {
  now: PromptsSummary;
  before?: PromptsSummary | null;
  comparison?: Comparison;
  newSources?: FactsInput['newSources'];
}

function factsOf({ now, before = null, comparison, newSources = null }: Setup): Fact[] {
  const aggregates = aggregatesOf(now, before);
  const asked = aggregates.engines.filter((engine) => engine.asked).map((engine) => engine.engineCode);
  return buildFacts({
    aggregates,
    comparison: comparison ?? (before === null ? 'off' : 'read'),
    pairs: before === null ? null : pairPrompts(now.prompts, before.prompts, asked),
    newSources,
    days: 28,
  });
}

const kinds = (facts: readonly Fact[]): string[] => facts.map((fact) => fact.kind);

/** One prompt with a large count on one engine: its mention rate is the count over the answers. */
const bigRow = (code: EngineCode, k: number, n: number, id = `p-${code}`): PromptSummaryRow =>
  promptRow(id, [engineCells(code, { mentioned: [k, n] })]);

describe('buildFacts: collection', () => {
  it('writes a collection fact for each engine with answers that were not valid, the worst engine first, before everything else', () => {
    const now = summary(
      [
        promptRow('p1', [
          engineCells('chatgpt_web', { mentioned: [10, 40, 40] }),
          engineCells('gemini_web', { mentioned: [10, 40, 50] }),
          engineCells('google_ai_mode', { mentioned: [10, 40, 80] }),
        ]),
      ],
      ALL,
    );
    const before = summary(
      [
        promptRow('p1', [
          engineCells('chatgpt_web', { mentioned: [10, 40] }),
          engineCells('gemini_web', { mentioned: [10, 40] }),
          engineCells('google_ai_mode', { mentioned: [10, 40] }),
        ]),
      ],
      ALL,
    );
    const facts = factsOf({ now, before });
    expect(facts[0]?.kind).toBe('collection');
    const collection = facts.filter((fact) => fact.kind === 'collection');
    expect(collection.map((fact) => fact.params)).toEqual([
      { engine: 'google_ai_mode', notValid: 40, all: 80, days: 28 },
      { engine: 'gemini_web', notValid: 10, all: 50, days: 28 },
    ]);
    expect(facts.slice(0, collection.length)).toEqual(collection);
  });

  it('writes none when every answer was valid', () => {
    const now = summary([bigRow('chatgpt_web', 10, 40)], ['chatgpt_web']);
    expect(kinds(factsOf({ now }))).not.toContain('collection');
  });
});

describe('buildFacts: engine change', () => {
  const now = summary(
    [bigRow('chatgpt_web', 700, 1800), bigRow('gemini_web', 360, 1800)],
    ['chatgpt_web', 'gemini_web'],
  );
  const before = summary(
    [bigRow('chatgpt_web', 575, 1800), bigRow('gemini_web', 350, 1800)],
    ['chatgpt_web', 'gemini_web'],
  );

  it('writes a fact only for an engine whose change is detectable, with the counts of both windows', () => {
    const facts = factsOf({ now, before });
    expect(kinds(facts)).toEqual(['engineChange']);
    const [fact] = facts;
    if (fact?.kind !== 'engineChange') throw new Error('Expected an engine change');
    expect(fact.params).toMatchObject({
      engine: 'chatgpt_web',
      k: 700,
      n: 1800,
      prompts: 1,
      beforeK: 575,
      beforeN: 1800,
    });
    expect(fact.params.rate).toBeCloseTo(700 / 1800, 10);
    expect(fact.params.before).toBeCloseTo(575 / 1800, 10);
    expect(fact.params.delta).toBeCloseTo(700 / 1800 - 575 / 1800, 10);
    expect(fact.link).toEqual({ destination: 'prompts', engine: 'chatgpt_web' });
  });

  it('writes one fact for each detectable engine, in catalog order', () => {
    const moved = summary(
      [bigRow('chatgpt_web', 700, 1800), bigRow('gemini_web', 700, 1800)],
      ['chatgpt_web', 'gemini_web'],
    );
    const old = summary(
      [bigRow('chatgpt_web', 575, 1800), bigRow('gemini_web', 500, 1800)],
      ['chatgpt_web', 'gemini_web'],
    );
    const facts = factsOf({ now: moved, before: old });
    expect(facts.map((fact) => fact.id)).toEqual(['engineChange:chatgpt_web', 'engineChange:gemini_web']);
  });

  it('gives one within-variation fact, with the engines compared, when no engine is detectable', () => {
    const calm = summary(
      [bigRow('chatgpt_web', 360, 1800), bigRow('gemini_web', 360, 1800)],
      ['chatgpt_web', 'gemini_web'],
    );
    const calmBefore = summary(
      [bigRow('chatgpt_web', 350, 1800), bigRow('gemini_web', 350, 1800)],
      ['chatgpt_web', 'gemini_web'],
    );
    const facts = factsOf({ now: calm, before: calmBefore });
    expect(facts.filter((fact) => fact.kind !== 'gainedLost').map((fact) => [fact.kind, fact.params])).toEqual([
      ['withinVariation', { engines: 2 }],
    ]);
  });
});

describe('buildFacts: no previous data', () => {
  const now = summary([bigRow('chatgpt_web', 700, 1800)], ['chatgpt_web']);

  it('says the comparison is off, and nothing about change, when it is off', () => {
    const facts = factsOf({ now });
    expect(facts.map((fact) => [fact.kind, fact.params])).toEqual([['noPrevious', { reason: 'off', days: 28 }]]);
  });

  it('says the previous window has no answers when it has none', () => {
    const empty = summary([promptRow('p1', [engineCells('chatgpt_web', {})])], ['chatgpt_web']);
    const facts = factsOf({ now, before: empty });
    expect(facts.map((fact) => [fact.kind, fact.params])).toEqual([['noPrevious', { reason: 'noAnswers', days: 28 }]]);
  });

  it('says there are too few answers to compare when the previous window has some but too few on every engine', () => {
    const thin = summary([bigRow('chatgpt_web', 1, 3)], ['chatgpt_web']);
    const facts = factsOf({ now, before: thin });
    expect(facts.map((fact) => [fact.kind, fact.params])).toEqual([['noPrevious', { reason: 'tooFew', days: 28 }]]);
  });

  it('makes no claim, and never writes "within normal variation", when the pooled counts and the prompt rates point apart', () => {
    // Pooled: 70 + 10 of 110 now against 90 of 110 before, down. Prompt weighted: (0.7 + 1) / 2 against (0.9 + 0) / 2, up
    const rows = (cells: readonly [id: string, k: number, n: number][]): PromptSummaryRow[] =>
      cells.map(([id, k, n]) => bigRow('chatgpt_web', k, n, id));
    const mixed = summary(
      rows([
        ['a', 70, 100],
        ['b', 10, 10],
      ]),
      ['chatgpt_web'],
    );
    const old = summary(
      rows([
        ['a', 90, 100],
        ['b', 0, 10],
      ]),
      ['chatgpt_web'],
    );
    const [engine] = aggregatesOf(mixed, old).engines.filter((entry) => entry.asked);
    // The fixture does what it says: a change with no claim to make
    expect(engine?.change.mentioned.delta).not.toBeNull();
    expect(engine?.change.mentioned.detectable).toBeNull();
    const facts = factsOf({ now: mixed, before: old });
    expect(kinds(facts)).not.toContain('withinVariation');
    expect(kinds(facts)).not.toContain('engineChange');
    expect(facts.filter((fact) => fact.kind !== 'gainedLost').map((fact) => [fact.kind, fact.params])).toEqual([
      ['noPrevious', { reason: 'noClaim', days: 28 }],
    ]);
  });

  it('counts in within-variation only the engines whose test found no change, not those with no claim', () => {
    const rows = (cells: readonly [id: string, k: number, n: number][], code: EngineCode): PromptSummaryRow[] =>
      cells.map(([id, k, n]) => bigRow(code, k, n, `${id}-${code}`));
    const codes = ['chatgpt_web', 'gemini_web'] as const;
    const mixedNow: [id: string, k: number, n: number][] = [
      ['a', 70, 100],
      ['b', 10, 10],
    ];
    const mixedBefore: [id: string, k: number, n: number][] = [
      ['a', 90, 100],
      ['b', 0, 10],
    ];
    const now = summary([...rows(mixedNow, 'chatgpt_web'), bigRow('gemini_web', 360, 1800)], codes);
    const before = summary([...rows(mixedBefore, 'chatgpt_web'), bigRow('gemini_web', 350, 1800)], codes);
    const facts = factsOf({ now, before });
    expect(facts.filter((fact) => fact.kind === 'withinVariation').map((fact) => fact.params)).toEqual([
      { engines: 1 },
    ]);
  });

  it('says it could not be read when the previous read failed', () => {
    const facts = factsOf({ now, comparison: 'unread' });
    expect(facts.map((fact) => [fact.kind, fact.params])).toEqual([['noPrevious', { reason: 'unread', days: 28 }]]);
  });

  it('says nothing about change while the two windows are not of one scope (pending)', () => {
    expect(factsOf({ now, comparison: 'pending', newSources: { total: 9, minSupport: 2 } })).toEqual([]);
  });
});

describe('buildFacts: gained and lost prompts', () => {
  const rows = (cells: readonly [id: string, k: number, n: number][]): PromptSummaryRow[] =>
    cells.map(([id, k, n]) => bigRow('chatgpt_web', k, n, id));
  const codes = ['chatgpt_web'] as const;

  it('counts prompts with 4 or more valid answers in both windows that stopped or started naming the brand, and reports those left out', () => {
    const now = summary(
      rows([
        ['lost', 0, 8],
        ['gained', 2, 8],
        ['kept', 3, 8],
        ['never', 0, 8],
        // Fewer than 4 valid answers now: left out, never read as "not named"
        ['thin', 0, 3],
        ['added', 5, 8],
      ]),
      codes,
    );
    const before = summary(
      rows([
        ['lost', 1, 8],
        ['gained', 0, 8],
        ['kept', 4, 8],
        ['never', 0, 8],
        ['thin', 3, 4],
        ['left', 4, 8],
      ]),
      codes,
    );
    const gained = factsOf({ now, before }).find((fact) => fact.kind === 'gainedLost');
    expect(gained?.params).toEqual({
      engine: 'chatgpt_web',
      lost: 1,
      namedBefore: 2,
      gained: 1,
      notNamedBefore: 2,
      compared: 4,
      leftOut: 1,
    });
    expect(gained?.link).toBeNull();
  });

  it('counts a prompt with no cell of the engine in one window as left out: no cell is 0 valid answers', () => {
    const now = summary(
      [
        ...rows([
          ['lost', 0, 8],
          ['nocell', 3, 8],
        ]),
      ],
      codes,
    );
    // The prompt is in both windows, but only on another engine in the window before
    const before = summary(
      [bigRow('chatgpt_web', 1, 8, 'lost'), promptRow('nocell', [engineCells('gemini_web', { mentioned: [3, 8] })])],
      codes,
    );
    const gained = factsOf({ now, before }).find((fact) => fact.kind === 'gainedLost');
    expect(gained?.params).toMatchObject({ lost: 1, compared: 1, leftOut: 1 });
  });

  it('is not written when no prompt changed', () => {
    const same = summary(rows([['a', 2, 8]]), codes);
    expect(kinds(factsOf({ now: same, before: same }))).not.toContain('gainedLost');
  });

  it('is written when only the reverse happened', () => {
    const now = summary(rows([['a', 2, 8]]), codes);
    const before = summary(rows([['a', 0, 8]]), codes);
    expect(factsOf({ now, before }).find((fact) => fact.kind === 'gainedLost')?.params).toMatchObject({
      lost: 0,
      gained: 1,
    });
  });
});

describe('buildFacts: new sources', () => {
  const now = summary([bigRow('chatgpt_web', 360, 1800)], ['chatgpt_web']);
  const before = summary([bigRow('chatgpt_web', 350, 1800)], ['chatgpt_web']);

  it('is written when the read answered, the total is above 0 and the previous window has answers', () => {
    const facts = factsOf({ now, before, newSources: { total: 37, minSupport: 2 } });
    expect(facts.at(-1)).toMatchObject({
      kind: 'newSources',
      params: { count: 37, minSupport: 2, days: 28 },
      link: null,
    });
  });

  it.each([
    ['the read did not answer', null],
    ['the total is 0', { total: 0, minSupport: 2 }],
  ])('is not written when %s', (_name, newSources) => {
    expect(kinds(factsOf({ now, before, newSources }))).not.toContain('newSources');
  });

  it('is not written when the previous window has no answers', () => {
    const empty = summary([promptRow('p1', [engineCells('chatgpt_web', {})])], ['chatgpt_web']);
    expect(kinds(factsOf({ now, before: empty, newSources: { total: 9, minSupport: 2 } }))).not.toContain('newSources');
  });
});

describe('buildFacts: the whole', () => {
  const now = summary(
    [
      promptRow('lost', [engineCells('chatgpt_web', { mentioned: [0, 1800, 1900] })]),
      promptRow('gained', [engineCells('chatgpt_web', { mentioned: [700, 1800] })]),
    ],
    ['chatgpt_web'],
  );
  const before = summary(
    [
      promptRow('lost', [engineCells('chatgpt_web', { mentioned: [575, 1800] })]),
      promptRow('gained', [engineCells('chatgpt_web', { mentioned: [0, 1800] })]),
    ],
    ['chatgpt_web'],
  );
  const input: Setup = { now, before, newSources: { total: 5, minSupport: 2 } };

  it('keeps a fixed order whatever the data: collection, engine change, gained and lost, new sources', () => {
    expect(kinds(factsOf(input))).toEqual(['collection', 'engineChange', 'gainedLost', 'newSources']);
  });

  it('gives the same facts for the same input', () => {
    expect(factsOf(input)).toEqual(factsOf(input));
  });

  it('gives every number its denominator in the params', () => {
    const keys = Object.fromEntries(factsOf(input).map((fact) => [fact.kind, Object.keys(fact.params).sort()]));
    expect(keys).toEqual({
      collection: ['all', 'days', 'engine', 'notValid'],
      engineChange: ['beforeK', 'beforeN', 'delta', 'engine', 'k', 'n', 'prompts', 'rate', 'before'].sort(),
      gainedLost: ['compared', 'engine', 'gained', 'leftOut', 'lost', 'namedBefore', 'notNamedBefore'],
      newSources: ['count', 'days', 'minSupport'],
    });
  });

  it('never writes the share of voice leader: no fact kind or param speaks of it', () => {
    const facts = factsOf(input);
    for (const fact of facts) {
      expect(['collection', 'engineChange', 'withinVariation', 'noPrevious', 'gainedLost', 'newSources']).toContain(
        fact.kind,
      );
      expect(JSON.stringify(fact).toLowerCase()).not.toContain('voice');
    }
  });

  it('gives the numbers of a fact as raw counts with their denominators, and null for what it does not have', () => {
    const byKind = Object.fromEntries(factsOf(input).map((fact) => [fact.kind, factNumbers(fact)]));
    expect(byKind.collection).toEqual({
      count: 100,
      of: 3700,
      secondCount: null,
      secondOf: null,
      prompts: null,
      leftOut: null,
      changePoints: null,
      days: 28,
      minSupport: null,
    });
    expect(byKind.engineChange).toMatchObject({ count: 700, of: 3600, secondCount: 575, secondOf: 3600, prompts: 2 });
    expect(byKind.engineChange?.changePoints).toBeCloseTo(((700 + 0) / 3600 - (575 + 0) / 3600) * 100, 6);
    expect(byKind.gainedLost).toMatchObject({ count: 1, of: 1, secondCount: 1, secondOf: 1, prompts: 2, leftOut: 0 });
    expect(byKind.newSources).toMatchObject({ count: 5, minSupport: 2, days: 28, of: null });
  });
});

describe('limitFacts', () => {
  const facts = Array.from({ length: 7 }, (_unused, index): Fact => ({
    id: `collection:${String(index)}`,
    kind: 'collection',
    params: { engine: 'chatgpt_web', notValid: 1, all: 2, days: 28 },
    link: null,
  }));

  it.each([
    [3, 3, 4],
    [5, 5, 2],
  ])('cuts to %i and reports how many more', (limit, shown, hidden) => {
    const cut = limitFacts(facts, limit);
    expect(cut.shown).toHaveLength(shown);
    expect(cut.hidden).toBe(hidden);
  });

  it('reports 0 more when everything fits', () => {
    expect(limitFacts(facts.slice(0, 2), 5)).toEqual({ shown: facts.slice(0, 2), hidden: 0 });
  });
});

describe('the messages of the facts', () => {
  const block = (messages as unknown as { aiOverview: { engines: { changeSummary: Record<string, unknown> } } })
    .aiOverview.engines.changeSummary;
  const values = (tree: Record<string, unknown>): string[] =>
    Object.values(tree).flatMap((value) =>
      typeof value === 'string' ? [value] : values(value as Record<string, unknown>),
    );
  const FORBIDDEN = [
    'because',
    'due to',
    'drove',
    'caused',
    'thanks to',
    'great',
    'worrying',
    'strong',
    'weak',
    "n't",
    // The curly form of "n't"; the dashes (figure dash, en-dash, em-dash, horizontal bar) come from code points
    // so that this file does not contain the characters it looks for
    '’t',
    ...[0x2012, 0x2013, 0x2014, 0x2015].map((code) => String.fromCharCode(code)),
  ];

  it('has words for the block and never a causal word, a judgement adjective, a dash or a contraction of not', () => {
    const all = values(block);
    expect(all.length).toBeGreaterThan(20);
    for (const text of all) {
      for (const word of FORBIDDEN) expect(text.toLowerCase(), `"${word}" in "${text}"`).not.toContain(word);
      expect(text, `a spaced hyphen in "${text}"`).not.toMatch(/ - /);
    }
  });
});
