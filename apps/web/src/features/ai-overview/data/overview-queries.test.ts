import { describe, expect, it } from 'vitest';

import {
  askedEngines,
  comparisonWindow,
  overviewEnginesQuery,
  overviewFanoutQuery,
  overviewSchedulesQuery,
  overviewSourcesQuery,
  overviewSummaryQuery,
  sourcesComparable,
  type ProjectRef,
  type ReadScope,
} from './overview-queries';
import type { OverviewScope } from '../scope/scope-model';
import type { EngineCode } from '@/lib/api/types';

const PROJECT: ProjectRef = { workspaceId: 'w1', projectId: 'p1' };
const ALL: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];
const TOPIC = '3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b';

function scopeOf(patch: Partial<OverviewScope> = {}): OverviewScope {
  return {
    range: { from: '2026-10-16', to: '2026-11-12', days: 28 },
    rangeValue: { kind: 'preset', preset: '28d' },
    compare: true,
    compareKind: 'previous_period',
    previous: { from: '2026-09-18', to: '2026-10-15' },
    country: null,
    engines: null,
    topic: null,
    branded: 'excluded',
    metric: 'visibility',
    ...patch,
  };
}

const readOf = (patch: Partial<OverviewScope> = {}, enabledEngines: readonly EngineCode[] = ALL): ReadScope => ({
  scope: scopeOf(patch),
  enabledEngines,
});

/** The normalized query the request carries: the last element of every key. */
const queryOf = (options: { queryKey: readonly unknown[] }): unknown => options.queryKey.at(-1);

