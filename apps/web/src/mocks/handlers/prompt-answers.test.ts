import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MOCK_ENTITY_IDS, MOCK_TERM_IDS, MOCK_TERMS } from '../entity-fixtures';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { mockId } from '../mock-ids';
import {
  answerOf,
  DAY_MS,
  ENGINE_CODES,
  FIXTURE_PROMPTS,
  observationIdOf,
  runInstants,
  type Answer,
} from '../prompt-fixtures';
import { dataOf, fieldCodes, mockBrowser, pageOf, type MockBrowser } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');
const FYNIX = `${W}/projects/${fynix.project_id}`;
const CLEANSTART = `${W}/projects/${cleanstart.project_id}`;
const PROMPTS = FIXTURE_PROMPTS.get(fynix.project_id) ?? [];
/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
let clock = NOW;
/** Four Mondays and four Thursdays in the 28 days ending 12 November, 24 prompts on two engines. */
const RUNS_IN_28_DAYS = 8;
const ANSWERS_PER_RUN = 48;
const SERVICE_TERM = mockId('term', 7);
const ROCKET = String.fromCodePoint(0x1f680);
const DEVANAGARI = new RegExp(`[${String.fromCodePoint(0x900)}-${String.fromCodePoint(0x97f)}]`, 'u');

const FACTS = z.object({
  derivation_id: z.number(),
  is_valid: z.boolean(),
  outcome: z.enum(['mentioned_and_cited', 'mentioned_only', 'cited_only', 'neither']).nullable(),
  own_mentioned: z.boolean(),
  own_domain_cited: z.boolean(),
  tracked_entities_mentioned: z.number(),
  competitor_mentions: z.array(z.string()),
});
const OBSERVATION = z.object({
  observation_id: z.string(),
  observed_at: z.string(),
  observed_date: z.string(),
  engine_code: z.string(),
  status: z.enum(['complete', 'partial', 'empty', 'refused', 'error']),
  subject: z.object({
    type: z.literal('prompt'),
    prompt_id: z.string(),
    prompt_version_id: z.string(),
    version_no: z.number(),
  }),
  query_text: z.string(),
  answer_char_count: z.number().nullable(),
  citation_count: z.number(),
  facts: FACTS.nullable(),
});
const DETAIL = OBSERVATION.extend({
  answer_text: z.string().nullable(),
  error_code: z.string().nullable(),
  check_url: z.string().nullable(),
  offsets_unit: z.literal('utf16'),
  citations: z.array(
    z.object({
      citation_index: z.number(),
      url: z.string(),
      raw_url: z.string(),
      domain_role: z.enum(['own', 'competitor', 'third_party']),
      first_char_offset: z.number().nullable(),
    }),
  ),
  mentions: z.array(
    z.object({
      entity_id: z.string(),
      name: z.string(),
      role: z.string(),
      mention_order: z.number().nullable(),
      first_char_offset: z.number(),
      evidence_spans: z.array(z.tuple([z.number(), z.number()])),
    }),
  ),
});
const PAGE = z.object({ limit: z.number(), next_cursor: z.string().nullable(), has_more: z.boolean() });
const POOLED = z.object({ successes: z.number(), trials: z.number() });
const CELL = z.object({
  value: z.number().nullable(),
  numerator: z.number(),
  denominator: z.number(),
  n_observations: z.number(),
  pooled: POOLED.nullable(),
});
const ENGINE_SUMMARY = z.object({
  engine_code: z.string(),
  mentioned: CELL,
  cited: CELL,
  outcomes: z.object({
    mentioned_and_cited: CELL,
    mentioned_only: CELL,
    cited_only: CELL,
    neither: CELL,
  }),
  share_of_voice: CELL,
});
const CONTEXT = z.object({
  metric: z.string(),
  prompt_rows: z.enum(['observation_weighted', 'prompt_weighted']),
  topic_rows: z.enum(['observation_weighted', 'prompt_weighted']),
  method: z.string(),
});
const SUMMARY = z.object({
  window: z.object({ from: z.string(), to: z.string(), timezone: z.string() }),
  include_branded: z.boolean(),
  branded_only: z.boolean(),
  engine_codes: z.array(z.string()),
  metric_context: z.object({
    mentioned: CONTEXT,
    cited: CONTEXT,
    outcomes: CONTEXT,
    share_of_voice: CONTEXT,
  }),
  entities: z.array(z.object({ entity_id: z.string(), name: z.string(), role: z.enum(['own', 'competitor']) })),
  entity_config_versions: z.array(z.number()),
  prompts: z.array(
    z.object({
      prompt_id: z.string(),
      text: z.string(),
      is_branded: z.boolean(),
      topic_term_ids: z.array(z.string()),
      last_observed_at: z.string().nullable(),
      last_valid_at: z.string().nullable(),
      engines: z.array(ENGINE_SUMMARY),
    }),
  ),
  topics: z.array(
    z.object({
      term_id: z.string().nullable(),
      name: z.string().nullable(),
      prompt_count: z.number(),
      last_observed_at: z.string().nullable(),
      last_valid_at: z.string().nullable(),
      engines: z.array(ENGINE_SUMMARY),
    }),
  ),
});
type Observation = z.infer<typeof OBSERVATION>;
type Summary = z.infer<typeof SUMMARY>;
type EngineSummary = z.infer<typeof ENGINE_SUMMARY>;
type Cell = z.infer<typeof CELL>;
const PROBLEM = z.object({ code: z.string(), limit_days: z.number().optional() });

