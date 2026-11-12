import { describe, expect, it } from 'vitest';

import { markSrc } from './marks';
import { byEngineOrder, ENGINE_ORDER } from './order';

describe('engine order', () => {
  it('puts engines in the fixed order with unknown codes last', () => {
    const items = [
      { code: 'perplexity_web' },
      { code: 'google_ai_overview' },
      { code: 'gemini_web' },
      { code: 'chatgpt_web' },
      { code: 'claude_web' },
      { code: 'google_ai_mode' },
    ];
    expect(byEngineOrder(items, (item) => item.code).map((item) => item.code)).toEqual([
      ...ENGINE_ORDER,
      'perplexity_web',
      'claude_web',
    ]);
  });

  it('does not change the list it is given', () => {
    const items = [{ code: 'gemini_web' }, { code: 'chatgpt_web' }];
    byEngineOrder(items, (item) => item.code);
    expect(items.map((item) => item.code)).toEqual(['gemini_web', 'chatgpt_web']);
  });
});

describe('markSrc', () => {
  it('accepts the URL string a test runner gives and the { src } object Next gives', () => {
    expect(markSrc('/a.svg')).toBe('/a.svg');
    expect(markSrc({ src: '/b.svg', width: 24, height: 24 })).toBe('/b.svg');
  });

  it('throws on any other shape', () => {
    expect(() => markSrc(undefined)).toThrow('Unexpected SVG import shape');
    expect(() => markSrc(null)).toThrow('Unexpected SVG import shape');
    expect(() => markSrc({ src: 3 })).toThrow('Unexpected SVG import shape');
  });
});
