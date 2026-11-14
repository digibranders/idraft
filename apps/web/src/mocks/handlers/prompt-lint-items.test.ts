import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { FIXTURE_PROMPTS, PROMPT_QUOTA } from '../prompt-fixtures';
import type { Schemas } from '@/lib/api/types';
import { dataOf, fieldCodes, mockBrowser, type Answer } from '@/test/mock-api';

/**
 * The lint and the create of contract C1, read through shapes declared against the generated types: a change to
 * `PromptLintResponse` breaks this file at compile time, and `.strict()` makes an extra member fail the parse.
 */
const WARNING: z.ZodType<Schemas['LintWarning']> = z
  .object({
    rule: z.enum([
      'contains_brand_alias',
      'engine_limit',
      'word_count',
      'multiple_questions',
      'leading_wording',
      'language_mismatch',
      'contains_competitor_alias',
    ]),
    severity: z.enum(['info', 'warning', 'error']),
    message: z.string(),
    engine_code: z.enum(['chatgpt_web', 'gemini_web', 'google_ai_mode']).nullable(),
    span: z.object({ start: z.number(), end: z.number() }).strict().nullable(),
  })
  .strict();
const TYPES = z.enum([
  'question',
  'comparison',
  'recommendation',
  'how_to',
  'definition',
  'local',
  'transactional',
  'other',
]);
const ALIAS: z.ZodType<Schemas['MatchedAlias']> = z
  .object({
    alias: z.string(),
    entity: z
      .object({
        entity_id: z.string(),
        canonical_name: z.string(),
        entity_type: z.enum(['brand', 'product', 'organization', 'person', 'other']),
        role: z.enum(['own', 'competitor', 'watch']).nullable(),
        color_index: z.number().nullable(),
      })
      .strict(),
  })
  .strict();
const LINT_BASE = {
  text: z.string(),
  is_branded: z.boolean(),
  matched_aliases: z.array(ALIAS),
  warnings: z.array(WARNING),
  suggested_prompt_type: TYPES,
};
/** A row of the `items` shape answers `tracked` and `near_duplicate_of`, each an object or null. */
const LINT: z.ZodType<Schemas['PromptLint']> = z
  .object({
    ...LINT_BASE,
    tracked: z.object({ prompt_id: z.string(), is_active: z.boolean() }).strict().nullable(),
    near_duplicate_of: z.object({ prompt_id: z.string(), text: z.string() }).strict().nullable(),
  })
  .strict();
/** A row of the `texts` shape answers neither. */
const TEXT_LINT: z.ZodType<Schemas['PromptLint']> = z.object(LINT_BASE).strict();
const ENGINE_ESTIMATE: z.ZodType<Schemas['EngineEstimate']> = z
  .object({
    engine_code: z.enum(['chatgpt_web', 'gemini_web', 'google_ai_mode']),
    prompts_fit: z.number(),
    answers_per_month: z.number(),
    monthly_cost_usd: z.string().nullable(),
    run_now_answers: z.number(),
    run_now_cost_usd: z.string().nullable(),
  })
  .strict();
const RESPONSE: z.ZodType<Schemas['PromptLintResponse']> = z
  .object({
    data: z.array(LINT),
    quota: z.object({ limit: z.number(), used: z.number(), would_create: z.number() }).strict(),
    estimate: z.object({ engines: z.array(ENGINE_ESTIMATE), total_monthly_cost_usd: z.string().nullable() }).strict(),
  })
  .strict();
const TEXTS_RESPONSE: z.ZodType<Schemas['PromptLintResponse']> = z
  .object({ data: z.array(TEXT_LINT), quota: z.object({ limit: z.number(), used: z.number() }).strict() })
  .strict();
const PROMPT = z.object({
  prompt_id: z.string(),
  prompt_type: z.string(),
  prompt_type_source: z.string(),
  is_branded: z.boolean(),
  is_branded_source: z.string(),
  source: z.string(),
  creation_method: z.string(),
});
const BULK = z.object({
  created: z.array(z.string()),
  skipped: z.array(z.object({ index: z.number(), existing_id: z.string() })),
  rejected: z.array(z.object({ index: z.number(), code: z.string(), message: z.string() })),
});
const KEYWORDS = z.array(z.object({ tracked_keyword_id: z.string() }));

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix fixture project is missing');
const FYNIX = `${W}/projects/${fynix.project_id}`;
const FIXTURES = FIXTURE_PROMPTS.get(fynix.project_id) ?? [];
const TRACKED = FIXTURES[0]?.text ?? '';
/** Thursday 12 November 2026, noon UTC. */
const NOW = Date.parse('2026-11-12T12:00:00Z');

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const item = (text: string, country = 'DE', language = 'en'): Record<string, string> => ({
  text,
  language_code: language,
  country_iso: country,
});
const lintItems = (items: unknown[], extra: Record<string, unknown> = {}): Promise<Answer> =>
  mockBrowser('viewer').call('POST', `${FYNIX}/prompts/lint`, { items, ...extra });

