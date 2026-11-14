import { describe, expect, it } from 'vitest';

import { readRangeParams } from '@/components/app/date-range/range-model';
import { parseScope as parseCitationScope } from '@/features/citations/citation-scope';
import { engineSortId, parseCountry, parseMetric, parseTab } from '@/features/prompts/prompt-model';
import { parseEnumList } from '@/lib/filters/filter-values';
import { parseInspectTarget } from '@/lib/inspector/placement';
import { NAVIGATION } from '@/lib/navigation/registry';
import { parseSort } from '@/lib/tables/table-state';

import { parseBranded, type OverviewScope } from '../scope/scope-model';

import { DRILL_SUPPORT, drillHref, type DrillKind, type DrillSupport } from './drill-links';

const TOPIC = '3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b';
const OTHER_TOPIC = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const ENGINES = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;
const PROJECT = { workspace: 'acme', project: 'eventus' };
const NO_SUPPORT: DrillSupport = {
  prompts: { outcome: false, opportunity: false },
  topic: { outcome: false, opportunity: false },
  topicDrawer: { outcome: false, opportunity: false },
  prompt: { outcome: false, opportunity: false },
  citations: { outcome: false, opportunity: false },
  competitors: { outcome: false, opportunity: false },
  sources: { outcome: false, opportunity: false },
  runs: { outcome: false, opportunity: false },
};

function scopeOf(patch: Partial<OverviewScope> = {}): OverviewScope {
  return {
    range: { from: '2026-10-16', to: '2026-11-12', days: 28 },
    rangeValue: { kind: 'preset', preset: '28d' },
    compare: true,
    previous: { from: '2026-09-18', to: '2026-10-15' },
    country: null,
    engines: null,
    topic: null,
    branded: 'excluded',
    ...patch,
  };
}

/** The scope of a person who has narrowed every key the Overview has. */
const NARROWED = scopeOf({
  rangeValue: { kind: 'custom', from: '2026-10-01', to: '2026-10-20' },
  range: { from: '2026-10-01', to: '2026-10-20', days: 20 },
  compare: false,
  country: 'DE',
  engines: ['chatgpt_web', 'gemini_web'],
  topic: TOPIC,
  branded: 'included',
});

/** The query of a link, as the page it opens reads it. */
function queryOf(href: string | null): URLSearchParams {
  if (href === null) throw new Error('expected a link, got null');
  return new URL(href, 'http://localhost').searchParams;
}

const pathOf = (href: string | null): string => {
  if (href === null) throw new Error('expected a link, got null');
  return new URL(href, 'http://localhost').pathname;
};

const isLive = (key: string): boolean => NAVIGATION.find((item) => item.key === key)?.status === 'live';

describe('drillHref carries the scope', () => {
  // Citations does not read the country, so its link is checked without one (see the null cases below)
  it.each<[DrillKind, OverviewScope, string]>([
    ['prompts', NARROWED, '/acme/eventus/ai/prompts'],
    ['topic', NARROWED, '/acme/eventus/ai/prompts'],
    ['topicDrawer', NARROWED, '/acme/eventus/ai/prompts'],
    ['citations', scopeOf({ ...NARROWED, country: null }), '/acme/eventus/ai/citations'],
  ])('%s: window, cmp, country, engine, topic and branded of the scope', (kind, scope, path) => {
    const href = drillHref(kind, scope, kind === 'topicDrawer' ? { term: OTHER_TOPIC } : {}, PROJECT);
    const query = queryOf(href);
    expect(pathOf(href)).toBe(path);
    expect(query.get('from')).toBe('2026-10-01');
    expect(query.get('to')).toBe('2026-10-20');
    expect(query.get('win')).toBeNull();
    expect(query.get('cmp')).toBe('off');
    expect(query.get('country')).toBe(kind === 'citations' ? null : 'DE');
    expect(query.get('engine')).toBe('chatgpt_web,gemini_web');
    expect(query.get('topic')).toBe(TOPIC);
    expect(query.get('branded')).toBe('include');
  });

  it('writes a preset window as win, and nothing for the default 28 days', () => {
    expect(
      queryOf(drillHref('prompts', scopeOf({ rangeValue: { kind: 'preset', preset: '7d' } }), {}, PROJECT)).get('win'),
    ).toBe('7d');
    expect(queryOf(drillHref('prompts', scopeOf(), {}, PROJECT)).get('win')).toBeNull();
  });

  it('branded excluded and compare on write nothing: the default scope has no query beyond the tab', () => {
    expect(drillHref('topic', scopeOf(), {}, PROJECT)).toBe('/acme/eventus/ai/prompts');
    expect(drillHref('citations', scopeOf(), {}, PROJECT)).toBe('/acme/eventus/ai/citations');
    expect(queryOf(drillHref('prompts', scopeOf(), {}, PROJECT)).toString()).toBe('tab=prompts');
  });

  it('encodes a slug and writes the engine of the scope in the order given', () => {
    const href = drillHref(
      'topic',
      scopeOf({ engines: ['gemini_web', 'chatgpt_web'] }),
      {},
      { workspace: 'a b', project: 'p' },
    );
    expect(pathOf(href)).toBe('/a%20b/p/ai/prompts');
    expect(queryOf(href).get('engine')).toBe('gemini_web,chatgpt_web');
  });
});

