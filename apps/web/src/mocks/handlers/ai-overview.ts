import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller } from './access';
import {
  answersWithCitations,
  countedAnswers,
  type CitedAnswer,
  NO_FLAGS,
  registrableOf,
  scopeOf,
  termSubtree,
  unitsOf,
} from './citations-model';
import { booleanQuery, offsetPageOf, offsetPaging, queryError, unknownQuery, uuidError } from './rules';
import { fanoutQueryRows, truncatedAnswerIds, type FanoutAnswer } from '../ai-fanout-queries';
import { ENGINE_CODES, ENGINE_FACTS } from '../prompt-fixtures';
import { promptsOf } from '../prompts-state';
import { invalid, mock, problem } from '../respond';
import { shiftIsoDate, validateDateWindow } from '../serp-views';
import type { EngineCode, Schemas, ValidationItem } from '@/lib/api/types';
import { formatIsoDate } from '@/lib/format';

/**
 * WP-33: the one route the AI overview reads that no mock answers yet, `ai/fanout-queries` (it reads its `meta`
 * only: one row, `limit=1`). WP-24 (the fan-out page) owns the route; its handlers sit in `fanoutHandlers`, which
 * is registered before this array, so the first handler to match is WP-24's and this one stops answering the day
 * WP-24 adds its own. Delete it then.
 *
 * shortcut: the fixtures keep no list of the queries an answer issued (the observations mock says `fanout_count:
 * 0` for every answer), so an answer counts as one that issued queries when it cited a source (the sources
 * read's `answers_citing`), and its queries come from the fixture builder `../ai-fanout-queries.ts`, which gives
 * each such answer one to three queries from a fixed pool (WP-37). The denominator is the sources read's: the valid
 * answers in scope on the engines that show their fan-out (ChatGPT). Unlike the API, an engine filter naming an
 * engine that shows none is not a `422 engine_has_no_fanout` here: it is no answers, and the engine is in
 * `engines_without_fanout`.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const DEFAULT_DAYS = 28;
const MAX_DAYS = 92;
const MAX_ENGINES = 3;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A market: two capital letters. */
const COUNTRY = /^[A-Z]{2}$/;
const ALLOWED = [
  'from',
  'to',
  'min_support',
  'include',
  'filter[country_iso]',
  'filter[engine_code_in]',
  'filter[prompt_id]',
  'filter[term]',
  'include_branded',
  'offset',
  'limit',
];
/** The fewest answers a query is listed for, when the request does not say (the API's default). */
const DEFAULT_MIN_SUPPORT = 2;
const MAX_MIN_SUPPORT = 1000;

const isEngine = (value: string): value is EngineCode => ENGINE_CODES.some((code) => code === value);

/** A comma list or repeated parameters of the query, each one of `allowed`; the errors go to `errors`. */
function listOf(url: URL, name: string, allowed: readonly string[], max: number, errors: ValidationItem[]): string[] {
  const values = url.searchParams
    .getAll(name)
    .flatMap((value) => value.split(','))
    .filter((value) => value !== '');
  if (values.length > max) errors.push(queryError(name, 'too_long', `List should have at most ${String(max)} items.`));
  values.forEach((value, place) => {
    if (!allowed.includes(value))
      errors.push(queryError(`${name}.${String(place)}`, 'enum', `Allowed: ${allowed.join(', ')}.`));
  });
  return values.filter((value) => allowed.includes(value));
}

/** `min_support`: a whole number from 1 to 1000, the API's default when left out. */
function minSupportOf(url: URL, errors: ValidationItem[]): number {
  const raw = url.searchParams.get('min_support');
  if (raw === null) return DEFAULT_MIN_SUPPORT;
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(value)) {
    errors.push(
      queryError('min_support', 'int_parsing', 'Input should be a valid integer, unable to parse string as an integer'),
    );
  } else if (value < 1 || value > MAX_MIN_SUPPORT) {
    errors.push(queryError('min_support', 'value_error', `Use a whole number from 1 to ${String(MAX_MIN_SUPPORT)}.`));
  } else {
    return value;
  }
  return DEFAULT_MIN_SUPPORT;
}

/** The answer as the fixture builder needs it, or nothing when it cited no source (it issued no query). */
function fanoutAnswerOf(answer: CitedAnswer): FanoutAnswer[] {
  const units = unitsOf(answer, NO_FLAGS);
  if (units.length === 0) return [];
  const cited = new Map<string, FanoutAnswer['cited'][number]>();
  for (const unit of units) {
    const domain = registrableOf(unit.host);
    const key = `${domain}|${unit.domain_role}|${unit.role_entity_id ?? ''}`;
    const found = cited.get(key);
    cited.set(key, {
      domain,
      role: unit.domain_role,
      entityId: unit.role_entity_id,
      units: (found?.units ?? 0) + 1,
    });
  }
  return [
    { id: answer.id, at: answer.at, promptId: answer.promptId, engine: answer.engine, cited: [...cited.values()] },
  ];
}

