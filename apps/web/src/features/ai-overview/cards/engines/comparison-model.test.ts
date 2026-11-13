import { describe, expect, it } from 'vitest';

import { buildComparison, comparisonDomains, type ComparisonRow } from './comparison-model';
import { engineCells, promptRow, summaryOf } from './engines-fixtures';
import { buildAggregates, type OverviewAggregates } from '../../data/aggregates';
import { projectEngine } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { EngineCode, PromptsSummary } from '@/lib/api/types';
import { differenceInterval } from '@/lib/stats';

const ALL: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];
const CODES = ['chatgpt_web', 'gemini_web'] as const;

function aggregatesOf(current: PromptsSummary, previous: PromptsSummary | null): OverviewAggregates {
  return buildAggregates({
    current,
    previous,
    engines: ALL.map((code) => ({ ...projectEngine(code), is_enabled: current.engine_codes.includes(code) })),
    chosenEngines: null,
    topicsKept: null,
    sources: null,
    fanout: null,
  });
}

const summary = (
  chatgpt: [Parameters<typeof engineCells>[1], Parameters<typeof engineCells>[1]],
  gemini: [Parameters<typeof engineCells>[1], Parameters<typeof engineCells>[1]],
): PromptsSummary =>
  summaryOf(
    [
      promptRow('p1', [engineCells('chatgpt_web', chatgpt[0]), engineCells('gemini_web', gemini[0])]),
      promptRow('p2', [engineCells('chatgpt_web', chatgpt[1]), engineCells('gemini_web', gemini[1])]),
    ],
    { codes: CODES },
  );

const NOW = summary(
  [
    { mentioned: [6, 8], cited: [2, 8], shareOfVoice: [4, 8] },
    { mentioned: [4, 8], cited: [0, 8], shareOfVoice: [4, 8] },
  ],
  [
    { mentioned: [2, 8], cited: [6, 8], shareOfVoice: [2, 8] },
    { mentioned: [4, 8], cited: [4, 8], shareOfVoice: [2, 8] },
  ],
);
const BEFORE = summary(
  [
    { mentioned: [2, 8], cited: [2, 8], shareOfVoice: [2, 8] },
    { mentioned: [4, 8], cited: [2, 8], shareOfVoice: [4, 8] },
  ],
  [
    { mentioned: [2, 8], cited: [4, 8], shareOfVoice: [2, 8] },
    { mentioned: [4, 8], cited: [4, 8], shareOfVoice: [2, 8] },
  ],
);

function compared(row: ComparisonRow | undefined): Extract<ComparisonRow, { state: 'compare' }> {
  if (row?.state !== 'compare') throw new Error(`Expected a comparison, got ${row?.state ?? 'no row'}`);
  return row;
}

describe('buildComparison', () => {
  it('has a row per asked engine with both rates, their counts and the change', () => {
    const rows = buildComparison({ aggregates: aggregatesOf(NOW, BEFORE), metric: 'mention' });
    expect(rows.map((row) => row.engineCode)).toEqual(['chatgpt_web', 'gemini_web']);
    const chatgpt = compared(rows[0]);
    // The mean of the prompts' own rates: (6/8 + 4/8) / 2 now and (2/8 + 4/8) / 2 before, over the pooled answers
    expect(chatgpt.now).toMatchObject({ answers: 16, successes: 10, prompts: 2 });
    expect(chatgpt.now.value).toBeCloseTo(0.625, 12);
    expect(chatgpt.before).toMatchObject({ answers: 16, successes: 6, prompts: 2 });
    expect(chatgpt.before.value).toBeCloseTo(0.375, 12);
    expect(chatgpt.points).toBeCloseTo(0.25, 12);
  });

  it('gives mention and citation the interval of the difference and share of voice none', () => {
    const mention = compared(buildComparison({ aggregates: aggregatesOf(NOW, BEFORE), metric: 'mention' })[0]);
    expect(mention.interval).toEqual(differenceInterval({ k: 10, n: 16 }, { k: 6, n: 16 }));
    const citation = compared(buildComparison({ aggregates: aggregatesOf(NOW, BEFORE), metric: 'citation' })[0]);
    expect(citation.interval).toEqual(differenceInterval({ k: 2, n: 16 }, { k: 4, n: 16 }));
    const voice = compared(buildComparison({ aggregates: aggregatesOf(NOW, BEFORE), metric: 'share_of_voice' })[0]);
    expect(voice.interval).toBeNull();
    expect(voice.detectable).toBeNull();
    expect(voice.now.successes).toBeNull();
  });

  it('is detectable only through the aggregates verdict', () => {
    const aggregates = aggregatesOf(NOW, BEFORE);
    const [chatgpt] = buildComparison({ aggregates, metric: 'mention' });
    expect(compared(chatgpt).detectable).toBe(aggregates.engines[0]?.change.mentioned.detectable);
  });

  it('picks the cell of the metric option: citation reads the cited cell', () => {
    const [chatgpt] = buildComparison({ aggregates: aggregatesOf(NOW, BEFORE), metric: 'citation' });
    expect(compared(chatgpt).now).toMatchObject({ answers: 16, successes: 2 });
    expect(compared(chatgpt).before).toMatchObject({ answers: 16, successes: 4 });
  });

  it('says "too few answers" for an engine under 4 answers in either window, never a rate', () => {
    const thin = summary(
      [{ mentioned: [1, 3] }, { mentioned: [0, 0] }],
      [{ mentioned: [2, 8] }, { mentioned: [4, 8] }],
    );
    const rows = buildComparison({ aggregates: aggregatesOf(thin, BEFORE), metric: 'mention' });
    expect(rows[0]).toMatchObject({ engineCode: 'chatgpt_web', state: 'thin', now: 3, before: 16 });
    expect(rows[1]?.state).toBe('compare');
  });

  it('has no comparison for an engine whose window before has no answers', () => {
    const silent = summary([{}, {}], [{ mentioned: [2, 8] }, { mentioned: [4, 8] }]);
    const rows = buildComparison({ aggregates: aggregatesOf(NOW, silent), metric: 'mention' });
    expect(rows[0]?.state).toBe('none');
    expect(rows[1]?.state).toBe('compare');
  });

  it('gives domains that cover every rate and every interval of the rows drawn', () => {
    const rows = buildComparison({ aggregates: aggregatesOf(NOW, BEFORE), metric: 'mention' });
    const { rate, change } = comparisonDomains(rows);
    expect(rate[0]).toBe(0);
    expect(rate[1]).toBeCloseTo(0.7, 12);
    for (const row of rows) {
      if (row.state !== 'compare' || row.interval === null) continue;
      expect(rate[1]).toBeGreaterThanOrEqual(Math.max(row.now.value, row.before.value));
      expect(change[0]).toBeLessThanOrEqual(row.interval.low);
      expect(change[1]).toBeGreaterThanOrEqual(row.interval.high);
    }
    // No row can be drawn: the smallest domains, not a domain of nothing
    expect(comparisonDomains([])).toEqual({ rate: [0, 0.1], change: [-0.1, 0.1] });
  });

  it('has no row for an engine that is off', () => {
    const rows = buildComparison({ aggregates: aggregatesOf(NOW, BEFORE), metric: 'mention' });
    expect(rows.some((row) => row.engineCode === 'google_ai_mode')).toBe(false);
  });
});