describe('the Prompts links are read by the Prompts page own parsers', () => {
  const href = drillHref('prompts', NARROWED, { engine: 'gemini_web' }, PROJECT);
  const query = queryOf(href);

  it('tab, country, metric and the window', () => {
    expect(parseTab(query.get('tab'))).toBe('prompts');
    expect(parseCountry(query.get('country'))).toBe('DE');
    expect(parseMetric(query.get('metric'))).toBe('mention');
    const read = readRangeParams(
      { win: query.get('win'), from: query.get('from'), to: query.get('to') },
      { today: '2026-11-13' },
    );
    expect(read).toEqual({ value: NARROWED.rangeValue, dropped: null });
  });

  it('the engine filter and the topic filter hold ids the filter bar knows', () => {
    expect(parseEnumList(query.get('engine'), new Set(ENGINES))).toEqual(['gemini_web']);
    expect(parseEnumList(query.get('topic'), new Set([TOPIC]))).toEqual([TOPIC]);
  });

  it('branded=include is the one value the Branded filter has, and the Overview reads it back as included', () => {
    expect(query.get('branded')).toBe('include');
    expect(parseBranded(query.get('branded'))).toBe('included');
  });

  it('the sort id is one of the Prompts table (an engine rate), descending', () => {
    const known = new Set(ENGINES.map((code) => engineSortId(code, 'rate')));
    expect(parseSort(query.get('sort'), known)).toEqual([{ id: engineSortId('gemini_web', 'rate'), desc: true }]);
  });

  it('the topic drawer target is read by the inspector', () => {
    const drawer = queryOf(drillHref('topicDrawer', scopeOf(), { term: TOPIC }, PROJECT));
    expect(parseInspectTarget(drawer.get('inspect'))).toEqual({ type: 'topic', id: TOPIC });
  });
});

describe('the Citations link is read by the Citations page own parser', () => {
  it('engine, topic, branded and cmp', () => {
    const href = drillHref('citations', scopeOf({ ...NARROWED, country: null }), {}, PROJECT);
    const query = queryOf(href);
    const read = parseCitationScope(
      Object.fromEntries(['tab', 'engine', 'topic', 'branded', 'cmp'].map((key) => [key, query.get(key)])),
      ENGINES,
    );
    expect(read.engines).toEqual(['chatgpt_web', 'gemini_web']);
    expect(read.term).toBe(TOPIC);
    expect(read.includeBranded).toBe(true);
    expect(read.compare).toBe(false);
  });
});

describe('liveness', () => {
  it('a destination that is not live in the navigation registry gives null, not a link to a 404 page', () => {
    for (const kind of ['sources'] as const) {
      expect(isLive(kind)).toBe(false);
      expect(drillHref(kind, scopeOf(), {}, PROJECT)).toBeNull();
    }
  });

  it('every kind the registry has live gives a link', () => {
    // competitors is live since WP-39
    expect(isLive('prompts') && isLive('citations') && isLive('runs') && isLive('competitors')).toBe(true);
    for (const kind of ['prompts', 'topic', 'citations', 'competitors', 'runs'] as const) {
      expect(drillHref(kind, scopeOf(), {}, PROJECT)).not.toBeNull();
    }
  });

  it('runs is the project Runs page with nothing carried, whatever the scope', () => {
    expect(drillHref('runs', NARROWED, {}, PROJECT)).toBe('/acme/eventus/ops/runs');
  });
});

