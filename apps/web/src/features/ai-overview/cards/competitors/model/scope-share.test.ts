import { describe, expect, it } from 'vitest';

import { shareAcrossPlatforms } from './scope-share';
import { at, competitor, engine, entityCells, own, share, summaryOf, weighted } from './summary-fixtures';
import { trackedSetOf } from './tracked-set';

const THREE = [own(), competitor(2, 'HubSpot'), competitor(3, 'Zoho')];

/** One engine: each brand's share numerator over `answers` that name a tracked brand. */
function engineOf(code: string, numerators: readonly number[], answers: number) {
  const cells = THREE.map((entity, index) =>
    entityCells(entity, weighted(numerators[index] ?? 0, 100, [0.3]), share(numerators[index] ?? 0, answers)),
  );
  return engine(code, { share: share(numerators[0] ?? 0, answers), mentioned: weighted(30, 100, [0.3]), entities: cells });
}

const set = (summary: ReturnType<typeof summaryOf>) => trackedSetOf(summary, null);

describe('shareAcrossPlatforms', () => {
  it('reads one platform as its own shares, with the answers behind them', () => {
    const summary = summaryOf({ entities: THREE, total: [engineOf('chatgpt_web', [25, 50, 25], 100)] });
    const result = shareAcrossPlatforms(summary, ['chatgpt_web'], set(summary), false);
    if (result.status !== 'read') throw new Error('unread');
    expect(result.state).toBe('ok');
    expect(result.used).toEqual(['chatgpt_web']);
    expect(result.answers).toBe(100);
    expect(at(result.entities, 1).value).toBeCloseTo(0.5);
  });

  it('averages the platforms that have a share, each counting once, never pooling their answers', () => {
    const summary = summaryOf({
      entities: THREE,
      total: [engineOf('chatgpt_web', [40, 40, 20], 100), engineOf('gemini_web', [10, 10, 0], 20)],
    });
    const result = shareAcrossPlatforms(summary, ['chatgpt_web', 'gemini_web'], set(summary), true);
    if (result.status !== 'read') throw new Error('unread');
    expect(result.used).toEqual(['chatgpt_web', 'gemini_web']);
    // (0.4 + 0.5) / 2: pooled counts would give 50 / 120
    expect(at(result.entities, 0).value).toBeCloseTo(0.45);
    expect(at(result.entities, 2).value).toBeCloseTo(0.1);
  });

  it('leaves out a platform with fewer than 4 answers naming a tracked brand, and says how many took part', () => {
    const summary = summaryOf({
      entities: THREE,
      total: [engineOf('chatgpt_web', [40, 40, 20], 100), engineOf('gemini_web', [1, 1, 0], 3)],
    });
    const result = shareAcrossPlatforms(summary, ['chatgpt_web', 'gemini_web'], set(summary), true);
    if (result.status !== 'read') throw new Error('unread');
    expect(result.used).toEqual(['chatgpt_web']);
    expect(at(result.entities, 0).value).toBeCloseTo(0.4);
  });

  it('is insufficient, with the largest answer count and no value, when no platform has enough', () => {
    const summary = summaryOf({ entities: THREE, total: [engineOf('chatgpt_web', [1, 1, 0], 3)] });
    const result = shareAcrossPlatforms(summary, ['chatgpt_web'], set(summary), false);
    if (result.status !== 'read') throw new Error('unread');
    expect(result.state).toBe('insufficient');
    expect(result.answers).toBe(3);
    expect(result.entities.every((entry) => entry.value === null)).toBe(true);
  });

  it('is unread when the summary carries no entity cells for the platforms', () => {
    const summary = summaryOf({ entities: THREE, total: [engine('chatgpt_web')] });
    expect(shareAcrossPlatforms(summary, ['chatgpt_web'], set(summary), false).status).toBe('unread');
  });
});
