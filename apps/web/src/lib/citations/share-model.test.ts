import { describe, expect, it } from 'vitest';

import {
  engineShare,
  engineTotals,
  isNewSource,
  ownShare,
  roleUnits,
  shareChange,
  unitShare,
  weeklyShare,
} from './share-model';
import type { MetricCell, SourceDomainRow, SourcesMeta } from './types';

const cell = (numerator: number, denominator: number): MetricCell => ({
  value: denominator === 0 ? null : numerator / denominator,
  numerator,
  denominator,
  n_observations: 8,
});
const WINDOW = { from: '2026-10-16', to: '2026-11-12', timezone: 'Europe/Berlin' };

/** The meta of a scope with 200 units: 40 own, 60 competitor, 100 third party. */
const metaOf = (overrides: Partial<SourcesMeta> = {}): SourcesMeta => ({
  window: WINDOW,
  include_branded: false,
  engine_codes: ['chatgpt_web', 'gemini_web'],
  answers: 24,
  answers_citing: 20,
  citation_units: 200,
  by_role: [
    { domain_role: 'own', citation_units: 40, observations: 10 },
    { domain_role: 'competitor', citation_units: 60, observations: 12 },
    { domain_role: 'third_party', citation_units: 100, observations: 18 },
  ],
  ...overrides,
});

const rowOf = (overrides: Partial<SourceDomainRow> = {}): SourceDomainRow => ({
  registrable_domain: 'example.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 20,
  observations: 9,
  prompts: 4,
  engines: [
    { engine_code: 'chatgpt_web', citation_units: 15 },
    { engine_code: 'gemini_web', citation_units: 5 },
  ],
  source_share: cell(20, 200),
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  ...overrides,
});

describe('unitShare', () => {
  it('gives value, units and the denominator, and a null value for 0 of 0', () => {
    expect(unitShare(cell(20, 200))).toEqual({ value: 0.1, units: 20, total: 200 });
    expect(unitShare(cell(0, 200))).toEqual({ value: 0, units: 0, total: 200 });
    // No unit in scope is no share, never 0%
    expect(unitShare(cell(0, 0))).toEqual({ value: null, units: 0, total: 0 });
  });
});

describe('ownShare and roleUnits', () => {
  it('ownShare is the own role over every unit and ignores a role filter', () => {
    // A role filter narrows the rows and never meta: the share is the same with or without one
    expect(ownShare(metaOf())).toEqual({ value: 0.2, units: 40, total: 200 });
  });

  it('ownShare is null for a scope with no unit and 0 units when no own role is listed', () => {
    expect(ownShare(metaOf({ citation_units: 0, by_role: [] }))).toEqual({ value: null, units: 0, total: 0 });
    expect(ownShare(metaOf({ by_role: [] }))).toEqual({ value: 0, units: 0, total: 200 });
  });

  it('roleUnits reads the units of each role from by_role', () => {
    expect(roleUnits(metaOf())).toEqual({ own: 40, competitor: 60, third_party: 100 });
    expect(roleUnits(metaOf({ by_role: [] }))).toEqual({ own: 0, competitor: 0, third_party: 0 });
  });
});

describe('engineTotals and engineShare', () => {
  const block = (own: number, competitor: number, thirdParty: number, engine: 'chatgpt_web' | 'gemini_web') => ({
    engine_code: engine,
    own: { citation_units: own, answers_citing: 1 },
    competitor: { citation_units: competitor, answers_citing: 1 },
    third_party: { citation_units: thirdParty, answers_citing: 1 },
  });

  it('engineTotals sums the roles of by_role_by_engine and is null without the block', () => {
    const totals = engineTotals(
      metaOf({ by_role_by_engine: [block(10, 20, 30, 'chatgpt_web'), block(0, 0, 0, 'gemini_web')] }),
    );
    expect(totals?.get('chatgpt_web')).toBe(60);
    expect(totals?.get('gemini_web')).toBe(0);
    expect(engineTotals(metaOf())).toBeNull();
    expect(engineTotals(metaOf({ by_role_by_engine: null }))).toBeNull();
  });

  it('engineShare is the engine units of the row over the engine total', () => {
    const totals = engineTotals(
      metaOf({ by_role_by_engine: [block(10, 20, 30, 'chatgpt_web'), block(5, 5, 10, 'gemini_web')] }),
    );
    expect(engineShare(rowOf(), 'chatgpt_web', totals)).toEqual({ value: 0.25, units: 15, total: 60 });
    expect(engineShare(rowOf(), 'gemini_web', totals)).toEqual({ value: 0.25, units: 5, total: 20 });
  });

  it('engineShare is n/a when the engine total is 0, never 0', () => {
    const totals = engineTotals(
      metaOf({ by_role_by_engine: [block(10, 20, 30, 'chatgpt_web'), block(0, 0, 0, 'gemini_web')] }),
    );
    const silent = rowOf({
      engines: [
        { engine_code: 'chatgpt_web', citation_units: 15 },
        { engine_code: 'gemini_web', citation_units: 0 },
      ],
    });
    expect(engineShare(silent, 'gemini_web', totals)).toBeNull();
  });

  it('engineShare is n/a without totals, for an engine they do not list and for an engine the row does not list', () => {
    const totals = engineTotals(metaOf({ by_role_by_engine: [block(10, 20, 30, 'chatgpt_web')] }));
    expect(engineShare(rowOf(), 'chatgpt_web', null)).toBeNull();
    expect(engineShare(rowOf(), 'gemini_web', totals)).toBeNull();
    expect(engineShare(rowOf({ engines: [] }), 'chatgpt_web', totals)).toBeNull();
  });
});