describe('engine numbers', () => {
  it('lead to Prompts with that engine and the sort of its rate, instead of the scope engines', () => {
    const query = queryOf(drillHref('prompts', NARROWED, { engine: 'google_ai_mode' }, PROJECT));
    expect(query.get('tab')).toBe('prompts');
    expect(query.get('engine')).toBe('google_ai_mode');
    expect(query.get('sort')).toBe('-google_ai_mode_rate');
  });

  it('carry the metric of the rate, and nothing for mention (the default)', () => {
    expect(
      queryOf(drillHref('prompts', scopeOf(), { engine: 'chatgpt_web', metric: 'citation' }, PROJECT)).get('metric'),
    ).toBe('citation');
    expect(
      queryOf(drillHref('prompts', scopeOf(), { engine: 'chatgpt_web', metric: 'mention' }, PROJECT)).get('metric'),
    ).toBeNull();
  });

  it('the Topics tab takes the engine but no rate sort', () => {
    const query = queryOf(drillHref('topic', scopeOf(), { engine: 'chatgpt_web' }, PROJECT));
    expect(query.get('engine')).toBe('chatgpt_web');
    expect(query.get('sort')).toBeNull();
  });
});

describe('the topic drawer', () => {
  it('is inspect=topic:<term> on the Prompts page, with the scope beside it', () => {
    const href = drillHref('topicDrawer', scopeOf({ country: 'DE' }), { term: TOPIC }, PROJECT);
    const query = queryOf(href);
    expect(pathOf(href)).toBe('/acme/eventus/ai/prompts');
    expect(query.get('inspect')).toBe(`topic:${TOPIC}`);
    expect(query.get('country')).toBe('DE');
    expect(query.get('tab')).toBeNull();
  });

  it('takes the topic of the scope when no term is given, and is null with neither', () => {
    expect(queryOf(drillHref('topicDrawer', scopeOf({ topic: TOPIC }), {}, PROJECT)).get('inspect')).toBe(
      `topic:${TOPIC}`,
    );
    expect(drillHref('topicDrawer', scopeOf(), {}, PROJECT)).toBeNull();
  });
});

describe('a prompt', () => {
  const PROMPT = '7c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';

  it('is inspect=prompt:<id> on the Prompts page with the scope carried like the topic drawer, and no tab', () => {
    const href = drillHref('prompt', NARROWED, { promptId: PROMPT, term: OTHER_TOPIC }, PROJECT);
    const query = queryOf(href);
    expect(pathOf(href)).toBe('/acme/eventus/ai/prompts');
    expect(parseInspectTarget(query.get('inspect'))).toEqual({ type: 'prompt', id: PROMPT });
    expect(query.get('tab')).toBeNull();
    expect(query.get('from')).toBe('2026-10-01');
    expect(query.get('to')).toBe('2026-10-20');
    expect(query.get('cmp')).toBe('off');
    expect(query.get('country')).toBe('DE');
    expect(query.get('engine')).toBe('chatgpt_web,gemini_web');
    expect(query.get('topic')).toBe(TOPIC);
    expect(query.get('branded')).toBe('include');
    expect(parseCountry(query.get('country'))).toBe('DE');
    expect(parseEnumList(query.get('engine'), new Set(ENGINES))).toEqual(['chatgpt_web', 'gemini_web']);
  });

  it('is null without a prompt id, for branded only, for a 92 day window and when Prompts is not live', () => {
    expect(drillHref('prompt', scopeOf(), {}, PROJECT)).toBeNull();
    expect(drillHref('prompt', scopeOf({ branded: 'only' }), { promptId: PROMPT }, PROJECT)).toBeNull();
    const long = scopeOf({
      rangeValue: { kind: 'custom', from: '2026-08-13', to: '2026-11-12' },
      range: { from: '2026-08-13', to: '2026-11-12', days: 92 },
    });
    expect(drillHref('prompt', long, { promptId: PROMPT }, PROJECT)).toBeNull();
    expect(isLive('prompts')).toBe(true);
  });
});

