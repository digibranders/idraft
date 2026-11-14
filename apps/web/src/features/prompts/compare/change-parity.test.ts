import { describe, expect, it } from 'vitest';

import { cell, cellsOf, topicCell } from './change-test-data';
import { engineChange } from '@/features/prompts/topics-by-engine/engine-values';
import type { EngineSummary, MetricCell } from '@/lib/api/types';
import { engineChangeOf } from '@/lib/compare/change-model';
import type { CellMetric } from '@/lib/rates/rate-model';

/** The same three cells in both windows: what a row of the summary carries for an engine. */
const row = (now: MetricCell, before: MetricCell | null): EngineSummary => {
  const full = (value: MetricCell) => ({ ...cellsOf(value, value), cited: value });
  return { engine_code: 'chatgpt_web', ...full(now), previous: before === null ? null : full(before) };
};

const CASES: readonly (readonly [string, EngineSummary[] | undefined])[] = [
  ['a detectable rise', [row(cell(30, 60), cell(12, 60))]],
  ['a detectable fall', [row(cell(12, 60), cell(30, 60))]],
  ['a change within normal variation', [row(cell(31, 60), cell(27, 60))]],
  ['no change at all', [row(cell(30, 60), cell(30, 60))]],
  ['a rate under 4 answers now', [row(cell(1, 3), cell(12, 60))]],
  ['a rate under 4 answers before', [row(cell(30, 60), cell(2, 3))]],
  ['no answer before', [row(cell(30, 60), cell(0, 0))]],
  ['no previous period', [row(cell(30, 60), null)]],
  [
    'topic cells whose weighted points and pooled answers move apart',
    [row({ ...topicCell(30, 100, 5), value: 0.55 }, { ...topicCell(60, 100, 4), value: 0.5 })],
  ],
  ['no cells', undefined],
];
const METRICS: readonly CellMetric[] = ['mentioned', 'cited', 'share_of_voice'];

describe('rateChange and the engine change of the By engine views', () => {
  for (const metric of METRICS) {
    it.each(CASES)(`gives the same points and verdict for ${metric}, %s`, (_name, cells) => {
      const theirs = engineChange(cells, 'chatgpt_web', metric);
      const ours = engineChangeOf(cells, 'chatgpt_web', metric);
      if (theirs === null) {
        expect(ours).toBeNull();
        return;
      }
      expect(ours?.points).toBeCloseTo(theirs.points, 10);
      expect(ours?.detectable).toBe(theirs.detectable);
    });
  }
});
