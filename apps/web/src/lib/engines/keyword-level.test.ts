import { describe, expect, it } from 'vitest';

import { hasSummaryAnswers, isKeywordLevelEngine } from './keyword-level';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';

describe('keyword level platforms', () => {
  it('has Google AI Overview as the only keyword level platform, and the only one with summary answers', () => {
    expect(isKeywordLevelEngine(ENGINE_FACTS.google_ai_overview)).toBe(true);
    expect(hasSummaryAnswers(ENGINE_FACTS.google_ai_overview)).toBe(true);
  });

  it('keeps the platforms asked per prompt out of both', () => {
    for (const code of ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const) {
      expect(isKeywordLevelEngine(ENGINE_FACTS[code])).toBe(false);
      expect(hasSummaryAnswers(ENGINE_FACTS[code])).toBe(false);
    }
  });
});
