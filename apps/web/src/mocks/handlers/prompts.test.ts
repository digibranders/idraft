import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { FIXTURE_PROMPTS, PROMPT_QUOTA } from '../prompt-fixtures';
import { dataOf, fieldCodes, mockBrowser, pageOf } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');
const FYNIX = `${W}/projects/${fynix.project_id}`;
const CLEANSTART = `${W}/projects/${cleanstart.project_id}`;
/** Thursday 12 November 2026, noon UTC. */
const NOW = Date.parse('2026-11-12T12:00:00Z');

const ENGINE = z.object({
  engine: z.object({ engine_code: z.string(), label: z.string(), max_prompt_chars: z.number() }),
  is_configured: z.boolean(),
  is_enabled: z.boolean(),
  location_ids: z.array(z.number()),
  active_prompts: z.number(),
  estimated_monthly_cost_usd: z.string().nullable(),
});
const PROMPT = z.object({
  prompt_id: z.string(),
  current_version: z.object({ text: z.string(), version_no: z.number() }),
  country_iso: z.string().nullable(),
  is_branded: z.boolean(),
  is_active: z.boolean(),
  terms: z.array(z.object({ term_id: z.string(), name: z.string() })),
});
const PAGE = z.object({ limit: z.number(), next_cursor: z.string().nullable(), has_more: z.boolean() });
const BULK = z.object({
  created: z.array(z.string()),
  skipped: z.array(z.object({ index: z.number(), existing_id: z.string() })),
  rejected: z.array(z.object({ index: z.number(), code: z.string() })),
});
const LINT = z.array(
  z.object({
    is_branded: z.boolean(),
    warnings: z.array(z.object({ rule: z.string(), severity: z.string(), engine_code: z.string().nullable() })),
  }),
);
const QUOTA = z.object({ limit: z.number(), used: z.number() });

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const item = (text: string, country = 'DE'): Record<string, string> => ({
  text,
  language_code: 'en',
  country_iso: country,
});

describe('engines', () => {
  it('lists the three engines, Fynix with ChatGPT and Gemini on and a monthly cost for each', async () => {
    const answer = await mockBrowser('viewer').call('GET', `${FYNIX}/engines`);
    const engines = dataOf(answer, z.array(ENGINE));
    expect(engines.map((engine) => [engine.engine.engine_code, engine.is_enabled])).toEqual([
      ['chatgpt_web', true],
      ['gemini_web', true],
      ['google_ai_mode', false],
    ]);
    // 24 prompts, twice a week, at $0.0012: 24 x 2 x 0.0012 x 52 / 12 = $0.25
    expect(engines[0]).toMatchObject({ active_prompts: 24, estimated_monthly_cost_usd: '0.250000' });
  });

  it('turns an engine on with its countries for an editor, and refuses a viewer and an unknown country', async () => {
    const editor = mockBrowser('editor');
    const on = await editor.call('PUT', `${CLEANSTART}/engines/chatgpt_web`, { location_ids: [2840] });
    expect(on.status).toBe(200);
    expect(dataOf(on, ENGINE)).toMatchObject({ is_configured: true, is_enabled: true, location_ids: [2840] });
    expect(
      (await editor.as('viewer').call('PUT', `${CLEANSTART}/engines/gemini_web`, { location_ids: [2840] })).code,
    ).toBe('forbidden');
    const unknown = await editor.call('PUT', `${CLEANSTART}/engines/gemini_web`, { location_ids: [1023191] });
    expect(fieldCodes(unknown)).toEqual(['location_ids.0:location_not_supported']);
    expect(fieldCodes(await editor.call('PUT', `${CLEANSTART}/engines/gemini_web`, { location_ids: [] }))).toEqual([
      'location_ids:too_short',
    ]);
  });

  it('removes an engine setting, and says not found for one that is not set', async () => {
    const editor = mockBrowser('editor');
    expect((await editor.call('DELETE', `${FYNIX}/engines/gemini_web`)).status).toBe(204);
    const engines = dataOf(await editor.call('GET', `${FYNIX}/engines`), z.array(ENGINE));
    expect(engines[1]).toMatchObject({ is_configured: false, is_enabled: false, location_ids: [] });
    expect((await editor.call('DELETE', `${FYNIX}/engines/gemini_web`)).code).toBe('not_found');
    expect((await editor.as('viewer').call('DELETE', `${FYNIX}/engines/chatgpt_web`)).code).toBe('forbidden');
  });
});