beforeEach(() => {
  clock = NOW;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const item = (text: string, country = 'DE'): Record<string, string> => ({
  text,
  language_code: 'en',
  country_iso: country,
});

/** Every row of a list, page after page. */
async function listAll(who: MockBrowser, query: string): Promise<Observation[]> {
  const rows: Observation[] = [];
  let cursor = '';
  for (;;) {
    const answer = await who.call('GET', `${FYNIX}/ai/observations?limit=200${query}${cursor}`);
    rows.push(...dataOf(answer, z.array(OBSERVATION)));
    const page = pageOf(answer, PAGE);
    if (page.next_cursor === null) return rows;
    cursor = `&cursor=${page.next_cursor}`;
  }
}

describe('answers list', () => {
  it('gives the last 28 days newest first, every prompt on every engine it was asked on', async () => {
    const rows = await listAll(mockBrowser('viewer'), '');
    expect(rows).toHaveLength(RUNS_IN_28_DAYS * ANSWERS_PER_RUN);
    expect(rows[0]?.observed_at).toBe('2026-11-12T02:00:00.000Z');
    expect(rows[0]?.observed_date).toBe('2026-11-12');
    const order = rows.map((row) => [Date.parse(row.observed_at), BigInt(row.observation_id)] as const);
    const sorted = [...order].sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));
    expect(order).toEqual(sorted);
    for (const row of rows) {
      expect(row.observation_id).toMatch(/^\d+$/);
      expect(row.subject).toMatchObject({ type: 'prompt', version_no: 1 });
      expect(row.query_text).toBe(PROMPTS.find((prompt) => prompt.prompt_id === row.subject.prompt_id)?.text);
    }
    // The branded prompt is listed too; only the summary leaves it out
    expect(rows.some((row) => row.subject.prompt_id === PROMPTS[7]?.prompt_id)).toBe(true);
  });

  it('takes project days for from and to, to included, and instants as they are', async () => {
    const viewer = mockBrowser('viewer');
    const monday = await listAll(viewer, '&from=2026-11-09&to=2026-11-09');
    expect(monday).toHaveLength(ANSWERS_PER_RUN);
    expect(new Set(monday.map((row) => row.observed_at))).toEqual(new Set(['2026-11-09T02:00:00.000Z']));
    expect(await listAll(viewer, '&from=2026-11-09&to=2026-11-12')).toHaveLength(2 * ANSWERS_PER_RUN);
    expect(await listAll(viewer, '&from=2026-11-12T00:00:00Z&to=2026-11-12T01:00:00Z')).toHaveLength(0);
    expect(await listAll(viewer, '&from=2026-11-12T02:00:00Z&to=2026-11-12T02:00:01Z')).toHaveLength(ANSWERS_PER_RUN);
    expect(await listAll(viewer, '&from=2026-11-12T02:00:00%2B00:00&to=2026-11-12T02:00:00Z')).toHaveLength(0);
  });

  it('refuses a window over 92 days as a problem that says the limit, and a value that is not a date', async () => {
    const viewer = mockBrowser('viewer');
    const wide = await viewer.call('GET', `${FYNIX}/ai/observations?from=2026-01-01&to=2026-11-12`);
    expect(wide.status).toBe(422);
    expect(PROBLEM.parse(wide.body)).toMatchObject({ code: 'window_too_large', limit_days: 92 });
    expect((await viewer.call('GET', `${FYNIX}/ai/observations?from=2026-08-14&to=2026-11-12`)).status).toBe(200);
    expect(fieldCodes(await viewer.call('GET', `${FYNIX}/ai/observations?from=yesterday`))).toEqual([
      'from:date_parsing',
    ]);
    expect(fieldCodes(await viewer.call('GET', `${FYNIX}/ai/observations?to=2026-11-12T10:00:00`))).toEqual([
      'to:timezone_aware',
    ]);
  });

  it('has refused, empty, failed and cut off answers among its rows', async () => {
    const rows = await listAll(mockBrowser('viewer'), '&from=2026-08-14&to=2026-11-12');
    expect(new Set(rows.map((row) => row.status))).toEqual(
      new Set(['complete', 'partial', 'empty', 'refused', 'error']),
    );
    for (const row of rows) {
      const valid = row.status === 'complete' || row.status === 'partial';
      expect(row.facts?.is_valid).toBe(valid);
      // An answer that is not valid is in no bucket
      expect(row.facts?.outcome === null).toBe(!valid);
    }
  });

  it('filters by engine, prompt, status, validity and outcome, and an outcome belongs to valid answers only', async () => {
    const viewer = mockBrowser('viewer');
    const window = '&from=2026-08-14&to=2026-11-12';
    const gemini = await listAll(viewer, `${window}&filter[engine_code_in]=gemini_web`);
    expect(gemini.length).toBeGreaterThan(0);
    expect(gemini.every((row) => row.engine_code === 'gemini_web')).toBe(true);
    const id = PROMPTS[3]?.prompt_id ?? '';
    const one = await listAll(viewer, `${window}&filter[prompt_id]=${id}`);
    expect(one.length).toBeGreaterThan(0);
    expect(one.every((row) => row.subject.prompt_id === id)).toBe(true);
    const bad = await listAll(viewer, `${window}&filter[status_in]=refused,error`);
    expect(new Set(bad.map((row) => row.status))).toEqual(new Set(['refused', 'error']));
    const invalid = await listAll(viewer, `${window}&filter[is_valid]=false`);
    expect(invalid.every((row) => row.facts?.is_valid === false)).toBe(true);
    expect(new Set(invalid.map((row) => row.status))).toEqual(new Set(['empty', 'refused', 'error']));
    const neither = await listAll(viewer, `${window}&filter[outcome_in]=neither,cited_only`);
    expect(neither.length).toBeGreaterThan(0);
    for (const row of neither) {
      expect(row.facts?.is_valid).toBe(true);
      expect(['neither', 'cited_only']).toContain(row.facts?.outcome);
    }
    // A refusal has both own flags false, and is still not a "neither"
    expect(neither.some((row) => row.status === 'refused')).toBe(false);
    expect(fieldCodes(await viewer.call('GET', `${FYNIX}/ai/observations?filter[status_in]=lost`))).toEqual([
      'filter[status_in]:enum',
    ]);
    expect(fieldCodes(await viewer.call('GET', `${FYNIX}/ai/observations?filter[prompt_id]=7`))).toEqual([
      'filter[prompt_id]:uuid_parsing',
    ]);
  });

  it('pages with a cursor that is bound to its filters', async () => {
    const viewer = mockBrowser('viewer');
    const first = await viewer.call('GET', `${FYNIX}/ai/observations?limit=5`);
    expect(dataOf(first, z.array(OBSERVATION))).toHaveLength(5);
    const page = pageOf(first, PAGE);
    expect(page.has_more).toBe(true);
    const second = await viewer.call('GET', `${FYNIX}/ai/observations?limit=5&cursor=${page.next_cursor ?? ''}`);
    const next = dataOf(second, z.array(OBSERVATION));
    expect(next).toHaveLength(5);
    expect(next.map((row) => row.observation_id)).not.toEqual(
      dataOf(first, z.array(OBSERVATION)).map((row) => row.observation_id),
    );
    const other = await viewer.call(
      'GET',
      `${FYNIX}/ai/observations?limit=5&filter[engine_code_in]=gemini_web&cursor=${page.next_cursor ?? ''}`,
    );
    expect(other.status).toBe(400);
    expect(other.code).toBe('invalid_cursor');
  });

  it('keeps the answers of an archived prompt, and has none for a prompt added here', async () => {
    const editor = mockBrowser('editor');
    expect((await editor.call('DELETE', `${FYNIX}/prompts/${PROMPTS[1]?.prompt_id ?? ''}`)).status).toBe(204);
    const kept = await listAll(editor, `&filter[prompt_id]=${PROMPTS[1]?.prompt_id ?? ''}`);
    expect(kept).toHaveLength(RUNS_IN_28_DAYS * 2);
    const added = dataOf(
      await editor.call('POST', `${FYNIX}/prompts`, item('Which agency audits shop sites in Munich?')),
      z.object({ prompt_id: z.string() }),
    );
    expect(await listAll(editor, `&filter[prompt_id]=${added.prompt_id}`)).toEqual([]);
  });

  it('answers a project with no answers with an empty page', async () => {
    const answer = await mockBrowser('viewer').call('GET', `${CLEANSTART}/ai/observations`);
    expect(dataOf(answer, z.array(OBSERVATION))).toEqual([]);
    expect(pageOf(answer, PAGE)).toMatchObject({ has_more: false, next_cursor: null });
  });
});

