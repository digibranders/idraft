import { describe, expect, it } from 'vitest';

import { parseScope } from './scope-model';

const ALL = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;
const TOPIC = '3F2B8C1E-5A47-4D0E-9B6A-1C2D3E4F5A6B';

describe('parseScope', () => {
  it('a link with no key is the Comparison tab, every engine, cmp on, no country, no topic, branded excluded', () => {
    const scope = parseScope({}, ALL);
    expect(scope).toMatchObject({
      tab: 'comparison',
      compare: true,
      country: null,
      engines: [],
      engineScope: [...ALL],
      eng: 'chatgpt_web',
      metric: 'mention',
      topic: null,
      branded: 'excluded',
      lost: null,
    });
  });

  it('tab reads seo, ai and candidates; anything else is Comparison', () => {
    expect(parseScope({ tab: 'seo' }, ALL).tab).toBe('seo');
    expect(parseScope({ tab: 'ai' }, ALL).tab).toBe('ai');
    expect(parseScope({ tab: 'candidates' }, ALL).tab).toBe('candidates');
    expect(parseScope({ tab: 'comparison' }, ALL).tab).toBe('comparison');
    expect(parseScope({ tab: 'SEO' }, ALL).tab).toBe('comparison');
    expect(parseScope({ tab: 'nope' }, ALL).tab).toBe('comparison');
  });

  it('engine reads a comma list of known codes, once each, at most 3; none known is every engine', () => {
    expect(parseScope({ engine: 'gemini_web,chatgpt_web,gemini_web' }, ALL).engines).toEqual([
      'gemini_web',
      'chatgpt_web',
    ]);
    expect(parseScope({ engine: 'bing,gemini_web' }, ALL).engines).toEqual(['gemini_web']);
    expect(parseScope({ engine: 'bing,copilot' }, ALL).engines).toEqual([]);
    expect(parseScope({ engine: 'bing,copilot' }, ALL).engineScope).toEqual([...ALL]);
    expect(parseScope({ engine: 'chatgpt_web,gemini_web,google_ai_mode,chatgpt_web' }, ALL).engines).toHaveLength(3);
    // An engine that is off is left out, as the Citations page does
    expect(parseScope({ engine: 'google_ai_mode' }, ['chatgpt_web', 'gemini_web']).engines).toEqual([]);
  });

  it('the engines in scope are the engines that are on, in the fixed engine order', () => {
    expect(parseScope({ engine: 'google_ai_mode,chatgpt_web' }, ALL).engineScope).toEqual([
      'chatgpt_web',
      'google_ai_mode',
    ]);
    expect(parseScope({}, ['google_ai_mode', 'chatgpt_web']).engineScope).toEqual(['chatgpt_web', 'google_ai_mode']);
    expect(parseScope({}, []).engineScope).toEqual([]);
    expect(parseScope({}, []).eng).toBeNull();
  });

  it('eng reads one known code; an engine that is not in scope falls back to the first engine in scope in the fixed order', () => {
    expect(parseScope({ eng: 'gemini_web' }, ALL).eng).toBe('gemini_web');
    expect(parseScope({ eng: 'bing' }, ALL).eng).toBe('chatgpt_web');
    expect(parseScope({ eng: 'chatgpt_web', engine: 'gemini_web,google_ai_mode' }, ALL).eng).toBe('gemini_web');
    expect(parseScope({ eng: 'google_ai_mode', engine: 'gemini_web,google_ai_mode' }, ALL).eng).toBe('google_ai_mode');
    // An engine that is off is not in scope either
    expect(parseScope({ eng: 'google_ai_mode' }, ['gemini_web', 'chatgpt_web']).eng).toBe('chatgpt_web');
  });

  it('metric sov is share of voice; citation, recommendation and anything else is mention', () => {
    expect(parseScope({ metric: 'sov' }, ALL).metric).toBe('sov');
    for (const metric of ['citation', 'recommendation', 'mention', 'SOV', '']) {
      expect(parseScope({ metric }, ALL).metric).toBe('mention');
    }
  });

  it('branded include and included count branded prompts, only counts them alone, anything else leaves them out', () => {
    expect(parseScope({ branded: 'include' }, ALL).branded).toBe('included');
    expect(parseScope({ branded: 'included' }, ALL).branded).toBe('included');
    expect(parseScope({ branded: 'only' }, ALL).branded).toBe('only');
    expect(parseScope({ branded: 'yes' }, ALL).branded).toBe('excluded');
  });

  it('topic reads a UUID lowercased; anything else is no topic', () => {
    expect(parseScope({ topic: TOPIC }, ALL).topic).toBe(TOPIC.toLowerCase());
    expect(parseScope({ topic: 'pricing' }, ALL).topic).toBeNull();
    expect(parseScope({ topic: '' }, ALL).topic).toBeNull();
  });

  it('lost reads a UUID; anything else is none', () => {
    expect(parseScope({ lost: TOPIC }, ALL).lost).toBe(TOPIC.toLowerCase());
    expect(parseScope({ lost: 'hubspot' }, ALL).lost).toBeNull();
  });

  it('country reads two capitals; the table state is kept as the address writes it', () => {
    expect(parseScope({ country: 'DE' }, ALL).country).toBe('DE');
    expect(parseScope({ country: 'de' }, ALL).country).toBeNull();
    const table = parseScope({ sort: '-gap', cols: 'topic,gap', q: ' crm ', density: 'compact' }, ALL);
    expect(table).toMatchObject({ sort: '-gap', columns: 'topic,gap', query: 'crm', density: 'compact' });
    expect(parseScope({}, ALL)).toMatchObject({ sort: null, columns: null, query: null });
  });

  it('a value that does not read never throws and never writes to the address', () => {
    const search = {
      tab: '\u0000',
      engine: ',,,',
      eng: '  ',
      metric: '%',
      topic: '{}',
      branded: '[]',
      lost: 'x'.repeat(500),
      country: 'D',
      cmp: 'maybe',
      density: 'huge',
    };
    expect(() => parseScope(search, ALL)).not.toThrow();
    // The input is a plain object that parseScope only reads
    expect(search.tab).toBe('\u0000');
    // Anything but cmp=off reads as on
    expect(parseScope(search, ALL).compare).toBe(true);
    expect(parseScope({ cmp: 'off' }, ALL).compare).toBe(false);
  });
});
