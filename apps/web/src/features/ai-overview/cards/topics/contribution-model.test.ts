import { describe, expect, it } from 'vitest';

import { changeModel, levelModel, type ContributionBar } from './contribution-model';
import type { TopicNode } from './model-types';
import { NO_TOPIC } from './topic-nodes';
import { engineCells, promptRow as summaryPrompt, summaryOf, topicRow } from './topic-card-test-kit';
import { buildAggregates } from '../../data/aggregates';
import { cell, engine, projectEngine, promptRow } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { PromptSummaryRow } from '@/lib/api/types';

const CODE = 'chatgpt_web';

/** A prompt with `k` of `n` valid answers on ChatGPT. */
const prompt = (id: string, topics: string[], k: number, n: number): PromptSummaryRow =>
  promptRow(id, id, topics, [engine(CODE, { mentioned: cell(k, n) })]);

/** A topic node that holds the prompts of `members`; `null` members are prompts the tree does not tell. */
function topic(name: string, members: readonly PromptSummaryRow[] | null, over: Partial<TopicNode> = {}): TopicNode {
  return {
    key: name,
    termId: name,
    name,
    path: [name],
    parentKey: null,
    level: 1,
    promptCount: members?.length ?? 0,
    engines: [],
    members,
    lastValidAt: null,
    children: [],
    ...over,
  };
}

const noTopic = (members: readonly PromptSummaryRow[]): TopicNode =>
  topic('No topic', members, { key: NO_TOPIC, termId: null });

// P is 4 (p1, p2, p3, p5): p4 has no valid answer. Prompt rates .9, .5, 0, .75: R is .5375 as the mean of the
// prompts, where all the answers together would give 13 of 20.
const P1 = prompt('p1', ['A'], 9, 10);
const P2 = prompt('p2', ['A', 'B'], 1, 2);
const P3 = prompt('p3', ['B'], 0, 4);
const P4 = prompt('p4', ['B'], 0, 0);
const P5 = prompt('p5', [], 3, 4);
const PROMPTS = [P1, P2, P3, P4, P5];
const NODES = [topic('A', [P1, P2]), topic('B', [P2, P3, P4]), noTopic([P5])];

const pointsOf = (bars: readonly ContributionBar[], key: string): number | null =>
  bars.find((bar) => bar.key === key)?.points ?? Number.NaN;

describe('levelModel', () => {
  it("R equals the strip's mention rate for the engine (R12 parity with buildAggregates)", () => {
    const summary = summaryOf({
      topics: [topicRow('A', 'A', 2, [engineCells(CODE, { mentioned: [10, 12] })])],
      prompts: PROMPTS.map((entry) =>
        summaryPrompt(entry.prompt_id, entry.text, entry.topic_term_ids, [
          engineCells(CODE, {
            mentioned: [entry.engines[0]?.mentioned.numerator ?? 0, entry.engines[0]?.mentioned.denominator ?? 0],
          }),
        ]),
      ),
    });
    const aggregates = buildAggregates({
      current: summary,
      previous: null,
      engines: [projectEngine(CODE)],
      chosenEngines: null,
      topicsKept: null,
      sources: null,
      fanout: null,
    });
    const strip = aggregates.engines.find((entry) => entry.engineCode === CODE)?.mentioned;
    const model = levelModel(NODES, PROMPTS, CODE);
    expect(model.state).toBe('ok');
    expect(model.headline.value).toBeCloseTo(0.5375, 10);
    expect(model.headline.value).toBeCloseTo(strip?.value ?? Number.NaN, 10);
    expect(model.headline.prompts).toBe(strip?.prompts);
    expect(model.headline.answers).toBe(strip?.answers);
  });

  it("the contribution of a topic is the sum of its prompts' rates over the prompts with an answer", () => {
    const { bars } = levelModel(NODES, PROMPTS, CODE);
    // (0.9 + 0.5) / 4 and (0.5 + 0) / 4, in points; p4 has no answer and is not in the 4
    expect(pointsOf(bars, 'A')).toBeCloseTo(35);
    expect(pointsOf(bars, 'B')).toBeCloseTo(12.5);
    expect(bars.find((bar) => bar.key === 'A')?.prompts).toBe(2);
    expect(bars.find((bar) => bar.key === 'B')?.prompts).toBe(2);
  });

  it('prompts without a topic have their own bar, after the topics', () => {
    const { bars } = levelModel(NODES, PROMPTS, CODE);
    expect(bars.map((bar) => bar.key)).toEqual(['A', 'B', NO_TOPIC]);
    expect(pointsOf(bars, NO_TOPIC)).toBeCloseTo(18.75);
    expect(bars.find((bar) => bar.key === NO_TOPIC)?.node?.key).toBe(NO_TOPIC);
  });

  it('bars can add up to more than R and the overlap count is exact', () => {
    const model = levelModel(NODES, PROMPTS, CODE);
    expect(model.sumPoints).toBeCloseTo(66.25);
    expect((model.headline.value ?? 0) * 100).toBeCloseTo(53.75);
    // p2 is in A and B: its 0.5 / 4 is counted twice, which is the whole excess
    expect(model.sumPoints - (model.headline.value ?? 0) * 100).toBeCloseTo(12.5);
    expect(model.overlapping).toBe(1);
  });

  it('a topic whose prompts are not known, or none of which has an answer, is n/a and never 0', () => {
    const { bars } = levelModel(
      [topic('Unknown', null), topic('Silent', [P4]), topic('A', [P1, P2, P3, P5])],
      PROMPTS,
      CODE,
    );
    expect(bars.find((bar) => bar.key === 'Unknown')?.points).toBeNull();
    expect(bars.find((bar) => bar.key === 'Silent')?.points).toBeNull();
    expect(bars.map((bar) => bar.key)).toEqual(['A', 'Silent', 'Unknown']);
  });

  it('under 4 answers is insufficient and has no bars', () => {
    const few = [prompt('a', ['A'], 2, 2), prompt('b', ['A'], 0, 1)];
    const model = levelModel([topic('A', few)], few, CODE);
    expect(model.state).toBe('insufficient');
    expect(model.bars).toEqual([]);
    expect(model.headline).toMatchObject({ value: null, answers: 3 });
  });

  it('no valid answer at all is none', () => {
    const silent = [prompt('a', ['A'], 0, 0)];
    expect(levelModel([topic('A', silent)], silent, CODE)).toMatchObject({ state: 'none', bars: [] });
  });

  it('a prompt cell whose count is not whole is refused by name', () => {
    const broken = promptRow('x', 'x', ['A'], [engine(CODE, { mentioned: { ...cell(1, 2), numerator: 0.5 } })]);
    expect(() => levelModel([topic('A', [broken])], [broken], CODE)).toThrow(/not a whole count/);
  });
});

