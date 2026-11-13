import { createTranslator } from 'next-intl';
import { isValidElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import type { CitationRead } from './citation-reads';
import { parseScope, type CitationScope } from './citation-scope';
import { stripItems, stripStatus, type StripReads, type StripWords } from './strip-model';
import messages from '../../../messages/en.json';
import type { MetricDeltaInput } from '@/lib/format';
import type {
  EngineCode,
  MetricCell,
  SourceChangePage,
  SourceDiversity,
  SourceDomainPage,
  SourcesMeta,
} from '@/lib/citations/types';

const t = createTranslator({ locale: 'en', messages, namespace: 'citations.strip' });
const LABELS: Record<EngineCode, string> = {
  chatgpt_web: 'ChatGPT',
  gemini_web: 'Gemini',
  google_ai_mode: 'AI Mode',
};
const words: StripWords = { t, labelOf: (code) => LABELS[code] };
const WINDOW = { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' };
const BEFORE = { from: '2026-09-18', to: '2026-10-15', timezone: 'UTC' };

const ready = <TPage>(data: TPage, retrying = false): CitationRead<TPage> => ({
  status: 'ready',
  data,
  errorId: null,
  retry: () => undefined,
  retrying,
});
const failed = <TPage>(): CitationRead<TPage> => ({
  status: 'error',
  data: undefined,
  errorId: null,
  retry: () => undefined,
  retrying: false,
});
const pending = <TPage>(): CitationRead<TPage> => ({
  status: 'loading',
  data: undefined,
  errorId: null,
  retry: () => undefined,
  retrying: true,
});
/** A read that has nothing to ask: ready, with no data. */
const idle = <TPage>(): CitationRead<TPage> => ({ ...failed<TPage>(), status: 'ready' });

const metaOf = (over: Partial<SourcesMeta> = {}): SourcesMeta => ({
  answers: 4812,
  answers_citing: 4000,
  by_role: [
    { domain_role: 'own', citation_units: 1676, observations: 900 },
    { domain_role: 'competitor', citation_units: 5000, observations: 2000 },
    { domain_role: 'third_party', citation_units: 11744, observations: 3000 },
  ],
  citation_units: 18420,
  engine_codes: ['chatgpt_web', 'gemini_web'],
  include_branded: false,
  previous_answers: 4500,
  compare_window: BEFORE,
  window: WINDOW,
  ...over,
});
const domainPage = (meta: SourcesMeta): SourceDomainPage => ({
  data: [],
  meta,
  page: { limit: 1, offset: 0, total: 0 },
});
const cell = (value: number | null, units: number): MetricCell => ({
  numerator: units,
  denominator: units,
  n_observations: units,
  value,
});
const diversity = (average: number | null = 86.3): SourceDiversity => ({
  data: [
    {
      engine_code: 'chatgpt_web',
      answers: 2000,
      answers_citing: 1800,
      citation_units: 9000,
      distinct_domains: 700,
      effective_sources: cell(90, 9000),
    },
    {
      engine_code: 'gemini_web',
      answers: 2812,
      answers_citing: 2200,
      citation_units: 9420,
      distinct_domains: 800,
      effective_sources: cell(82.6, 9420),
    },
  ],
  meta: {
    distinct_domains: 1204,
    effective_sources_engine_average: average,
    engine_codes: ['chatgpt_web', 'gemini_web'],
    include_branded: false,
    window: WINDOW,
  },
});
const changes = (kind: 'new' | 'lost', total: number, minSupport = 2): SourceChangePage => ({
  data: [],
  meta: {
    kind,
    min_support: minSupport,
    engine_codes: [],
    include_branded: false,
    window: WINDOW,
    compare_window: BEFORE,
  },
  page: { limit: 1, offset: 0, total },
});

const scopeOf = (search: Parameters<typeof parseScope>[0] = {}): CitationScope =>
  parseScope(search, Object.keys(LABELS) as EngineCode[]);

/** The 13,280 units of the period before: own 1,102 of them, as in the plan's tooltip. */
const previousMeta = (own = 1102, total = 13280): SourcesMeta =>
  metaOf({
    citation_units: total,
    window: BEFORE,
    by_role: [
      { domain_role: 'own', citation_units: own, observations: 700 },
      { domain_role: 'competitor', citation_units: 4000, observations: 1500 },
      { domain_role: 'third_party', citation_units: total - own - 4000, observations: 2500 },
    ],
  });

const readsOf = (over: Partial<StripReads> = {}): StripReads => ({
  scope: ready(domainPage(metaOf())),
  previous: ready(domainPage(previousMeta())),
  diversity: ready(diversity()),
  newSources: ready(changes('new', 37)),
  lostSources: ready(changes('lost', 12)),
  ...over,
});

const byId = (reads: StripReads, scope = scopeOf()): Record<string, ReturnType<typeof stripItems>[number]> =>
  Object.fromEntries(stripItems(reads, scope, words).map((item) => [item.id, item]));

const deltaOf = (delta: unknown): MetricDeltaInput => {
  if (!isValidElement(delta)) throw new Error('The item has no delta');
  return (delta as ReactElement<{ input: MetricDeltaInput }>).props.input;
};

describe('stripItems', () => {
  it('gives six items in the DS order', () => {
    const items = stripItems(readsOf(), scopeOf(), words);
    expect(items.map((item) => item.id)).toEqual(['units', 'distinct', 'effective', 'own-share', 'new', 'lost']);
    expect(items.map((item) => item.label)).toEqual([
      'Citation units',
      'Distinct domains',
      'Effective sources',
      'Own citation share',
      'New sources',
      'Lost sources',
    ]);
    expect(items.map((item) => item.value)).toEqual(['18,420', '1,204', '86.3', '9.1%', '37', '12']);
    expect(items[0]?.context).toBe('4,812 answers, all engines');
    expect(items[1]?.context).toBe('registrable domains');
  });

  it('names the engines in the units context when the scope chooses some', () => {
    const items = byId(readsOf(), scopeOf({ engine: 'chatgpt_web,gemini_web' }));
    expect(items['units']?.context).toBe('4,812 answers, ChatGPT and Gemini');
  });

  it('own share ignores the role filter', () => {
    const own = byId(readsOf(), scopeOf({ role: 'competitor' }))['own-share'];
    expect(own?.value).toBe('9.1%');
    expect(own?.context).toBe('1,676 units');
    expect(own?.tip).toContain('1,676 of 18,420 citation units');
    expect(own?.tip).toContain('The role filter does not change this figure');
  });

  it('every percent shows its units and the total', () => {
    const own = byId(readsOf())['own-share'];
    expect(own?.context).toMatch(/units$/);
    expect(own?.tip).toContain('of 18,420 citation units');
  });

  it('own share change is the share now minus the share before, in points, with the previous units', () => {
    const own = byId(readsOf())['own-share'];
    const input = deltaOf(own?.delta);
    expect(input.unit).toBe('points');
    expect(input.value).toBeCloseTo(1676 / 18420 - 1102 / 13280, 10);
    expect(own?.tip).toContain('Previous 8.3% (1,102 of 13,280 units)');
    expect(own?.tip).toContain('No test of this change exists, so it is not coloured');
  });

  it('own share change is neutral whatever its size', () => {
    for (const previous of [1676, 100, 9000]) {
      const input = deltaOf(byId(readsOf({ previous: ready(domainPage(previousMeta(previous))) }))['own-share']?.delta);
      expect(input.polarity).toBe('neutral');
      expect(input.isDetectable).toBeNull();
    }
  });

  it('own share change is n/a without a previous total', () => {
    const without = [
      readsOf({ previous: idle() }),
      readsOf({ previous: failed() }),
      readsOf({ previous: pending() }),
      readsOf({ scope: ready(domainPage(metaOf({ previous_answers: 0 }))) }),
      readsOf({ previous: ready(domainPage(previousMeta(0, 0))) }),
    ];
    for (const reads of without) {
      const own = byId(reads)['own-share'];
      expect(own?.delta).toBeUndefined();
      expect(own?.value).toBe('9.1%');
      expect(own?.tip).not.toContain('Previous');
    }
  });

  it('has no change with the comparison off', () => {
    expect(byId(readsOf({ previous: idle() }), scopeOf({ cmp: 'off' }))['own-share']?.delta).toBeUndefined();
  });

  it('own share is n/a with a reason when no unit is in scope', () => {
    const none = metaOf({ citation_units: 0, by_role: [] });
    const own = byId(readsOf({ scope: ready(domainPage(none)) }))['own-share'];
    expect(own?.value).toBe('n/a');
    expect(own?.unknown).toEqual({ kind: 'not-applicable' });
    expect(own?.tip).toBe('No citation unit in this window, so there is no share.');
    expect(byId(readsOf({ scope: ready(domainPage(none)) }))['units']?.value).toBe('0');
  });

  it('effective sources is the engine average and the tip lists each engine with its units', () => {
    const effective = byId(readsOf())['effective'];
    expect(effective?.value).toBe('86.3');
    expect(effective?.context).toBe('avg of 2 engines');
    expect(effective?.tip).toBe(
      'ChatGPT 90.0, over 9,000 units and Gemini 82.6, over 9,420 units. Each engine is counted alone and the engines are averaged with equal weight.',
    );
    expect(isValidElement(effective?.labelAddon)).toBe(true);
  });

  it('effective sources is n/a with its reason when no engine has a unit', () => {
    const empty: SourceDiversity = {
      ...diversity(null),
      data: diversity().data.map((engine) => ({ ...engine, citation_units: 0, effective_sources: cell(null, 0) })),
    };
    const effective = byId(readsOf({ diversity: ready(empty) }))['effective'];
    expect(effective?.value).toBe('n/a');
    expect(effective?.unknown).toEqual({ kind: 'not-applicable' });
    expect(effective?.tip).toBe('No engine has a citation in this window, so there is nothing to average.');
  });

  it('new and lost use min support', () => {
    const items = byId(
      readsOf({ newSources: ready(changes('new', 37, 3)), lostSources: ready(changes('lost', 12, 3)) }),
    );
    expect(items['new']?.context).toBe('at least 3 units');
    expect(items['lost']?.context).toBe('after 2 windows');
    expect([items['new']?.value, items['lost']?.value]).toEqual(['37', '12']);
  });

  it('a failed read is unavailable and the others stay', () => {
    const items = byId(readsOf({ diversity: failed(), lostSources: failed() }));
    for (const id of ['distinct', 'effective', 'lost']) {
      expect(items[id]?.value).toBe('n/a');
      expect(items[id]?.unknown).toEqual({ kind: 'not-applicable' });
      expect(items[id]?.tip).toBe('Could not be loaded');
    }
    for (const id of ['units', 'own-share', 'new']) {
      expect(items[id]?.unknown ?? null).toBeNull();
    }
  });

  it('a failed scope read makes the units and the own share unavailable', () => {
    const items = byId(readsOf({ scope: failed(), previous: idle() }));
    expect(items['units']?.unknown).toEqual({ kind: 'not-applicable' });
    expect(items['own-share']?.unknown).toEqual({ kind: 'not-applicable' });
    expect(items['distinct']?.unknown ?? null).toBeNull();
  });

  it('a pending read is pending, with no tip', () => {
    const items = byId(readsOf({ diversity: pending() }));
    expect(items['distinct']?.unknown).toEqual({ kind: 'pending' });
    expect(items['distinct']?.tip).toBeUndefined();
  });
});

describe('stripStatus', () => {
  it('is loading until the scope read arrives', () => {
    expect(stripStatus(readsOf({ scope: pending() }))).toBe('loading');
    expect(stripStatus(readsOf({ scope: pending(), diversity: ready(diversity(), true) }))).toBe('loading');
  });

  it('is refetching while any read refetches and ready otherwise', () => {
    expect(stripStatus(readsOf())).toBe('ready');
    expect(stripStatus(readsOf({ lostSources: ready(changes('lost', 1), true) }))).toBe('refetching');
    expect(stripStatus(readsOf({ scope: ready(domainPage(metaOf()), true) }))).toBe('refetching');
  });

  it('is ready when the scope read failed and nothing else is on its way', () => {
    expect(stripStatus(readsOf({ scope: failed(), previous: idle() }))).toBe('ready');
  });
});