describe('prompts', () => {
  it('lists the active prompts newest first in cursor pages', async () => {
    const viewer = mockBrowser('viewer');
    const first = await viewer.call('GET', `${FYNIX}/prompts?limit=10`);
    expect(dataOf(first, z.array(PROMPT))).toHaveLength(10);
    const page = pageOf(first, PAGE);
    expect(page.has_more).toBe(true);
    const second = await viewer.call('GET', `${FYNIX}/prompts?limit=10&cursor=${page.next_cursor ?? ''}`);
    expect(dataOf(second, z.array(PROMPT))).toHaveLength(10);
    // A cursor is bound to its filters
    const other = await viewer.call('GET', `${FYNIX}/prompts?limit=10&filter[q]=seo&cursor=${page.next_cursor ?? ''}`);
    expect(other.status).toBe(400);
    expect(other.code).toBe('invalid_cursor');
    const all = await viewer.call('GET', `${FYNIX}/prompts?limit=200`);
    const prompts = dataOf(all, z.array(PROMPT));
    expect(prompts).toHaveLength(24);
    expect(prompts.filter((prompt) => prompt.is_branded).map((prompt) => prompt.current_version.text)).toEqual([
      'Is Fynix a good SEO agency for software companies?',
    ]);
  });

  it('adds one prompt, refuses a duplicate with its id and a country no enabled engine runs in', async () => {
    const editor = mockBrowser('editor');
    const added = await editor.call('POST', `${FYNIX}/prompts`, item('Which agency audits shop sites in Munich?'));
    expect(added.status).toBe(201);
    const prompt = dataOf(added, PROMPT);
    const again = await editor.call('POST', `${FYNIX}/prompts`, item('  Which agency audits shop sites in Munich?  '));
    expect(again.status).toBe(409);
    expect(again.body.existing_id).toBe(prompt.prompt_id);
    expect(
      fieldCodes(await editor.call('POST', `${FYNIX}/prompts`, item('Which agency works in Paris?', 'FR'))),
    ).toEqual(['country_iso:location_not_supported']);
    expect(fieldCodes(await editor.call('POST', `${FYNIX}/prompts`, item('x'.repeat(2001))))).toEqual([
      'text:prompt_too_long',
    ]);
    expect((await editor.as('viewer').call('POST', `${FYNIX}/prompts`, item('Who audits?'))).code).toBe('forbidden');
  });

  it('bulk-creates to the 150 prompt limit, skips what is tracked, rejects what cannot be saved', async () => {
    const editor = mockBrowser('editor');
    const tracked = FIXTURE_PROMPTS.get(fynix.project_id)?.[0]?.text ?? '';
    const room = PROMPT_QUOTA - 24;
    const items = [
      item(tracked),
      item('Which agency works in Paris?', 'FR'),
      item('Same line twice?'),
      item('Same line twice?'),
      ...Array.from({ length: room - 1 }, (_, n) => item(`Which SEO agency suits a team of ${String(n + 2)} people?`)),
    ];
    const answer = await editor.call('POST', `${FYNIX}/prompts/bulk-create`, { items });
    const result = dataOf(answer, BULK);
    expect(result.created).toHaveLength(room);
    expect(result.skipped.map((entry) => entry.index)).toEqual([0]);
    expect(result.rejected.map((entry) => [entry.index, entry.code])).toEqual([
      [1, 'location_not_supported'],
      [3, 'duplicate_in_request'],
    ]);
    const over = await editor.call('POST', `${FYNIX}/prompts/bulk-create`, { items: [item('One more question?')] });
    expect(over.status).toBe(422);
    expect(over.code).toBe('quota_exceeded');
    expect(over.body).toMatchObject({ limit: PROMPT_QUOTA, used: PROMPT_QUOTA, requested: 1 });
  });

  it('lints each text for an own brand and for the length each engine takes, and gives the quota', async () => {
    const answer = await mockBrowser('viewer').call('POST', `${FYNIX}/prompts/lint`, {
      texts: ['Is Fynix any good?', 'x'.repeat(800)],
    });
    const lints = dataOf(answer, LINT);
    expect(lints[0]).toMatchObject({
      is_branded: true,
      warnings: [{ rule: 'contains_brand_alias', severity: 'info' }],
    });
    expect(lints[1]?.warnings).toEqual([
      expect.objectContaining({ rule: 'engine_limit', severity: 'warning', engine_code: 'google_ai_mode' }),
    ]);
    expect(QUOTA.parse(answer.body.quota)).toEqual({ limit: PROMPT_QUOTA, used: 24 });
  });

  it('archives a prompt and brings it back', async () => {
    const editor = mockBrowser('editor');
    const id = FIXTURE_PROMPTS.get(fynix.project_id)?.[1]?.prompt_id ?? '';
    expect((await editor.call('DELETE', `${FYNIX}/prompts/${id}`)).status).toBe(204);
    expect(dataOf(await editor.call('GET', `${FYNIX}/prompts/${id}`), PROMPT).is_active).toBe(false);
    const back = await editor.call('PATCH', `${FYNIX}/prompts/${id}`, { is_active: true });
    expect(dataOf(back, PROMPT).is_active).toBe(true);
    expect(fieldCodes(await editor.call('PATCH', `${FYNIX}/prompts/${id}`, { text: 'New?' }))).toEqual([
      'text:immutable_field',
    ]);
  });
});
