import { describe, expect, it } from 'vitest';

import type { TopicNode } from './model-types';
import { moversModel, type MoverRow } from './movers-model';
import { NO_TOPIC } from './topic-nodes';
import { engine, promptRow, weighted } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { PromptSummaryRow } from '@/lib/api/types';

const CODE = 'chatgpt_web';
const OTHER = 'gemini_web';
type Pair = readonly [k: number, n: number];

/** A leaf topic with Mentioned `k` of `n` valid answers over 5 prompts on every engine given. */
function leaf(
  name: string,
  counts: Partial<Record<string, Pair>>,
  members: readonly PromptSummaryRow[] | null = null,
  over: Partial<TopicNode> = {},
): TopicNode {
  return {
    key: name,
    termId: name,
    name,
    path: [name],
    parentKey: null,
    level: 1,
    promptCount: 5,
    engines: Object.entries(counts).flatMap(([code, pair]) =>
      pair === undefined ? [] : [engine(code, { mentioned: weighted(pair[0], pair[1], 5) })],
    ),
    members,
    lastValidAt: null,
    children: [],
    ...over,
  };
}

const before = (...nodes: TopicNode[]): Map<string, TopicNode> => new Map(nodes.map((node) => [node.key, node]));
const names = (rows: readonly MoverRow[]): string[] => rows.map((row) => row.node.name);

/** Now and before for one topic: 80 of 100 against 40 of 100 is a detectable gain of 40 points. */
const GAIN = { now: [80, 100], before: [40, 100] } as const;

