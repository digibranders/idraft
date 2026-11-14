import { describe, expect, it } from 'vitest';

import type { NumberFigure, NumberReading } from '../data/number-sources';
import type { OverviewScope } from '../scope/scope-model';
import { numberHref } from './number-links';
import type { EngineCode } from '@/lib/api/types';
import type { NumberItem } from '@/lib/layouts/types';

const PROJECT = { workspace: 'acme', project: 'fynix' };
const ENABLED: readonly EngineCode[] = ['chatgpt_web', 'gemini_web'];

const FIGURE: NumberFigure = {
  state: 'ok',
  value: 0.42,
  k: 42,
  n: 100,
  unit: 'answers',
  prompts: 10,
  invalid: 0,
  topics: null,
  reason: null,
  change: null,
  companions: null,
};
const READ: NumberReading = { status: 'read', figure: FIGURE };

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

const item = (metric: string, engine?: EngineCode): NumberItem =>
  engine === undefined ? { id: metric, metric } : { id: `${metric}-${engine}`, metric, engine };

function linkOf(
  number: NumberItem,
  options: { reading?: NumberReading | null; scope?: OverviewScope; enabled?: readonly EngineCode[] } = {},
): URL | null {
  const href = numberHref(
    number,
    options.reading === undefined ? READ : options.reading,
    options.scope ?? scopeOf(),
    PROJECT,
    options.enabled ?? ENABLED,
  );
  return href === null ? null : new URL(href, 'http://localhost');
}

describe('numberHref: where each number leads', () => {
  it.each([
    ['ai.mention_rate', null],
    ['ai.citation_rate', 'citation'],
    ['ai.share_of_voice', 'sov'],
  ])('%s of an engine opens Prompts with that engine, its rate sort and metric %s', (metric, expected) => {
    const url = linkOf(item(metric, 'gemini_web'));
    expect(url?.pathname).toBe('/acme/fynix/ai/prompts');
    expect(url?.searchParams.get('tab')).toBe('prompts');
    expect(url?.searchParams.get('engine')).toBe('gemini_web');
    expect(url?.searchParams.get('sort')).toBe('-gemini_web_rate');
    expect(url?.searchParams.get('metric')).toBe(expected);
  });

  it('valid answers of an engine opens Prompts with that engine', () => {
    const url = linkOf(item('ai.valid_answers', 'chatgpt_web'));
    expect(url?.pathname).toBe('/acme/fynix/ai/prompts');
    expect(url?.searchParams.get('engine')).toBe('chatgpt_web');
  });

  it('prompts in scope opens Prompts with the engines of the scope', () => {
    const url = linkOf(item('ai.prompts_in_scope'), { scope: scopeOf({ engines: ['gemini_web'] }) });
    expect(url?.pathname).toBe('/acme/fynix/ai/prompts');
    expect(url?.searchParams.get('engine')).toBe('gemini_web');
    expect(url?.searchParams.get('sort')).toBeNull();
  });

  it('citation share of an engine opens Citations with that engine and the topic', () => {
    const url = linkOf(item('ai.citation_share', 'chatgpt_web'), { scope: scopeOf({ topic: 'topic-1' }) });
    expect(url?.pathname).toBe('/acme/fynix/ai/citations');
    expect(url?.searchParams.get('engine')).toBe('chatgpt_web');
    expect(url?.searchParams.get('topic')).toBe('topic-1');
  });

  it('carries the window, the country and the branded choice of the scope', () => {
    const scope = scopeOf({
      rangeValue: { kind: 'preset', preset: '7d' },
      range: { from: '2026-11-06', to: '2026-11-12', days: 7 },
      country: 'DE',
      branded: 'included',
    });
    const url = linkOf(item('ai.mention_rate', 'chatgpt_web'), { scope });
    expect(url?.searchParams.get('win')).toBe('7d');
    expect(url?.searchParams.get('country')).toBe('DE');
    expect(url?.searchParams.get('branded')).toBe('include');
  });

  it.each(['ai.mention_and_citation_rate', 'ai.fanout_presence_rate', 'ai.recommendation_rate'])(
    '%s has no column or filter on a destination, so it is plain text',
    (metric) => {
      expect(linkOf(item(metric, 'chatgpt_web'))).toBeNull();
    },
  );
});

describe('numberHref: no link where the page could not show the same numbers', () => {
  it.each<[string, NumberReading | null]>([
    ['off', { status: 'notAsked', why: 'off' }],
    ['outside the filter', { status: 'notAsked', why: 'outsideFilter' }],
    ['not exposed', { status: 'notExposed' }],
    ['unread', { status: 'unread' }],
    ['not available', null],
  ])('a number that is %s is plain text', (_name, reading) => {
    expect(linkOf(item('ai.mention_rate', 'chatgpt_web'), { reading })).toBeNull();
  });

  it('a scope that holds an engine that is off in the project has no link, for any number', () => {
    const scope = scopeOf({ engines: ['chatgpt_web', 'google_ai_mode'] });
    expect(linkOf(item('ai.mention_rate', 'chatgpt_web'), { scope })).toBeNull();
    expect(linkOf(item('ai.prompts_in_scope'), { scope })).toBeNull();
  });

  it('an engine of the number that is off in the project has no link', () => {
    expect(linkOf(item('ai.mention_rate', 'google_ai_mode'))).toBeNull();
  });

  it('branded prompts only cannot be written on the pages, so it is plain text', () => {
    expect(linkOf(item('ai.mention_rate', 'chatgpt_web'), { scope: scopeOf({ branded: 'only' }) })).toBeNull();
  });

  it('a window of more than 91 days is plain text', () => {
    const scope = scopeOf({ range: { from: '2026-08-13', to: '2026-11-12', days: 92 } });
    expect(linkOf(item('ai.prompts_in_scope'), { scope })).toBeNull();
  });

  it('citation share with a country is plain text: Citations does not read the country', () => {
    expect(linkOf(item('ai.citation_share', 'chatgpt_web'), { scope: scopeOf({ country: 'DE' }) })).toBeNull();
    expect(linkOf(item('ai.mention_rate', 'chatgpt_web'), { scope: scopeOf({ country: 'DE' }) })).not.toBeNull();
  });
});
