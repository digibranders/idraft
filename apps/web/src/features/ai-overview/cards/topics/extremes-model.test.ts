import { describe, expect, it } from 'vitest';

import { extremesModel } from './extremes-model';
import type { TopicNode } from './model-types';
import { NO_TOPIC } from './topic-nodes';
import { engine, weighted } from '@/features/prompts/topics-by-engine/cells-fixtures';

const CODE = 'chatgpt_web';

/** A leaf topic with `k` of `n` valid answers on ChatGPT, weighted over `prompts` prompts. */
function leaf(name: string, prompts: number, k: number, n: number, over: Partial<TopicNode> = {}): TopicNode {
  return {
    key: name,
    termId: name,
    name,
    path: [name],
    parentKey: null,
    level: 1,
    promptCount: prompts,
    engines: [engine(CODE, { mentioned: weighted(k, n, prompts) })],
    members: null,
    lastValidAt: null,
    children: [],
    ...over,
  };
}

const names = (entries: readonly { row: { node: TopicNode } }[]): string[] =>
  entries.map((entry) => entry.row.node.name);

describe('extremesModel', () => {
  it('a topic under 4 answers or under 3 prompts is not eligible and is counted', () => {
    const model = extremesModel(
      [
        leaf('Thin answers', 5, 3, 3),
        leaf('Thin prompts', 2, 8, 10),
        leaf('No cells', 4, 0, 0, { engines: [] }),
        leaf('Ranked', 4, 8, 10),
      ],
      CODE,
      'mentioned',
      5,
    );
    expect(names(model.strongest)).toEqual(['Ranked']);
    expect(model.weakest).toEqual([]);
    expect(model.notRanked).toBe(3);
  });

  it('says whether the engine has a rate or any answer at all, ranked or not', () => {
    const some = extremesModel([leaf('Few prompts', 2, 8, 10), leaf('Thin', 4, 3, 3)], CODE, 'mentioned', 5);
    expect(some).toMatchObject({ rated: 1, answered: true, notRanked: 2 });
    const none = extremesModel([leaf('Silent', 4, 0, 0)], CODE, 'mentioned', 5);
    expect(none).toMatchObject({ rated: 0, answered: false, notRanked: 1 });
  });

  it('the floor is 4 answers and 3 prompts exactly', () => {
    const model = extremesModel([leaf('Edge', 3, 2, 4)], CODE, 'mentioned', 5);
    expect(names(model.strongest)).toEqual(['Edge']);
    expect(model.notRanked).toBe(0);
  });

  it('strongest takes the highest and skips a rate of 0', () => {
    const model = extremesModel(
      [leaf('Zero', 4, 0, 10), leaf('Half', 4, 5, 10), leaf('Most', 4, 9, 10)],
      CODE,
      'mentioned',
      5,
    );
    expect(names(model.strongest)).toEqual(['Most', 'Half']);
    // A rate of 0 is a real weakest, only never a strongest
    expect(names(model.weakest)).toEqual(['Zero']);
  });

  it('weakest takes the lowest of the rest and never repeats a strongest topic', () => {
    const topics = [
      leaf('A', 4, 9, 10),
      leaf('B', 4, 7, 10),
      leaf('C', 4, 5, 10),
      leaf('D', 4, 3, 10),
      leaf('E', 4, 1, 10),
    ];
    const split = extremesModel(topics, CODE, 'mentioned', 2);
    expect(names(split.strongest)).toEqual(['A', 'B']);
    expect(names(split.weakest)).toEqual(['E', 'D']);
    // Three topics are asked for in each list but only five exist: the weakest list gets what the strongest left
    const crowded = extremesModel(topics.slice(0, 3), CODE, 'mentioned', 2);
    expect(names(crowded.strongest)).toEqual(['A', 'B']);
    expect(names(crowded.weakest)).toEqual(['C']);
    const shared = names(crowded.strongest).filter((name) => names(crowded.weakest).includes(name));
    expect(shared).toEqual([]);
  });

  it('a tie goes to the prompts then the name', () => {
    const model = extremesModel(
      [leaf('Beta', 4, 5, 10), leaf('Alpha', 4, 5, 10), leaf('Wide', 9, 5, 10)],
      CODE,
      'mentioned',
      5,
    );
    expect(names(model.strongest)).toEqual(['Wide', 'Alpha', 'Beta']);
  });

  it('the no topic row is never ranked', () => {
    const model = extremesModel(
      [leaf('Unfiled', 6, 9, 10, { key: NO_TOPIC, termId: null }), leaf('SEO', 4, 5, 10)],
      CODE,
      'mentioned',
      5,
    );
    expect(names(model.strongest)).toEqual(['SEO']);
    expect(model.notRanked).toBe(0);
  });

  it('parents are not ranked beside their children (leaves only)', () => {
    const child = leaf('Local SEO', 4, 4, 10, { level: 2, parentKey: 'SEO' });
    const parent = leaf('SEO', 8, 9, 10, { children: [child] });
    const model = extremesModel([parent, leaf('Ads', 4, 6, 10)], CODE, 'mentioned', 5);
    expect(names(model.strongest)).toEqual(['Ads', 'Local SEO']);
    expect(names(model.weakest)).toEqual([]);
  });

  it('ranks the metric asked: citation reads the cited cell', () => {
    const topic = leaf('Cited', 4, 9, 10, {
      engines: [engine(CODE, { mentioned: weighted(9, 10, 4), cited: weighted(1, 10, 4) })],
    });
    const model = extremesModel([topic], CODE, 'cited', 5);
    expect(model.strongest[0]?.value.value).toBeCloseTo(0.1);
  });
});