describe('outcome and opportunity', () => {
  const extra = { outcome: 'not_mentioned', opportunity: 'high' };

  it('are written only for destinations that read them: today none does', () => {
    expect(Object.values(DRILL_SUPPORT).every((entry) => !entry.outcome && !entry.opportunity)).toBe(true);
    const query = queryOf(drillHref('prompts', scopeOf(), extra, PROJECT));
    expect(query.get('outcome')).toBeNull();
    expect(query.get('opportunity')).toBeNull();
  });

  it('are written for a destination the table says reads them, and for no other', () => {
    const support: DrillSupport = { ...NO_SUPPORT, prompts: { outcome: true, opportunity: false } };
    const query = queryOf(drillHref('prompts', scopeOf(), extra, PROJECT, support));
    expect(query.get('outcome')).toBe('not_mentioned');
    expect(query.get('opportunity')).toBeNull();
    expect(queryOf(drillHref('topic', scopeOf(), extra, PROJECT, support)).get('outcome')).toBeNull();
  });
});

describe('a scope the destination cannot express gives null, never a link that shows other numbers', () => {
  it.each(['prompts', 'topic', 'topicDrawer', 'citations'] as const)('%s: branded only', (kind) => {
    expect(drillHref(kind, scopeOf({ branded: 'only' }), { term: TOPIC }, PROJECT)).toBeNull();
  });

  it('citations does not read the country, so a country scope has no link', () => {
    expect(drillHref('citations', scopeOf({ country: 'DE' }), {}, PROJECT)).toBeNull();
  });
});

describe('the longest window the destinations take', () => {
  // The Overview allows 92 days; Prompts and Citations read a range with the default limit, 91
  const custom = (from: string, to: string, days: number): OverviewScope =>
    scopeOf({ rangeValue: { kind: 'custom', from, to }, range: { from, to, days } });
  const KINDS = ['prompts', 'topic', 'topicDrawer', 'citations'] as const;

  it.each(KINDS)('%s: a 92 day custom window gives null, not a link that opens another window', (kind) => {
    expect(drillHref(kind, custom('2026-08-13', '2026-11-12', 92), { term: TOPIC }, PROJECT)).toBeNull();
  });

  it.each(KINDS)('%s: a 91 day window links and the destination reads it back as the same window', (kind) => {
    const scope = custom('2026-08-14', '2026-11-12', 91);
    const query = queryOf(drillHref(kind, scope, { term: TOPIC }, PROJECT));
    const read = readRangeParams(
      { win: query.get('win'), from: query.get('from'), to: query.get('to') },
      { today: '2026-11-13' },
    );
    expect(read).toEqual({ value: scope.rangeValue, dropped: null });
  });

  it('the 90d preset still links', () => {
    const scope = scopeOf({
      rangeValue: { kind: 'preset', preset: '90d' },
      range: { from: '2026-08-15', to: '2026-11-12', days: 90 },
    });
    const query = queryOf(drillHref('prompts', scope, {}, PROJECT));
    expect(query.get('win')).toBe('90d');
    expect(readRangeParams({ win: '90d', from: null, to: null }, { today: '2026-11-13' }).dropped).toBeNull();
  });
});

describe('bad input', () => {
  it('a window before 2000 and a window that is not a date never throw', () => {
    const early = scopeOf({
      rangeValue: { kind: 'custom', from: '1999-01-01', to: '1999-01-28' },
      range: { from: '1999-01-01', to: '1999-01-28', days: 28 },
      previous: { from: '1998-12-04', to: '1998-12-31' },
    });
    expect(() => drillHref('prompts', early, {}, PROJECT)).not.toThrow();
    const garbled = scopeOf({ rangeValue: { kind: 'custom', from: 'soon', to: '' } });
    expect(() => drillHref('citations', garbled, {}, PROJECT)).not.toThrow();
  });

  it('an unknown kind is a type error, and gives null if it gets through anyway', () => {
    // @ts-expect-error 'nowhere' is not a DrillKind
    const href = drillHref('nowhere', scopeOf(), {}, PROJECT);
    expect(href).toBeNull();
  });

  it('a term or engine with reserved characters is encoded, not injected', () => {
    const query = queryOf(drillHref('topicDrawer', scopeOf(), { term: 'a&b=c#d' }, PROJECT));
    expect(query.get('inspect')).toBe('topic:a&b=c#d');
    expect(query.get('b')).toBeNull();
  });
});
