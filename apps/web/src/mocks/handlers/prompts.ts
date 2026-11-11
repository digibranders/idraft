import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller, type ProjectCaller } from './access';
import {
  bodyError,
  booleanError,
  cursorPage,
  enumError,
  extraMembers,
  isOneOf,
  isRecord,
  notAnObject,
  nullErrors,
  pageRequest,
  uuidError,
} from './rules';
import { matchAliases, TooManyMatchesError, type MatcherEntity } from '../alias-matcher';
import { MOCK_LOCATIONS, MOCK_TERMS, MOCK_VOCABULARIES } from '../entity-fixtures';
import { isActiveRole, type EntityWorld, type StoredEntity, type StoredRole } from '../entities-state';
import { entityRefView, termPath } from '../factories/entity';
import {
  ENGINE_CODES,
  ENGINE_FACTS,
  monthlyCostUsd,
  PROMPT_QUOTA,
  PROMPT_TEXT_MAX,
  promptId,
  versionId,
  type StoredEngine,
  type StoredPrompt,
} from '../prompt-fixtures';
import { activePromptCount, mintPromptNumber, promptsOf } from '../prompts-state';
import { invalid, mock, noContent, problem } from '../respond';
import { projectList } from '../workspace-state';
import type { EngineCode, ProjectEngine, Prompt, PromptLint, ValidationItem } from '@/lib/api/types';
import { textLength } from '@/lib/text/length';

/**
 * AI prompt tracking, slice 1, plan A of 2026-11-11: the project's engines with their monthly cost, and
 * prompts (list, add one, add many, lint, read, change, archive). The rules are the API's, cut to what the
 * screens meet: the 150 prompt quota, duplicates by text, language and country, a country every enabled
 * engine runs in, and the length of a prompt per engine.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const ENGINES = `${P}/engines` as const;
const PROMPTS = `${P}/prompts` as const;
const BULK_MAX = 1000;
const LINT_MAX = 1000;
const LOCATIONS_MAX = 50;
const TERMS_MAX = 20;
const LOCATION_ID_MAX = 2_147_483_647;
/** A text longer than this cannot compose to a legal prompt, so the API does not even compose it. */
const RAW_TEXT_MAX = 4 * PROMPT_TEXT_MAX;
const PROMPT_FIELDS = [
  'text',
  'language_code',
  'country_iso',
  'intent',
  'funnel_stage',
  'prompt_type',
  'importance',
  'term_ids',
] as const;
const INTENTS = [
  'informational',
  'navigational',
  'commercial',
  'transactional',
  'local',
  'unknown',
] as const satisfies readonly Prompt['intent'][];
const FUNNEL_STAGES = [
  'tofu',
  'mofu',
  'bofu',
  'retention',
  'unknown',
] as const satisfies readonly Prompt['funnel_stage'][];
const PROMPT_TYPES = [
  'question',
  'comparison',
  'recommendation',
  'how_to',
  'definition',
  'local',
  'transactional',
  'other',
] as const satisfies readonly Prompt['prompt_type'][];
/** What a change may set; `term_ids` replaces the prompt's terms. */
const PATCH_FIELDS = [
  'intent',
  'funnel_stage',
  'prompt_type',
  'importance',
  'is_branded',
  'is_active',
  'term_ids',
] as const;
const IMMUTABLE = ['text', 'language_code', 'country_iso'] as const;
const LANGUAGE = /^[a-z]{2}$/;
const COUNTRY = /^[A-Z]{2}$/;
/** Unicode Cc, Cf, Zl and Zp: what the API's `printable` refuses (tab, NUL, zero width joiner, line separators). */
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const normalized = (text: string): string => text.normalize('NFC').trim();
const keyOf = (text: string, language: string, country: string): string =>
  `${normalized(text)}\u0000${language}\u0000${country}`;
export const isoOf = (instant: number): string => new Date(instant).toISOString();

/** The country of an active country location, or `null` for any other location. */
export const countryOf = (locationId: number): string | null =>
  MOCK_LOCATIONS.find((location) => location.location_id === locationId && location.location_type === 'Country')
    ?.country_iso ?? null;

const countriesOf = (engine: StoredEngine): Set<string> =>
  new Set(
    engine.location_ids.flatMap((id) => {
      const country = countryOf(id);
      return country === null ? [] : [country];
    }),
  );

