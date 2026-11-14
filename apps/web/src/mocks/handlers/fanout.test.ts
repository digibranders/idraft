import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { aiOverviewHandlers } from './ai-overview';
import { fanoutHandlers } from './fanout';
import { fanoutQueryRows, truncatedAnswerIds, type FanoutAnswer } from '../ai-fanout-queries';
import { EVENTUS_WORLD } from '../ai-prompt-world';
import { setAiSeeded } from '../ai-seed';
import { MOCK_TERMS, MOCK_VOCABULARIES, MOCK_VOCABULARY_IDS } from '../entity-fixtures';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { promptsOf } from '../prompts-state';
import type { Schemas } from '@/lib/api/types';
import { mockBrowser, type Answer } from '@/test/mock-api';

/**
 * The route `ai/fanout-queries` is answered in ./ai-overview.ts (WP-33, WP-37), where its tests started; WP-24 added
 * the topics and the truncated count to it. These tests read the answer through a strict shape declared against the
 * generated type, so a member the mock leaves out or adds that the schema does not have fails the parse.
 */
const ENGINE = z.enum(['chatgpt_web', 'gemini_web', 'google_ai_mode']);
const ROLE = z.enum(['own', 'competitor', 'third_party']);
const FANOUT_ROW: z.ZodType<Schemas['FanoutQueryRow']> = z.strictObject({
  cited_domains: z.array(
    z.strictObject({
      citation_units: z.number(),
      domain_role: ROLE,
      registrable_domain: z.string(),
      role_entity_id: z.string().nullable(),
    }),
  ),
  engine_code: ENGINE,
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  normalized_text: z.string(),
  observations: z.number(),
  prompt_ids: z.array(z.string()),
  prompts: z.number(),
  query_text: z.string(),
  topics: z
    .array(z.strictObject({ observations: z.number(), term_id: z.string() }))
    .nullable()
    .exactOptional(),
});
const FANOUT_PAGE: z.ZodType<Schemas['FanoutQueryPage']> = z.strictObject({
  data: z.array(FANOUT_ROW),
  meta: z.strictObject({
    answers: z.number(),
    answers_truncated: z.number(),
    answers_with_fanout: z.number(),
    engine_codes: z.array(ENGINE),
    engines_without_fanout: z.array(ENGINE),
    include_branded: z.boolean(),
    min_support: z.number(),
    window: z.strictObject({ from: z.string(), to: z.string(), timezone: z.string() }),
  }),
  page: z.strictObject({ limit: z.number(), offset: z.number(), total: z.number() }),
});

/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (fynix === undefined || eventus === undefined) throw new Error('The fixture projects are missing');
const FYNIX = `${W}/projects/${fynix.project_id}/ai`;
const EVENTUS = `${W}/projects/${eventus.project_id}/ai`;
const WINDOW = 'from=2026-10-16&to=2026-11-12';

const get = (path: string): Promise<Answer> => mockBrowser('owner').call('GET', path);

async function read(base: string, query = ''): Promise<Schemas['FanoutQueryPage']> {
  const answer = await get(`${base}/fanout-queries?${WINDOW}&limit=200${query === '' ? '' : `&${query}`}`);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return FANOUT_PAGE.parse(answer.body);
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const keyOf = (row: Schemas['FanoutQueryRow']): string => `${row.engine_code}|${row.normalized_text}`;

/** The topic term ids of the prompts of a project: the terms of a vocabulary of kind topic, whatever else a prompt is tagged with. */
function topicTermsByPrompt(projectId: string): Map<string, string[]> {
  const vocabularies = [...MOCK_VOCABULARIES, EVENTUS_WORLD.vocabulary];
  const topicVocabularies = new Set(
    vocabularies.filter((vocabulary) => vocabulary.kind === 'topic').map((vocabulary) => vocabulary.vocabulary_id),
  );
  const topicTerms = new Set(
    [...MOCK_TERMS, ...EVENTUS_WORLD.terms]
      .filter((term) => topicVocabularies.has(term.vocabulary_id))
      .map((term) => term.term_id),
  );
  return new Map(
    promptsOf(projectId).prompts.map((prompt) => [
      prompt.prompt_id,
      prompt.term_ids.filter((id) => topicTerms.has(id)),
    ]),
  );
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
  setAiSeeded(false);
});

