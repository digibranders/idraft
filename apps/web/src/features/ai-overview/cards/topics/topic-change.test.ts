import { describe, expect, it } from 'vitest';

import type { TopicNode } from './model-types';
import { attachPrevious, commonPrompts, topicChange } from './topic-change';
import { cell, engine, promptRow, weighted } from '@/features/prompts/topics-by-engine/cells-fixtures';
import { engineChangeOf } from '@/lib/compare/change-model';
import { isDetectableChange } from '@/lib/stats';

const nodeOf = (key: string, engines: ReturnType<typeof engine>[]): TopicNode => ({
  key,
  termId: key,
  name: key,
  path: [key],
  parentKey: null,
  level: 1,
  promptCount: 3,
  engines,
  members: null,
  lastValidAt: null,
  children: [],
});

/** Mentioned of a topic: `k` of `n` valid answers over 3 prompts. */
const mentioned = (k: number, n: number): ReturnType<typeof engine> =>
  engine('chatgpt_web', { mentioned: weighted(k, n, 3) });

describe('attachPrevious', () => {
  it('sets previous from the other window for the same engine', () => {
    const now = [mentioned(6, 10)];
    const before = [engine('chatgpt_web', { mentioned: weighted(3, 10, 3), cited: cell(2, 10) })];
    const [joined] = attachPrevious(now, before);
    expect(joined?.previous?.mentioned).toEqual(before[0]?.mentioned);
    expect(joined?.previous?.cited).toEqual(before[0]?.cited);
    expect(joined?.previous?.share_of_voice).toEqual(before[0]?.share_of_voice);
    expect(joined?.previous?.outcomes).toEqual(before[0]?.outcomes);
    // The current cells are the ones of now
    expect(joined?.mentioned).toEqual(now[0]?.mentioned);
  });

  it('an engine absent from the other window gets no previous', () => {
    const now = [mentioned(6, 10), engine('gemini_web', { mentioned: weighted(6, 10, 3) })];
    const joined = attachPrevious(now, [mentioned(3, 10)]);
    expect(joined[0]?.previous).not.toBeNull();
    expect(joined[1]?.previous ?? null).toBeNull();
  });

  it('no previous window gives cells unchanged', () => {
    const now = [mentioned(6, 10)];
    const joined = attachPrevious(now, undefined);
    expect(joined).toEqual(now);
    expect(joined[0]).not.toHaveProperty('previous');
    // The input is not changed
    expect(now[0]).not.toHaveProperty('previous');
  });

  it('the change of the joined cells equals engineChangeOf on cells that carry previous natively', () => {
    const before = engine('chatgpt_web', { mentioned: weighted(3, 10, 3) });
    const native = engine('chatgpt_web', {
      mentioned: weighted(6, 10, 3),
      previous: { mentioned: weighted(3, 10, 3) },
    });
    const joined = attachPrevious([mentioned(6, 10)], [before]);
    expect(engineChangeOf(joined, 'chatgpt_web', 'mentioned')).toEqual(
      engineChangeOf([native], 'chatgpt_web', 'mentioned'),
    );
    expect(engineChangeOf(joined, 'chatgpt_web', 'mentioned')).not.toBeNull();
  });
});

describe('topicChange', () => {
  it('is the move of the rate in points, with the counts of both sides', () => {
    const change = topicChange(
      nodeOf('a', [mentioned(6, 10)]),
      nodeOf('a', [mentioned(3, 10)]),
      'chatgpt_web',
      'mentioned',
    );
    expect(change?.points).toBeCloseTo(0.3, 12);
    expect(change?.now).toMatchObject({ answers: 10, successes: 6, prompts: 3 });
    expect(change?.before).toMatchObject({ answers: 10, successes: 3, prompts: 3 });
  });

  it('a change is null when either side has under 4 answers (never 0)', () => {
    const thin = nodeOf('a', [mentioned(1, 3)]);
    const full = nodeOf('a', [mentioned(6, 10)]);
    expect(topicChange(full, thin, 'chatgpt_web', 'mentioned')).toBeNull();
    expect(topicChange(thin, full, 'chatgpt_web', 'mentioned')).toBeNull();
    // No node in the other window, or an engine without cells there
    expect(topicChange(full, undefined, 'chatgpt_web', 'mentioned')).toBeNull();
    expect(topicChange(full, nodeOf('a', []), 'chatgpt_web', 'mentioned')).toBeNull();
  });

  it('detectable comes from isDetectableChange on pooled counts and is null for share of voice', () => {
    const now = nodeOf('a', [mentioned(90, 100)]);
    const before = nodeOf('a', [mentioned(10, 100)]);
    const change = topicChange(now, before, 'chatgpt_web', 'mentioned');
    expect(change?.detectable).toBe(isDetectableChange({ k: 90, n: 100 }, { k: 10, n: 100 }));
    expect(change?.detectable).toBe(true);
    const share = (k: number, n: number): ReturnType<typeof engine> =>
      engine('chatgpt_web', { mentioned: weighted(k, n, 3), share_of_voice: cell(k, n) });
    const shareChange = topicChange(
      nodeOf('a', [share(90, 100)]),
      nodeOf('a', [share(10, 100)]),
      'chatgpt_web',
      'share_of_voice',
    );
    expect(shareChange).not.toBeNull();
    expect(shareChange?.detectable).toBeNull();
  });
});

describe('commonPrompts', () => {
  const row = (id: string): ReturnType<typeof promptRow> => promptRow(id, id, []);

  it('counts prompt ids in both windows', () => {
    expect(commonPrompts([row('a'), row('b'), row('c')], [row('b'), row('c'), row('d')])).toEqual({ both: 2, now: 3 });
    expect(commonPrompts([row('a')], [row('z')])).toEqual({ both: 0, now: 1 });
  });

  it('is null when either side is absent', () => {
    expect(commonPrompts(null, [row('a')])).toBeNull();
    expect(commonPrompts([row('a')], null)).toBeNull();
  });
});
