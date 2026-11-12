import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { EVENTUS_DEFINITION } from '../ai-prompt-definition';
import { EVENTUS_WORLD } from '../ai-prompt-world';
import { setAiSeeded } from '../ai-seed';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { FIXTURE_PROMPTS } from '../prompt-fixtures';
import { dataOf, mockBrowser, pageOf, type MockBrowser } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
if (eventus === undefined || fynix === undefined) throw new Error('The fixture projects are missing');
const EVENTUS = `${W}/projects/${eventus.project_id}`;
const FYNIX = `${W}/projects/${fynix.project_id}`;
const definition = EVENTUS_DEFINITION;
/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
/** Four Mondays and four Thursdays in the 28 days ending 12 November. */
const RUNS_IN_28_DAYS = 8;
const PROMPT_COUNT = 72;

const PAGE = z.object({ limit: z.number(), next_cursor: z.string().nullable(), has_more: z.boolean() });
const OFFSET_PAGE = z.object({ offset: z.number(), limit: z.number(), total: z.number() });
const PROMPT = z.object({
  prompt_id: z.string(),
  current_version: z.object({ text: z.string() }),
  country_iso: z.string(),
  language_code: z.string(),
  intent: z.string(),
  funnel_stage: z.string(),
  prompt_type: z.string(),
  importance: z.number(),
  is_branded: z.boolean(),
  is_active: z.boolean(),
  terms: z.array(z.object({ term_id: z.string(), name: z.string(), path: z.string() })),
});
const ENGINE = z.object({
  engine: z.object({ engine_code: z.string(), label: z.string() }),
  is_configured: z.boolean(),
  is_enabled: z.boolean(),
  location_ids: z.array(z.number()),
  active_prompts: z.number(),
});
const FACTS = z.object({
  is_valid: z.boolean(),
  outcome: z.string().nullable(),
  own_mentioned: z.boolean(),
  own_domain_cited: z.boolean(),
});
const OBSERVATION = z.object({
  observation_id: z.string(),
  observed_at: z.string(),
  engine_code: z.string(),
  status: z.string(),
  subject: z.object({ prompt_id: z.string() }),
  facts: FACTS.nullable(),
});
const DETAIL = OBSERVATION.extend({
  answer_text: z.string().nullable(),
  mentions: z.array(
    z.object({
      entity_id: z.string(),
      name: z.string(),
      role: z.string(),
      mention_order: z.number().nullable(),
      evidence_spans: z.array(z.tuple([z.number(), z.number()])),
    }),
  ),
  citations: z.array(z.object({ url: z.string(), domain_role: z.string(), host: z.string() })),
});
const CELL = z.object({
  value: z.number().nullable(),
  numerator: z.number(),
  denominator: z.number(),
  n_observations: z.number(),
});
const SUMMARY_ENGINE = z.object({ engine_code: z.string(), mentioned: CELL, cited: CELL });
const SUMMARY = z.object({
  engine_codes: z.array(z.string()),
  entities: z.array(z.object({ entity_id: z.string(), name: z.string(), role: z.string() })),
  prompts: z.array(
    z.object({
      prompt_id: z.string(),
      text: z.string(),
      topic_term_ids: z.array(z.string()),
      last_observed_at: z.string().nullable(),
      last_valid_at: z.string().nullable(),
      engines: z.array(SUMMARY_ENGINE),
    }),
  ),
  topics: z.array(
    z.object({
      term_id: z.string().nullable(),
      name: z.string().nullable(),
      prompt_count: z.number(),
      engines: z.array(SUMMARY_ENGINE),
    }),
  ),
});
const SCHEDULE = z.object({
  workload: z.string(),
  cadence: z.string(),
  weekday: z.number().nullable(),
  is_active: z.boolean(),
});
const ENTITY = z.object({ entity_id: z.string(), canonical_name: z.string() });
const PROJECT = z.object({ slug: z.string() });

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  setAiSeeded(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function allOf<T>(who: MockBrowser, path: string, shape: z.ZodType<T>): Promise<T[]> {
  const rows: T[] = [];
  let cursor = '';
  for (;;) {
    const answer = await who.call('GET', `${path}${path.includes('?') ? '&' : '?'}limit=200${cursor}`);
    rows.push(...dataOf(answer, z.array(shape)));
    const page = pageOf(answer, PAGE);
    if (page.next_cursor === null) return rows;
    cursor = `&cursor=${page.next_cursor}`;
  }
}

describe('Eventus Security prompts', () => {
  it('has the 72 prompts of its file, each with its country, intent, topics and brand flag', async () => {
    const rows = await allOf(mockBrowser('viewer'), `${EVENTUS}/prompts`, PROMPT);
    expect(rows).toHaveLength(PROMPT_COUNT);
    expect(new Set(rows.map((row) => row.current_version.text)).size).toBe(PROMPT_COUNT);
    for (const prompt of definition.prompts) {
      const row = rows.find((candidate) => candidate.current_version.text === prompt.text);
      expect(row).toMatchObject({
        country_iso: prompt.country,
        language_code: 'en',
        intent: prompt.intent,
        funnel_stage: prompt.funnel_stage,
        prompt_type: prompt.prompt_type,
        importance: prompt.importance,
        is_branded: prompt.branded,
        is_active: true,
      });
      expect(row?.terms.map((term) => term.term_id).sort()).toEqual(
        prompt.topics.map((slug) => EVENTUS_WORLD.termIdOf(slug)).sort(),
      );
    }
  });

  it('does not touch the prompts of Fynix, and is not there at all while the data switch is off', async () => {
    const fynixRows = await allOf(mockBrowser('viewer'), `${FYNIX}/prompts`, PROMPT);
    expect(fynixRows).toHaveLength(FIXTURE_PROMPTS.get(fynix.project_id)?.length ?? -1);
    setAiSeeded(false);
    expect(await allOf(mockBrowser('viewer'), `${EVENTUS}/prompts`, PROMPT)).toHaveLength(0);
    expect(
      dataOf(await mockBrowser('viewer').call('GET', `${EVENTUS}/engines`), z.array(ENGINE)).every(
        (e) => !e.is_enabled,
      ),
    ).toBe(true);
  });

  it('asks ChatGPT and Gemini in India, the UAE and Saudi Arabia, and counts the prompts each takes', async () => {
    const engines = dataOf(await mockBrowser('viewer').call('GET', `${EVENTUS}/engines`), z.array(ENGINE));
    const on = engines.filter((engine) => engine.is_enabled);
    expect(on.map((engine) => engine.engine.engine_code)).toEqual(['chatgpt_web', 'gemini_web']);
    for (const engine of on) {
      expect(engine.active_prompts).toBe(PROMPT_COUNT);
      expect(engine.location_ids).toEqual(expect.arrayContaining([2356, 2784, 2682]));
    }
  });
});

describe('Eventus Security answers', () => {
  it('lists every prompt on both engines for each run of the last 28 days, newest first', async () => {
    const rows = await allOf(mockBrowser('viewer'), `${EVENTUS}/ai/observations`, OBSERVATION);
    expect(rows).toHaveLength(RUNS_IN_28_DAYS * PROMPT_COUNT * 2);
    expect(rows[0]?.observed_at).toBe('2026-11-12T02:00:00.000Z');
    expect(new Set(rows.map((row) => row.engine_code))).toEqual(new Set(['chatgpt_web', 'gemini_web']));
    const invalid = rows.filter((row) => row.facts?.is_valid === false);
    expect(invalid.length / rows.length).toBeGreaterThan(0.005);
    expect(invalid.length / rows.length).toBeLessThan(0.08);
  });

  it('gives the detail of an answer with mentions that cut out the names it holds', async () => {
    const viewer = mockBrowser('viewer');
    const rows = await allOf(viewer, `${EVENTUS}/ai/observations?filter[is_valid]=true`, OBSERVATION);
    const named = rows.filter((row) => row.facts?.own_mentioned === true).slice(0, 12);
    expect(named.length).toBe(12);
    for (const row of named) {
      const detail = dataOf(
        await viewer.call('GET', `${EVENTUS}/ai/observations/${row.observation_id}?observed_at=${row.observed_at}`),
        DETAIL,
      );
      const own = detail.mentions.find((mention) => mention.role === 'own');
      const [start, end] = own?.evidence_spans[0] ?? [0, 0];
      expect(definition.brand.aliases).toContain(detail.answer_text?.slice(start, end));
      for (const citation of detail.citations) expect(citation.url).toContain(citation.host);
    }
    const raw = await viewer
      .as('admin')
      .call('GET', `${EVENTUS}/ai/observations/${named[0]?.observation_id ?? ''}/raw`);
    expect(raw.status).toBe(200);
  });
});

describe('Eventus Security summary', () => {
  it('counts what its answers hold, prompt by prompt and engine by engine', async () => {
    const viewer = mockBrowser('viewer');
    const answer = await viewer.call('GET', `${EVENTUS}/ai/prompts-summary`);
    expect(answer.status).toBe(200);
    const summary = dataOf(answer, SUMMARY);
    const rows = await allOf(viewer, `${EVENTUS}/ai/observations`, OBSERVATION);
    expect(summary.engine_codes).toEqual(['chatgpt_web', 'gemini_web']);
    // Branded prompts are left out unless asked for
    const plain = definition.prompts.filter((prompt) => !prompt.branded);
    expect(summary.prompts).toHaveLength(plain.length);
    for (const prompt of summary.prompts) {
      for (const cells of prompt.engines) {
        const own = rows.filter(
          (row) =>
            row.subject.prompt_id === prompt.prompt_id &&
            row.engine_code === cells.engine_code &&
            row.facts?.is_valid === true,
        );
        expect(cells.mentioned.denominator).toBe(own.length);
        expect(cells.mentioned.numerator).toBe(own.filter((row) => row.facts?.own_mentioned).length);
        expect(cells.cited.numerator).toBe(own.filter((row) => row.facts?.own_domain_cited).length);
      }
      expect(prompt.last_observed_at).toBe('2026-11-12T02:00:00.000Z');
      expect(prompt.last_valid_at).not.toBeNull();
    }
  });

  it('has the brand and its eight competitors, and a row for every topic it uses', async () => {
    const summary = dataOf(
      await mockBrowser('viewer').call('GET', `${EVENTUS}/ai/prompts-summary?include_branded=true`),
      SUMMARY,
    );
    expect(summary.entities).toHaveLength(9);
    expect(summary.entities.filter((entity) => entity.role === 'own').map((entity) => entity.name)).toEqual([
      'Eventus Security',
    ]);
    expect(summary.prompts).toHaveLength(PROMPT_COUNT);
    const names = summary.topics.map((topic) => topic.name);
    for (const parent of definition.topics) {
      expect(names).toContain(parent.name);
      const row = summary.topics.find((topic) => topic.name === parent.name);
      const slugs = new Set([parent.slug, ...parent.children.map((child) => child.slug)]);
      // A topic holds the prompts tagged with it or with a topic below it, each once
      expect(row?.prompt_count).toBe(
        definition.prompts.filter((prompt) => prompt.topics.some((slug) => slugs.has(slug))).length,
      );
    }
    for (const row of summary.topics) expect(row.term_id).not.toBeNull();
  });

  it('leaves the summary of Fynix exactly as it was', async () => {
    const viewer = mockBrowser('viewer');
    setAiSeeded(false);
    const before = await viewer.call('GET', `${FYNIX}/ai/prompts-summary?include_branded=true`);
    setAiSeeded(true);
    const after = await viewer.call('GET', `${FYNIX}/ai/prompts-summary?include_branded=true`);
    expect(after.body).toEqual(before.body);
  });
});

describe('Eventus Security beside the rest of the workspace', () => {
  it('returns its brand and its eight competitors with the entities', async () => {
    const rows = await allOf(mockBrowser('viewer'), `${W}/entities`, ENTITY);
    const names = rows.map((row) => row.canonical_name);
    expect(names).toContain('Eventus Security');
    for (const competitor of definition.competitors) expect(names).toContain(competitor.name);
    setAiSeeded(false);
    const without = await allOf(mockBrowser('viewer'), `${W}/entities`, ENTITY);
    expect(without.map((row) => row.canonical_name)).not.toContain('Eventus Security');
  });

  it('knows the Gulf countries of its prompts as locations, and only while its data is on', async () => {
    const countries = async (): Promise<string[]> =>
      (
        await allOf(
          mockBrowser('viewer'),
          '/api/v1/locations?filter[location_type]=Country',
          z.object({ name: z.string() }),
        )
      ).map((row) => row.name);
    expect(await countries()).toEqual(expect.arrayContaining(['India', 'United Arab Emirates', 'Saudi Arabia']));
    setAiSeeded(false);
    const without = await countries();
    expect(without).toContain('India');
    expect(without).not.toContain('Saudi Arabia');
  });

  it('shows the two AI schedules of the project, Monday and Thursday', async () => {
    const answer = await mockBrowser('viewer').call('GET', `${EVENTUS}/schedules`);
    expect(pageOf(answer, OFFSET_PAGE).total).toBe(2);
    const schedules = dataOf(answer, z.array(SCHEDULE));
    expect(
      schedules.map((schedule) => [schedule.workload, schedule.cadence, schedule.weekday, schedule.is_active]),
    ).toEqual([
      ['ai_prompt', 'weekly', 1, true],
      ['ai_prompt', 'weekly', 4, true],
    ]);
    setAiSeeded(false);
    expect(pageOf(await mockBrowser('viewer').call('GET', `${EVENTUS}/schedules`), OFFSET_PAGE).total).toBe(0);
  });

  it('lists the runs of its AI schedules, a Monday or Thursday each, and none while its data is off', async () => {
    const runs = async (): Promise<string[]> =>
      (await allOf(mockBrowser('viewer'), `${EVENTUS}/runs`, z.object({ workload: z.string() }))).map(
        (run) => run.workload,
      );
    const seeded = await runs();
    expect(seeded.length).toBeGreaterThanOrEqual(25);
    expect(new Set(seeded)).toEqual(new Set(['ai_prompt']));
    setAiSeeded(false);
    expect(await runs()).toHaveLength(0);
  });

  it('opens Eventus Security first, as the development server does, and Fynix keeps its place otherwise', async () => {
    const first = async (): Promise<string | undefined> =>
      dataOf(await mockBrowser('owner').call('GET', `${W}/projects`), z.array(PROJECT))[0]?.slug;
    expect(await first()).toBe('eventus-security');
    setAiSeeded(false);
    expect(await first()).toBe('cleanstart');
  });

  it('adds an answer to the project when Run now asks a prompt', async () => {
    const owner = mockBrowser('owner');
    const prompts = await allOf(owner, `${EVENTUS}/prompts`, PROMPT);
    const target = prompts.find((prompt) => prompt.current_version.text === definition.prompts[0]?.text);
    const queued = await owner.call('POST', `${EVENTUS}/prompts/${target?.prompt_id ?? ''}/run-now`, {
      engine_codes: ['chatgpt_web'],
    });
    expect(queued.status).toBe(202);
    const rows = await allOf(
      owner,
      `${EVENTUS}/ai/observations?filter[prompt_id]=${target?.prompt_id ?? ''}&to=2026-11-13`,
      OBSERVATION,
    );
    const delivered = rows.filter((row) => row.observed_at === new Date(NOW).toISOString());
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ engine_code: 'chatgpt_web', facts: { is_valid: true } });
  });
});