describe('the items lint', () => {
  it("answers tracked, near duplicate, would_create and estimate for the project's own prompts", async () => {
    const answer = await lintItems([
      item(TRACKED),
      item(TRACKED.toLowerCase().replace(' seo ', '  seo ')),
      item('Which agency audits shop sites in Munich?'),
      item('Which agency audits shop sites in Munich?'),
      item(TRACKED, 'FR'),
    ]);
    expect(answer.status).toBe(200);
    const lint = dataOf(answer, z.array(LINT));
    expect(lint[0]?.tracked).toEqual({ prompt_id: FIXTURES[0]?.prompt_id, is_active: true });
    expect(lint[0]?.near_duplicate_of ?? null).toBeNull();
    expect(lint[1]?.tracked ?? null).toBeNull();
    expect(lint[1]?.near_duplicate_of).toEqual({ prompt_id: FIXTURES[0]?.prompt_id, text: TRACKED });
    expect(lint[2]?.tracked ?? null).toBeNull();
    // The same text in another country is a different prompt
    expect(lint[4]?.tracked ?? null).toBeNull();
    const body = RESPONSE.parse(answer.body);
    // Not tracked, not repeated: the near duplicate, the first Munich line and the French copy
    expect(body.quota).toEqual({ limit: PROMPT_QUOTA, used: 24, would_create: 3 });
    // The engines the project has on, each with the 3 prompts it takes
    expect(
      body.estimate?.engines.map((engine) => [engine.engine_code, engine.prompts_fit, engine.answers_per_month]),
    ).toEqual([
      ['chatgpt_web', 3, 26],
      ['gemini_web', 3, 26],
    ]);
    expect(body.estimate?.total_monthly_cost_usd).toBe('0.06');
  });

  it('names an archived prompt as tracked with is_active false, and counts it as not created', async () => {
    const editor = mockBrowser('editor');
    expect(
      (await editor.call('POST', `${FYNIX}/prompts/bulk-archive`, { ids: [FIXTURES[0]?.prompt_id], archive: true }))
        .status,
    ).toBe(200);
    const answer = await editor.call('POST', `${FYNIX}/prompts/lint`, { items: [item(TRACKED)] });
    const body = RESPONSE.parse(answer.body);
    expect(body.data[0]?.tracked).toEqual({ prompt_id: FIXTURES[0]?.prompt_id, is_active: false });
    expect(body.quota).toEqual({ limit: PROMPT_QUOTA, used: 23, would_create: 0 });
    expect(body.estimate?.engines[0]).toMatchObject({ prompts_fit: 0, answers_per_month: 0 });
  });

  it('prices each engine asked for, and gives no price, not zero, for the one the price book lacks', async () => {
    const answer = await lintItems([item('Which agency audits shop sites in Munich?')], {
      engine_codes: ['chatgpt_web', 'google_ai_mode'],
    });
    const estimate = RESPONSE.parse(answer.body).estimate;
    expect(estimate?.engines).toEqual([
      {
        engine_code: 'chatgpt_web',
        prompts_fit: 1,
        answers_per_month: 8,
        monthly_cost_usd: '0.01',
        run_now_answers: 1,
        run_now_cost_usd: '0.001200',
      },
      {
        engine_code: 'google_ai_mode',
        prompts_fit: 1,
        answers_per_month: 8,
        monthly_cost_usd: null,
        run_now_answers: 1,
        run_now_cost_usd: null,
      },
    ]);
    expect(estimate?.total_monthly_cost_usd).toBe('0.01');
  });

  it('applies the five rules to an item with the contract wording, and the type the wording gives', async () => {
    const answer = await lintItems([
      item('best crm'),
      item('Is Rankforge a good choice for a small agency in Berlin?'),
      item('Why is Rankforge the best agency for startups in Berlin?'),
      item('Quelle est la meilleure solution de facturation pour une petite entreprise ?'),
      item('Asana vs Trello for a ten person agency'),
    ]);
    const lint = dataOf(answer, z.array(LINT));
    expect(lint[0]).toMatchObject({
      suggested_prompt_type: 'other',
      warnings: [
        {
          rule: 'word_count',
          severity: 'warning',
          message: 'Has 2 words. Prompts of 5 to 60 words read like real questions.',
        },
      ],
    });
    expect(lint[1]?.warnings.map((warning) => [warning.rule, warning.severity])).toEqual([
      ['contains_competitor_alias', 'warning'],
    ]);
    expect(lint[2]?.warnings.map((warning) => warning.rule)).toEqual(['contains_competitor_alias', 'leading_wording']);
    expect(lint[3]?.warnings.map((warning) => warning.message)).toEqual([
      'Reads as French, and the prompt is set to English.',
    ]);
    expect(lint[4]?.suggested_prompt_type).toBe('comparison');
  });

  it('refuses a body the API refuses: extra members, two shapes, bad codes, bounds', async () => {
    expect(fieldCodes(await lintItems([{ ...item('Fine question here?'), extra: 1 }]))).toEqual([
      'items.0.extra:extra_forbidden',
    ]);
    expect(fieldCodes(await lintItems([item('Fine question here?')], { texts: ['x'] }))).toEqual([
      'texts:extra_forbidden',
    ]);
    expect(fieldCodes(await lintItems([item('Fine question here?', 'de', 'EN')]))).toEqual([
      'items.0.language_code:string_pattern_mismatch',
      'items.0.country_iso:string_pattern_mismatch',
    ]);
    expect(fieldCodes(await lintItems([]))).toEqual(['items:too_short']);
    expect(fieldCodes(await lintItems(Array.from({ length: 1001 }, () => item('Fine question here?'))))).toEqual([
      'items:too_long',
    ]);
    expect(fieldCodes(await lintItems([item('x'.repeat(8001))]))).toEqual(['items.0.text:string_too_long']);
    // A text too long to save is linted and told so, not refused
    const long = await lintItems([item('x'.repeat(3000))]);
    expect(long.status).toBe(200);
    expect(RESPONSE.parse(long.body).quota.would_create).toBe(0);
  });
});