describe('the fan-out route of the mock', () => {
  it('answers what the schema says, rows and meta', async () => {
    const page = await read(FYNIX);
    expect(page.data.length).toBeGreaterThan(3);
    expect(page.page).toEqual({ offset: 0, limit: 200, total: page.data.length });
    expect(page.meta).toMatchObject({
      engine_codes: ['chatgpt_web'],
      include_branded: false,
      min_support: 2,
      window: { from: '2026-10-16', to: '2026-11-12', timezone: fynix.timezone },
    });
    expect(page.meta.answers_with_fanout).toBeLessThanOrEqual(page.meta.answers);
    for (const row of page.data) expect(row).not.toHaveProperty('topics');
  });

  it('keeps fanoutHandlers empty: the route is answered where WP-33 tested it', () => {
    expect(fanoutHandlers).toEqual([]);
    expect(aiOverviewHandlers).toHaveLength(1);
  });

  it('adds topics to every row with include=topics, and none without it', async () => {
    const asked = await read(FYNIX, 'include=topics');
    expect(asked.data.length).toBeGreaterThan(0);
    for (const row of asked.data) expect(Array.isArray(row.topics)).toBe(true);
    const plain = await read(FYNIX);
    expect(asked.data.map(keyOf)).toEqual(plain.data.map(keyOf));
    for (const row of plain.data) expect(row).not.toHaveProperty('topics');
  });

  it.each([
    ['Fynix', false, FYNIX, fynix.project_id],
    ['Eventus Security', true, EVENTUS, eventus.project_id],
  ])(
    'gives a row the topic terms of the prompts that issued it, each with its answer count, most answers first then term id, at most 10 (%s)',
    async (_, seeded, base, projectId) => {
      setAiSeeded(seeded);
      const topicsOf = topicTermsByPrompt(projectId);
      const page = await read(base, 'include=topics&min_support=1');
      expect(page.data.length).toBeGreaterThan(0);
      let tagged = 0;
      for (const row of page.data) {
        const topics = row.topics ?? [];
        const expected = new Set(row.prompt_ids.flatMap((id) => topicsOf.get(id) ?? []));
        const listed = topics.map((topic) => topic.term_id);
        expect(listed.length).toBe(Math.min(expected.size, 10));
        for (const id of listed) expect(expected.has(id)).toBe(true);
        expect(new Set(listed).size).toBe(listed.length);
        const order = topics.map((topic) => topic.observations);
        expect(order).toEqual([...order].sort((a, b) => b - a));
        for (let place = 1; place < topics.length; place += 1) {
          const [before, after] = [topics[place - 1], topics[place]];
          if (before === undefined || after === undefined) throw new Error('A topic is missing');
          if (before.observations === after.observations) {
            expect(compare(before.term_id, after.term_id)).toBeLessThan(0);
          }
        }
        tagged += topics.length;
      }
      expect(tagged).toBeGreaterThan(0);
    },
  );

  it("never counts more answers for a topic than the row's observations, and all of them in a one prompt scope", async () => {
    const page = await read(FYNIX, 'include=topics&min_support=1');
    for (const row of page.data) {
      for (const topic of row.topics ?? []) {
        expect(topic.observations).toBeGreaterThan(0);
        expect(topic.observations).toBeLessThanOrEqual(row.observations);
      }
    }
    const topicsOf = topicTermsByPrompt(fynix.project_id);
    const promptId = page.data.flatMap((row) => row.prompt_ids).find((id) => (topicsOf.get(id) ?? []).length > 0);
    if (promptId === undefined) throw new Error('No prompt with a topic issued a query');
    const one = await read(FYNIX, `include=topics&min_support=1&filter[prompt_id]=${promptId}`);
    expect(one.data.length).toBeGreaterThan(0);
    for (const row of one.data) {
      expect(row.topics?.map((topic) => topic.term_id)).toEqual(topicsOf.get(promptId));
      for (const topic of row.topics ?? []) expect(topic.observations).toBe(row.observations);
    }
  });

  it('lists only terms of a topic vocabulary, not the other terms a prompt is tagged with', async () => {
    const service = MOCK_TERMS.find((term) => term.vocabulary_id === MOCK_VOCABULARY_IDS.services);
    const all = await read(FYNIX, 'min_support=1');
    const promptId = all.data[0]?.prompt_ids[0];
    const stored = promptsOf(fynix.project_id).prompts.find((prompt) => prompt.prompt_id === promptId);
    if (service === undefined || stored === undefined) throw new Error('The fixtures have no service term or prompt');
    const before = [...stored.term_ids];
    stored.term_ids.push(service.term_id);
    try {
      const page = await read(FYNIX, 'include=topics&min_support=1');
      for (const row of page.data) {
        expect(row.topics?.map((topic) => topic.term_id)).not.toContain(service.term_id);
      }
    } finally {
      stored.term_ids.splice(0, stored.term_ids.length, ...before);
    }
  });

  it('cuts the answers that kept fewer queries: counted, never more than the answers with fan-out', async () => {
    for (const [base, seeded] of [
      [FYNIX, false],
      [EVENTUS, true],
    ] as const) {
      setAiSeeded(seeded);
      const { meta } = await read(base);
      expect(meta.answers_truncated).toBeGreaterThan(0);
      expect(meta.answers_truncated).toBeLessThanOrEqual(meta.answers_with_fanout);
    }
  });

  it('cuts the same answers on every read of a scope, whatever the minimum or the page', async () => {
    const first = await read(FYNIX);
    expect((await read(FYNIX)).meta.answers_truncated).toBe(first.meta.answers_truncated);
    expect((await read(FYNIX, 'min_support=1')).meta.answers_truncated).toBe(first.meta.answers_truncated);
    const small = await get(`${FYNIX}/fanout-queries?${WINDOW}&limit=1`);
    expect(FANOUT_PAGE.parse(small.body).meta.answers_truncated).toBe(first.meta.answers_truncated);
  });

  it('lists more rows with min_support=1 than by default, and every row of the default is in it', async () => {
    // One prompt's answers: few enough that some query was issued once
    const all = await read(FYNIX);
    const promptId = all.data[0]?.prompt_ids[0];
    if (promptId === undefined) throw new Error('No query was issued');
    const scope = `filter[prompt_id]=${promptId}`;
    const strict = await read(FYNIX, scope);
    const loose = await read(FYNIX, `${scope}&min_support=1`);
    expect(loose.data.length).toBeGreaterThan(strict.data.length);
    const listed = new Set(loose.data.map(keyOf));
    for (const row of strict.data) expect(listed.has(keyOf(row))).toBe(true);
    expect(strict.meta.min_support).toBe(2);
    expect(loose.meta.min_support).toBe(1);
  });

  it('narrows rows and meta.answers to one prompt with filter[prompt_id]', async () => {
    const all = await read(FYNIX, 'min_support=1');
    const promptId = all.data[0]?.prompt_ids[0];
    if (promptId === undefined) throw new Error('No query was issued');
    const narrowed = await read(FYNIX, `min_support=1&filter[prompt_id]=${promptId}`);
    expect(narrowed.data.length).toBeGreaterThan(0);
    for (const row of narrowed.data) expect(row.prompt_ids).toEqual([promptId]);
    expect(narrowed.meta.answers).toBeGreaterThan(0);
    expect(narrowed.meta.answers).toBeLessThan(all.meta.answers);
    expect(narrowed.meta.answers_truncated).toBeLessThanOrEqual(all.meta.answers_truncated);
  });

  it('names Gemini and AI Mode in engines_without_fanout and never in engine_codes', async () => {
    const all = await read(FYNIX);
    expect(all.meta.engine_codes).toEqual(['chatgpt_web']);
    expect(all.meta.engines_without_fanout).toEqual(['gemini_web', 'google_ai_mode']);
    const hidden = await read(FYNIX, 'filter[engine_code_in]=gemini_web,google_ai_mode');
    expect(hidden.meta.engine_codes).toEqual([]);
    expect(hidden.meta.engines_without_fanout).toEqual(['gemini_web', 'google_ai_mode']);
    expect(hidden.data).toEqual([]);
  });
});

