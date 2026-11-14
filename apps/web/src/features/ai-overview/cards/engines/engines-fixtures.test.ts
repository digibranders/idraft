import { describe, expect, it } from 'vitest';

import { cell, engineCells, promptRow, summaryOf, week } from './engines-fixtures';
import { buildAggregates } from '../../data/aggregates';
import { projectEngine } from '@/features/prompts/topics-by-engine/cells-fixtures';
import { engineRates } from '@/lib/rates/strip-model';

describe('engines fixtures', () => {
  it('a cell is k over n, counts k of n and has no value for n of 0', () => {
    expect(cell(3, 8)).toMatchObject({ value: 0.375, numerator: 3, denominator: 8, n_observations: 8, pooled: null });
    expect(cell(0, 0).value).toBeNull();
    expect(cell(3, 8, 10).n_observations).toBe(10);
  });

  it('promptRow keeps the engines it is given, under the id and text given', () => {
    const row = promptRow('p1', [engineCells('chatgpt_web', { mentioned: [2, 4] })], { text: 'best crm' });
    expect(row).toMatchObject({ prompt_id: 'p1', text: 'best crm', is_branded: false, topic_term_ids: [] });
    expect(row.engines).toHaveLength(1);
    expect(row.engines[0]?.mentioned).toMatchObject({ numerator: 2, denominator: 4, value: 0.5 });
  });

  it('engineCells has an empty cell, never a missing one, for a metric left out', () => {
    const cells = engineCells('gemini_web', { cited: [1, 5] });
    expect(cells.cited.value).toBe(0.2);
    expect(cells.mentioned).toMatchObject({ value: null, denominator: 0 });
    expect(cells.outcomes.mentioned_and_cited.denominator).toBe(0);
  });

  it('engineCells writes the four outcome cells and the weekly series it is given', () => {
    const cells = engineCells('chatgpt_web', {
      outcomes: { mentionedAndCited: [2, 8], neither: [3, 8] },
      series: [week('2026-11-02', { mentioned: [1, 4], prompts: 1 })],
    });
    expect(cells.outcomes.mentioned_and_cited.numerator).toBe(2);
    expect(cells.outcomes.neither.numerator).toBe(3);
    expect(cells.outcomes.cited_only.denominator).toBe(0);
    expect(cells.series?.[0]).toMatchObject({ week_start: '2026-11-02', is_pooled: false, prompts: 1 });
  });

  it('summaryOf builds a PromptsSummary the aggregates accept', () => {
    const prompts = [
      promptRow('p1', [engineCells('chatgpt_web', { mentioned: [2, 4] })]),
      promptRow('p2', [engineCells('chatgpt_web', { mentioned: [4, 4] })]),
    ];
    const summary = summaryOf(prompts);
    expect(summary.engine_codes).toEqual(['chatgpt_web']);
    expect(summary.window).toEqual({ from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' });
    const aggregates = buildAggregates({
      current: summary,
      previous: null,
      engines: [projectEngine('chatgpt_web')],
      chosenEngines: null,
      topicsKept: null,
      sources: null,
      fanout: null,
    });
    expect(aggregates.promptCount).toBe(2);
    expect(aggregates.engines[0]?.mentioned).toEqual(engineRates(prompts, 'chatgpt_web').mentioned);
    expect(aggregates.engines[0]?.mentioned).toMatchObject({ value: 0.75, answers: 8, successes: 6, prompts: 2 });
  });
});
