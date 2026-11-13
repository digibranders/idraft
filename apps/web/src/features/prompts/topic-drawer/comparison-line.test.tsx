import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ComparisonLine } from './comparison-line';
import { engine, projectEngine, weighted } from '@/features/prompts/topics-by-engine/cells-fixtures';
import { engineValue, type EngineValue } from '@/features/prompts/topics-by-engine/engine-values';
import type { MetricCell } from '@/lib/api/types';
import type { CellMetric } from '@/lib/rates/rate-model';
import { renderDrawerPart } from '@/test/topic-drawer-harness';

const ENGINES = [projectEngine('chatgpt_web'), projectEngine('gemini_web'), projectEngine('google_ai_mode')];
const CODES = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;

/** The values of the three engines for `metric`, each `[k, n]` or `null` for an engine with no cells at all. */
function line(counts: readonly ([number, number] | null)[], metric: CellMetric = 'mentioned') {
  const cells = counts.flatMap((count, at) => {
    if (count === null) return [];
    const cell: MetricCell = weighted(count[0], count[1], 4);
    return [engine(CODES[at] ?? 'other', { [metric]: cell })];
  });
  const values = CODES.map((code) => engineValue(cells, code, metric));
  return renderDrawerPart(<ComparisonLine values={values} metric={metric} />, { engines: ENGINES });
}

describe('ComparisonLine: what can be said of the gap between the engines', () => {
  it('says best and weakest with rates and the gap in points', () => {
    line([
      [3, 8],
      [2, 8],
    ]);
    expect(screen.getByText('Best on ChatGPT at 37.5%, weakest on Gemini at 25.0%, a gap of 12.5 pts.')).toBeVisible();
  });

  it('writes the gap as the difference of the two rates it shows, not of the exact rates', () => {
    const rated = (code: string, value: number): EngineValue => ({
      code,
      state: 'ok',
      value,
      answers: 10,
      successes: null,
      prompts: 4,
      observations: 10,
      reason: null,
    });
    // 33.337 and 11.262 percent are shown as 33.3 and 11.3: the exact gap, 22.075, would read as 22.1
    renderDrawerPart(
      <ComparisonLine values={[rated('chatgpt_web', 0.33337), rated('gemini_web', 0.11262)]} metric="share_of_voice" />,
      { engines: ENGINES },
    );
    expect(screen.getByText('Best on ChatGPT at 33.3%, weakest on Gemini at 11.3%, a gap of 22.0 pts.')).toBeVisible();
  });

  it('says within normal variation or larger, labelled unpaired on pooled answers', () => {
    const small = line([
      [5, 10],
      [4, 10],
    ]);
    expect(
      screen.getByText('The difference is within normal variation (unpaired test on pooled answers).'),
    ).toBeVisible();
    small.unmount();
    line([
      [40, 80],
      [20, 80],
    ]);
    expect(
      screen.getByText('The difference is larger than normal variation (unpaired test on pooled answers).'),
    ).toBeVisible();
  });

  it('gives no test for share of voice, and none when an engine has too few answers', () => {
    const share = line(
      [
        [40, 80],
        [20, 80],
      ],
      'share_of_voice',
    );
    expect(screen.getByText('No test is given for share of voice.')).toBeVisible();
    expect(screen.queryByText(/unpaired test/)).toBeNull();
    share.unmount();
    line([
      [40, 80],
      [20, 80],
      [1, 3],
    ]);
    expect(screen.getByText('Too few answers to test the difference.')).toBeVisible();
  });

  it('names the engines left out', () => {
    line([[40, 80], [20, 80], null]);
    expect(screen.getByText('Left out for too few answers: Google AI Mode.')).toBeVisible();
    // The best and weakest are still compared
    expect(screen.getByText(/^Best on ChatGPT at 50.0%, weakest on Gemini at 25.0%/)).toBeVisible();
  });

  it('says there is nothing to compare under 2 engines', () => {
    line([[3, 8], null, [1, 3]]);
    expect(screen.getByText('Fewer than 2 engines have a rate, so there is nothing to compare.')).toBeVisible();
    expect(screen.getByText('Left out for too few answers: Gemini and Google AI Mode.')).toBeVisible();
    expect(screen.queryByText(/Best on/)).toBeNull();
  });

  it('says no engine names the brand', () => {
    line([
      [0, 8],
      [0, 8],
    ]);
    expect(screen.getByText('No engine names the brand in this topic.')).toBeVisible();
  });

  it('says every engine is at the same rate', () => {
    line([
      [4, 8],
      [4, 8],
    ]);
    expect(screen.getByText('Every engine with a rate is at 50.0%.')).toBeVisible();
  });

  it('never writes a rate of 0 for an engine without data', () => {
    const { container } = line([[3, 8], null, null]);
    expect(container.textContent).not.toMatch(/0%/);
    expect(container.textContent).not.toMatch(/Gemini at/);
  });
});