export const enabledEngines = (projectId: string): StoredEngine[] =>
  promptsOf(projectId).engines.filter((engine) => engine.is_enabled);

/** A sha256-shaped hex text, the same for the same text: the mocks never compare it with the API's. */
function hashOf(text: string): string {
  let hash = 2166136261;
  let out = '';
  for (let round = 0; round < 8; round += 1) {
    for (const char of `${String(round)}${text}`) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619) >>> 0;
    out += hash.toString(16).padStart(8, '0');
  }
  return out;
}

const VOCABULARY_KINDS = new Map(MOCK_VOCABULARIES.map((vocabulary) => [vocabulary.vocabulary_id, vocabulary.kind]));

function termOf(termId: string): Prompt['terms'][number] | null {
  const term = MOCK_TERMS.find((candidate) => candidate.term_id === termId);
  if (term === undefined) return null;
  return {
    term_id: term.term_id,
    vocabulary_kind: VOCABULARY_KINDS.get(term.vocabulary_id) ?? 'custom',
    name: term.name,
    path: termPath({ terms: MOCK_TERMS }, term),
  };
}

type Mention = ReturnType<typeof matchAliases>['mentions'][number];

interface OwnMention {
  entity: StoredEntity;
  role: StoredRole;
  mention: Mention;
}

/**
 * The own brands a text names, found through the project's entities and their aliases as the API's matcher
 * does: a name makes the prompt branded only when the mention is accepted.
 */
function ownMentions(world: EntityWorld, projectId: string, text: string): OwnMention[] {
  const roles = world.roles.filter((role) => role.project_id === projectId && isActiveRole(role));
  const entities = roles.flatMap((role): MatcherEntity[] => {
    const entity = world.entities.find((candidate) => candidate.entity_id === role.entity_id);
    return entity === undefined
      ? []
      : [
          {
            entity,
            aliases: world.aliases.filter((alias) => alias.entity_id === entity.entity_id),
            domains: world.domains.filter((domain) => domain.entity_id === entity.entity_id),
          },
        ];
  });
  return matchAliases(text, entities).mentions.flatMap((mention) => {
    const role = roles.find((candidate) => candidate.entity_id === mention.entity_id);
    const entity = entities.find((candidate) => candidate.entity.entity_id === mention.entity_id)?.entity;
    return mention.status === 'accepted' && role?.role === 'own' && entity !== undefined
      ? [{ entity, role, mention }]
      : [];
  });
}

function promptView(stored: StoredPrompt): Prompt {
  return {
    prompt_id: stored.prompt_id,
    current_version: {
      prompt_version_id: stored.version_id,
      version_no: 1,
      text: stored.text,
      text_hash: hashOf(stored.text),
      change_kind: 'initial',
      created_at: stored.created_at,
    },
    language_code: stored.language_code,
    country_iso: stored.country_iso,
    intent: stored.intent,
    funnel_stage: stored.funnel_stage,
    prompt_type: stored.prompt_type,
    importance: stored.importance,
    is_branded: stored.is_branded,
    source: 'manual',
    creation_method: 'human',
    is_active: stored.is_active,
    terms: stored.term_ids.flatMap((id) => termOf(id) ?? []),
    created_by: stored.created_by,
    created_at: stored.created_at,
    updated_at: stored.updated_at,
  };
}

function engineView(projectId: string, code: EngineCode): ProjectEngine {
  const configured = promptsOf(projectId).engines.find((engine) => engine.engine_code === code);
  const fits = promptsOf(projectId).prompts.filter(
    (prompt) => prompt.is_active && textLength(prompt.text) <= ENGINE_FACTS[code].max_prompt_chars,
  ).length;
  return {
    engine: ENGINE_FACTS[code],
    is_configured: configured !== undefined,
    is_enabled: configured?.is_enabled ?? false,
    location_ids: configured?.location_ids ?? [],
    replicates: 1,
    provider_code: 'dataforseo',
    active_prompts: fits,
    estimated_monthly_cost_usd: monthlyCostUsd(fits),
  };
}

interface PromptItem {
  text: string;
  language_code: string;
  country_iso: string;
  intent: Prompt['intent'];
  funnel_stage: Prompt['funnel_stage'];
  prompt_type: Prompt['prompt_type'];
  importance: number;
  term_ids: string[];
}

