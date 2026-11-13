import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { engineRole } from './engine-role';
import { bestWorst, compareEngines, engineGapOf, engineValue } from './engine-values';
import type { TopicNode } from './model-types';
import { buildTopicNodes, topicDescendants, topicsBelow } from './topic-nodes';
import { enginePoints } from './topic-points';
import { topicHeads, type TopicHead } from '@/features/prompts/topics-by-engine/topic-rows';
import { compareEngines as compareEnginesOfWp20 } from '@/features/prompts/topics-by-engine/comparison';
import {
  bestWorst as bestWorstOfWp20,
  engineGapOf as engineGapOfWp20,
  engineValue as engineValueOfWp20,
} from '@/features/prompts/topics-by-engine/engine-values';
import { engineRole as engineRoleOfWp20 } from '@/features/prompts/history-model';
import { enginePoints as enginePointsOfWp20 } from '@/features/prompts/topics-by-engine/series-model';
import type { PromptsSummary } from '@/lib/api/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';
import type { CellMetric } from '@/lib/rates/rate-model';
import { setAiSeeded } from '@/mocks/ai-seed';
import { EVENTUS_WORLD } from '@/mocks/ai-prompt-world';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { dataOf, mockBrowser } from '@/test/mock-api';

/*
 * The local copies of the WP-20 pure parts (engine values, the comparison, weekly points, the topic tree, the engine
 * role) must give the numbers the Prompts page gives for the same rows. A production file of this feature may not
 * import them; a test may, so a drift between a copy and its original fails here (plan section 2.4, decision D2).
 */

/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const METRICS: readonly CellMetric[] = ['mentioned', 'cited', 'share_of_voice'];
const CODES = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;
const SUMMARY = z.custom<PromptsSummary>(
  (value) => typeof value === 'object' && value !== null && 'prompts' in value && 'topics' in value,
);

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  setAiSeeded(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  setAiSeeded(false);
});

async function eventusSummary(query = ''): Promise<PromptsSummary> {
  const path = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS_WORLD.projectId}/ai/prompts-summary`;
  const answer = await mockBrowser('viewer').call('GET', `${path}?from=2026-10-16&to=2026-11-12${query}`);
  return dataOf(answer, SUMMARY);
}

/** The topic vocabulary of Eventus as the vocabularies read gives it. */
const TREE: NamedTerm[] = EVENTUS_WORLD.terms.map((entry) => {
  const parent = EVENTUS_WORLD.terms.find((candidate) => candidate.term_id === entry.parent_id);
  return {
    termId: entry.term_id,
    name: entry.name,
    parentId: entry.parent_id ?? null,
    path: parent === undefined ? entry.name : `${parent.name} / ${entry.name}`,
  };
});

interface Shape {
  key: string;
  name: string;
  path: string;
  promptCount: number;
  members: string[] | null;
  children: Shape[];
}
const shapeOfHead = (head: TopicHead): Shape => ({
  key: head.key,
  name: head.name,
  path: head.path,
  promptCount: head.promptCount,
  members: head.members?.map((prompt) => prompt.prompt_id) ?? null,
  children: head.children.map(shapeOfHead),
});
const shapeOfNode = (node: TopicNode): Shape => ({
  key: node.key,
  name: node.name,
  path: node.path.join(' / '),
  promptCount: node.promptCount,
  members: node.members?.map((prompt) => prompt.prompt_id) ?? null,
  children: node.children.map(shapeOfNode),
});

describe('parity with the WP-20 topic tree', () => {
  it('parity: buildTopicNodes gives the order and nesting of topicHeads of WP-20 on the Eventus fixture', async () => {
    const summary = await eventusSummary();
    const descendants = topicDescendants(TREE, []);
    const heads = topicHeads({
      summary,
      tree: TREE,
      descendants,
      kept: new Set(),
      filtering: false,
      search: null,
      locale: 'en',
      noTopicName: 'No topic',
    });
    const nodes = buildTopicNodes({
      topics: summary.topics,
      prompts: summary.prompts,
      tree: TREE,
      descendants,
      kept: null,
      noTopicName: 'No topic',
    });
    expect(heads.length).toBeGreaterThan(1);
    expect(heads.some((head) => head.children.length > 0)).toBe(true);
    expect(nodes.map(shapeOfNode)).toEqual(heads.map(shapeOfHead));
  });

  it('parity: a topic filter keeps the same rows as the WP-20 filter', async () => {
    const summary = await eventusSummary();
    const descendants = topicDescendants(TREE, []);
    const parent = TREE.find((term) => term.parentId === null && TREE.some((child) => child.parentId === term.termId));
    if (parent === undefined) throw new Error('Eventus has no topic with topics below it');
    const kept = topicsBelow([parent.termId], descendants);
    const heads = topicHeads({
      summary,
      tree: TREE,
      descendants,
      kept,
      filtering: true,
      search: null,
      locale: 'en',
      noTopicName: 'No topic',
    });
    const nodes = buildTopicNodes({
      topics: summary.topics,
      prompts: summary.prompts,
      tree: TREE,
      descendants,
      kept,
      noTopicName: 'No topic',
    });
    expect(nodes.map(shapeOfNode)).toEqual(heads.map(shapeOfHead));
    expect(nodes.map((node) => node.key)).toEqual([parent.termId]);
  });
});

describe('parity with the WP-20 engine values', () => {
  it('parity: equals WP-20 engineValue and bestWorst for every row and engine of the Eventus summary', async () => {
    const summary = await eventusSummary();
    const rows = [...summary.topics, ...summary.prompts];
    let compared = 0;
    for (const row of rows) {
      for (const metric of METRICS) {
        const values = CODES.map((code) => engineValue(row.engines, code, metric));
        const original = CODES.map((code) => engineValueOfWp20(row.engines, code, metric));
        expect(values).toEqual(original);
        expect(bestWorst(values)).toEqual(bestWorstOfWp20(original));
        expect(engineGapOf(values)).toEqual(engineGapOfWp20(original));
        expect(compareEngines(values, metric)).toEqual(compareEnginesOfWp20(original, metric));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(30);
  });
});

describe('parity with the WP-20 weekly points', () => {
  it('parity: enginePoints equals WP-20 enginePoints on a topic row with series', async () => {
    const summary = await eventusSummary('&include=series&rows=topics');
    let withSeries = 0;
    for (const topic of summary.topics) {
      for (const cells of topic.engines) {
        for (const metric of METRICS) {
          const points = enginePoints(cells, metric);
          expect(points).toEqual(enginePointsOfWp20(cells, metric));
          if (points !== null && points.length > 0) withSeries += 1;
        }
      }
    }
    expect(withSeries).toBeGreaterThan(0);
  });
});

describe('parity with the WP-20 engine role', () => {
  it('parity: engineRole equals the one of the prompt history', () => {
    for (const code of [...CODES, 'perplexity']) expect(engineRole(code)).toEqual(engineRoleOfWp20(code));
  });
});

describe('the mock the cards are tested on', () => {
  it('every prompt cell of the Eventus summary has a whole numerator and denominator', async () => {
    const summary = await eventusSummary();
    expect(summary.prompts.length).toBeGreaterThan(0);
    for (const prompt of summary.prompts) {
      for (const cells of prompt.engines) {
        for (const metric of ['mentioned', 'cited'] as const) {
          expect(Number.isInteger(cells[metric].numerator)).toBe(true);
          expect(Number.isInteger(cells[metric].denominator)).toBe(true);
        }
      }
    }
  });
});
