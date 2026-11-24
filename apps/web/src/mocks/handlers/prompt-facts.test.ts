import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { setAiSeeded } from '../ai-seed';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { dataOf, fieldCodes, mockBrowser } from '@/test/mock-api';

const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (eventus === undefined) throw new Error('The Eventus Security project fixture is missing');
const SUMMARY_URL = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${eventus.project_id}/ai/prompts-summary`;
/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');

const CELL = z.object({ value: z.number().nullable(), numerator: z.number(), denominator: z.number() });
const FACTS = z.object({
  position: z
    .object({ rank_sum: z.number(), ordered_answers: z.number(), mentions: z.number(), answers: z.number() })
    .nullable()
    .optional(),
  sentiment: z
    .object({ positive: z.number(), neutral: z.number(), negative: z.number(), mixed: z.number() })
    .nullable()
    .optional(),
  recommended: CELL.nullable().optional(),
  other_brands: z
    .array(z.object({ name: z.string(), mentioned: CELL }))
    .nullable()
    .optional(),
  top_links: z
    .array(z.object({ url: z.string(), domain: z.string(), domain_role: z.string(), answers: z.number() }))
    .nullable()
    .optional(),
  latest: z
    .object({
      observation_id: z.string(),
      observed_at: z.string(),
      screenshot_url: z.string().nullable(),
      screenshot_state: z.enum(['available', 'capturable', 'expired', 'unsupported']),
    })
    .nullable()
    .optional(),
});
const ENGINE = FACTS.extend({ engine_code: z.string(), mentioned: CELL });
const LINK = z.object({ keyword: z.string(), search_volume: z.number().nullable() });
const SUMMARY = z.object({
  prompts: z.array(
    z.object({
      prompt_id: z.string(),
      topic_term_ids: z.array(z.string()),
      intent: z.string().optional(),
      linked_keyword: LINK.nullable().optional(),
      engines: z.array(ENGINE),
    }),
  ),
  topics: z.array(
    z.object({ term_id: z.string().nullable(), linked_keywords: z.array(LINK).optional(), engines: z.array(ENGINE) }),
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

describe('include=facts of the prompts summary', () => {
  it('is accepted next to the other include values, and any other value is still refused', async () => {
    const refused = await mockBrowser('viewer').call('GET', `${SUMMARY_URL}?include=entities,facts,cells`);
    expect(fieldCodes(refused)).toEqual(['include.2:literal_error']);
    expect((await mockBrowser('viewer').call('GET', `${SUMMARY_URL}?include=entities,facts`)).status).toBe(200);
  });

  it('answers include=fact_counts with the same counts', async () => {
    const summary = await summaryOf('?include=fact_counts');
    expect(summary.prompts.length).toBeGreaterThan(0);
    for (const row of summary.prompts) {
      for (const engine of row.engines) expect(engine.position?.answers).toBe(engine.mentioned.denominator);
    }
  });

  it('leaves every fact out when it is not asked for', async () => {
    const summary = await summaryOf('?include=entities');
    expect(summary.prompts.length).toBeGreaterThan(0);
    for (const row of summary.prompts) {
      expect(row.intent).toBeUndefined();
      expect(row.linked_keyword).toBeUndefined();
      for (const engine of row.engines) expect(engine.position).toBeUndefined();
    }
    for (const topic of summary.topics) expect(topic.linked_keywords).toBeUndefined();
  });

  it('gives every prompt row its intent and linked keyword, with the variety the file has', async () => {
    // The navigational prompts are the branded ones, which a summary leaves out unless asked
    const summary = await summaryOf('?include=entities,facts&include_branded=true');
    const intents = new Set(summary.prompts.map((row) => row.intent));
    expect(intents.size).toBeGreaterThan(2);
    expect(summary.prompts.every((row) => row.linked_keyword !== undefined)).toBe(true);
    expect(summary.prompts.some((row) => row.linked_keyword === null)).toBe(true);
    expect(summary.prompts.some((row) => row.linked_keyword?.search_volume != null)).toBe(true);
  });

  it('gives every engine of a prompt counts that agree with its own cells', async () => {
    const summary = await summaryOf('?include=entities,facts');
    for (const row of summary.prompts) {
      for (const engine of row.engines) {
        const { position, sentiment, recommended } = engine;
        expect(position?.answers).toBe(engine.mentioned.denominator);
        expect(position?.mentions).toBe(engine.mentioned.numerator);
        expect(position?.ordered_answers ?? 0).toBeLessThanOrEqual(position?.mentions ?? 0);
        if (sentiment !== null && sentiment !== undefined) {
          expect(sentiment.positive + sentiment.neutral + sentiment.negative + sentiment.mixed).toBe(
            position?.mentions,
          );
        }
        expect(recommended === null ? 0 : (recommended?.numerator ?? 0)).toBeLessThanOrEqual(position?.mentions ?? 0);
      }
    }
  });

  it('classifies sentiment on ChatGPT and Gemini only, and has no screenshot stored before one is captured', async () => {
    const summary = await summaryOf('?include=entities,facts');
    const engines = summary.prompts.flatMap((row) => row.engines);
    expect(engines.length).toBeGreaterThan(0);
    for (const engine of engines) {
      const classified = engine.engine_code === 'chatgpt_web' || engine.engine_code === 'gemini_web';
      expect(engine.sentiment === null).toBe(!classified);
      expect(engine.recommended === null).toBe(!classified);
      if (engine.latest !== null && engine.latest !== undefined) {
        expect(engine.latest.screenshot_url).toBeNull();
        expect(engine.latest.screenshot_state).toBe('capturable');
      }
    }
  });

  it('reads the cited links and the newest answer from the answers, and the links are ranked', async () => {
    const summary = await summaryOf('?include=entities,facts');
    const withLinks = summary.prompts
      .flatMap((row) => row.engines)
      .filter((engine) => (engine.top_links ?? []).length > 0);
    expect(withLinks.length).toBeGreaterThan(0);
    for (const engine of withLinks) {
      const counts = (engine.top_links ?? []).map((link) => link.answers);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
      expect(Math.max(...counts)).toBeLessThanOrEqual(engine.mentioned.denominator);
      expect(engine.latest?.observation_id).toMatch(/^\d+$/);
    }
  });

  it('builds a topic row from its prompts: counts add up and each keyword is listed once', async () => {
    const summary = await summaryOf('?include=entities,facts');
    const topic = summary.topics.find((row) => row.term_id !== null);
    if (topic === undefined) throw new Error('The fixture has no topic');
    const members = summary.prompts.filter((row) => row.topic_term_ids.includes(topic.term_id ?? ''));
    for (const engine of topic.engines) {
      const answers = members.flatMap((row) => row.engines.filter((entry) => entry.engine_code === engine.engine_code));
      expect(engine.position?.answers).toBe(answers.reduce((sum, entry) => sum + (entry.position?.answers ?? 0), 0));
      expect(engine.position?.mentions).toBe(answers.reduce((sum, entry) => sum + (entry.position?.mentions ?? 0), 0));
    }
    const keywords = (topic.linked_keywords ?? []).map((link) => link.keyword);
    expect(new Set(keywords).size).toBe(keywords.length);
    expect(keywords.length).toBeGreaterThan(0);
  });

  it('answers the same facts every time', async () => {
    expect(await summaryOf('?include=entities,facts')).toEqual(await summaryOf('?include=entities,facts'));
  });
});