/** Answers that take turns among the prompts, and issue queries from one pool: the ids decide which. */
function answers(count: number, prompts: readonly string[] = ['p1', 'p2', 'p3']): FanoutAnswer[] {
  return Array.from({ length: count }, (_, place) => ({
    id: String(place + 1),
    at: NOW,
    promptId: prompts[place % prompts.length] ?? 'p1',
    engine: 'chatgpt_web',
    cited: [],
  }));
}

describe('fanoutQueryRows with the terms of a prompt', () => {
  it('leaves the rows without a topics key when no terms are given', () => {
    for (const row of fanoutQueryRows(answers(60), 1)) expect(row).not.toHaveProperty('topics');
  });

  it('counts an answer once under a term even when its prompt lists the term twice', () => {
    const rows = fanoutQueryRows(answers(60), 1, () => ['t-a', 't-a']);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.topics).toEqual([{ term_id: 't-a', observations: row.observations }]);
  });

  it('gives a row with no tagged prompt an empty list, not a missing one', () => {
    for (const row of fanoutQueryRows(answers(60), 1, () => [])) expect(row.topics).toEqual([]);
  });

  it("counts a term's own answers only: a term of one prompt of a two prompt row has fewer than the row", () => {
    const terms: Record<string, string[]> = { p1: ['t-b'], p2: ['t-a', 't-b'] };
    const rows = fanoutQueryRows(answers(60, ['p1', 'p2']), 1, (promptId) => terms[promptId] ?? []);
    const both = rows.find((row) => row.prompt_ids.join() === 'p1,p2');
    if (both === undefined) throw new Error('No row was issued by p1 and p2');
    const shared = both.topics?.find((topic) => topic.term_id === 't-b');
    const own = both.topics?.find((topic) => topic.term_id === 't-a');
    expect(shared?.observations).toBe(both.observations);
    expect(own?.observations).toBeGreaterThan(0);
    expect(own?.observations).toBeLessThan(both.observations);
    // Most answers first
    expect(both.topics?.map((topic) => topic.term_id)).toEqual(['t-b', 't-a']);
  });

  it('keeps the 10 terms with the most answers, ties by term id', () => {
    const many = Array.from({ length: 12 }, (_, place) => `t-${String(place).padStart(2, '0')}`).reverse();
    const rows = fanoutQueryRows(answers(20, ['p3']), 1, () => many);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.topics?.map((topic) => topic.term_id)).toEqual(many.slice().sort().slice(0, 10));
    }
  });
});

describe('truncatedAnswerIds', () => {
  const some = answers(200);

  it('cuts some of the answers and not all, and only answers it was given', () => {
    const cut = truncatedAnswerIds(some);
    expect(cut.size).toBeGreaterThan(0);
    expect(cut.size).toBeLessThan(some.length / 2);
    const ids = new Set(some.map((answer) => answer.id));
    for (const id of cut) expect(ids.has(id)).toBe(true);
  });

  it('is the same on every call, and an answer is cut whatever answers come with it', () => {
    const cut = truncatedAnswerIds(some);
    expect([...truncatedAnswerIds(some)]).toEqual([...cut]);
    const half = truncatedAnswerIds(some.filter((_, place) => place % 2 === 0));
    for (const answer of some.filter((_, place) => place % 2 === 0)) {
      expect(half.has(answer.id)).toBe(cut.has(answer.id));
    }
  });

  it('cuts nothing from no answers', () => {
    expect(truncatedAnswerIds([]).size).toBe(0);
  });
});
