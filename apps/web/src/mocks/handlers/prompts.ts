import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller, type ProjectCaller } from './access';
import { bodyError, cursorPage, extraMembers, isOneOf, isRecord, notAnObject, pageRequest } from './rules';
import { MOCK_ENTITIES, MOCK_LOCATIONS, MOCK_ROLES, MOCK_TERMS, MOCK_VOCABULARIES } from '../entity-fixtures';
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
import type { EngineCode, ProjectEngine, Prompt, PromptLint, ValidationItem } from '@/lib/api/types';

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
const PATCH_FIELDS = ['is_active', 'importance'] as const;
const IMMUTABLE = ['text', 'language_code', 'country_iso'] as const;
const LANGUAGE = /^[a-z]{2}$/;
const COUNTRY = /^[A-Z]{2}$/;

const normalized = (text: string): string => text.normalize('NFC').trim();
const keyOf = (text: string, language: string, country: string): string =>
  `${normalized(text)}\u0000${language}\u0000${country}`;
const isoOf = (instant: number): string => new Date(instant).toISOString();

/** The country of an active country location, or `null` for any other location. */
const countryOf = (locationId: number): string | null =>
  MOCK_LOCATIONS.find((location) => location.location_id === locationId && location.location_type === 'Country')
    ?.country_iso ?? null;

const countriesOf = (engine: StoredEngine): Set<string> =>
  new Set(
    engine.location_ids.flatMap((id) => {
      const country = countryOf(id);
      return country === null ? [] : [country];
    }),
  );

const enabledEngines = (projectId: string): StoredEngine[] =>
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
    path: term.slug,
  };
}

/** The own brands of a project, by canonical name: what makes a prompt branded. */
const ownEntities = (projectId: string): { entity_id: string; canonical_name: string; entity_type: string }[] =>
  MOCK_ROLES.filter((role) => role.project_id === projectId && role.role === 'own').flatMap((role) =>
    MOCK_ENTITIES.filter((entity) => entity.entity_id === role.entity_id),
  );

const namesOwn = (projectId: string, text: string): boolean =>
  ownEntities(projectId).some((entity) => text.toLowerCase().includes(entity.canonical_name.toLowerCase()));

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
    intent: 'unknown',
    funnel_stage: 'unknown',
    prompt_type: 'question',
    importance: stored.importance,
    is_branded: stored.is_branded,
    source: 'manual',
    creation_method: 'human',
    is_active: stored.is_active,
    terms: stored.term_ids.flatMap((id) => termOf(id) ?? []),
    created_by: stored.created_by,
    created_at: stored.created_at,
    updated_at: stored.created_at,
  };
}

