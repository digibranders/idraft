import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { topicsInScope } from './topics-in-scope';
import { topicDescendants, topicsBelow, topicsSpanned } from '@/features/prompts/prompt-model';
import { promptRow, topicRow } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { PromptsSummary } from '@/lib/api/types';
import { EVENTUS_WORLD } from '@/mocks/ai-prompt-world';
import { setAiSeeded } from '@/mocks/ai-seed';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '@/mocks/fixtures';
import { dataOf, mockBrowser } from '@/test/mock-api';

/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (eventus === undefined) throw new Error('The Eventus Security project fixture is missing');
const SUMMARY_URL = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${eventus.project_id}/ai/prompts-summary`;

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

/** Only the parts of a summary the count reads. */
const summaryOf = (
  topics: PromptsSummary['topics'],
  prompts: PromptsSummary['prompts'] = [],
): Pick<PromptsSummary, 'topics' | 'prompts' | 'total'> => ({ topics, prompts });

describe('topicsInScope', () => {
  const topics = [
    topicRow('seo', 'SEO', 3),
    topicRow('technical', 'Technical SEO', 2),
    topicRow('paid', 'Paid', 1),
    topicRow(null, null, 4),
    topicRow('empty', 'No prompt here', 0),
  ];
  const prompts = [promptRow('p1', 'one', ['technical']), promptRow('p2', 'two', [])];

  it('counts the topic rows that hold a prompt and are not the no-topic row', () => {
    expect(topicsInScope(summaryOf(topics, prompts), null)).toBe(3);
  });

  it('counts the subtree of a topic filter and nothing outside it', () => {
    expect(topicsInScope(summaryOf(topics, prompts), new Set(['seo', 'technical']))).toBe(2);
    expect(topicsInScope(summaryOf(topics, prompts), new Set(['paid']))).toBe(1);
    expect(topicsInScope(summaryOf(topics, prompts), new Set(['technical']))).toBe(1);
  });

  it('is null while the topic rows are absent and prompts are there, and 0 with no prompt at all', () => {
    expect(topicsInScope(summaryOf([], prompts), null)).toBeNull();
    expect(topicsInScope(summaryOf([], []), null)).toBe(0);
  });

  it('is null when only the total says there are prompts and the topic rows were not read', () => {
    const total = { engines: [], last_observed_at: null, last_valid_at: null, prompt_count: 5 };
    expect(topicsInScope({ topics: [], prompts: [], total }, null)).toBeNull();
  });

  it('equals the topics the Topics and Prompts strip counts on the Eventus Security world', async () => {
    const summary = dataOf(await mockBrowser('viewer').call('GET', SUMMARY_URL), SUMMARY);
    const tree = EVENTUS_WORLD.terms.map((term) => ({
      termId: term.term_id,
      name: term.name,
      parentId: term.parent_id ?? null,
      path: term.slug,
    }));
    const descendants = topicDescendants(tree, []);
    const spanned = topicsSpanned(summary.topics, summary.prompts, descendants, null);
    // The plan's example of 13 topics is not the dev seed's count: it holds its parent topics and their children
    expect(spanned).toBeGreaterThan(0);
    expect(topicsInScope(summary, null)).toBe(spanned);
    // The same under a topic filter of one parent topic and the topics below it
    const parent = EVENTUS_WORLD.definition.topics[0];
    if (parent === undefined) throw new Error('The Eventus Security definition has no topic');
    const kept = topicsBelow([EVENTUS_WORLD.termIdOf(parent.slug)], descendants);
    expect(topicsInScope(summary, kept)).toBe(topicsSpanned(summary.topics, summary.prompts, descendants, kept));
  });
});