describe('overviewSummaryQuery', () => {
  it('carries the window, engines, country, topic and branded of the scope', () => {
    const options = overviewSummaryQuery(
      PROJECT,
      readOf({ engines: ['gemini_web'], country: 'DE', topic: TOPIC, branded: 'excluded' }),
    );
    expect(queryOf(options)).toEqual({
      from: '2026-10-16',
      to: '2026-11-12',
      include_branded: false,
      'filter[engine_code_in]': ['gemini_web'],
      'filter[country_iso]': 'DE',
      'filter[term]': TOPIC,
    });
  });

  it.each([
    ['excluded', { include_branded: false }],
    ['included', { include_branded: true }],
    ['only', { include_branded: true, branded_only: true }],
  ] as const)('sends the parameters of branded %s', (branded, expected) => {
    expect(queryOf(overviewSummaryQuery(PROJECT, readOf({ branded })))).toEqual({
      from: '2026-10-16',
      to: '2026-11-12',
      'filter[engine_code_in]': ALL,
      ...expected,
    });
  });

  it('asks the previous window with its own from and to', () => {
    const options = overviewSummaryQuery(PROJECT, readOf(), { period: 'previous' });
    expect(queryOf(options)).toMatchObject({ from: '2026-09-18', to: '2026-10-15' });
  });

  it('sends the blocks and the row choice it is given, in one order', () => {
    const options = overviewSummaryQuery(PROJECT, readOf(), { include: ['series', 'entities'], rows: 'topics' });
    expect(queryOf(options)).toMatchObject({ include: ['entities', 'series'], rows: 'topics' });
    expect(queryOf(overviewSummaryQuery(PROJECT, readOf()))).not.toHaveProperty('include');
  });

  it('summary params carry total and co_mentions in sorted order', () => {
    const options = overviewSummaryQuery(PROJECT, readOf(), {
      include: ['total', 'entities', 'co_mentions'],
      rows: 'none',
    });
    expect(queryOf(options)).toMatchObject({ include: ['co_mentions', 'entities', 'total'], rows: 'none' });
    // Two orders of the same blocks are one request, so one cache entry
    const reordered = overviewSummaryQuery(PROJECT, readOf(), {
      include: ['co_mentions', 'total', 'entities'],
      rows: 'none',
    });
    expect(options.queryKey).toEqual(reordered.queryKey);
  });

  it('names the engines of an all-engines scope, so an engine the read does not ask is never pooled in', () => {
    expect(queryOf(overviewSummaryQuery(PROJECT, readOf({ engines: null })))).toMatchObject({
      'filter[engine_code_in]': ALL,
    });
    const reordered = readOf({ engines: ['google_ai_mode', 'chatgpt_web', 'gemini_web'] });
    expect(queryOf(overviewSummaryQuery(PROJECT, reordered))).toMatchObject({ 'filter[engine_code_in]': ALL });
    const two = readOf({ engines: ['gemini_web', 'chatgpt_web'] }, ['chatgpt_web', 'gemini_web']);
    expect(queryOf(overviewSummaryQuery(PROJECT, two))).toMatchObject({
      'filter[engine_code_in]': ['chatgpt_web', 'gemini_web'],
    });
  });

  it('asks Google AI Overview only when the read names it, and never pools it into the other reads', () => {
    const answered = readOf({ engines: null }, [...ALL, 'google_ai_overview']);
    expect(queryOf(overviewSummaryQuery(PROJECT, answered))).toMatchObject({
      'filter[engine_code_in]': [...ALL, 'google_ai_overview'],
    });
    const plain = overviewSummaryQuery(PROJECT, readOf({ engines: null }));
    expect(JSON.stringify(queryOf(plain))).not.toContain('google_ai_overview');
    expect(plain.queryKey).not.toEqual(overviewSummaryQuery(PROJECT, answered).queryKey);
  });

  it('sends a subset of the engines in the order of the project, so equal choices share one entry', () => {
    const first = overviewSummaryQuery(PROJECT, readOf({ engines: ['google_ai_mode', 'chatgpt_web'] }));
    const second = overviewSummaryQuery(PROJECT, readOf({ engines: ['chatgpt_web', 'google_ai_mode'] }));
    expect(queryOf(first)).toMatchObject({ 'filter[engine_code_in]': ['chatgpt_web', 'google_ai_mode'] });
    expect(first.queryKey).toEqual(second.queryKey);
  });

  it('puts the read under the AI prefix of the project, which a refresh of the prompts invalidates', () => {
    expect(overviewSummaryQuery(PROJECT, readOf()).queryKey.slice(0, 5)).toEqual(['ws', 'w1', 'p', 'p1', 'ai']);
  });

  it('has different keys for different scopes and one key for equal scopes', () => {
    const keyOf = (patch: Partial<OverviewScope>): string =>
      JSON.stringify(overviewSummaryQuery(PROJECT, readOf(patch)).queryKey);
    const keys = [
      keyOf({}),
      keyOf({ country: 'DE' }),
      keyOf({ topic: TOPIC }),
      keyOf({ branded: 'included' }),
      keyOf({ branded: 'only' }),
      keyOf({ engines: ['gemini_web'] }),
      keyOf({ range: { from: '2026-10-17', to: '2026-11-12', days: 27 } }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keyOf({})).toBe(keyOf({ compare: false }));
  });
});

describe('the fact counts of the cards', () => {
  it('are asked with include=fact_counts, next to the other blocks in a stable order', () => {
    const options = overviewSummaryQuery(PROJECT, readOf(), { include: ['fact_counts'] });
    expect(queryOf(options)).toMatchObject({ include: ['fact_counts'] });
    const mixed = overviewSummaryQuery(PROJECT, readOf(), { include: ['series', 'fact_counts'] });
    expect(queryOf(mixed)).toMatchObject({ include: ['fact_counts', 'series'] });
  });

  it('share one read between the cards that ask for them', () => {
    const first = overviewSummaryQuery(PROJECT, readOf(), { include: ['fact_counts'] });
    const second = overviewSummaryQuery(PROJECT, readOf(), { include: ['fact_counts'] });
    expect(first.queryKey).toEqual(second.queryKey);
  });
});

describe('askedEngines', () => {
  it('is every enabled engine for a null choice and the enabled ones inside the choice otherwise', () => {
    expect(askedEngines(readOf())).toEqual(ALL);
    expect(askedEngines(readOf({ engines: ['gemini_web'] }))).toEqual(['gemini_web']);
    expect(askedEngines(readOf({ engines: ['gemini_web', 'chatgpt_web'] }))).toEqual(['chatgpt_web', 'gemini_web']);
  });

  it('leaves out an engine that is not on and is empty when none of the choice is on', () => {
    expect(askedEngines(readOf({ engines: ['gemini_web', 'chatgpt_web'] }, ['chatgpt_web']))).toEqual(['chatgpt_web']);
    expect(askedEngines(readOf({ engines: ['gemini_web'] }, ['chatgpt_web']))).toEqual([]);
    expect(askedEngines(readOf({}, []))).toEqual([]);
  });
});

describe('sourcesComparable', () => {
  it('is on for the period before only: the sources routes have no compare=previous_year', () => {
    expect(sourcesComparable(scopeOf())).toBe(true);
    expect(sourcesComparable(scopeOf({ compare: false }))).toBe(false);
    const year = scopeOf({ compareKind: 'previous_year', previous: { from: '2025-10-16', to: '2025-11-12' } });
    expect(sourcesComparable(year)).toBe(false);
    // The summary reads the year window by its dates, so the Overview still has it
    expect(comparisonWindow(year)).toEqual({ from: '2025-10-16', to: '2025-11-12' });
    expect(queryOf(overviewSourcesQuery(PROJECT, readOf({ compareKind: 'previous_year' })))).not.toHaveProperty(
      'compare',
    );
  });
});

describe('comparisonWindow', () => {
  it('is the previous window while the comparison is on', () => {
    expect(comparisonWindow(scopeOf())).toEqual({ from: '2026-09-18', to: '2026-10-15' });
  });

  it('is null while the comparison is off', () => {
    expect(comparisonWindow(scopeOf({ compare: false }))).toBeNull();
  });

  it('is null when the previous window starts before the year 2000, which no read or format takes', () => {
    const early = scopeOf({
      range: { from: '2000-01-10', to: '2000-02-06', days: 28 },
      previous: { from: '1999-12-13', to: '2000-01-09' },
    });
    expect(comparisonWindow(early)).toBeNull();
  });
});

describe('overviewSourcesQuery', () => {
  it('asks one row, so the answer is its meta, with the roles per engine', () => {
    const query = queryOf(overviewSourcesQuery(PROJECT, readOf({ compare: false })));
    expect(query).toEqual({
      from: '2026-10-16',
      to: '2026-11-12',
      include_branded: false,
      limit: 1,
      // Named, so the platform that is off is not read (the summary leaves the filter out for all of them)
      'filter[engine_code_in]': ALL,
      include: ['by_role_by_engine'],
    });
  });

  it('asks the previous period while the comparison is on and the previous window can be read', () => {
    expect(queryOf(overviewSourcesQuery(PROJECT, readOf()))).toMatchObject({ compare: 'previous_period' });
    const early = readOf({
      range: { from: '2000-01-10', to: '2000-02-06', days: 28 },
      previous: { from: '1999-12-13', to: '2000-01-09' },
    });
    expect(queryOf(overviewSourcesQuery(PROJECT, early))).not.toHaveProperty('compare');
  });

  it('carries the engines, country, topic and branded of the scope, and the blocks it is given', () => {
    const options = overviewSourcesQuery(
      PROJECT,
      readOf({ engines: ['gemini_web'], country: 'IN', topic: TOPIC, branded: 'included', compare: false }),
      { include: ['series', 'by_role_by_engine'] },
    );
    expect(queryOf(options)).toMatchObject({
      include_branded: true,
      'filter[engine_code_in]': ['gemini_web'],
      'filter[country_iso]': 'IN',
      'filter[term]': TOPIC,
      include: ['by_role_by_engine', 'series'],
    });
  });
});

describe('overviewFanoutQuery', () => {
  it('asks one row, so the answer is its meta', () => {
    expect(queryOf(overviewFanoutQuery(PROJECT, readOf({}, ['chatgpt_web'])))).toEqual({
      from: '2026-10-16',
      to: '2026-11-12',
      include_branded: false,
      limit: 1,
    });
  });

  it('carries the country, topic and branded of the scope and never an engine that shows no fan-out', () => {
    const options = overviewFanoutQuery(
      PROJECT,
      readOf({ engines: ['chatgpt_web', 'gemini_web'], country: 'DE', topic: TOPIC, branded: 'included' }, [
        'chatgpt_web',
      ]),
    );
    expect(queryOf(options)).toEqual({
      from: '2026-10-16',
      to: '2026-11-12',
      include_branded: true,
      limit: 1,
      'filter[country_iso]': 'DE',
      'filter[term]': TOPIC,
    });
  });
});

describe('the engines and schedules reads', () => {
  it('reads the engines of the project under its engines key', () => {
    const options = overviewEnginesQuery(PROJECT);
    expect(options.queryKey.slice(0, 5)).toEqual(['ws', 'w1', 'p', 'p1', 'engines']);
  });

  it('reads the schedules of the AI workload, active or not', () => {
    const query = queryOf(overviewSchedulesQuery(PROJECT));
    expect(query).toEqual({ 'filter[workload]': 'ai_prompt', limit: 10 });
  });
});
