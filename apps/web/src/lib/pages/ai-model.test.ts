import { describe, expect, it } from 'vitest';

import {
  AI_TREND_SERIES_ID,
  alongsideKind,
  changeOf,
  citingPlatformsOf,
  periodLine,
  platformSummaryText,
  promptIdsOf,
  trendOf,
} from './ai-model';
import { AI_CITED_PAGE, pageAiOf } from '@/mocks/internal-links-page-ai';

describe('changeOf', () => {
  it('returns null when there is no compared period or it had no answers', () => {
    const uncompared = pageAiOf(AI_CITED_PAGE, { compare: 'none' });
    expect(changeOf(uncompared)).toBeNull();

    const base = pageAiOf(AI_CITED_PAGE, { compare: 'previous_period' });
    expect(changeOf({ ...base, previous_answers: 0, previous_answers_citing: 0 })).toBeNull();
  });

  it('computes positive, negative and zero deltas', () => {
    const base = pageAiOf(AI_CITED_PAGE, { compare: 'previous_period' });
    expect(changeOf(base)).toEqual({ delta: 3, previous: 11, days: 28 });
    expect(changeOf({ ...base, answers_citing: 8 })).toEqual({ delta: -3, previous: 11, days: 28 });
    expect(changeOf({ ...base, answers_citing: 11 })).toEqual({ delta: 0, previous: 11, days: 28 });
  });
});

describe('trendOf', () => {
  it('builds one series, categories in day order and table cell text', () => {
    const cited = pageAiOf(AI_CITED_PAGE, { compare: 'previous_period' });
    const trend = trendOf(cited, {
      seriesName: 'Answers that cited this page',
      cell: (citedCount, answersCount) => `${String(citedCount)} of ${String(answersCount)} answers`,
      noAnswers: 'No answers',
    });

    expect(trend.categories).toHaveLength(28);
    expect(trend.categories[0]).toBe('Oct 22');
    expect(trend.categories[27]).toBe('Nov 18');
    expect(trend.series).toEqual([
      {
        id: AI_TREND_SERIES_ID,
        name: 'Answers that cited this page',
        role: { kind: 'brand' },
        values: cited.trend.map((day) => day.answers_citing),
      },
    ]);

    // Index 2 has 2 answers, 1 citing; index 3 has 0 answers.
    expect(trend.cellText(AI_TREND_SERIES_ID, 2)).toBe('1 of 2 answers');
    expect(trend.cellText(AI_TREND_SERIES_ID, 3)).toBe('No answers');
    expect(trend.cellText('other', 2)).toBeNull();
  });
});

describe('alongsideKind', () => {
  it('distinguishes own in-crawl pages, own outside-crawl pages, competitors and third parties', () => {
    const cited = pageAiOf(AI_CITED_PAGE, { compare: 'previous_period' });
    expect(cited.alongside.map(alongsideKind)).toEqual(['page', 'competitor', 'page', 'own-outside', 'third-party']);
  });
});

describe('promptIdsOf and platform helpers', () => {
  it('keeps prompt row order', () => {
    const cited = pageAiOf(AI_CITED_PAGE, { compare: 'previous_period' });
    expect(promptIdsOf(cited)).toEqual(cited.prompts.map((prompt) => prompt.prompt_id));
  });

  it('orders citing platforms by engine order, drops zero-citing ones and formats tooltip text', () => {
    const cited = pageAiOf(AI_CITED_PAGE, { compare: 'previous_period' });
    const row = cited.prompts[1];
    if (row === undefined) throw new Error('Expected second prompt row');
    const reversed = [...row.platforms].reverse();
    const citing = citingPlatformsOf(reversed);
    expect(citing.map((platform) => platform.engine_code)).toEqual(['chatgpt_web', 'gemini_web']);
    expect(
      platformSummaryText(
        citing,
        (label, citedCount, answersCount) => `${label}: ${String(citedCount)} of ${String(answersCount)} answers`,
      ),
    ).toBe('ChatGPT: 2 of 3 answers · Gemini: 1 of 3 answers');
  });
});

describe('periodLine', () => {
  it('parses ISO business dates without timezone drift and leaves compare null when absent', () => {
    const compared = pageAiOf(AI_CITED_PAGE, { compare: 'previous_period' });
    const parsed = periodLine(compared);
    expect(parsed.start.getFullYear()).toBe(2026);
    expect(parsed.start.getMonth()).toBe(9);
    expect(parsed.start.getDate()).toBe(22);
    expect(parsed.end.getFullYear()).toBe(2026);
    expect(parsed.end.getMonth()).toBe(10);
    expect(parsed.end.getDate()).toBe(18);
    expect(parsed.compare).not.toBeNull();
    expect(parsed.compare?.start.getMonth()).toBe(8);
    expect(parsed.compare?.start.getDate()).toBe(24);
    expect(parsed.compare?.end.getMonth()).toBe(9);
    expect(parsed.compare?.end.getDate()).toBe(21);

    const plain = pageAiOf(AI_CITED_PAGE, { compare: 'none' });
    expect(periodLine(plain).compare).toBeNull();
  });
});