describe('shareChange', () => {
  const now = metaOf({ previous_answers: 12 });

  it('is the share now minus previous units over the previous total, as a ratio the points format reads', () => {
    // Now 20 of 200 (10%), before 5 of 100 (5%)
    const change = shareChange(
      rowOf({ previous: { citation_units: 5, observations: 2 } }),
      now,
      metaOf({ citation_units: 100 }),
    );
    expect(change?.delta).toBeCloseTo(0.05, 10);
    expect(change?.now).toEqual({ value: 0.1, units: 20, total: 200 });
    expect(change?.previous).toEqual({ value: 0.05, units: 5, total: 100 });
  });

  it('is negative when the share fell', () => {
    const change = shareChange(
      rowOf({ previous: { citation_units: 30, observations: 6 } }),
      now,
      metaOf({ citation_units: 100 }),
    );
    expect(change?.delta).toBeCloseTo(-0.2, 10);
  });

  it('is null without a previous total or with previous_answers 0', () => {
    const row = rowOf({ previous: { citation_units: 5, observations: 2 } });
    const previous = metaOf({ citation_units: 100 });
    expect(shareChange(row, now, null)).toBeNull();
    expect(shareChange(row, now, undefined)).toBeNull();
    expect(shareChange(row, metaOf({ previous_answers: 0 }), previous)).toBeNull();
    expect(shareChange(row, metaOf(), previous)).toBeNull();
    expect(shareChange(row, metaOf({ previous_answers: null }), previous)).toBeNull();
  });

  it('is null for a row with no previous block, a previous total of 0 or no unit in scope now', () => {
    expect(shareChange(rowOf(), now, metaOf({ citation_units: 100 }))).toBeNull();
    const row = rowOf({ previous: { citation_units: 0, observations: 0 } });
    expect(shareChange(row, now, metaOf({ citation_units: 0 }))).toBeNull();
    expect(shareChange({ ...row, source_share: cell(0, 0) }, now, metaOf({ citation_units: 100 }))).toBeNull();
  });
});

describe('isNewSource', () => {
  const now = metaOf({ previous_answers: 12 });
  const fresh = rowOf({ citation_units: 3, previous: { citation_units: 0, observations: 0 } });

  it('needs previous 0, previous_answers above 0 and units at least min support', () => {
    expect(isNewSource(fresh, now, 2)).toBe(true);
    expect(isNewSource(fresh, now, 3)).toBe(true);
    expect(isNewSource(fresh, now, 4)).toBe(false);
    expect(isNewSource({ ...fresh, previous: { citation_units: 1, observations: 1 } }, now, 2)).toBe(false);
  });

  it('is null when the previous period has no answers, so nothing is marked either way', () => {
    expect(isNewSource(fresh, metaOf({ previous_answers: 0 }), 2)).toBeNull();
    expect(isNewSource(fresh, metaOf({ previous_answers: null }), 2)).toBeNull();
    expect(isNewSource(fresh, metaOf(), 2)).toBeNull();
  });

  it('is null for a row with no previous block', () => {
    expect(isNewSource(rowOf({ citation_units: 3 }), now, 2)).toBeNull();
  });
});

describe('weeklyShare', () => {
  const metaWeeks = [
    { week_start: '2026-10-26', answers: 4, citation_units: 40, distinct_domains: 9 },
    { week_start: '2026-11-02', answers: 0, citation_units: 0, distinct_domains: 0 },
    { week_start: '2026-11-09', answers: 4, citation_units: 20, distinct_domains: 7 },
  ];

  it('aligns row weeks with meta weeks and leaves a week with no units in scope as a gap', () => {
    const series = [
      { week_start: '2026-10-26', citation_units: 10, observations: 3 },
      { week_start: '2026-11-02', citation_units: 0, observations: 0 },
      { week_start: '2026-11-09', citation_units: 0, observations: 0 },
    ];
    expect(weeklyShare(series, metaWeeks)).toEqual([
      { weekStart: '2026-10-26', value: 0.25, units: 10, total: 40 },
      { weekStart: '2026-11-02', value: null, units: 0, total: 0 },
      // The scope had units and the domain none: a real 0, not a gap
      { weekStart: '2026-11-09', value: 0, units: 0, total: 20 },
    ]);
  });

  it('follows the weeks of meta and leaves a week the row does not list as a gap', () => {
    const series = [{ week_start: '2026-11-09', citation_units: 5, observations: 2 }];
    expect(weeklyShare(series, metaWeeks)?.map((week) => week.value)).toEqual([null, null, 0.25]);
  });

  it('is null without the series of the row or of meta', () => {
    expect(weeklyShare(null, metaWeeks)).toBeNull();
    expect(weeklyShare(undefined, metaWeeks)).toBeNull();
    expect(weeklyShare([], null)).toBeNull();
    expect(weeklyShare([], undefined)).toBeNull();
  });
});