export const aiOverviewHandlers: HttpHandler[] = [
  mock('get', `${P}/ai/fanout-queries`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      // The unknown names are answered with the other 422s, after the 404 and the 403
      query: [...new Set(new URL(request.url).searchParams.keys())],
    });
    if (caller instanceof Response) return caller;
    const { url } = caller;
    const errors = unknownQuery(url, ALLOWED);
    const now = Date.now();
    const zone = caller.project.timezone;
    const toParam = url.searchParams.get('to');
    const anchor =
      toParam !== null && ISO_DATE.test(toParam) ? toParam : formatIsoDate(new Date(now).toISOString(), zone);
    const window = validateDateWindow(
      url.searchParams.get('from') ?? shiftIsoDate(anchor, 1 - DEFAULT_DAYS),
      toParam,
      now,
      zone,
      MAX_DAYS,
    );
    if ('error' in window) errors.push(window.error);
    const engines = listOf(url, 'filter[engine_code_in]', ENGINE_CODES, MAX_ENGINES, errors).filter(isEngine);
    const promptId = url.searchParams.get('filter[prompt_id]');
    const termId = url.searchParams.get('filter[term]');
    const country = url.searchParams.get('filter[country_iso]');
    for (const [value, name] of [
      [promptId, 'filter[prompt_id]'],
      [termId, 'filter[term]'],
    ] as const) {
      if (value !== null) {
        errors.push(...uuidError(value, name).map((item) => queryError(item.path, item.code, item.message)));
      }
    }
    if (country !== null && !COUNTRY.test(country)) {
      errors.push(
        queryError('filter[country_iso]', 'string_pattern_mismatch', "String should match pattern '^[A-Z]{2}$'"),
      );
    }
    const includeBranded = booleanQuery(url, 'include_branded', false);
    if (typeof includeBranded !== 'boolean') errors.push(includeBranded);
    const withTopics = listOf(url, 'include', ['topics'], 1, errors).includes('topics');
    const minSupport = minSupportOf(url, errors);
    const paging = offsetPaging(url);
    if (Array.isArray(paging)) errors.push(...paging);
    if (errors.length > 0 || 'error' in window || 'problem' in window || Array.isArray(paging)) {
      return 'problem' in window && errors.length === 0
        ? problem(request, 'window_too_large', {
            detail: `A request covers at most ${String(MAX_DAYS)} days.`,
            limit_days: MAX_DAYS,
          })
        : invalid(request, errors);
    }
    const projectId = caller.project.project_id;
    const scope = scopeOf({
      now,
      timezone: zone,
      from: window.range.firstDate,
      to: window.range.lastDate,
      engines,
      prompts: promptsOf(projectId).prompts,
      promptId,
      termIds: termId === null ? null : termSubtree(caller.world.terms, termId),
      country,
      roles: [],
      includeBranded: includeBranded === true,
      includeUnresolvedRedirects: false,
      includeEngineInternal: false,
    });
    const showing = scope.engines.filter((code) => ENGINE_FACTS[code].exposes_fanout);
    const counted = countedAnswers(answersWithCitations(projectId, now), { ...scope, engines: showing });
    const issuing = counted.flatMap(fanoutAnswerOf);
    // The topic terms a prompt is tagged with: terms of a `topic` vocabulary, whatever else it is tagged with
    const { terms, vocabularies } = caller.world;
    const topicVocabularies = new Set(
      vocabularies.filter((vocabulary) => vocabulary.kind === 'topic').map((vocabulary) => vocabulary.vocabulary_id),
    );
    const topicTerms = new Set(
      terms.filter((term) => topicVocabularies.has(term.vocabulary_id)).map((term) => term.term_id),
    );
    const termsOfPrompts = new Map(
      promptsOf(projectId).prompts.map((prompt) => [
        prompt.prompt_id,
        prompt.term_ids.filter((id) => topicTerms.has(id)),
      ]),
    );
    const cut = truncatedAnswerIds(issuing);
    const meta: Schemas['FanoutMeta'] = {
      window: { from: scope.window.first, to: scope.window.last, timezone: zone },
      include_branded: scope.includeBranded,
      engine_codes: showing,
      engines_without_fanout: scope.engines.filter((code) => !ENGINE_FACTS[code].exposes_fanout),
      min_support: minSupport,
      answers: counted.length,
      answers_truncated: cut.size,
      answers_with_fanout: issuing.length,
    };
    const rows = fanoutQueryRows(
      issuing,
      minSupport,
      withTopics ? (promptId) => termsOfPrompts.get(promptId) ?? [] : undefined,
    );
    return HttpResponse.json({ ...offsetPageOf(rows, paging), meta });
  }),
];
