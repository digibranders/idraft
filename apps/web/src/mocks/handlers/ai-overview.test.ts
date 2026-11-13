import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { aiOverviewHandlers } from './ai-overview';
import { fanoutHandlers } from './fanout';
import { handlers } from './index';
import { promptAnswerHandlers } from './prompt-answers';
import { setAiSeeded } from '../ai-seed';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import type { Schemas } from '@/lib/api/types';
import { fieldCodes, mockBrowser, type Answer } from '@/test/mock-api';

/**
 * The answer is read through a strict shape declared against the generated type: a change to the schema breaks
 * this file at compile time, and a member the mock leaves out or adds that the schema does not have fails the
 * parse (`strictObject`).
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
/** Only what the checks below read of the sources meta and of the answers list. */
const SOURCES_META = z.object({ meta: z.object({ answers: z.number(), answers_citing: z.number() }) });
const OBSERVATIONS = z.object({
  data: z.array(z.object({ observation_id: z.string(), status: z.string() })),
  page: z.object({ has_more: z.boolean(), next_cursor: z.string().nullable() }),
});

/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
const cleanstart = MOCK_PROJECTS.find((project) => project.slug === 'cleanstart');
const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (fynix === undefined || cleanstart === undefined || eventus === undefined) {
  throw new Error('The fixture projects are missing');
}
const FYNIX = `${W}/projects/${fynix.project_id}/ai`;
const WINDOW = 'from=2026-10-16&to=2026-11-12';

const get = (path: string): Promise<Answer> => mockBrowser('owner').call('GET', path);

async function fanoutOf(base: string, query = ''): Promise<Schemas['FanoutQueryPage']> {
  const answer = await get(`${base}/fanout-queries?${WINDOW}&limit=1${query === '' ? '' : `&${query}`}`);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return FANOUT_PAGE.parse(answer.body);
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
  setAiSeeded(false);
});

describe('the fan-out mock of the AI overview', () => {
  it('answers the generated FanoutQueryPage shape with the meta of ChatGPT, the only engine that shows it', async () => {
    const page = await fanoutOf(FYNIX);
    expect(page.data).toEqual([]);
    expect(page.page).toEqual({ offset: 0, limit: 1, total: 0 });
    expect(page.meta).toMatchObject({
      engine_codes: ['chatgpt_web'],
      engines_without_fanout: ['gemini_web', 'google_ai_mode'],
      include_branded: false,
      min_support: 2,
      answers_truncated: 0,
      window: { from: '2026-10-16', to: '2026-11-12', timezone: fynix.timezone },
    });
    expect(page.meta.answers).toBeGreaterThan(0);
    expect(page.meta.answers_with_fanout).toBeGreaterThan(0);
    expect(page.meta.answers_with_fanout).toBeLessThanOrEqual(page.meta.answers);
  });

  it('counts the valid ChatGPT answers the observations mock lists', async () => {
    const listed: string[] = [];
    let cursor = '';
    for (let page = 0; page < 20; page += 1) {
      const answer = await get(
        `${FYNIX}/observations?${WINDOW}&filter[engine_code_in]=chatgpt_web&filter[is_valid]=true&limit=200${cursor}`,
      );
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      const read = OBSERVATIONS.parse(answer.body);
      listed.push(...read.data.map((row) => row.observation_id));
      if (!read.page.has_more || read.page.next_cursor === null) break;
      cursor = `&cursor=${encodeURIComponent(read.page.next_cursor)}`;
    }
    const page = await fanoutOf(FYNIX, 'include_branded=true');
    expect(listed.length).toBeGreaterThan(0);
    expect(page.meta.answers).toBe(listed.length);
  });

  it.each([
    ['the default scope', ''],
    ['branded prompts included', 'include_branded=true'],
    ['one market', 'filter[country_iso]=DE'],
    ['a market no prompt asks in', 'filter[country_iso]=ZZ'],
    ['the previous window', 'from=2026-09-18&to=2026-10-15'],
  ])(
    'counts the answers the sources read counts for %s, and those that cited a source as fan-out',
    async (_, query) => {
      const fanout = await get(
        `${FYNIX}/fanout-queries?${query.includes('from=') ? '' : `${WINDOW}&`}limit=1&${query}`,
      );
      expect(fanout.status, JSON.stringify(fanout.body)).toBe(200);
      const meta = FANOUT_PAGE.parse(fanout.body).meta;
      const sources = await get(
        `${FYNIX}/sources/domains?${query.includes('from=') ? '' : `${WINDOW}&`}limit=1&filter[engine_code_in]=chatgpt_web&${query}`,
      );
      const counted = SOURCES_META.parse(sources.body).meta;
      expect(meta.answers).toBe(counted.answers);
      expect(meta.answers_with_fanout).toBe(counted.answers_citing);
    },
  );

  it('is empty, and not an error, for a project with no answers', async () => {
    const page = await fanoutOf(`${W}/projects/${cleanstart.project_id}/ai`);
    expect(page.meta.answers).toBe(0);
    expect(page.meta.answers_with_fanout).toBe(0);
  });

  it('answers for the Eventus Security data set', async () => {
    setAiSeeded(true);
    const page = await fanoutOf(`${W}/projects/${eventus.project_id}/ai`);
    expect(page.meta.answers).toBeGreaterThan(0);
  });

  it('refuses a window of more than 92 days and a parameter it does not have, as the API does', async () => {
    const wide = await get(`${FYNIX}/fanout-queries?from=2026-07-01&to=2026-11-12&limit=1`);
    expect(wide.status).toBe(422);
    expect(wide.code).toBe('window_too_large');
    const unknown = await get(`${FYNIX}/fanout-queries?${WINDOW}&limit=1&branded_only=true`);
    expect(unknown.status).toBe(422);
    expect(fieldCodes(unknown)).toEqual(['branded_only:extra_forbidden']);
  });

  it('is not answered to a caller who cannot see the project', async () => {
    const answer = await get(`${W}/projects/00000000-0000-4000-8000-000000000000/ai/fanout-queries?${WINDOW}`);
    expect(answer.status).toBe(404);
  });
});

describe('where the AI overview handlers sit', () => {
  it('registers only the fan-out route, after fanoutHandlers and the answer handlers, so WP-24 supersedes it', () => {
    expect(aiOverviewHandlers).toHaveLength(1);
    const place = (handler: (typeof handlers)[number]): number => handlers.indexOf(handler);
    const [ours] = aiOverviewHandlers;
    if (ours === undefined) throw new Error('The AI overview handler is missing');
    expect(place(ours)).toBeGreaterThan(-1);
    for (const earlier of [...fanoutHandlers, ...promptAnswerHandlers]) {
      expect(place(earlier)).toBeLessThan(place(ours));
    }
  });
});