function engineView(projectId: string, code: EngineCode): ProjectEngine {
  const configured = promptsOf(projectId).engines.find((engine) => engine.engine_code === code);
  const fits = promptsOf(projectId).prompts.filter(
    (prompt) => prompt.is_active && prompt.text.length <= ENGINE_FACTS[code].max_prompt_chars,
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
  importance: number;
  term_ids: string[];
}

/** One prompt of a body as the API's `PromptCreate` reads it, or its field errors under `prefix`. */
function itemOf(value: unknown, prefix: string): PromptItem | ValidationItem[] {
  const path = (name: string): string => (prefix === '' ? name : `${prefix}.${name}`);
  if (!isRecord(value)) return [notAnObject(prefix)];
  const errors: ValidationItem[] = [...extraMembers(value, PROMPT_FIELDS, prefix)];
  const { text, language_code: language, country_iso: country, importance, term_ids: terms } = value;
  if (typeof text !== 'string')
    errors.push(bodyError(path('text'), text === undefined ? 'missing' : 'string_type', 'Give the prompt.'));
  else if (normalized(text) === '') errors.push(bodyError(path('text'), 'string_too_short', 'At least 1 character.'));
  else if (normalized(text).length > PROMPT_TEXT_MAX)
    errors.push(
      bodyError(path('text'), 'prompt_too_long', `A prompt has at most ${String(PROMPT_TEXT_MAX)} characters.`),
    );
  else if (/[\r\n]/.test(normalized(text))) errors.push(bodyError(path('text'), 'value_error', 'One line only.'));
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
  if (
    importance !== undefined &&
    (typeof importance !== 'number' || !Number.isInteger(importance) || importance < 1 || importance > 5)
  )
    errors.push(bodyError(path('importance'), 'less_than_equal', 'From 1 to 5.'));
  if (terms !== undefined && (!Array.isArray(terms) || terms.some((term) => typeof term !== 'string')))
    errors.push(bodyError(path('term_ids'), 'list_type', 'A list of term ids.'));
  if (errors.length > 0 || typeof text !== 'string' || typeof language !== 'string' || typeof country !== 'string') {
    return errors;
  }
  return {
    text: normalized(text),
    language_code: language,
    country_iso: country,
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
        message: `${ENGINE_FACTS[missing.engine_code].label} runs in no location of this country.`,
      };
}

function newPrompt(caller: ProjectCaller, item: PromptItem, now: number): StoredPrompt {
  const n = mintPromptNumber();
  const user = caller.session.user;
  return {
    prompt_id: promptId(n),
    version_id: versionId(n),
    project_id: caller.project.project_id,
    text: item.text,
    language_code: item.language_code,
    country_iso: item.country_iso,
    term_ids: item.term_ids,
    importance: item.importance,
    is_branded: namesOwn(caller.project.project_id, item.text),
    is_active: true,
    created_at: isoOf(now),
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

const workspaceProjects = (caller: ProjectCaller): string[] => caller.projects.map((project) => project.project_id);

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
      ids.forEach((id: unknown, index) => {
        if (typeof id !== 'number' || countryOf(id) === null) {
          errors.push(bodyError(`location_ids.${String(index)}`, 'location_not_supported', 'Not an active country.'));
        }
      });
    if (body.is_enabled !== undefined && typeof body.is_enabled !== 'boolean') {
      errors.push(bodyError('is_enabled', 'bool_type', 'Input should be a valid boolean'));
    }
    if (errors.length > 0 || !Array.isArray(ids)) return invalid(request, errors);
    const state = promptsOf(caller.project.project_id);
    const next: StoredEngine = {
      engine_code: code,
      is_enabled: body.is_enabled !== false,
      location_ids: ids.filter((id): id is number => typeof id === 'number'),
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
    const seen = new Set<string>();
    const accepted: PromptItem[] = [];
    const skipped: { index: number; existing_id: string }[] = [];
    const rejected: { index: number; code: string; message: string }[] = [];
    parsed.forEach((item, index) => {
      const key = keyOf(item.text, item.language_code, item.country_iso);
      const refused = saveError(caller.project.project_id, item);
      const existing = tracked.get(key);
      if (refused !== null) rejected.push({ index, code: refused.code, message: refused.message });
      else if (seen.has(key))
        rejected.push({ index, code: 'duplicate_in_request', message: 'The same prompt twice in the list.' });
      else if (existing !== undefined && mode === 'skip') skipped.push({ index, existing_id: existing });
      else if (existing !== undefined)
        rejected.push({ index, code: 'duplicate', message: 'The project has this prompt.' });
      else accepted.push(item);
      seen.add(key);
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
    if (
      !Array.isArray(texts) ||
      texts.length === 0 ||
      texts.length > LINT_MAX ||
      texts.some((text) => typeof text !== 'string')
    ) {
      errors.push(bodyError('texts', 'too_short', `From 1 to ${String(LINT_MAX)} texts.`));
    }
    const codes = body.engine_codes ?? ENGINE_CODES;
    if (!Array.isArray(codes) || codes.length === 0 || codes.some((code) => !isOneOf(code, ENGINE_CODES))) {
      errors.push(bodyError('engine_codes', 'enum', `Allowed: ${ENGINE_CODES.join(', ')}.`));
    }
    if (errors.length > 0 || !Array.isArray(texts) || !Array.isArray(codes)) return invalid(request, errors);
    const engines = codes.filter((code): code is EngineCode => isOneOf(code, ENGINE_CODES));
    const owners = ownEntities(caller.project.project_id);
    const data = texts.map((raw: unknown): PromptLint => {
      const text = normalized(typeof raw === 'string' ? raw : '');
      const lower = text.toLowerCase();
      const found = owners.flatMap((entity) => {
        const start = lower.indexOf(entity.canonical_name.toLowerCase());
        return start < 0 ? [] : [{ entity, start, end: start + entity.canonical_name.length }];
      });
      return {
        text,
        is_branded: found.length > 0,
        matched_aliases: found.map(({ entity, start, end }) => ({
          entity: {
            entity_id: entity.entity_id,
            canonical_name: entity.canonical_name,
            entity_type: entity.entity_type === 'brand' ? 'brand' : 'other',
            color_index: 1,
            role: 'own',
          },
          alias: text.slice(start, end),
        })),
        warnings: [
          ...found.map(({ entity, start, end }) => ({
            rule: 'contains_brand_alias' as const,
            severity: 'info' as const,
            message: `Names ${entity.canonical_name}: the prompt is branded.`,
            engine_code: null,
            span: { start, end },
          })),
          ...engines
            .filter((code) => text.length > ENGINE_FACTS[code].max_prompt_chars)
            .map((code) => ({
              rule: 'engine_limit' as const,
              severity: text.length > PROMPT_TEXT_MAX ? ('error' as const) : ('warning' as const),
              message: `${ENGINE_FACTS[code].label} takes at most ${String(ENGINE_FACTS[code].max_prompt_chars)} characters.`,
              engine_code: code,
              span: null,
            })),
        ],
      };
    });
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
    const errors = [
      ...IMMUTABLE.filter((name) => name in body).map((name) =>
        bodyError(name, 'immutable_field', 'Fixed once saved: archive the prompt and add a new one.'),
      ),
      ...extraMembers(body, [...PATCH_FIELDS, ...IMMUTABLE]),
    ];
    if (body.is_active !== undefined && typeof body.is_active !== 'boolean') {
      errors.push(bodyError('is_active', 'bool_type', 'Input should be a valid boolean'));
    }
    if (errors.length > 0) return invalid(request, errors);
    if (body.is_active === true && !found.is_active) {
      const used = activePromptCount(workspaceProjects(caller));
      if (used + 1 > PROMPT_QUOTA) return quotaProblem(request, used, 1);
    }
    if (typeof body.is_active === 'boolean') found.is_active = body.is_active;
    if (typeof body.importance === 'number') found.importance = body.importance;
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
