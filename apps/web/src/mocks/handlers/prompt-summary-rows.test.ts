import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { setAiSeeded } from '../ai-seed';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { dataOf, fieldCodes, mockBrowser } from '@/test/mock-api';

const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const SUMMARY_URL = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${fynix.project_id}/ai/prompts-summary`;
/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');

/** The fields of `PromptsSummary` (the generated schema) these tests read: both row lists, each topic row's engines and entities. */
const CELL = z.object({ value: z.number().nullable(), numerator: z.number(), denominator: z.number() });
const ENGINE = z.object({
  engine_code: z.string(),
  mentioned: CELL,
  share_of_voice: CELL,
  entities: z.array(z.object({ entity_id: z.string(), mentioned: CELL, share_of_voice: CELL })).optional(),
});
const SUMMARY = z.object({
  engine_codes: z.array(z.string()),
  entities: z.array(z.object({ entity_id: z.string(), name: z.string(), role: z.enum(['own', 'competitor']) })),
  prompts: z.array(z.object({ prompt_id: z.string(), engines: z.array(ENGINE) })),
  topics: z.array(
    z.object({
      term_id: z.string().nullable(),
      name: z.string().nullable(),
      prompt_count: z.number(),
      engines: z.array(ENGINE),
    }),
  ),
});

const summaryOf = async (query: string): Promise<z.infer<typeof SUMMARY>> =>
  dataOf(await mockBrowser('viewer').call('GET', `${SUMMARY_URL}${query}`), SUMMARY);

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  setAiSeeded(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the rows of the prompts summary', () => {
  it('returns every row when rows is left out', async () => {
    const summary = await summaryOf('');
    expect(summary.prompts.length).toBeGreaterThan(0);
    expect(summary.topics.length).toBeGreaterThan(0);
  });

  it('rows=topics leaves the prompt rows out and keeps the topic rows', async () => {
    const all = await summaryOf('');
    const summary = await summaryOf('?rows=topics');
    expect(summary.prompts).toEqual([]);
    expect(summary.topics).toEqual(all.topics);
  });

  it('rows=none leaves both lists, and the tracked entities stay', async () => {
    const summary = await summaryOf('?rows=none&include=entities');
    expect(summary.prompts).toEqual([]);
    expect(summary.topics).toEqual([]);
    expect(summary.entities.length).toBeGreaterThan(0);
  });

  it('answers rows=topics with include=entities as an entity cell per tracked entity on every engine of every topic', async () => {
    const summary = await summaryOf('?rows=topics&include=entities');
    expect(summary.prompts).toEqual([]);
    expect(summary.topics.length).toBeGreaterThan(0);
    for (const topic of summary.topics) {
      for (const engine of topic.engines) {
        expect((engine.entities ?? []).map((cells) => cells.entity_id).sort()).toEqual(
          summary.entities.map((entity) => entity.entity_id).sort(),
        );
      }
    }
  });

  it('keeps the other query names working beside rows', async () => {
    const summary = await summaryOf('?rows=topics&include=series,entities&filter[country_iso]=DE&include_branded=true');
    expect(summary.prompts).toEqual([]);
    expect(summary.topics.length).toBeGreaterThan(0);
  });

  it('refuses an unknown rows value with a 422 at rows', async () => {
    for (const value of ['all', 'prompts']) {
      const answer = await mockBrowser('viewer').call('GET', `${SUMMARY_URL}?rows=${value}`);
      expect(answer.status).toBe(422);
      expect(fieldCodes(answer)).toEqual(['rows:literal_error']);
    }
  });
});
