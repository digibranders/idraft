import { describe, expect, it } from 'vitest';

import { promptHref, promptsTabHref, topicDrawerHref, topicEngineHref, topicsTabHref, type LinkContext } from './links';
import { NO_TOPIC } from './topic-nodes';
import type { OverviewScope } from '../../scope/scope-model';
import { ENGINE_PARAM, parseEngineParam, parseView } from '@/features/prompts/topics-by-engine/drill';
import { TOPIC_TAB, parseMetric, parseTab } from '@/features/prompts/prompt-model';
import { parseInspectTarget } from '@/lib/inspector/placement';

const TOPIC = '3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b';
const ENGINES = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;

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

const ctxOf = (patch: Partial<OverviewScope> = {}): LinkContext => ({
  workspaceSlug: 'acme',
  projectSlug: 'eventus',
  scope: scopeOf(patch),
});

const NARROWED: Partial<OverviewScope> = {
  rangeValue: { kind: 'custom', from: '2026-10-01', to: '2026-10-20' },
  range: { from: '2026-10-01', to: '2026-10-20', days: 20 },
  compare: false,
  country: 'DE',
  engines: ['chatgpt_web', 'gemini_web'],
  branded: 'included',
};

/** The query of a link, as the page it opens reads it. */
function queryOf(href: string | null): URLSearchParams {
  if (href === null) throw new Error('expected a link, got null');
  return new URL(href, 'http://localhost').searchParams;
}
const pathOf = (href: string | null): string => {
  if (href === null) throw new Error('expected a link, got null');
  return new URL(href, 'http://localhost').pathname;
};

describe('topic links', () => {
  it('a topic drawer link carries inspect, itab, eng and the scope keys', () => {
    const href = topicEngineHref(ctxOf(NARROWED), TOPIC, 'gemini_web');
    const query = queryOf(href);
    expect(pathOf(href)).toBe('/acme/eventus/ai/prompts');
    expect(query.get('inspect')).toBe(`topic:${TOPIC}`);
    expect(query.get('itab')).toBe('prompts');
    expect(query.get('eng')).toBe('gemini_web');
    expect(query.get('from')).toBe('2026-10-01');
    expect(query.get('to')).toBe('2026-10-20');
    expect(query.get('cmp')).toBe('off');
    expect(query.get('country')).toBe('DE');
    expect(query.get('branded')).toBe('include');
    // The number is of one engine, so the page shows that engine
    expect(query.get('engine')).toBe('gemini_web');
  });

  it('the drawer link of a topic opens its Overview tab and no engine', () => {
    const query = queryOf(topicDrawerHref(ctxOf(NARROWED), TOPIC));
    expect(query.get('inspect')).toBe(`topic:${TOPIC}`);
    expect(query.get('itab')).toBeNull();
    expect(query.get('eng')).toBeNull();
    expect(query.get('engine')).toBe('chatgpt_web,gemini_web');
  });

  it('defaults write nothing (compare on, branded excluded, no country)', () => {
    const drawer = queryOf(topicDrawerHref(ctxOf(), TOPIC));
    expect([...drawer.keys()]).toEqual(['inspect']);
    const engine = queryOf(topicEngineHref(ctxOf(), TOPIC, 'chatgpt_web'));
    expect([...engine.keys()].sort()).toEqual(['eng', 'engine', 'inspect', 'itab']);
    expect(queryOf(promptsTabHref(ctxOf())).toString()).toBe('tab=prompts');
  });

  it('the Topics tab link carries view and metric', () => {
    const query = queryOf(topicsTabHref(ctxOf(), { view: 'heatmap', metric: 'citation' }));
    expect(query.get('view')).toBe('heatmap');
    expect(query.get('metric')).toBe('citation');
    expect(query.get('sort')).toBeNull();
    expect(query.get('tab')).toBeNull();
  });

  it('writes share of voice as the metric the Prompts page calls sov, and a sort as given', () => {
    const query = queryOf(topicsTabHref(ctxOf(), { view: 'engines', metric: 'share_of_voice', sort: '-engine_gap' }));
    expect(query.get('metric')).toBe('sov');
    expect(query.get('sort')).toBe('-engine_gap');
    expect(queryOf(topicsTabHref(ctxOf(), { view: 'heatmap', metric: 'mention' })).get('metric')).toBeNull();
  });

  it('a prompt link opens the prompt inspector', () => {
    expect(parseInspectTarget(queryOf(promptHref(ctxOf(), 'prompt-1')).get('inspect'))).toEqual({
      type: 'prompt',
      id: 'prompt-1',
    });
  });

  it('the Prompts tab link carries the engine, its rate sort and the topic', () => {
    const query = queryOf(promptsTabHref(ctxOf(), { engine: 'gemini_web', topic: TOPIC, metric: 'citation' }));
    expect(query.get('tab')).toBe('prompts');
    expect(query.get('engine')).toBe('gemini_web');
    expect(query.get('sort')).toBe('-gemini_web_rate');
    expect(query.get('topic')).toBe(TOPIC);
    expect(query.get('metric')).toBe('citation');
  });

  it('a link built from a topic with an odd character is encoded', () => {
    const href = topicEngineHref(ctxOf(), 'a&b=c d', 'chatgpt_web');
    expect(href).not.toContain(' ');
    expect(queryOf(href).get('inspect')).toBe('topic:a&b=c d');
    expect(queryOf(href).get('eng')).toBe('chatgpt_web');
  });

  it('the prompts without a topic open the drawer of the no topic row', () => {
    expect(queryOf(topicEngineHref(ctxOf(), NO_TOPIC, 'chatgpt_web')).get('inspect')).toBe('topic:__none');
  });

  it('is null where the page cannot show the scope (a window longer than the page reads)', () => {
    const long = ctxOf({ range: { from: '2026-08-14', to: '2026-11-12', days: 92 } });
    expect(topicDrawerHref(long, TOPIC)).toBeNull();
    expect(topicEngineHref(long, TOPIC, 'chatgpt_web')).toBeNull();
    expect(topicsTabHref(long, { view: 'heatmap', metric: 'mention' })).toBeNull();
    expect(promptHref(long, 'p')).toBeNull();
    expect(promptsTabHref(long)).toBeNull();
  });
});

describe('the links are read by the Prompts page parsers', () => {
  it('the Prompts page parsers read tab, metric, view, eng and the drawer tab of each link', () => {
    const engine = queryOf(topicEngineHref(ctxOf(), TOPIC, 'google_ai_mode'));
    expect(parseEngineParam(engine.get(ENGINE_PARAM), ENGINES)).toBe('google_ai_mode');
    expect(engine.get('itab')).toBe(TOPIC_TAB.prompts);
    expect(parseInspectTarget(engine.get('inspect'))).toEqual({ type: 'topic', id: TOPIC });

    const topics = queryOf(topicsTabHref(ctxOf(), { view: 'engines', metric: 'share_of_voice' }));
    expect(parseView(topics.get('view'))).toBe('engines');
    expect(parseMetric(topics.get('metric'))).toBe('sov');
    expect(parseTab(topics.get('tab'))).toBe('topics');

    const heat = queryOf(topicsTabHref(ctxOf(), { view: 'heatmap', metric: 'citation' }));
    expect(parseView(heat.get('view'))).toBe('heatmap');
    expect(parseMetric(heat.get('metric'))).toBe('citation');

    const prompts = queryOf(promptsTabHref(ctxOf(), { metric: 'citation' }));
    expect(parseTab(prompts.get('tab'))).toBe('prompts');
    expect(parseMetric(prompts.get('metric'))).toBe('citation');
  });
});
