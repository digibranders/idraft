import { describe, expect, it } from 'vitest';

import type { TopicNode } from './model-types';
import { SCATTER_EXPORT_HEADER, scatterFileName, scatterModel } from './scatter-model';
import { NO_TOPIC } from './topic-nodes';
import { engine, weighted } from '@/features/prompts/topics-by-engine/cells-fixtures';

type Pair = readonly [k: number, n: number];

/** A leaf topic with `[k, n]` valid answers on ChatGPT for mention and for citation (null: no cells at all). */
function leaf(
  name: string,
  prompts: number,
  mention: Pair | null,
  citation: Pair | null,
  over: Partial<TopicNode> = {},
): TopicNode {
  return {
    key: name,
    termId: name,
    name,
    path: [name],
    parentKey: null,
    level: 1,
    promptCount: prompts,
    engines:
      mention === null || citation === null
        ? []
        : [
            engine('chatgpt_web', {
              mentioned: weighted(mention[0], mention[1], prompts),
              cited: weighted(citation[0], citation[1], prompts),
            }),
          ],
    members: null,
    lastValidAt: null,
    children: [],
    ...over,
  };
}

const plotted = (model: ReturnType<typeof scatterModel>): string[] => model.points.map((point) => point.row.node.name);

describe('scatterModel', () => {
  it('a point needs a rate on mention and citation', () => {
    const model = scatterModel(
      [
        leaf('Both', 5, [5, 10], [2, 10]),
        leaf('Thin citation', 5, [5, 10], [2, 3]),
        leaf('Thin mention', 5, [2, 3], [5, 10]),
        leaf('No answers', 5, [0, 0], [0, 0]),
        leaf('No cells', 5, null, null),
      ],
      'chatgpt_web',
    );
    expect(plotted(model)).toEqual(['Both']);
  });

  it('others are counted and listed with their answers', () => {
    const model = scatterModel(
      [
        leaf('Both', 5, [5, 10], [2, 10]),
        leaf('Thin citation', 5, [5, 10], [2, 3]),
        leaf('No answers', 4, [0, 0], [0, 0]),
      ],
      'chatgpt_web',
    );
    expect(model.unplotted).toBe(2);
    expect(model.rows.map((row) => row.node.name)).toEqual(['Both', 'Thin citation', 'No answers']);
    const thin = model.rows.find((row) => row.node.name === 'Thin citation');
    expect(thin).toMatchObject({ plotted: false, gap: null });
    expect(thin?.citation).toMatchObject({ state: 'insufficient', answers: 3, value: null });
    expect(thin?.mention).toMatchObject({ state: 'ok', answers: 10, successes: 5 });
  });

  it('size is the square root of prompts between 4 and 14', () => {
    const model = scatterModel(
      [
        leaf('Large', 100, [5, 10], [5, 10]),
        leaf('Quarter', 25, [5, 10], [5, 10]),
        leaf('Single', 1, [5, 10], [5, 10]),
      ],
      'chatgpt_web',
    );
    const size = (name: string): number => model.points.find((point) => point.row.node.name === name)?.size ?? 0;
    expect(size('Large')).toBeCloseTo(14, 9);
    expect(size('Quarter')).toBeCloseTo(9, 9);
    expect(size('Single')).toBeCloseTo(5, 9);
    for (const point of model.points) {
      expect(point.size).toBeGreaterThanOrEqual(4);
      expect(point.size).toBeLessThanOrEqual(14);
    }
  });

  it('the axis is one ceiling for both', () => {
    const ceilingOf = (mention: Pair, citation: Pair): number =>
      scatterModel([leaf('T', 5, mention, citation)], 'chatgpt_web').ceiling;
    // The highest value of either rate sets it: 47% mention and 12% citation, and the reverse, give one axis
    expect(ceilingOf([47, 100], [12, 100])).toBeCloseTo(0.5, 9);
    expect(ceilingOf([12, 100], [47, 100])).toBeCloseTo(0.5, 9);
    expect(ceilingOf([47, 100], [62, 100])).toBeCloseTo(0.7, 9);
    // The next tenth above, so a point on a tenth does not sit on the edge; the axis never passes 100 percent
    expect(ceilingOf([50, 100], [20, 100])).toBeCloseTo(0.6, 9);
    expect(ceilingOf([100, 100], [20, 100])).toBe(1);
    expect(scatterModel([], 'chatgpt_web').ceiling).toBe(1);
  });

  it('the gap is mention minus citation in points', () => {
    const model = scatterModel(
      [leaf('Exact', 5, [3349, 10000], [1001, 10000]), leaf('Reverse', 5, [10, 100], [40, 100])],
      'chatgpt_web',
    );
    const gap = (name: string): number | null => model.rows.find((row) => row.node.name === name)?.gap ?? null;
    // Exact, not the difference of two rounded percents (33.5 and 10.0 would make 23.5)
    expect(gap('Exact')).toBeCloseTo(23.48, 9);
    expect(gap('Reverse')).toBeCloseTo(-30, 9);
  });

  it('leaves only, the no topic row is not a point', () => {
    const child = leaf('Child', 4, [5, 10], [2, 10], { level: 2, parentKey: 'Parent', path: ['Parent', 'Child'] });
    const parent = leaf('Parent', 6, [5, 10], [2, 10], { children: [child] });
    const lone = leaf('Lone', 3, [6, 10], [3, 10]);
    const none = leaf('No topic', 2, [6, 10], [3, 10], { key: NO_TOPIC, termId: null });
    const model = scatterModel([parent, lone, none], 'chatgpt_web');
    expect(plotted(model)).toEqual(['Child', 'Lone']);
    expect(model.rows.map((row) => row.node.name)).toEqual(['Child', 'Lone']);
  });

  it('rows run from the largest gap, the topics that are not plotted last', () => {
    const model = scatterModel(
      [
        leaf('Thin', 9, [5, 10], [1, 2]),
        leaf('Small', 5, [5, 10], [4, 10]),
        leaf('Big', 5, [9, 10], [1, 10]),
        leaf('Reverse', 5, [1, 10], [9, 10]),
      ],
      'chatgpt_web',
    );
    expect(model.rows.map((row) => row.node.name)).toEqual(['Big', 'Small', 'Reverse', 'Thin']);
  });

  it('the leaders are the topics named more often than cited, largest gap first, at most three', () => {
    const model = scatterModel(
      [
        leaf('A', 5, [9, 10], [1, 10]),
        leaf('B', 5, [8, 10], [1, 10]),
        leaf('C', 5, [7, 10], [1, 10]),
        leaf('D', 5, [6, 10], [1, 10]),
        leaf('Reverse', 5, [1, 10], [9, 10]),
      ],
      'chatgpt_web',
    );
    expect(model.leaders.map((row) => row.node.name)).toEqual(['A', 'B', 'C']);
    expect(scatterModel([leaf('Reverse', 5, [1, 10], [9, 10])], 'chatgpt_web').leaders).toEqual([]);
  });

  it('says whether any answer was given at all', () => {
    expect(scatterModel([leaf('Thin', 5, [1, 2], [1, 2])], 'chatgpt_web').answered).toBe(true);
    expect(scatterModel([leaf('None', 5, [0, 0], [0, 0])], 'chatgpt_web').answered).toBe(false);
    expect(scatterModel([], 'chatgpt_web').answered).toBe(false);
  });

  it('reads the engine asked, not another', () => {
    const topic = leaf('T', 5, [5, 10], [2, 10]);
    expect(plotted(scatterModel([topic], 'gemini_web'))).toEqual([]);
  });
});

describe('the export names', () => {
  it('has a column for each fact of a row, an unknown rate with its status', () => {
    expect(SCATTER_EXPORT_HEADER).toEqual([
      'topic',
      'mention_rate_percent',
      'mention_answers',
      'mention_status',
      'citation_rate_percent',
      'citation_answers',
      'citation_status',
      'prompts',
      'gap_points',
      'plotted',
    ]);
    expect(scatterFileName('gemini_web')).toBe('citation-vs-mention-gemini_web');
  });
});