/**
 * A text as the API's `PromptText` (a prompt: over 2,000 characters is `prompt_too_long`) or `LintText` (over
 * four times that is `string_too_long`) reads it: trimmed and composed, at least one character, and no control
 * character. Lengths count characters (code points), as Python does. Returns the saved text or the first error.
 */
function textOf(value: unknown, path: string, kind: 'prompt' | 'lint'): string | ValidationItem {
  if (value === undefined) return bodyError(path, 'missing', 'Field required');
  if (typeof value !== 'string') return bodyError(path, 'string_type', 'Input should be a valid string');
  const text = normalized(value);
  if (kind === 'prompt' && (textLength(value) > RAW_TEXT_MAX || textLength(text) > PROMPT_TEXT_MAX)) {
    return bodyError(path, 'prompt_too_long', `A prompt has at most ${String(PROMPT_TEXT_MAX)} characters.`);
  }
  if (kind === 'lint' && textLength(value) > RAW_TEXT_MAX) {
    return bodyError(path, 'string_too_long', `String should have at most ${String(RAW_TEXT_MAX)} characters`);
  }
  if (text === '') return bodyError(path, 'string_too_short', 'At least 1 character.');
  if (CONTROL.test(text)) return bodyError(path, 'value_error', 'must not contain control characters');
  return text;
}

/** A whole number from `min` to `max`, or its error (Pydantic's `int` with `ge` and `le`). */
function intError(value: unknown, path: string, min: number, max: number): ValidationItem[] {
  if (typeof value !== 'number') return [bodyError(path, 'int_type', 'Input should be a valid integer')];
  if (!Number.isInteger(value)) {
    return [bodyError(path, 'int_from_float', 'Input should be a valid integer, got a number with a fractional part')];
  }
  if (value < min)
    return [bodyError(path, 'greater_than_equal', `Input should be greater than or equal to ${String(min)}`)];
  if (value > max) return [bodyError(path, 'less_than_equal', `Input should be less than or equal to ${String(max)}`)];
  return [];
}

/** A list of at most 20 term ids, or its errors. */
function termIdErrors(value: unknown, path: string): ValidationItem[] {
  if (!Array.isArray(value)) return [bodyError(path, 'list_type', 'Input should be a valid list')];
  if (value.length > TERMS_MAX) return [bodyError(path, 'too_long', `At most ${String(TERMS_MAX)}.`)];
  return value.flatMap((term: unknown, index) => uuidError(term, `${path}.${String(index)}`));
}

/** One prompt of a body as the API's `PromptCreate` reads it, or its field errors under `prefix`. */
function itemOf(value: unknown, prefix: string): PromptItem | ValidationItem[] {
  const path = (name: string): string => (prefix === '' ? name : `${prefix}.${name}`);
  if (!isRecord(value)) return [notAnObject(prefix)];
  const errors: ValidationItem[] = [...extraMembers(value, PROMPT_FIELDS, prefix)];
  const { language_code: language, country_iso: country, importance, term_ids: terms } = value;
  const text = textOf(value.text, path('text'), 'prompt');
  if (typeof text !== 'string') errors.push(text);
  errors.push(
    ...enumError(value.intent, path('intent'), INTENTS),
    ...enumError(value.funnel_stage, path('funnel_stage'), FUNNEL_STAGES),
    ...enumError(value.prompt_type, path('prompt_type'), PROMPT_TYPES),
  );
  if (typeof language !== 'string' || !LANGUAGE.test(language))
    errors.push(
      bodyError(path('language_code'), language === undefined ? 'missing' : 'string_pattern_mismatch', 'Two letters.'),
    );
  if (typeof country !== 'string' || !COUNTRY.test(country))
    errors.push(
      bodyError(
        path('country_iso'),
        country === undefined ? 'missing' : 'string_pattern_mismatch',
        'Two capital letters.',
      ),
    );
  if (importance !== undefined) errors.push(...intError(importance, path('importance'), 1, 5));
  if (terms !== undefined) errors.push(...termIdErrors(terms, path('term_ids')));
  if (errors.length > 0 || typeof text !== 'string' || typeof language !== 'string' || typeof country !== 'string') {
    return errors;
  }
  return {
    text,
    language_code: language,
    country_iso: country,
    intent: isOneOf(value.intent, INTENTS) ? value.intent : 'unknown',
    funnel_stage: isOneOf(value.funnel_stage, FUNNEL_STAGES) ? value.funnel_stage : 'unknown',
    prompt_type: isOneOf(value.prompt_type, PROMPT_TYPES) ? value.prompt_type : 'question',
    importance: typeof importance === 'number' ? importance : 3,
    term_ids: Array.isArray(terms) ? terms.filter((term): term is string => typeof term === 'string') : [],
  };
}

