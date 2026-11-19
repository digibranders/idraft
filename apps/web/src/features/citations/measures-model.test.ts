import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { measureSlots, type MeasureInput } from './measures-model';
import messages from '../../../messages/en.json';
import type { CitationOverview } from '@/lib/citations/board-queries';

const t = createTranslator({ locale: 'en', messages, namespace: 'citations' });
const PREVIOUS = { full: 'the previous 4 runs (Aug 10 to Aug 31)', short: 'the previous 4 runs' };

const engine = (
  code: 'chatgpt_web' | 'gemini_web',
  [answers, citing, prompts, promptsCiting]: readonly [number, number, number, number],
  [pAnswers, pCiting, pPrompts, pPromptsCiting]: readonly [number, number, number, number],
): CitationOverview['engines'][number] => ({
  engine_code: code,
  answers,
  answers_citing: citing,
  prompts,
  prompts_citing: promptsCiting,
  previous_answers: pAnswers,
  previous_answers_citing: pCiting,
  previous_prompts: pPrompts,
  previous_prompts_citing: pPromptsCiting,
});

const OVERVIEW: CitationOverview = {
  citations: 60,
  previous_citations: 50,
  matched_citations: 58,
  matched_previous_citations: 49,
  matched_pairs: 60,
  own_urls: 8,
  previous_own_urls: 6,
  domains: 20,
  previous_domains: 20,
  engines: [
    engine('chatgpt_web', [100, 25, 40, 20], [100, 20, 40, 16]),
    engine('gemini_web', [50, 5, 30, 6], [50, 5, 30, 6]),
  ],
  window: {
    runs: 4,
    timezone: 'Europe/Berlin',
    current: [],
    previous: [],
    trend: [],
    answers: 150,
    prompts: 45,
    latest_answer_at: '2026-09-28T00:15:00.000Z',
    latest_run_number: 48,
  },
};
const ALL: MeasureInput = { overview: OVERVIEW, allPlatforms: true, ownDomain: 'fynix.digital', previous: PREVIOUS };
const slot = (input: MeasureInput, id: string) => {
  const found = measureSlots(input, t).find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No slot ${id}`);
  return found;
};

describe('the six Citations measures (C 244 to 257)', () => {
  it('names the six slots in order', () => {
    expect(measureSlots(ALL, t).map((item) => item.label)).toEqual([
      'Total citations',
      'Citation rate',
      'Prompt coverage',
      'Unique cited URLs',
      'Unique cited domains',
      'Citation growth',
    ]);
  });

  it.each([
    [
      'citations',
      '60',
      'How many times AI answers cite a page of your site. In 150 answers. Citations of fynix.digital pages in 150 answers to 45 prompts. One URL in one answer’s list of citations counts once. An answer that cites two of your pages counts twice.',
    ],
    [
      'frequency',
      '17.5%',
      'The share of answers that cite your site at least once. Average of 2 platforms. 30 of 150 answers cite you, summed over the platforms. The rate is their equal-weight average. Change against the previous 4 runs (Aug 10 to Aug 31). Answers that cite you, divided by all valid answers. Over All platforms it is the equal-weight average of the platforms, never pooled.',
    ],
    [
      'coverage',
      '35.0%',
      'The share of tracked prompts that cite your site at least once in these runs. Average of 2 platforms. 26 of 70 prompts cite you, summed over the platforms. The rate is their equal-weight average. Change against the previous 4 runs (Aug 10 to Aug 31). Prompts with at least one answer citing you, divided by prompts with an answer. Over All platforms it is the equal-weight average of the platforms.',
    ],
    [
      'urls',
      '8',
      'How many different pages of your site AI answers cite. Pages of fynix.digital. Distinct URLs on fynix.digital in the citation lists of the answers in scope.',
    ],
    [
      'domains',
      '20',
      'How many different domains AI answers cite for your prompts: the field you compete in for citations. In answers to your prompts. Distinct domains in the citation lists of the answers in scope, your site included.',
    ],
    [
      'growth',
      '+20.0%',
      'How total citations changed against the same number of runs before. +10 vs the previous 4 runs. 60 citations now, 50 in the previous 4 runs (Aug 10 to Aug 31). Total citations now minus before, divided by before. Not tested for detectability.',
    ],
  ])('derives the %s slot over All platforms', (id, value, hint) => {
    const item = slot(ALL, id);
    expect(item.value).toBe(value);
    expect(item.hint).toBe(hint);
    expect(item.spoken).toBe(`${item.label}: ${value}. ${hint}`);
  });

  it('gives the rates a trend delta, neutral while it is not detectable (rule 6)', () => {
    expect(slot(ALL, 'frequency').delta).toEqual({
      kind: 'points',
      input: { value: expect.closeTo(0.025, 10), unit: 'points', polarity: 'higher_is_better', isDetectable: false },
      tip: 'Up 2.5 pts against the previous period, from 15% to 18%. Within normal variation.',
      spoken: 'Up 2.5 pts, within normal variation',
    });
  });

  it('gives a changed count a neutral signed delta, and nothing when it is equal', () => {
    expect(slot(ALL, 'urls').delta).toEqual({
      kind: 'count',
      text: '+2',
      tip: '6 before. Counts are not tested for detectability',
    });
    expect(slot(ALL, 'domains').delta).toBeNull();
    expect(slot(ALL, 'citations').delta).toBeNull();
    expect(slot(ALL, 'growth').delta).toBeNull();
  });

  it('counts one platform as k of n (C 246 to 247)', () => {
    const one: MeasureInput = {
      ...ALL,
      allPlatforms: false,
      overview: { ...OVERVIEW, engines: OVERVIEW.engines.slice(0, 1) },
    };
    expect(slot(one, 'frequency').value).toBe('25.0%');
    expect(slot(one, 'frequency').hint).toContain(' 25 of 100 answers. 25 of 100 answers cite you. Change against');
    expect(slot(one, 'coverage').hint).toContain(' 20 of 40 prompts. 20 of 40 prompts cite you. Change against');
    expect(slot(one, 'frequency').delta).toMatchObject({
      tip: 'Up 5.0 pts against the previous period, from 20% to 25%. Within normal variation.',
    });
  });

  it('reads n/a with no answers and no previous citations', () => {
    const none: MeasureInput = {
      ...ALL,
      overview: {
        ...OVERVIEW,
        citations: 0,
        previous_citations: 0,
        engines: [engine('chatgpt_web', [0, 0, 0, 0], [0, 0, 0, 0])],
      },
    };
    expect(slot(none, 'frequency')).toMatchObject({ value: 'n/a', unknown: true, delta: null });
    expect(slot(none, 'frequency').hint).toBe(
      'The share of answers that cite your site at least once. No answers. Answers that cite you, divided by all valid answers. Over All platforms it is the equal-weight average of the platforms, never pooled.',
    );
    expect(slot(none, 'growth')).toMatchObject({ value: 'n/a', unknown: true });
  });

  it('colors a detectable change through formatMetricDelta', () => {
    const big: MeasureInput = {
      ...ALL,
      allPlatforms: false,
      overview: { ...OVERVIEW, engines: [engine('chatgpt_web', [1000, 400, 100, 60], [1000, 200, 100, 40])] },
    };
    expect(slot(big, 'frequency').delta).toMatchObject({
      input: { isDetectable: true },
      spoken: 'Up 20.0 pts, detectable change',
    });
  });
});
