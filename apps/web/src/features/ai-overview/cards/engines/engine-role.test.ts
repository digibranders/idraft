import { describe, expect, it } from 'vitest';

import { engineChartColor, engineLabel, engineRole, inCatalogOrder } from './engine-role';
import { engineRole as promptsEngineRole } from '@/features/prompts/history-model';

describe('engineRole', () => {
  it('ChatGPT is the brand role, Gemini palette 2, AI Mode palette 3, any other engine is other', () => {
    expect(engineRole('chatgpt_web')).toEqual({ kind: 'brand' });
    expect(engineRole('gemini_web')).toEqual({ kind: 'palette', index: 2 });
    expect(engineRole('google_ai_mode')).toEqual({ kind: 'palette', index: 3 });
    expect(engineRole('perplexity_web')).toEqual({ kind: 'other' });
  });

  it('gives AI Overview the chart-4 role of design system 14 section 4', () => {
    expect(engineRole('google_ai_overview')).toEqual({ kind: 'palette', index: 4 });
  });

  it('is the same as the role of the Prompts page for the three engines it knows (parity guard: this is a copy)', () => {
    // The Prompts page has no AI Overview role yet (follow-up of the coordinator): only the three live engines
    for (const code of ['chatgpt_web', 'gemini_web', 'google_ai_mode', 'perplexity_web']) {
      expect(engineRole(code)).toEqual(promptsEngineRole(code));
    }
  });
});

describe('engineChartColor', () => {
  it('gives chart-1, chart-2, chart-3 by the place of the engine, and chart-other for another', () => {
    expect(engineChartColor('chatgpt_web')).toBe('chart-1');
    expect(engineChartColor('gemini_web')).toBe('chart-2');
    expect(engineChartColor('google_ai_mode')).toBe('chart-3');
    expect(engineChartColor('google_ai_overview')).toBe('chart-4');
    expect(engineChartColor('perplexity_web')).toBe('chart-other');
  });
});

describe('engineLabel', () => {
  it('reads the catalog and never the code', () => {
    expect(engineLabel('chatgpt_web')).toBe('ChatGPT');
    expect(engineLabel('gemini_web')).toBe('Gemini');
    expect(engineLabel('google_ai_mode')).toBe('AI Mode');
    expect(engineLabel('perplexity_web')).toBeNull();
  });
});

describe('inCatalogOrder', () => {
  it('keeps the engines named, once each, in the order of the catalog whatever the order given', () => {
    expect(inCatalogOrder(['google_ai_mode', 'chatgpt_web'])).toEqual(['chatgpt_web', 'google_ai_mode']);
    expect(inCatalogOrder(['gemini_web', 'gemini_web'])).toEqual(['gemini_web']);
    expect(inCatalogOrder([])).toEqual([]);
  });
});