/** The id of the newest fixture answer of the 28 days that `test` picks, with the prompt it answers. */
function answerWhere(test: (answer: Answer, languageCode: string) => boolean): string {
  for (const at of runInstants(NOW).slice(0, RUNS_IN_28_DAYS)) {
    const day = Math.floor(at / DAY_MS);
    for (const prompt of PROMPTS) {
      for (const engine of ['chatgpt_web', 'gemini_web'] as const) {
        if (
          prompt.index !== null &&
          test(answerOf(prompt.index, prompt.language_code, engine, day), prompt.language_code)
        ) {
          return observationIdOf(day, prompt.index, ENGINE_CODES.indexOf(engine));
        }
      }
    }
  }
  throw new Error('No fixture answer matches');
}

describe('one answer', () => {
  it('has its text, its mentions as UTF-16 spans into the text, and its sources with their roles', async () => {
    const viewer = mockBrowser('viewer');
    const id = answerWhere(
      (answer) =>
        answer.facts.outcome === 'mentioned_and_cited' &&
        answer.mentions.some((mention) => mention.role === 'competitor') &&
        answer.citations.some((citation) => citation.domain_role === 'third_party'),
    );
    const answer = await viewer.call('GET', `${FYNIX}/ai/observations/${id}`);
    expect(answer.status).toBe(200);
    const detail = dataOf(answer, DETAIL);
    expect(detail.observation_id).toBe(id);
    expect(detail.offsets_unit).toBe('utf16');
    expect(detail.facts?.outcome).toBe('mentioned_and_cited');
    const own = detail.mentions.find((mention) => mention.role === 'own');
    const [start, end] = own?.evidence_spans[0] ?? [0, 0];
    expect(detail.answer_text?.slice(start, end)).toBe('Fynix');
    expect(own?.first_char_offset).toBe(start);
    expect(detail.citations.map((citation) => citation.domain_role)).toEqual(
      expect.arrayContaining(['own', 'third_party']),
    );
    expect(detail.answer_char_count).toBe([...(detail.answer_text ?? '')].length);
    expect(detail.citation_count).toBe(detail.citations.length);
    // The list gives the same row without the text
    const listed = (await listAll(viewer, '')).find((row) => row.observation_id === id);
    expect(listed).toEqual(OBSERVATION.parse(detail));
  });

  it('counts offsets in UTF-16 units: after an emoji, and in Hindi', async () => {
    const viewer = mockBrowser('viewer');
    const emojiId = answerWhere((answer) =>
      answer.mentions.some((mention) => {
        const start = mention.evidence_spans[0]?.[0] ?? 0;
        return [...(answer.answer_text ?? '').slice(0, start)].some((char) => (char.codePointAt(0) ?? 0) > 0xffff);
      }),
    );
    const hindiId = answerWhere((answer, language) => language === 'hi' && answer.mentions.length > 0);
    for (const id of [emojiId, hindiId]) {
      const detail = dataOf(await viewer.call('GET', `${FYNIX}/ai/observations/${id}`), DETAIL);
      const text = detail.answer_text ?? '';
      expect(detail.mentions.length).toBeGreaterThan(0);
      for (const mention of detail.mentions) {
        for (const [start, end] of mention.evidence_spans) {
          expect(text.slice(start, end).length).toBe(end - start);
          expect(['Fynix', 'Fynix Audit', mention.name]).toContain(text.slice(start, end));
        }
      }
    }
    const emoji = dataOf(await viewer.call('GET', `${FYNIX}/ai/observations/${emojiId}`), DETAIL).answer_text ?? '';
    expect([...emoji].length).toBeLessThan(emoji.length);
    expect(emoji.includes(ROCKET) || [...emoji].some((char) => (char.codePointAt(0) ?? 0) > 0xffff)).toBe(true);
    expect(
      DEVANAGARI.test(
        dataOf(await viewer.call('GET', `${FYNIX}/ai/observations/${hindiId}`), DETAIL).answer_text ?? '',
      ),
    ).toBe(true);
  });

  it('gives a source its canonical address as the link, and the string the provider gave apart from it', async () => {
    const viewer = mockBrowser('viewer');
    const id = answerWhere((answer) => answer.citations.some((citation) => citation.raw_url !== citation.url));
    const detail = dataOf(await viewer.call('GET', `${FYNIX}/ai/observations/${id}`), DETAIL);
    const moved = detail.citations.find((citation) => citation.raw_url !== citation.url);
    expect(moved?.url).toMatch(/^https?:\/\//);
    expect(moved?.url).not.toContain('utm_source');
    expect(moved?.raw_url).toContain(moved?.url ?? '?');
  });

  it('has no text, mention or source for a failed, empty or refused answer, and no outcome', async () => {
    const viewer = mockBrowser('viewer');
    for (const status of ['error', 'empty', 'refused'] as const) {
      const id = answerWhere((answer) => answer.status === status);
      const detail = dataOf(await viewer.call('GET', `${FYNIX}/ai/observations/${id}`), DETAIL);
      expect(detail).toMatchObject({ status, mentions: [], citations: [], facts: { is_valid: false, outcome: null } });
      expect(detail.answer_text === null).toBe(status !== 'refused');
      expect(detail.error_code === null).toBe(status !== 'error');
    }
  });

  it('gives a check link only as an http or https address', async () => {
    const viewer = mockBrowser('viewer');
    const links = new Set<string | null>();
    for (const at of runInstants(NOW).slice(0, 4)) {
      const day = Math.floor(at / DAY_MS);
      for (let index = 0; index < PROMPTS.length; index += 1) {
        const id = observationIdOf(day, index, 0);
        const detail = dataOf(await viewer.call('GET', `${FYNIX}/ai/observations/${id}`), DETAIL);
        links.add(detail.check_url);
        if (detail.check_url !== null) expect(detail.check_url).toMatch(/^https?:\/\//i);
      }
    }
    expect(links.size).toBeGreaterThan(1);
  });

  it('is found by its number, which is a 64-bit integer in the path, whatever its hint', async () => {
    const viewer = mockBrowser('viewer');
    const id = observationIdOf(Math.floor(NOW / DAY_MS), 0, 0);
    const at = '2026-11-12T02:00:00Z';
    expect((await viewer.call('GET', `${FYNIX}/ai/observations/${id}?observed_at=${at}`)).status).toBe(200);
    // The hint finds the month: a day either side is allowed, a week off finds nothing
    expect((await viewer.call('GET', `${FYNIX}/ai/observations/${id}?observed_at=2026-11-13T01:00:00Z`)).status).toBe(
      200,
    );
    expect((await viewer.call('GET', `${FYNIX}/ai/observations/${id}?observed_at=2026-11-05T02:00:00Z`)).code).toBe(
      'not_found',
    );
    expect(fieldCodes(await viewer.call('GET', `${FYNIX}/ai/observations/${id}?observed_at=soon`))).toEqual([
      'observed_at:datetime_from_date_parsing',
    ]);
    expect(dataOf(await viewer.call('GET', `${FYNIX}/ai/observations/000${id}`), DETAIL).observation_id).toBe(id);
    expect((await viewer.call('GET', `${FYNIX}/ai/observations/9`)).code).toBe('not_found');
    expect(fieldCodes(await viewer.call('GET', `${FYNIX}/ai/observations/abc`))).toEqual([
      'observation_id:int_parsing',
    ]);
    expect(fieldCodes(await viewer.call('GET', `${FYNIX}/ai/observations/0`))).toEqual([
      'observation_id:greater_than_equal',
    ]);
    expect(fieldCodes(await viewer.call('GET', `${FYNIX}/ai/observations/9223372036854775808`))).toEqual([
      'observation_id:less_than_equal',
    ]);
    // The largest the API takes is a number nothing answers to, not an error
    expect((await viewer.call('GET', `${FYNIX}/ai/observations/9223372036854775807`)).code).toBe('not_found');
    // An answer of another project is not found in this one
    expect((await viewer.call('GET', `${CLEANSTART}/ai/observations/${id}`)).code).toBe('not_found');
  });

  it('is not found when the prompt was not asked on that engine that day', async () => {
    const viewer = mockBrowser('viewer');
    const today = Math.floor(NOW / DAY_MS);
    // 11 November is a Wednesday: no run
    expect((await viewer.call('GET', `${FYNIX}/ai/observations/${observationIdOf(today - 1, 0, 0)}`)).code).toBe(
      'not_found',
    );
    // AI Mode is off for Fynix and was never asked
    expect((await viewer.call('GET', `${FYNIX}/ai/observations/${observationIdOf(today, 0, 2)}`)).code).toBe(
      'not_found',
    );
  });
});

describe('the raw answer', () => {
  const idOf = (): string => observationIdOf(Math.floor(NOW / DAY_MS), 2, 1);

  it('is the JSON the provider sent, as a download, for a member who may read raw answers', async () => {
    const analyst = mockBrowser('analyst');
    const answer = await analyst.call('GET', `${FYNIX}/ai/observations/${idOf()}/raw`);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toContain('application/json');
    expect(answer.headers.get('content-disposition')).toBe(`attachment; filename="ai-observation-${idOf()}.json"`);
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
    expect(answer.headers.get('content-security-policy')).toBe('sandbox');
    expect(answer.headers.get('cache-control')).toBe('private, no-store');
    expect(answer.body).toHaveProperty('tasks');
    const hint = await analyst.call('GET', `${FYNIX}/ai/observations/${idOf()}/raw?observed_at=2026-11-12T02:00:00Z`);
    expect(hint.status).toBe(200);
    expect(
      (await analyst.call('GET', `${FYNIX}/ai/observations/${idOf()}/raw?observed_at=2026-10-01T00:00:00Z`)).code,
    ).toBe('not_found');
  });

  it('is refused to a viewer, and not found for a number that is no answer', async () => {
    expect((await mockBrowser('viewer').call('GET', `${FYNIX}/ai/observations/${idOf()}/raw`)).code).toBe('forbidden');
    expect((await mockBrowser('analyst').call('GET', `${FYNIX}/ai/observations/9/raw`)).code).toBe('not_found');
    expect(fieldCodes(await mockBrowser('analyst').call('GET', `${FYNIX}/ai/observations/abc/raw`))).toEqual([
      'observation_id:int_parsing',
    ]);
  });
});

// The prompts summary

const summaryOf = async (who: MockBrowser, query = '', project = FYNIX): Promise<Summary> =>
  dataOf(await who.call('GET', `${project}/ai/prompts-summary${query}`), SUMMARY);
/** The newest `observed_at` of the answers, `null` when there are none. */
const newest = (rows: readonly Observation[]): string | null =>
  rows.reduce<string | null>(
    (best, row) => (best === null || Date.parse(row.observed_at) > Date.parse(best) ? row.observed_at : best),
    null,
  );
const PARENT_OF = new Map(MOCK_TERMS.map((term) => [term.term_id, term.parent_id ?? null]));
/** The term and every term above it, as the API's path prefixes give them. */
function withAncestors(termId: string): string[] {
  const chain: string[] = [];
  for (let at: string | null | undefined = termId; at !== null && at !== undefined; at = PARENT_OF.get(at))
    chain.push(at);
  return chain;
}
const engineOf = (
  summary: z.infer<typeof SUMMARY>['prompts'][number] | z.infer<typeof SUMMARY>['topics'][number],
  code: string,
): EngineSummary => {
  const found = summary.engines.find((engine) => engine.engine_code === code);
  if (found === undefined) throw new Error(`No ${code} cells`);
  return found;
};
const cellOf = (engine: EngineSummary, metric: string): Cell => {
  const [head, tail] = metric.split('.');
  const found =
    head === 'outcomes'
      ? engine.outcomes[tail as keyof EngineSummary['outcomes']]
      : engine[head as 'mentioned' | 'cited' | 'share_of_voice'];
  return found;
};
const METRICS = [
  'mentioned',
  'cited',
  'outcomes.mentioned_and_cited',
  'outcomes.mentioned_only',
  'outcomes.cited_only',
  'outcomes.neither',
] as const;

describe('prompts summary', () => {
  it('gives the 28 project days ending today, every prompt but the branded one, on the engines that are on', async () => {
    const summary = await summaryOf(mockBrowser('viewer'));
    expect(summary.window).toEqual({ from: '2026-10-16', to: '2026-11-12', timezone: 'Europe/Berlin' });
    expect(summary).toMatchObject({ include_branded: false, engine_codes: ['chatgpt_web', 'gemini_web'] });
    expect(summary.prompts).toHaveLength(23);
    expect(summary.prompts.some((row) => row.is_branded)).toBe(false);
    expect(summary.prompts.map((row) => row.prompt_id)).toEqual(
      PROMPTS.filter((prompt) => !prompt.is_branded).map((prompt) => prompt.prompt_id),
    );
    expect(summary.prompts[0]).toMatchObject({ text: PROMPTS[0]?.text, topic_term_ids: [MOCK_TERM_IDS.seo] });
    expect(
      summary.prompts.every(
        (row) => row.engines.map((engine) => engine.engine_code).join() === 'chatgpt_web,gemini_web',
      ),
    ).toBe(true);
    const branded = await summaryOf(mockBrowser('viewer'), '?include_branded=true');
    expect(branded.prompts).toHaveLength(24);
    expect(branded.prompts.find((row) => row.is_branded)?.text).toBe(PROMPTS[7]?.text);
  });

  it('says how each kind of cell is weighted, and which entities share of voice is over', async () => {
    const summary = await summaryOf(mockBrowser('viewer'));
    expect(Object.keys(summary.metric_context)).toEqual(['mentioned', 'cited', 'outcomes', 'share_of_voice']);
    expect(summary.metric_context).toMatchObject({
      mentioned: { metric: 'ai.mention_rate', prompt_rows: 'observation_weighted', topic_rows: 'prompt_weighted' },
      cited: { metric: 'ai.citation_rate', prompt_rows: 'observation_weighted', topic_rows: 'prompt_weighted' },
      outcomes: { metric: 'ai.outcome_mix', prompt_rows: 'observation_weighted', topic_rows: 'prompt_weighted' },
      share_of_voice: {
        metric: 'ai.share_of_voice',
        prompt_rows: 'observation_weighted',
        topic_rows: 'observation_weighted',
      },
    });
    for (const context of Object.values(summary.metric_context)) expect(context.method).not.toBe('');
    // The own brand, then... by role (the API sorts competitor before own) and name; the watched publication is out
    expect(summary.entities.map((entity) => [entity.name, entity.role])).toEqual([
      ['Brightwave Digital', 'competitor'],
      ['Clickvantage', 'competitor'],
      ['Meridian Growth', 'competitor'],
      ['Northlight SEO', 'competitor'],
      ['Rankforge', 'competitor'],
      ['Fynix', 'own'],
    ]);
    expect(summary.entities.some((entity) => entity.entity_id === MOCK_ENTITY_IDS.seoWeekly)).toBe(false);
    expect(summary.entity_config_versions).toEqual([1]);
  });

  it('counts the valid answers of a prompt on an engine as the answers themselves say: plain counts, no pooled', async () => {
    const viewer = mockBrowser('viewer');
    const summary = await summaryOf(viewer);
    const rows = await listAll(viewer, '&from=2026-10-16&to=2026-11-12');
    expect(rows).toHaveLength(RUNS_IN_28_DAYS * ANSWERS_PER_RUN);
    let someInvalid = false;
    for (const prompt of summary.prompts) {
      for (const engine of prompt.engines) {
        const mine = rows.filter(
          (row) => row.subject.prompt_id === prompt.prompt_id && row.engine_code === engine.engine_code,
        );
        const valid = mine.filter((row) => row.facts?.is_valid === true);
        const count = (test: (facts: NonNullable<Observation['facts']>) => boolean): number =>
          valid.filter((row) => row.facts !== null && test(row.facts)).length;
        const naming = valid.filter((row) => (row.facts?.tracked_entities_mentioned ?? 0) > 0);
        const share = naming.reduce(
          (sum, row) =>
            sum +
            ((row.facts?.tracked_entities_mentioned ?? 0) - (row.facts?.competitor_mentions.length ?? 0)) /
              (row.facts?.tracked_entities_mentioned ?? 1),
          0,
        );
        const cell = (numerator: number, denominator: number): Cell => ({
          value: denominator === 0 ? null : numerator / denominator,
          numerator,
          denominator,
          n_observations: mine.length,
          pooled: null,
        });
        expect(engine.mentioned).toEqual(
          cell(
            count((facts) => facts.own_mentioned),
            valid.length,
          ),
        );
        expect(engine.cited).toEqual(
          cell(
            count((facts) => facts.own_domain_cited),
            valid.length,
          ),
        );
        expect(engine.outcomes.mentioned_and_cited).toEqual(
          cell(
            count((facts) => facts.outcome === 'mentioned_and_cited'),
            valid.length,
          ),
        );
        expect(engine.outcomes.mentioned_only).toEqual(
          cell(
            count((facts) => facts.outcome === 'mentioned_only'),
            valid.length,
          ),
        );
        expect(engine.outcomes.cited_only).toEqual(
          cell(
            count((facts) => facts.outcome === 'cited_only'),
            valid.length,
          ),
        );
        expect(engine.outcomes.neither).toEqual(
          cell(
            count((facts) => facts.outcome === 'neither'),
            valid.length,
          ),
        );
        expect(engine.share_of_voice.numerator).toBeCloseTo(share, 10);
        expect(engine.share_of_voice).toMatchObject({
          denominator: naming.length,
          n_observations: mine.length,
          pooled: null,
        });
        const parts = METRICS.slice(2).map((metric) => cellOf(engine, metric).numerator);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(valid.length);
        // Eight runs: every answer counts in n_observations, valid or not
        expect(mine).toHaveLength(RUNS_IN_28_DAYS);
        if (valid.length < mine.length) someInvalid = true;
      }
    }
    expect(someInvalid).toBe(true);
  });

  it('weighs the rates of a topic by prompt: the mean of the rates of its prompts, with the answers pooled beside it', async () => {
    const summary = await summaryOf(mockBrowser('viewer'));
    expect(summary.topics.map((topic) => topic.name)).toEqual([
      'Blog Strategy',
      'Content Marketing',
      'Local SEO',
      'Paid Search',
      'SEO',
      'Technical SEO',
      null,
    ]);
    expect(summary.topics.at(-1)).toMatchObject({ term_id: null, prompt_count: 2 });
    let fractional = false;
    for (const topic of summary.topics) {
      const members = summary.prompts.filter((prompt) =>
        topic.term_id === null
          ? prompt.topic_term_ids.length === 0
          : prompt.topic_term_ids.some((term) => withAncestors(term).includes(topic.term_id ?? '')),
      );
      expect(topic.prompt_count).toBe(members.length);
      for (const code of summary.engine_codes) {
        const mine = members.map((prompt) => engineOf(prompt, code));
        const there = engineOf(topic, code);
        for (const metric of METRICS) {
          const rated = mine.map((engine) => cellOf(engine, metric)).filter((cell) => cell.denominator > 0);
          const numerator = rated.reduce((sum, cell) => sum + (cell.value ?? 0), 0);
          const cell = cellOf(there, metric);
          expect(cell.numerator).toBeCloseTo(numerator, 10);
          expect(cell.denominator).toBe(rated.length);
          if (rated.length === 0) expect(cell.value).toBeNull();
          else expect(cell.value).toBeCloseTo(numerator / rated.length, 10);
          expect(cell.n_observations).toBe(
            mine.reduce((sum, engine) => sum + cellOf(engine, metric).n_observations, 0),
          );
          expect(cell.pooled).toEqual({
            successes: rated.reduce((sum, one) => sum + one.numerator, 0),
            trials: rated.reduce((sum, one) => sum + one.denominator, 0),
          });
          if (!Number.isInteger(cell.numerator)) fractional = true;
        }
        // Share of voice stays one answer one weight: the sums of the prompts' counts, nothing pooled
        const sov = there.share_of_voice;
        expect(sov.numerator).toBeCloseTo(
          mine.reduce((sum, engine) => sum + engine.share_of_voice.numerator, 0),
          10,
        );
        expect(sov.denominator).toBe(mine.reduce((sum, engine) => sum + engine.share_of_voice.denominator, 0));
        expect(sov.n_observations).toBe(mine.reduce((sum, engine) => sum + engine.share_of_voice.n_observations, 0));
        expect(sov.pooled).toBeNull();
      }
    }
    // A sum of rates is not a count of answers
    expect(fractional).toBe(true);
  });

  it('puts a prompt in the topics above its own, once each, and in both topics of two', async () => {
    const editor = mockBrowser('editor');
    const before = await summaryOf(editor);
    const seoBefore = before.topics.find((topic) => topic.term_id === MOCK_TERM_IDS.seo);
    // A parent holds its children's prompts: SEO has 5 of its own (the sixth is branded), Technical SEO 4 and Local SEO 3
    expect(seoBefore?.prompt_count).toBe(12);
    expect(before.topics.find((topic) => topic.term_id === MOCK_TERM_IDS.technicalSeo)?.prompt_count).toBe(4);
    expect(before.topics.find((topic) => topic.term_id === MOCK_TERM_IDS.localSeo)?.prompt_count).toBe(3);
    const id = PROMPTS[0]?.prompt_id ?? '';
    const terms = [MOCK_TERM_IDS.technicalSeo, MOCK_TERM_IDS.localSeo];
    expect((await editor.call('PATCH', `${FYNIX}/prompts/${id}`, { term_ids: terms })).status).toBe(200);
    const after = await summaryOf(editor);
    // Two terms below SEO: the prompt is in SEO once, and in both of them
    expect(after.topics.find((topic) => topic.term_id === MOCK_TERM_IDS.seo)?.prompt_count).toBe(12);
    expect(after.topics.find((topic) => topic.term_id === MOCK_TERM_IDS.technicalSeo)?.prompt_count).toBe(5);
    expect(after.topics.find((topic) => topic.term_id === MOCK_TERM_IDS.localSeo)?.prompt_count).toBe(4);
    expect(after.prompts[0]?.topic_term_ids).toEqual([...terms].sort());
  });

  it('counts a term that is not a topic for nothing: a prompt with only that is a prompt without a topic', async () => {
    const editor = mockBrowser('editor');
    const id = PROMPTS[0]?.prompt_id ?? '';
    expect((await editor.call('PATCH', `${FYNIX}/prompts/${id}`, { term_ids: [SERVICE_TERM] })).status).toBe(200);
    const summary = await summaryOf(editor);
    expect(summary.prompts[0]?.topic_term_ids).toEqual([]);
    expect(summary.topics.some((topic) => topic.term_id === SERVICE_TERM)).toBe(false);
    expect(summary.topics.at(-1)).toMatchObject({ term_id: null, prompt_count: 3 });
  });

  it('adds the branded prompt to the topics when it is asked for', async () => {
    const summary = await summaryOf(mockBrowser('viewer'), '?include_branded=true');
    expect(summary.topics.find((topic) => topic.term_id === MOCK_TERM_IDS.seo)?.prompt_count).toBe(13);
  });

  it('shows the engines that are on or have answers in the window, and only those the filter names', async () => {
    const editor = mockBrowser('editor');
    expect((await editor.call('DELETE', `${FYNIX}/engines/gemini_web`)).status).toBe(204);
    // Off now, but it has answers in the window
    expect((await summaryOf(editor)).engine_codes).toEqual(['chatgpt_web', 'gemini_web']);
    // A window with no answers of its own shows only what is on
    const quiet = await summaryOf(editor, '?from=2026-11-10&to=2026-11-11');
    expect(quiet.engine_codes).toEqual(['chatgpt_web']);
    expect(quiet.prompts[0]?.engines[0]?.mentioned).toEqual({
      value: null,
      numerator: 0,
      denominator: 0,
      n_observations: 0,
      pooled: null,
    });
    // On, with nothing asked yet: shown with empty cells
    await editor.call('PUT', `${FYNIX}/engines/google_ai_mode`, { location_ids: [2276, 2356] });
    const withMode = await summaryOf(editor);
    expect(withMode.engine_codes).toEqual(['chatgpt_web', 'gemini_web', 'google_ai_mode']);
    expect(withMode.prompts[0]?.engines.at(-1)?.mentioned.n_observations).toBe(0);
    const only = await summaryOf(editor, '?filter[engine_code_in]=gemini_web');
    expect(only.engine_codes).toEqual(['gemini_web']);
    expect(only.prompts.every((row) => row.engines.length === 1)).toBe(true);
    // Any text is taken for an engine; one that is none shows nothing
    expect((await summaryOf(editor, '?filter[engine_code_in]=bing')).engine_codes).toEqual([]);
  });

  it('counts only the answers of the days asked for, in the days of the project', async () => {
    const viewer = mockBrowser('viewer');
    const monday = await summaryOf(viewer, '?from=2026-11-09&to=2026-11-09');
    expect(monday.window).toEqual({ from: '2026-11-09', to: '2026-11-09', timezone: 'Europe/Berlin' });
    expect(monday.prompts.every((row) => row.engines.every((engine) => engine.mentioned.n_observations === 1))).toBe(
      true,
    );
    // 23:30 UTC is already the 13th in Berlin: the window ends there, and the 12 November run is in it
    clock = Date.parse('2026-11-12T23:30:00Z');
    const late = await summaryOf(mockBrowser('viewer'));
    expect(late.window).toEqual({ from: '2026-10-17', to: '2026-11-13', timezone: 'Europe/Berlin' });
    expect(late.prompts[0]?.engines[0]?.mentioned.n_observations).toBe(RUNS_IN_28_DAYS);
  });

  it('refuses a window over 92 days as a problem that says the limit, and a window that runs backwards', async () => {
    const viewer = mockBrowser('viewer');
    const wide = await viewer.call('GET', `${FYNIX}/ai/prompts-summary?from=2026-01-01&to=2026-11-12`);
    expect(wide.status).toBe(422);
    expect(PROBLEM.parse(wide.body)).toMatchObject({ code: 'window_too_large', limit_days: 92 });
    expect((await viewer.call('GET', `${FYNIX}/ai/prompts-summary?from=2026-08-13&to=2026-11-12`)).status).toBe(200);
    expect(fieldCodes(await viewer.call('GET', `${FYNIX}/ai/prompts-summary?from=2026-11-12&to=2026-11-01`))).toEqual([
      'from:range_invalid',
    ]);
    expect(fieldCodes(await viewer.call('GET', `${FYNIX}/ai/prompts-summary?from=soon`))).toEqual([
      'from:date_parsing',
    ]);
    expect(fieldCodes(await viewer.call('GET', `${FYNIX}/ai/prompts-summary?include_branded=maybe`))).toEqual([
      'include_branded:bool_parsing',
    ]);
    expect(fieldCodes(await viewer.call('GET', `${FYNIX}/ai/prompts-summary?window=7`))).toEqual([
      'window:extra_forbidden',
    ]);
  });

  it('counts nothing for a prompt added here, which has no answer until the next run', async () => {
    const editor = mockBrowser('editor');
    await editor.call('POST', `${FYNIX}/prompts`, item('Which agency audits shop sites in Munich?'));
    const summary = await summaryOf(editor);
    expect(summary.prompts).toHaveLength(24);
    const added = summary.prompts.at(-1);
    expect(added?.text).toBe('Which agency audits shop sites in Munich?');
    expect(added?.topic_term_ids).toEqual([]);
    expect([added?.last_observed_at, added?.last_valid_at]).toEqual([null, null]);
    expect(added?.engines.map((engine) => engine.mentioned)).toEqual([
      { value: null, numerator: 0, denominator: 0, n_observations: 0, pooled: null },
      { value: null, numerator: 0, denominator: 0, n_observations: 0, pooled: null },
    ]);
  });

  it('answers a project that was never asked with empty cells, its own entities and no configuration version', async () => {
    const editor = mockBrowser('editor');
    await editor.call('PUT', `${CLEANSTART}/engines/chatgpt_web`, { location_ids: [2840] });
    await editor.call('POST', `${CLEANSTART}/prompts`, item('Which cleaning service is best in Boston?', 'US'));
    const summary = await summaryOf(editor, '', CLEANSTART);
    expect(summary.window.timezone).toBe('America/New_York');
    expect(summary.entities.map((entity) => entity.name)).toEqual(['Sparkle & Co', 'Cleanstart']);
    expect(summary.entity_config_versions).toEqual([]);
    const empty: Cell = { value: null, numerator: 0, denominator: 0, n_observations: 0, pooled: null };
    expect(summary.prompts[0]?.engines[0]).toMatchObject({
      engine_code: 'chatgpt_web',
      mentioned: empty,
      cited: empty,
      share_of_voice: empty,
    });
    expect(summary.topics).toEqual([
      {
        term_id: null,
        name: null,
        prompt_count: 1,
        last_observed_at: null,
        last_valid_at: null,
        engines: [
          expect.objectContaining({
            mentioned: { ...empty, pooled: { successes: 0, trials: 0 } },
            share_of_voice: empty,
          }),
        ],
      },
    ]);
  });

  it('says when the newest answer and the newest valid answer of each prompt and topic came', async () => {
    const viewer = mockBrowser('viewer');
    const summary = await summaryOf(viewer);
    const rows = await listAll(viewer, '&from=2026-10-16&to=2026-11-12');
    const lastOf = (mine: readonly Observation[]): [string | null, string | null] => [
      newest(mine),
      newest(mine.filter((row) => row.facts?.is_valid === true)),
    ];
    for (const prompt of summary.prompts) {
      const mine = rows.filter((row) => row.subject.prompt_id === prompt.prompt_id);
      expect([prompt.last_observed_at, prompt.last_valid_at]).toEqual(lastOf(mine));
    }
    for (const topic of summary.topics) {
      const members = summary.prompts.filter((row) =>
        topic.term_id === null
          ? row.topic_term_ids.length === 0
          : row.topic_term_ids.some((given) => withAncestors(given).includes(topic.term_id ?? '')),
      );
      const ids = new Set(members.map((row) => row.prompt_id));
      const mine = rows.filter((row) => ids.has(row.subject.prompt_id));
      expect([topic.last_observed_at, topic.last_valid_at]).toEqual(lastOf(mine));
    }
    // The newest run of the window is the Thursday 12 November run at 02:00 UTC
    expect(summary.prompts[0]?.last_observed_at).toBe('2026-11-12T02:00:00.000Z');
    expect(summary.topics.every((topic) => topic.last_observed_at !== null)).toBe(true);
  });

  it('leaves the last valid time empty for a prompt whose only answer in the window failed', async () => {
    const viewer = mockBrowser('viewer');
    const failed: string[] = [];
    for (const day of ['2026-11-12', '2026-11-09', '2026-11-05', '2026-11-02', '2026-10-29', '2026-10-26']) {
      const summary = await summaryOf(viewer, `?from=${day}&to=${day}&filter[engine_code_in]=chatgpt_web`);
      const rows = await listAll(viewer, `&from=${day}&to=${day}&filter[engine_code_in]=chatgpt_web`);
      for (const prompt of summary.prompts) {
        const answer = rows.find((row) => row.subject.prompt_id === prompt.prompt_id);
        expect(prompt.last_observed_at).toBe(answer?.observed_at);
        expect(prompt.last_valid_at).toBe(answer?.facts?.is_valid === true ? answer.observed_at : null);
        if (prompt.last_valid_at === null) failed.push(prompt.prompt_id);
      }
    }
    expect(failed.length).toBeGreaterThan(0);
  });

  it('reads the newest answers on the engines asked for, and gives null where the window has none', async () => {
    const viewer = mockBrowser('viewer');
    const rows = await listAll(viewer, '&from=2026-10-16&to=2026-11-12&filter[engine_code_in]=gemini_web');
    const only = await summaryOf(viewer, '?filter[engine_code_in]=gemini_web');
    const first = only.prompts[0];
    const mine = rows.filter((row) => row.subject.prompt_id === first?.prompt_id);
    expect(first?.last_observed_at).toBe(newest(mine));
    expect(first?.last_valid_at).toBe(newest(mine.filter((row) => row.facts?.is_valid === true)));
    const quiet = await summaryOf(viewer, '?from=2026-11-10&to=2026-11-11');
    for (const row of [...quiet.prompts, ...quiet.topics]) {
      expect([row.last_observed_at, row.last_valid_at]).toEqual([null, null]);
    }
    const monday = await summaryOf(viewer, '?from=2026-11-09&to=2026-11-09');
    expect(monday.prompts.every((row) => row.last_observed_at === '2026-11-09T02:00:00.000Z')).toBe(true);
  });

  it('keeps the branded prompts alone for branded_only, which wins over include_branded', async () => {
    const viewer = mockBrowser('viewer');
    const branded = PROMPTS.filter((prompt) => prompt.is_branded);
    for (const query of ['?branded_only=true', '?branded_only=true&include_branded=false']) {
      const summary = await summaryOf(viewer, query);
      expect(summary).toMatchObject({ include_branded: true, branded_only: true });
      expect(summary.prompts.map((row) => row.prompt_id)).toEqual(branded.map((prompt) => prompt.prompt_id));
      expect(summary.topics.map((topic) => [topic.term_id, topic.prompt_count])).toEqual([[MOCK_TERM_IDS.seo, 1]]);
    }
    expect(await summaryOf(viewer)).toMatchObject({ include_branded: false, branded_only: false });
    expect(await summaryOf(viewer, '?include_branded=true')).toMatchObject({
      include_branded: true,
      branded_only: false,
    });
    expect((await summaryOf(viewer, '?branded_only=false')).prompts).toHaveLength(23);
  });

  it('keeps the prompts of one country, and the topics that hold them', async () => {
    const viewer = mockBrowser('viewer');
    const india = await summaryOf(viewer, '?filter[country_iso]=IN');
    expect(india.prompts.map((row) => row.prompt_id)).toEqual([PROMPTS[5]?.prompt_id]);
    // No row for prompts without a topic: this one has a topic
    expect(india.topics.map((topic) => [topic.term_id, topic.prompt_count])).toEqual([[MOCK_TERM_IDS.seo, 1]]);
    expect(india.topics[0]?.last_observed_at).toBe(india.prompts[0]?.last_observed_at);
    const germany = await summaryOf(viewer, '?filter[country_iso]=DE');
    expect(germany.prompts).toHaveLength(22);
    expect(germany.topics.at(-1)).toMatchObject({ term_id: null, prompt_count: 2 });
    // Branded prompts stay out until asked for, whatever the country
    expect((await summaryOf(viewer, '?filter[country_iso]=DE&include_branded=true')).prompts).toHaveLength(23);
    expect((await summaryOf(viewer, '?filter[country_iso]=FR')).prompts).toEqual([]);
    expect((await summaryOf(viewer, '?filter[country_iso]=FR')).topics).toEqual([]);
  });

  it('keeps the prompts given a term or one below it, and the topics of that term and those below it', async () => {
    const viewer = mockBrowser('viewer');
    const under = [MOCK_TERM_IDS.seo, MOCK_TERM_IDS.technicalSeo, MOCK_TERM_IDS.localSeo];
    const seo = await summaryOf(viewer, `?filter[term]=${MOCK_TERM_IDS.seo}`);
    const given = PROMPTS.filter((prompt) => !prompt.is_branded && prompt.term_ids.some((id) => under.includes(id)));
    expect(seo.prompts.map((row) => row.prompt_id)).toEqual(given.map((prompt) => prompt.prompt_id));
    expect(seo.topics.map((topic) => topic.term_id).sort()).toEqual([...under].sort());
    expect(seo.topics.find((topic) => topic.term_id === MOCK_TERM_IDS.seo)?.prompt_count).toBe(given.length);
    // A leaf: its own row and nothing else, and no row for prompts without a topic
    const leaf = await summaryOf(viewer, `?filter[term]=${MOCK_TERM_IDS.technicalSeo}`);
    expect(leaf.topics.map((topic) => topic.term_id)).toEqual([MOCK_TERM_IDS.technicalSeo]);
    expect(leaf.prompts.every((row) => row.topic_term_ids.includes(MOCK_TERM_IDS.technicalSeo))).toBe(true);
    // A term no prompt was given, and a term that is none of the workspace's, hold nothing
    for (const id of [SERVICE_TERM, mockId('term', 999)]) {
      const none = await summaryOf(viewer, `?filter[term]=${id}`);
      expect([none.prompts, none.topics]).toEqual([[], []]);
    }
  });

  it('combines the three scopes with each other and with the engines and the window', async () => {
    const viewer = mockBrowser('viewer');
    const scoped = await summaryOf(
      viewer,
      `?branded_only=true&filter[country_iso]=DE&filter[term]=${MOCK_TERM_IDS.seo}&filter[engine_code_in]=gemini_web&from=2026-11-09&to=2026-11-12`,
    );
    expect(scoped.prompts.map((row) => row.text)).toEqual([PROMPTS[7]?.text]);
    expect(scoped.engine_codes).toEqual(['gemini_web']);
    expect(scoped.prompts[0]?.last_observed_at).toBe('2026-11-12T02:00:00.000Z');
    expect((await summaryOf(viewer, '?branded_only=true&filter[country_iso]=IN')).prompts).toEqual([]);
  });

  it('refuses a country that is not two capital letters, a term that is not an id and a flag that is no boolean', async () => {
    const viewer = mockBrowser('viewer');
    const codes = async (query: string): Promise<string[]> =>
      fieldCodes(await viewer.call('GET', `${FYNIX}/ai/prompts-summary${query}`));
    expect(await codes('?filter[country_iso]=de')).toEqual(['filter[country_iso]:string_pattern_mismatch']);
    expect(await codes('?filter[country_iso]=DEU')).toEqual(['filter[country_iso]:string_pattern_mismatch']);
    expect(await codes('?filter[term]=seo')).toEqual(['filter[term]:uuid_parsing']);
    expect(await codes('?branded_only=maybe')).toEqual(['branded_only:bool_parsing']);
    expect(await codes('?branded_only=maybe&filter[term]=x')).toEqual([
      'branded_only:bool_parsing',
      'filter[term]:uuid_parsing',
    ]);
  });

  it('is open to a viewer, and answers no query it does not have', async () => {
    expect((await mockBrowser('viewer').call('GET', `${FYNIX}/ai/prompts-summary`)).status).toBe(200);
    expect((await mockBrowser('viewer').call('GET', `${CLEANSTART}/ai/prompts-summary`)).status).toBe(200);
  });
});
