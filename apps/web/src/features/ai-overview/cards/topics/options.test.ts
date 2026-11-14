import { describe, expect, it } from 'vitest';

import { countOf, engineOf, enumOf, metricOf } from './options';

describe('metricOf', () => {
  it('maps the three catalog values', () => {
    expect(metricOf('mention')).toBe('mention');
    expect(metricOf('citation')).toBe('citation');
    expect(metricOf('share_of_voice')).toBe('share_of_voice');
  });

  it('an unknown value falls back to the catalog default', () => {
    expect(metricOf('')).toBe('mention');
    expect(metricOf('sov')).toBe('mention');
    expect(metricOf('Mention')).toBe('mention');
  });
});

describe('countOf', () => {
  it('reads 5, 10, 20 and falls back', () => {
    expect(countOf('5', 10)).toBe(5);
    expect(countOf('10', 5)).toBe(10);
    expect(countOf('20', 5)).toBe(20);
    expect(countOf('many', 10)).toBe(10);
    expect(countOf('', 10)).toBe(10);
    expect(countOf('0', 10)).toBe(10);
    expect(countOf('-5', 10)).toBe(10);
    expect(countOf('2.5', 10)).toBe(10);
  });
});

describe('engineOf', () => {
  it('accepts the three engine codes and falls back to ChatGPT', () => {
    expect(engineOf('chatgpt_web')).toBe('chatgpt_web');
    expect(engineOf('gemini_web')).toBe('gemini_web');
    expect(engineOf('google_ai_mode')).toBe('google_ai_mode');
    expect(engineOf('perplexity')).toBe('chatgpt_web');
    expect(engineOf('')).toBe('chatgpt_web');
  });
});

describe('enumOf', () => {
  it('returns the allowed value or the fallback', () => {
    expect(enumOf('down', ['both', 'up', 'down'] as const, 'both')).toBe('down');
    expect(enumOf('sideways', ['both', 'up', 'down'] as const, 'both')).toBe('both');
  });
});
