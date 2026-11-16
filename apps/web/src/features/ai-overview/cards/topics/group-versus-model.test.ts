import { describe, expect, it } from 'vitest';

import { versusRows } from './group-versus-model';
import { engineCells } from './topic-card-test-kit';

const PLATFORMS = [
  { code: 'chatgpt_web', label: 'ChatGPT' },
  { code: 'gemini_web', label: 'Gemini' },
];
const OUTCOMES = (k: number) => ({ both: [k, 10], named: [0, 10], cited: [0, 10], neither: [10 - k, 10] }) as const;

const own = [
  engineCells('chatgpt_web', { mentioned: [6, 10], outcomes: OUTCOMES(6), prompts: 4 }),
  engineCells('gemini_web', {
    mentioned: [2, 3],
    outcomes: { both: [2, 3], named: [0, 3], cited: [0, 3], neither: [1, 3] },
    prompts: 4,
  }),
];
const all = [
  engineCells('chatgpt_web', { mentioned: [5, 10], outcomes: OUTCOMES(5), prompts: 20 }),
  engineCells('gemini_web', { mentioned: [3, 10], outcomes: OUTCOMES(3), prompts: 20 }),
];

const rows = (
  group: typeof own | undefined,
  everyone: typeof all | undefined,
  measure: 'visibility' | 'mention' = 'visibility',
) => versusRows({ platforms: PLATFORMS, group, all: everyone, measure, averageLabel: 'Average' });

describe('versusRows', () => {
  it('has a row per platform then the average, with the gap in whole points of the rate difference', () => {
    const result = rows(own, all);
    expect(result.map((row) => row.label)).toEqual(['ChatGPT', 'Gemini', 'Average']);
    expect(result[0]).toMatchObject({ gap: 10, group: { state: 'ok', successes: 6, answers: 10 } });
    expect(result[2]?.average).toBe(true);
  });

  it('has no rate for a platform with fewer than 4 valid answers in the group, and no gap', () => {
    const [, gemini] = rows(own, all);
    expect(gemini?.group).toMatchObject({ state: 'insufficient', value: null, answers: 3 });
    expect(gemini?.gap).toBeNull();
    expect(gemini?.all.value).toBeCloseTo(0.3);
  });

  it('averages the platforms with a rate and says how many took part, for the group and for all groups', () => {
    const average = rows(own, all)[2];
    expect(average?.group).toMatchObject({ state: 'ok', used: 1 });
    expect(average?.group.value).toBeCloseTo(0.6);
    expect(average?.all).toMatchObject({ used: 2 });
    expect(average?.all.value).toBeCloseTo(0.4);
    expect(average?.gap).toBe(20);
  });

  it('is unknown, never 0, when the group has no row or all groups are not read yet', () => {
    const noGroup = rows(undefined, all);
    expect(noGroup.every((row) => row.group.state === 'none' && row.group.value === null)).toBe(true);
    const noAll = rows(own, undefined);
    expect(noAll.every((row) => row.all.value === null && row.gap === null)).toBe(true);
  });

  it('reads the measure the page chose', () => {
    expect(rows(own, all, 'mention')[0]?.group.value).toBeCloseTo(0.6);
  });
});