/** Why the project cannot save this prompt: a term it cannot use, or a country an enabled engine does not run in. */
function saveError(projectId: string, item: PromptItem): { code: string; path: string; message: string } | null {
  if (item.term_ids.some((term) => termOf(term) === null)) {
    return { code: 'term_unknown', path: 'term_ids', message: 'A term the project cannot use.' };
  }
  const missing = enabledEngines(projectId).find((engine) => !countriesOf(engine).has(item.country_iso));
  return missing === undefined
    ? null
    : {
        code: 'location_not_supported',
        path: 'country_iso',
        message: `${ENGINE_FACTS[missing.engine_code].label} runs in no location of this country. Add one in the project's engine settings, or turn the engine off.`,
      };
}

function newPrompt(caller: ProjectCaller, item: PromptItem, now: number): StoredPrompt {
  const n = mintPromptNumber();
  const user = caller.session.user;
  return {
    prompt_id: promptId(n),
    version_id: versionId(n),
    project_id: caller.project.project_id,
    index: null,
    text: item.text,
    language_code: item.language_code,
    country_iso: item.country_iso,
    term_ids: item.term_ids,
    intent: item.intent,
    funnel_stage: item.funnel_stage,
    prompt_type: item.prompt_type,
    importance: item.importance,
    is_branded: ownMentions(caller.world, caller.project.project_id, item.text).length > 0,
    is_active: true,
    created_at: isoOf(now),
    updated_at: isoOf(now),
    created_by: { user_id: user.user_id, name: user.name, email: user.email },
  };
}

const quotaProblem = (request: Request, used: number, requested: number): ReturnType<typeof problem> =>
  problem(request, 'quota_exceeded', {
    detail: `The workspace has ${String(used)} of ${String(PROMPT_QUOTA)} active prompts; ${String(requested)} more do not fit.`,
    limit: PROMPT_QUOTA,
    used,
    requested,
  });

/** Every project of the workspace, not only those the caller may open: the quota is the workspace's. */
export const workspaceProjects = (caller: ProjectCaller): string[] =>
  projectList(caller.changes, caller.access.workspace.workspace_id).map((project) => project.project_id);