// Now: p1 .9, p2 .5, p3 0, p6 1 (new). Before: p1 .5, p2 .5, p3 .5, p7 1 (left). C is p1, p2, p3.
const NOW = [P1, P2, P3, prompt('p6', ['A'], 4, 4)];
const BEFORE = [
  prompt('p1', ['A'], 5, 10),
  prompt('p2', ['A', 'B'], 1, 2),
  prompt('p3', ['B'], 2, 4),
  prompt('p7', ['A'], 4, 4),
];
const NOW_NODES = [topic('A', [P1, P2, NOW[3] as PromptSummaryRow]), topic('B', [P2, P3])];

describe('changeModel', () => {
  it('change view uses only prompts common to both windows', () => {
    const model = changeModel(NOW_NODES, NOW, BEFORE, CODE);
    expect(model.state).toBe('ok');
    expect(model.common).toBe(3);
    // A: p1 +.4, p2 0 over 3 prompts; B: p2 0, p3 -.5 over 3 prompts (p6 and p7 are in one window only)
    expect(pointsOf(model.bars, 'A')).toBeCloseTo(13.333, 2);
    expect(pointsOf(model.bars, 'B')).toBeCloseTo(-16.667, 2);
    expect(model.bars.find((bar) => bar.key === 'A')?.prompts).toBe(2);
    expect(model.headlinePoints).toBeCloseTo(-3.333, 2);
  });

  it('the remainder of prompts added or left is stated, not allocated', () => {
    const model = changeModel(NOW_NODES, NOW, BEFORE, CODE);
    // The strip rate went from 62.5% to 60.0%: -2.5 points, of which -3.33 are the common prompts
    expect(model.totalPoints).toBeCloseTo(-2.5, 6);
    expect(model.remainderPoints).toBeCloseTo(0.8333, 3);
    const allocated = model.bars.reduce((sum, bar) => sum + (bar.points ?? 0), 0);
    // The bars hold the common prompts only: nothing of the remainder is in them
    expect(allocated).toBeCloseTo(-3.3333, 3);
  });

  it('a window under 4 answers is insufficient, and one with none is none', () => {
    const thin = [prompt('p1', ['A'], 1, 2)];
    expect(changeModel(NOW_NODES, NOW, thin, CODE)).toMatchObject({ state: 'insufficient', bars: [] });
    const silent = [prompt('p1', ['A'], 0, 0)];
    expect(changeModel(NOW_NODES, NOW, silent, CODE)).toMatchObject({ state: 'none', bars: [] });
    expect(changeModel(NOW_NODES, [prompt('p1', ['A'], 0, 0)], BEFORE, CODE).state).toBe('none');
  });

  it('with no prompt in both windows there is nothing to split', () => {
    const elsewhere = [prompt('q1', ['A'], 8, 10)];
    const model = changeModel(NOW_NODES, NOW, elsewhere, CODE);
    expect(model.common).toBe(0);
    expect(model.bars).toEqual([]);
    expect(model.headlinePoints).toBeNull();
  });
});
