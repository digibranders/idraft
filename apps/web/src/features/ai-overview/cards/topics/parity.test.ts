import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { engineRole } from './engine-role';
import { bestWorst, compareEngines, engineGapOf, engineValue } from './engine-values';
import type { TopicNode } from './model-types';
import { buildTopicNodes, groupsOf as groupsOfOverview, topicDescendants, topicsBelow } from './topic-nodes';
import { enginePoints } from './topic-points';
import { topicRowKept } from '@/features/prompts/prompt-model';
import { buildTopicTree, groupsOf as groupsOfPrompts, type TopicBranch } from '@/features/prompts/topic-tree';
import { topicHeads } from '@/features/prompts/topics-by-engine/topic-rows';
import { compareEngines as compareEnginesOfWp20 } from '@/features/prompts/topics-by-engine/comparison';
import {
  bestWorst as bestWorstOfWp20,
  engineGapOf as engineGapOfWp20,
  engineValue as engineValueOfWp20,
} from '@/features/prompts/topics-by-engine/engine-values';
import { engineRole as engineRoleOfWp20 } from '@/features/prompts/history-model';
import { enginePoints as enginePointsOfWp20 } from '@/features/prompts/topics-by-engine/series-model';
import type { PromptsSummary, TopicSummaryRow } from '@/lib/api/types';
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
  promptCount: number;
  children: Shape[];
}
/** The two-level tree of the Prompts page (`buildTopicTree`), as keys and counts. */
const shapeOfBranch = ({ row, children }: TopicBranch<TopicSummaryRow>): Shape => ({
  key: row.term_id ?? '__none',
  promptCount: row.prompt_count,
  children: children.map((child) => ({
    key: child.term_id ?? '__none',
    promptCount: child.prompt_count,
    children: [],
  })),
});
const shapeOfNode = (node: TopicNode): Shape => ({
  key: node.key,
  promptCount: node.promptCount,
  children: node.children.map(shapeOfNode),
});

describe('parity with the WP-20 topic tree', () => {
  it('parity: buildTopicNodes gives the order and nesting of buildTopicTree of the Prompts page on the Eventus fixture', async () => {
    const summary = await eventusSummary();
    const descendants = topicDescendants(TREE, []);
    const branches = buildTopicTree(summary.topics, TREE);
    const nodes = buildTopicNodes({
      topics: summary.topics,
      prompts: summary.prompts,
      tree: TREE,
      descendants,
      kept: null,
      noTopicName: 'No group',
    });
    expect(branches.length).toBeGreaterThan(1);
    expect(branches.some((branch) => branch.children.length > 0)).toBe(true);
    // The Overview puts the row of no topic last; the Prompts page leaves it where the API sent it, and lists no group for it
    const keyed = (shapes: Shape[]): Shape[] => shapes.filter((shape) => shape.key !== '__none');
    expect(keyed(nodes.map(shapeOfNode))).toEqual(keyed(branches.map(shapeOfBranch)));
  });

  it('parity: a topic filter keeps the same rows as the Prompts page filter', async () => {
    const summary = await eventusSummary();
    const descendants = topicDescendants(TREE, []);
    const parent = TREE.find((term) => term.parentId === null && TREE.some((child) => child.parentId === term.termId));
    if (parent === undefined) throw new Error('Eventus has no topic with topics below it');
    const kept = topicsBelow([parent.termId], descendants);
    const branches = buildTopicTree(summary.topics, TREE, (termId) => topicRowKept(termId, kept));
    const nodes = buildTopicNodes({
      topics: summary.topics,
      prompts: summary.prompts,
      tree: TREE,
      descendants,
      kept,
      noTopicName: 'No group',
    });
    expect(nodes.map(shapeOfNode)).toEqual(branches.map(shapeOfBranch));
    expect(nodes.map((node) => node.key)).toEqual([parent.termId]);
  });

  it('parity: the Groups tab and the group cards list the same groups with the same prompts (flat, no parent rows)', async () => {
    const summary = await eventusSummary();
    const descendants = topicDescendants(TREE, []);
    const parent = TREE.find((term) => term.parentId === null && TREE.some((child) => child.parentId === term.termId));
    if (parent === undefined) throw new Error('Eventus has no topic with topics below it');
    for (const chosen of [null, topicsBelow([parent.termId], descendants)]) {
      const heads = topicHeads({
        summary,
        tree: TREE,
        descendants,
        kept: chosen ?? new Set(),
        filtering: chosen !== null,
        search: null,
        locale: 'en',
      });
      const nodes = buildTopicNodes({
        topics: summary.topics,
        prompts: summary.prompts,
        tree: TREE,
        descendants,
        kept: chosen,
        noTopicName: 'No group',
      });
      const groups = groupsOfOverview(nodes);
      expect(heads.length).toBeGreaterThan(1);
      expect(heads.map((head) => head.key)).toEqual(groups.map((group) => group.key));
      expect(heads.map((head) => head.promptCount)).toEqual(groups.map((group) => group.promptCount));
      expect(heads.map((head) => head.members?.map((prompt) => prompt.prompt_id))).toEqual(
        groups.map((group) => group.members?.map((prompt) => prompt.prompt_id)),
      );
      // The same rule as the Prompts page's `groupsOf` on the tree
      const rows = groupsOfPrompts(
        buildTopicTree(summary.topics, TREE, (termId) => chosen === null || topicRowKept(termId, chosen)),
      );
      expect(rows.map((row) => row.term_id)).toEqual(groups.map((group) => group.key));
    }
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