export const promptHandlers: HttpHandler[] = [
  mock('get', ENGINES, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    return HttpResponse.json({ data: ENGINE_CODES.map((code) => engineView(caller.project.project_id, code)) });
  }),

  mock('put', `${ENGINES}/{engine_code}`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const code = params.engine_code;
    if (!isOneOf(code, ENGINE_CODES)) {
      return invalid(request, [{ location: 'path', path: 'engine_code', code: 'enum', message: 'Not an engine.' }]);
    }
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = extraMembers(body, ['location_ids', 'is_enabled']);
    const ids = body.location_ids;
    if (!Array.isArray(ids))
      errors.push(bodyError('location_ids', ids === undefined ? 'missing' : 'list_type', 'A list of location ids.'));
    else if (ids.length === 0) errors.push(bodyError('location_ids', 'too_short', 'At least one country.'));
    else if (ids.length > LOCATIONS_MAX)
      errors.push(bodyError('location_ids', 'too_long', `At most ${String(LOCATIONS_MAX)}.`));
    else
      errors.push(
        ...ids.flatMap((id: unknown, index) => intError(id, `location_ids.${String(index)}`, 1, LOCATION_ID_MAX)),
      );
    if (body.is_enabled !== undefined && typeof body.is_enabled !== 'boolean') {
      errors.push(bodyError('is_enabled', 'bool_type', 'Input should be a valid boolean'));
    }
    if (errors.length > 0 || !Array.isArray(ids)) return invalid(request, errors);
    const locationIds = [...new Set(ids.filter((id): id is number => typeof id === 'number'))].sort((a, b) => a - b);
    if (locationIds.some((id) => countryOf(id) === null)) {
      return invalid(request, [
        bodyError(
          'location_ids',
          'location_not_supported',
          `${ENGINE_FACTS[code].label} runs in active countries only.`,
        ),
      ]);
    }
    const state = promptsOf(caller.project.project_id);
    const next: StoredEngine = {
      engine_code: code,
      is_enabled: body.is_enabled !== false,
      location_ids: locationIds,
    };
    state.engines = [...state.engines.filter((engine) => engine.engine_code !== code), next].sort(
      (a, b) => ENGINE_CODES.indexOf(a.engine_code) - ENGINE_CODES.indexOf(b.engine_code),
    );
    return HttpResponse.json({ data: engineView(caller.project.project_id, code) });
  }),

  mock('delete', `${ENGINES}/{engine_code}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const state = promptsOf(caller.project.project_id);
    if (!state.engines.some((engine) => engine.engine_code === params.engine_code))
      return problem(request, 'not_found');
    state.engines = state.engines.filter((engine) => engine.engine_code !== params.engine_code);
    return noContent();
  }),

  mock('get', PROMPTS, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: [
        'filter[q]',
        'filter[term]',
        'filter[intent_in]',
        'filter[country_iso]',
        'filter[language_code]',
        'filter[is_active]',
        'limit',
        'cursor',
      ],
    });
    if (caller instanceof Response) return caller;
    const paging = pageRequest(caller.url);
    if (Array.isArray(paging)) return invalid(request, paging);
    const search = caller.url.searchParams;
    const active = search.get('filter[is_active]') !== 'false';
    const q = search.get('filter[q]')?.toLowerCase() ?? null;
    const term = search.get('filter[term]');
    const country = search.get('filter[country_iso]');
    const language = search.get('filter[language_code]');
    const rows = promptsOf(caller.project.project_id)
      .prompts.filter(
        (prompt) =>
          prompt.is_active === active &&
          (q === null || prompt.text.toLowerCase().includes(q)) &&
          (term === null || prompt.term_ids.includes(term)) &&
          (country === null || prompt.country_iso === country) &&
          (language === null || prompt.language_code === language),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.prompt_id.localeCompare(a.prompt_id))
      .map(promptView);
    const page = cursorPage(rows, paging, JSON.stringify([active, q, term, country, language]));
    return page === null ? problem(request, 'invalid_cursor') : HttpResponse.json(page);
  }),

  mock('post', PROMPTS, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'prompts:write',
    });
    if (caller instanceof Response) return caller;
    const item = itemOf(await request.json(), '');
    if (Array.isArray(item)) return invalid(request, item);
    const refused = saveError(caller.project.project_id, item);
    if (refused !== null) return invalid(request, [bodyError(refused.path, refused.code, refused.message)]);
    const state = promptsOf(caller.project.project_id);
    const key = keyOf(item.text, item.language_code, item.country_iso);
    const existing = state.prompts.find(
      (prompt) => keyOf(prompt.text, prompt.language_code, prompt.country_iso) === key,
    );
    if (existing !== undefined) return problem(request, 'duplicate', { existing_id: existing.prompt_id });
    const used = activePromptCount(workspaceProjects(caller));
    if (used + 1 > PROMPT_QUOTA) return quotaProblem(request, used, 1);
    const stored = newPrompt(caller, item, Date.now());
    state.prompts.push(stored);
    return HttpResponse.json({ data: promptView(stored) }, { status: 201 });
  }),

  mock('post', `${PROMPTS}/bulk-create`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'prompts:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = extraMembers(body, ['items', 'on_duplicate']);
    const items = body.items;
    if (!Array.isArray(items)) return invalid(request, [...errors, bodyError('items', 'missing', 'Field required')]);
    if (items.length === 0) errors.push(bodyError('items', 'too_short', 'At least one prompt.'));
    if (items.length > BULK_MAX) errors.push(bodyError('items', 'too_long', `At most ${String(BULK_MAX)}.`));
    const mode = body.on_duplicate ?? 'skip';
    if (mode !== 'skip' && mode !== 'error') errors.push(bodyError('on_duplicate', 'literal_error', 'skip or error'));
    const read = items.map((value: unknown, index) => itemOf(value, `items.${String(index)}`));
    const parsed = read.flatMap((entry) => (Array.isArray(entry) ? [] : [entry]));
    errors.push(...read.flatMap((entry) => (Array.isArray(entry) ? entry : [])));
    if (errors.length > 0 || parsed.length !== read.length) return invalid(request, errors);
    const state = promptsOf(caller.project.project_id);
    const tracked = new Map(
      state.prompts.map((prompt) => [keyOf(prompt.text, prompt.language_code, prompt.country_iso), prompt.prompt_id]),
    );
    // The first index of each accepted prompt: a repeat of one the project already has is a duplicate, not a repeat
    const first = new Map<string, number>();
    const accepted: PromptItem[] = [];
    const skipped: { index: number; existing_id: string }[] = [];
    const rejected: { index: number; code: string; message: string }[] = [];
    parsed.forEach((item, index) => {
      const key = keyOf(item.text, item.language_code, item.country_iso);
      const refused = saveError(caller.project.project_id, item);
      const existing = tracked.get(key);
      const earlier = first.get(key);
      if (refused !== null) rejected.push({ index, code: refused.code, message: refused.message });
      else if (existing !== undefined && mode === 'skip') skipped.push({ index, existing_id: existing });
      else if (existing !== undefined)
        rejected.push({ index, code: 'duplicate', message: 'The project has this prompt.' });
      else if (earlier !== undefined)
        rejected.push({ index, code: 'duplicate_in_request', message: `The same prompt as item ${String(earlier)}.` });
      else {
        first.set(key, index);
        accepted.push(item);
      }
    });
    const used = activePromptCount(workspaceProjects(caller));
    if (used + accepted.length > PROMPT_QUOTA) return quotaProblem(request, used, accepted.length);
    const now = Date.now();
    const created = accepted.map((item) => newPrompt(caller, item, now));
    state.prompts.push(...created);
    return HttpResponse.json({ data: { created: created.map((prompt) => prompt.prompt_id), skipped, rejected } });
  }),

  mock('post', `${PROMPTS}/lint`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = extraMembers(body, ['texts', 'engine_codes']);
    const texts = body.texts;
    const saved: string[] = [];
    if (!Array.isArray(texts))
      errors.push(bodyError('texts', texts === undefined ? 'missing' : 'list_type', 'A list of texts.'));
    else if (texts.length === 0) errors.push(bodyError('texts', 'too_short', 'At least one text.'));
    else if (texts.length > LINT_MAX) errors.push(bodyError('texts', 'too_long', `At most ${String(LINT_MAX)}.`));
    else
      texts.forEach((raw: unknown, index) => {
        const text = textOf(raw, `texts.${String(index)}`, 'lint');
        if (typeof text === 'string') saved.push(text);
        else errors.push(text);
      });
    const codes = body.engine_codes ?? ENGINE_CODES;
    if (!Array.isArray(codes) || codes.length === 0 || codes.some((code) => !isOneOf(code, ENGINE_CODES))) {
      errors.push(bodyError('engine_codes', 'enum', `Allowed: ${ENGINE_CODES.join(', ')}.`));
    }
    if (errors.length > 0 || !Array.isArray(texts) || !Array.isArray(codes)) return invalid(request, errors);
    const engines = codes.filter((code): code is EngineCode => isOneOf(code, ENGINE_CODES));
    let data: PromptLint[];
    try {
      data = saved.map((text): PromptLint => {
        const found = ownMentions(caller.world, caller.project.project_id, text);
        const length = textLength(text);
        return {
          text,
          is_branded: found.length > 0,
          // Each text the aliases matched, once per brand: the alias is what the text says, not the brand's name
          matched_aliases: found.flatMap(({ entity, role, mention }) =>
            [
              ...new Set(
                mention.spans
                  .filter((span) => span.status === 'accepted')
                  .map((span) => text.slice(span.start, span.end)),
              ),
            ].map((alias) => ({ entity: entityRefView(entity, role), alias })),
          ),
          warnings: [
            ...found.map(({ entity, mention }) => {
              const place = mention.spans.find((span) => span.status === 'accepted') ?? mention.spans[0];
              return {
                rule: 'contains_brand_alias' as const,
                severity: 'warning' as const,
                message: `Names ${entity.canonical_name}. Answers to a branded prompt are left out of the rates unless they are asked for.`,
                engine_code: null,
                span: place === undefined ? null : { start: place.start, end: place.end },
              };
            }),
            ...engines
              .filter((code) => length > ENGINE_FACTS[code].max_prompt_chars)
              .map((code) => ({
                rule: 'engine_limit' as const,
                severity: length > PROMPT_TEXT_MAX ? ('error' as const) : ('warning' as const),
                message: `${ENGINE_FACTS[code].label} takes up to ${String(ENGINE_FACTS[code].max_prompt_chars)} characters; ${
                  length > PROMPT_TEXT_MAX ? 'the prompt cannot be saved.' : 'it skips this prompt.'
                }`,
                engine_code: code,
                span: null,
              })),
          ],
        };
      });
    } catch (error) {
      if (error instanceof TooManyMatchesError) return problem(request, 'too_many_matches', { detail: error.message });
      throw error;
    }
    return HttpResponse.json({
      data,
      quota: { limit: PROMPT_QUOTA, used: activePromptCount(workspaceProjects(caller)) },
    });
  }),

  mock('get', `${PROMPTS}/{prompt_id}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    const found = promptsOf(caller.project.project_id).prompts.find((prompt) => prompt.prompt_id === params.prompt_id);
    return found === undefined ? problem(request, 'not_found') : HttpResponse.json({ data: promptView(found) });
  }),

  mock('patch', `${PROMPTS}/{prompt_id}`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'prompts:write',
    });
    if (caller instanceof Response) return caller;
    const found = promptsOf(caller.project.project_id).prompts.find((prompt) => prompt.prompt_id === params.prompt_id);
    if (found === undefined) return problem(request, 'not_found');
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    // A member sent as null is refused by name; the other checks look at what is not null
    const given = (name: string): unknown => (body[name] === null ? undefined : body[name]);
    const errors = [
      ...nullErrors(body, PATCH_FIELDS),
      ...enumError(given('intent'), 'intent', INTENTS),
      ...enumError(given('funnel_stage'), 'funnel_stage', FUNNEL_STAGES),
      ...enumError(given('prompt_type'), 'prompt_type', PROMPT_TYPES),
      ...(given('importance') === undefined ? [] : intError(given('importance'), 'importance', 1, 5)),
      ...booleanError(given('is_branded'), 'is_branded'),
      ...booleanError(given('is_active'), 'is_active'),
      ...(given('term_ids') === undefined ? [] : termIdErrors(given('term_ids'), 'term_ids')),
      ...IMMUTABLE.filter((name) => name in body).map((name) =>
        bodyError(name, 'immutable_field', 'Fixed once saved: archive the prompt and add a new one.'),
      ),
      ...extraMembers(body, [...PATCH_FIELDS, ...IMMUTABLE]),
    ];
    if (errors.length > 0) return invalid(request, errors);
    if (Object.keys(body).length === 0) {
      return invalid(request, [bodyError('', 'value_error', 'give at least one field to change')]);
    }
    const termIds = Array.isArray(body.term_ids)
      ? [...new Set(body.term_ids.filter((term): term is string => typeof term === 'string'))].sort()
      : null;
    if (termIds?.some((term) => termOf(term) === null) === true) {
      return invalid(request, [bodyError('term_ids', 'term_unknown', 'A term the project cannot use.')]);
    }
    if (body.is_active === true && !found.is_active) {
      const used = activePromptCount(workspaceProjects(caller));
      if (used + 1 > PROMPT_QUOTA) return quotaProblem(request, used, 1);
    }
    if (termIds !== null) found.term_ids = termIds;
    // Terms live in their own table: only a change to the prompt's own columns moves updated_at
    const columns = PATCH_FIELDS.filter((name) => name !== 'term_ids' && name in body);
    if (columns.length > 0) found.updated_at = isoOf(Date.now());
    if (isOneOf(body.intent, INTENTS)) found.intent = body.intent;
    if (isOneOf(body.funnel_stage, FUNNEL_STAGES)) found.funnel_stage = body.funnel_stage;
    if (isOneOf(body.prompt_type, PROMPT_TYPES)) found.prompt_type = body.prompt_type;
    if (typeof body.importance === 'number') found.importance = body.importance;
    if (typeof body.is_branded === 'boolean') found.is_branded = body.is_branded;
    if (typeof body.is_active === 'boolean') found.is_active = body.is_active;
    return HttpResponse.json({ data: promptView(found) });
  }),

  mock('delete', `${PROMPTS}/{prompt_id}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'prompts:write',
    });
    if (caller instanceof Response) return caller;
    const found = promptsOf(caller.project.project_id).prompts.find((prompt) => prompt.prompt_id === params.prompt_id);
    if (found === undefined) return problem(request, 'not_found');
    found.is_active = false;
    return noContent();
  }),
];