describe('moversModel', () => {
  it('a change needs a rate on both sides', () => {
    const model = moversModel(
      [
        leaf('Thin now', { [CODE]: [3, 3] }),
        leaf('Thin before', { [CODE]: [8, 10] }),
        leaf('No cells now', {}),
        leaf('Fine', { [CODE]: [80, 100] }),
      ],
      before(
        leaf('Thin now', { [CODE]: [8, 10] }),
        leaf('Thin before', { [CODE]: [2, 3] }),
        leaf('No cells now', { [CODE]: [8, 10] }),
        leaf('Fine', { [CODE]: [40, 100] }),
      ),
      [CODE],
      'mentioned',
      'both',
      5,
    );
    expect(names(model.listed)).toEqual(['Fine']);
    expect(model.incomparable).toBe(3);
    expect(model.quiet).toBe(0);
  });

  it('a topic absent from the previous window is not compared (never 0)', () => {
    const model = moversModel([leaf('New topic', { [CODE]: [9, 10] })], before(), [CODE], 'mentioned', 'both', 5);
    expect(model.listed).toEqual([]);
    expect(model.quiet).toBe(0);
    expect(model.incomparable).toBe(1);
  });

  it('without a previous window nothing is compared', () => {
    const model = moversModel([leaf('A', { [CODE]: [9, 10] })], null, [CODE], 'mentioned', 'both', 5);
    expect(model).toMatchObject({ listed: [], quiet: 0, incomparable: 1 });
  });

  it('detectable moves come first ordered by absolute points', () => {
    const model = moversModel(
      [
        leaf('Small', { [CODE]: [52, 100] }),
        leaf('Gain', { [CODE]: GAIN.now }),
        leaf('Loss', { [CODE]: [20, 100] }),
        leaf('Tiny gain', { [CODE]: [90, 100] }),
      ],
      before(
        leaf('Small', { [CODE]: [50, 100] }),
        leaf('Gain', { [CODE]: GAIN.before }),
        leaf('Loss', { [CODE]: [75, 100] }),
        leaf('Tiny gain', { [CODE]: [50, 100] }),
      ),
      [CODE],
      'mentioned',
      'both',
      5,
    );
    // Loss is 55 points, Tiny gain 40 and Gain 40: a tie goes to the name
    expect(names(model.listed)).toEqual(['Loss', 'Gain', 'Tiny gain']);
    expect(model.listed.every((row) => row.change.detectable === true)).toBe(true);
  });

  it('the others fold into one counted line', () => {
    const model = moversModel(
      [
        leaf('Gain', { [CODE]: GAIN.now }),
        leaf('Quiet one', { [CODE]: [52, 100] }),
        leaf('Quiet two', { [CODE]: [48, 100] }),
      ],
      before(
        leaf('Gain', { [CODE]: GAIN.before }),
        leaf('Quiet one', { [CODE]: [50, 100] }),
        leaf('Quiet two', { [CODE]: [50, 100] }),
      ),
      [CODE],
      'mentioned',
      'both',
      5,
    );
    expect(names(model.listed)).toEqual(['Gain']);
    expect(model.quiet).toBe(2);
    expect(model.compared).toBe(3);
  });

  it('direction up keeps only gains and down only losses', () => {
    const now = [
      leaf('Gain', { [CODE]: GAIN.now }),
      leaf('Loss', { [CODE]: [20, 100] }),
      leaf('Quiet up', { [CODE]: [52, 100] }),
      leaf('Quiet down', { [CODE]: [48, 100] }),
    ];
    const earlier = before(
      leaf('Gain', { [CODE]: GAIN.before }),
      leaf('Loss', { [CODE]: [75, 100] }),
      leaf('Quiet up', { [CODE]: [50, 100] }),
      leaf('Quiet down', { [CODE]: [50, 100] }),
    );
    const up = moversModel(now, earlier, [CODE], 'mentioned', 'up', 5);
    expect(names(up.listed)).toEqual(['Gain']);
    expect(up.quiet).toBe(1);
    const down = moversModel(now, earlier, [CODE], 'mentioned', 'down', 5);
    expect(names(down.listed)).toEqual(['Loss']);
    expect(down.quiet).toBe(1);
  });

  it('rows are topic and engine pairs, cut to the row count with the rest counted', () => {
    const now = [
      leaf('Alpha', { [CODE]: GAIN.now, [OTHER]: [20, 100] }),
      leaf('Beta', { [CODE]: GAIN.now, [OTHER]: GAIN.now }),
    ];
    const earlier = before(
      leaf('Alpha', { [CODE]: GAIN.before, [OTHER]: [75, 100] }),
      leaf('Beta', { [CODE]: GAIN.before, [OTHER]: GAIN.before }),
    );
    const all = moversModel(now, earlier, [CODE, OTHER], 'mentioned', 'both', 10);
    expect(all.listed.map((row) => row.id)).toEqual([
      'Alpha:gemini_web',
      'Alpha:chatgpt_web',
      'Beta:chatgpt_web',
      'Beta:gemini_web',
    ]);
    const cut = moversModel(now, earlier, [CODE, OTHER], 'mentioned', 'both', 3);
    expect(cut.listed).toHaveLength(3);
    expect(cut.hidden).toBe(1);
  });

  it('an estimate outside its pooled interval is not drawn with an interval', () => {
    // The weighted rates move by 40 points while the pooled answers do not move at all: the interval of the
    // pooled counts is around 0, so the estimate is outside it and no interval is made up for it
    const skewed = (value: number): TopicNode => {
      const cell = weighted(50, 100, 5);
      return leaf('Skewed', {}, null, {
        engines: [engine(CODE, { mentioned: { ...cell, value, numerator: value * 5 } })],
      });
    };
    const model = moversModel([skewed(0.9)], before(skewed(0.5)), [CODE], 'mentioned', 'both', 5);
    const [row] = model.listed;
    expect(row?.change.points).toBeCloseTo(0.4);
    expect(row?.interval).toBeNull();
    // A change that agrees with its counts has one
    const agreed = moversModel(
      [leaf('Gain', { [CODE]: GAIN.now })],
      before(leaf('Gain', { [CODE]: GAIN.before })),
      [CODE],
      'mentioned',
      'both',
      5,
    );
    const interval = agreed.listed[0]?.interval;
    expect(interval).not.toBeNull();
    expect(interval?.low).toBeLessThan(0.4);
    expect(interval?.high).toBeGreaterThan(0.4);
  });

  it('share of voice has no test, so its rows are listed after the detectable ones with no interval', () => {
    const sov = (k: number, n: number): ReturnType<typeof engine>[] => [
      engine(CODE, { share_of_voice: weighted(k, n, 5), mentioned: weighted(k, n, 5) }),
    ];
    const model = moversModel(
      [leaf('A', {}, null, { engines: sov(60, 100) })],
      before(leaf('A', {}, null, { engines: sov(40, 100) })),
      [CODE],
      'share_of_voice',
      'both',
      5,
    );
    expect(model.listed).toHaveLength(1);
    expect(model.listed[0]?.change.detectable).toBeNull();
    expect(model.listed[0]?.interval).toBeNull();
    expect(model.quiet).toBe(0);
  });

  it('commonPrompts words: same N prompts or X of N', () => {
    const p = (id: string): PromptSummaryRow => promptRow(id, id, ['A']);
    const same = moversModel(
      [leaf('Same', { [CODE]: GAIN.now }, [p('1'), p('2')])],
      before(leaf('Same', { [CODE]: GAIN.before }, [p('1'), p('2')])),
      [CODE],
      'mentioned',
      'both',
      5,
    );
    expect(same.listed[0]?.prompts).toEqual({ both: 2, now: 2 });
    const part = moversModel(
      [leaf('Part', { [CODE]: GAIN.now }, [p('1'), p('2')])],
      before(leaf('Part', { [CODE]: GAIN.before }, [p('1'), p('9')])),
      [CODE],
      'mentioned',
      'both',
      5,
    );
    expect(part.listed[0]?.prompts).toEqual({ both: 1, now: 2 });
    // Without the prompt rows of both windows the sentence is left out
    const unknown = moversModel(
      [leaf('Unknown', { [CODE]: GAIN.now }, null)],
      before(leaf('Unknown', { [CODE]: GAIN.before }, [p('1')])),
      [CODE],
      'mentioned',
      'both',
      5,
    );
    expect(unknown.listed[0]?.prompts).toBeNull();
  });

  it('keeps every topic and engine pair for the export, also those that could not be compared', () => {
    const model = moversModel(
      [leaf('Gain', { [CODE]: GAIN.now }), leaf('New topic', { [CODE]: [9, 10] })],
      before(leaf('Gain', { [CODE]: GAIN.before })),
      [CODE, OTHER],
      'mentioned',
      'down',
      5,
    );
    expect(model.all.map((pair) => [pair.id, pair.change === null])).toEqual([
      ['Gain:chatgpt_web', false],
      ['Gain:gemini_web', true],
      ['New topic:chatgpt_web', true],
      ['New topic:gemini_web', true],
    ]);
    expect(model.listed).toEqual([]);
  });

  it('leaves only', () => {
    const child = leaf('Child', { [CODE]: GAIN.now }, null, { level: 2, parentKey: 'Parent' });
    const parent = leaf('Parent', { [CODE]: GAIN.now }, null, { children: [child] });
    const none = leaf('No topic', { [CODE]: GAIN.now }, null, { key: NO_TOPIC, termId: null });
    const earlier = before(
      leaf('Child', { [CODE]: GAIN.before }),
      leaf('Parent', { [CODE]: GAIN.before }),
      leaf('No topic', { [CODE]: GAIN.before }, null, { key: NO_TOPIC, termId: null }),
    );
    const model = moversModel([parent, none], earlier, [CODE], 'mentioned', 'both', 5);
    expect(names(model.listed)).toEqual(['Child']);
    expect(model.compared).toBe(1);
  });
});