describe('the texts lint', () => {
  it('answers no estimate, tracked or would_create, but the suggested type, and takes a language for the mismatch', async () => {
    const answer = await mockBrowser('viewer').call('POST', `${FYNIX}/prompts/lint`, {
      texts: [TRACKED, 'Quelle est la meilleure solution de facturation pour une petite entreprise ?'],
      language_code: 'en',
    });
    // The strict shape has no estimate, no would_create and no tracked: an answer that carried one would fail here
    const body = TEXTS_RESPONSE.parse(answer.body);
    expect(body.data.map((row) => row.suggested_prompt_type)).toEqual(['question', 'question']);
    expect(body.data[1]?.warnings.map((warning) => warning.rule)).toEqual(['language_mismatch']);
    expect(body.data[0]?.warnings).toEqual([]);
    const bad = await mockBrowser('viewer').call('POST', `${FYNIX}/prompts/lint`, {
      texts: ['x'],
      language_code: 'EN',
    });
    expect(fieldCodes(bad)).toEqual(['language_code:string_pattern_mismatch']);
  });
});

describe('creating with the contract members', () => {
  const create = (editor: ReturnType<typeof mockBrowser>, body: Record<string, unknown>): Promise<Answer> =>
    editor.call('POST', `${FYNIX}/prompts/bulk-create`, { items: [{ ...item('Placeholder?'), ...body }] });
  const read = async (editor: ReturnType<typeof mockBrowser>, answer: Answer): Promise<z.infer<typeof PROMPT>> => {
    const [id = ''] = dataOf(answer, BULK).created;
    return dataOf(await editor.call('GET', `${FYNIX}/prompts/${id}`), PROMPT);
  };

  it('takes the type from the wording when it is left out or null, and keeps a chosen type as person', async () => {
    const editor = mockBrowser('editor');
    const [left, empty, chosen] = [
      await read(editor, await create(editor, { text: 'Asana vs Trello for a ten person agency' })),
      await read(editor, await create(editor, { text: 'How to run an audit on a shop site', prompt_type: null })),
      await read(
        editor,
        await create(editor, { text: 'Which agency audits shop sites in Munich?', prompt_type: 'recommendation' }),
      ),
    ];
    expect(left).toMatchObject({ prompt_type: 'comparison', prompt_type_source: 'rule' });
    expect(empty).toMatchObject({ prompt_type: 'how_to', prompt_type_source: 'rule' });
    expect(chosen).toMatchObject({ prompt_type: 'recommendation', prompt_type_source: 'person' });
  });

  it('keeps is_branded as sent with the override source, and computes it from the aliases otherwise', async () => {
    const editor = mockBrowser('editor');
    const sent = await read(
      editor,
      await create(editor, { text: 'Which agency audits shop sites?', is_branded: true }),
    );
    const never = await read(
      editor,
      await create(editor, { text: 'Is Fynix a fair price for shop audits?', is_branded: false }),
    );
    const computed = await read(
      editor,
      await create(editor, { text: 'Is Fynix good at shop audits?', is_branded: null }),
    );
    expect(sent).toMatchObject({ is_branded: true, is_branded_source: 'override' });
    expect(never).toMatchObject({ is_branded: false, is_branded_source: 'override' });
    expect(computed).toMatchObject({ is_branded: true, is_branded_source: 'computed' });
  });

  it('stores source and creation method, with the defaults human and manual, and template with generated_from', async () => {
    const editor = mockBrowser('editor');
    const [first] = dataOf(await editor.call('GET', `${FYNIX}/tracked-keywords?limit=1`), KEYWORDS);
    const keywordId = first?.tracked_keyword_id ?? '';
    expect(keywordId).not.toBe('');
    const plain = await read(editor, await create(editor, { text: 'Which agency audits shop sites in Hamburg?' }));
    const imported = await read(
      editor,
      await create(editor, {
        text: 'Which agency audits shop sites in Cologne?',
        source: 'csv_import',
        creation_method: 'imported',
      }),
    );
    const generated = await read(
      editor,
      await create(editor, {
        text: 'Which agency audits shop sites in Bremen?',
        source: 'seo_keyword',
        generated_from: { tracked_keyword_id: keywordId, template: 'recommendation' },
      }),
    );
    expect(plain).toMatchObject({ source: 'manual', creation_method: 'human' });
    expect(imported).toMatchObject({ source: 'csv_import', creation_method: 'imported' });
    expect(generated).toMatchObject({ source: 'seo_keyword', creation_method: 'template' });
  });

  it('refuses a value outside the contract, and rejects only the item whose keyword is not tracked', async () => {
    const editor = mockBrowser('editor');
    expect(fieldCodes(await create(editor, { source: 'llm_scan' }))).toEqual(['items.0.source:enum']);
    expect(fieldCodes(await create(editor, { creation_method: 'llm_generated' }))).toEqual([
      'items.0.creation_method:enum',
    ]);
    expect(fieldCodes(await create(editor, { is_branded: 'yes' }))).toEqual(['items.0.is_branded:bool_type']);
    expect(
      fieldCodes(await create(editor, { generated_from: { tracked_keyword_id: 'nope', template: 'poem', extra: 1 } })),
    ).toEqual([
      'items.0.generated_from.extra:extra_forbidden',
      'items.0.generated_from.tracked_keyword_id:uuid_parsing',
      'items.0.generated_from.template:enum',
    ]);
    const unknown = await editor.call('POST', `${FYNIX}/prompts/bulk-create`, {
      items: [
        {
          ...item('Which agency audits shop sites in Kiel?'),
          generated_from: { tracked_keyword_id: '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7bff', template: 'how_to' },
        },
        item('Which agency audits shop sites in Essen?'),
      ],
    });
    const result = dataOf(unknown, BULK);
    expect(result.created).toHaveLength(1);
    expect(result.rejected.map((entry) => [entry.index, entry.code])).toEqual([[0, 'tracked_keyword_unknown']]);
    const single = await editor.call('POST', `${FYNIX}/prompts`, {
      ...item('Which agency audits shop sites in Bonn?'),
      generated_from: { tracked_keyword_id: '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7bff', template: 'how_to' },
    });
    expect(fieldCodes(single)).toEqual(['generated_from.tracked_keyword_id:tracked_keyword_unknown']);
  });

  it('sets the sources to person and override when a change sets the type or the branded flag', async () => {
    const editor = mockBrowser('editor');
    const made = await read(editor, await create(editor, { text: 'Which agency audits shop sites in Trier?' }));
    expect(made).toMatchObject({ prompt_type_source: 'rule', is_branded_source: 'computed' });
    const changed = await editor.call('PATCH', `${FYNIX}/prompts/${made.prompt_id}`, {
      prompt_type: 'local',
      is_branded: false,
    });
    expect(dataOf(changed, PROMPT)).toMatchObject({
      prompt_type: 'local',
      prompt_type_source: 'person',
      is_branded: false,
      is_branded_source: 'override',
    });
  });
});
