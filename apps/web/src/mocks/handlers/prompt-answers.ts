import { TZDate } from '@date-fns/tz';
import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller, type ProjectCaller } from './access';
import { countryOf, enabledEngines, isoOf } from './prompts';
import { booleanQuery, cursorPage, pageRequest, queryError, uuidError } from './rules';
import { isActiveRole } from '../entities-state';
import {
  answerOf,
  DAY_MS,
  ENGINE_CODES,
  ENGINE_FACTS,
  FIXTURE_ENGINES,
  FIXTURE_PROMPTS,
  observationIdOf,
  parseObservationId,
  RUN_OFFSET_MS,
  runInstants,
  validAnswerOf,
  type Answer,
  type StoredEngine,
  type StoredPrompt,
} from '../prompt-fixtures';
import { countsOf, NO_COUNTS, promptCells, topicCells, type Counts } from '../prompt-summary';
import { promptsOf } from '../prompts-state';
import { invalid, mock, problem } from '../respond';
import { shiftIsoDate, validateDateWindow } from '../serp-views';
import type {
  ObservationDetail,
  ObservationSummary,
  PromptsSummary,
  PromptSummaryRow,
  TopicSummaryRow,
  ValidationItem,
} from '@/lib/api/types';
import { formatIsoDate } from '@/lib/format';

/**
 * AI answers and the prompts summary, slice 1, plan B of 2026-11-11: the project's answers newest first, one
 * answer with its mentions and sources, the provider's raw answer, and the summary the Topics and Prompts page
 * reads. The rules are the API's (backend `api/ai/observations.py`, `observation_routes.py`, `summary.py` and
 * `summary_repository.py`). Answers are made from the fixtures (./prompt-fixtures.ts), so they are the same on
 * every request and the summary is computed from them, never written down.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const OBSERVATIONS = `${P}/ai/observations` as const;
/** Without `from`, a list covers the 28 days before `to`; no request covers more than 92. */
const DEFAULT_DAYS = 28;
const MAX_DAYS = 92;
const MAX_ENGINE_FILTER = 10;
const ANSWER_STATUSES = ['complete', 'partial', 'empty', 'refused', 'error'] as const;
const OUTCOMES = ['mentioned_and_cited', 'mentioned_only', 'cited_only', 'neither'] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** An instant with its zone: `Z` or an offset (Pydantic's `AwareDatetime`). */
const AWARE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;
/** A date and time with no zone: a datetime, but not an instant. */
const NAIVE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
/** An observation id is a 64-bit integer, and PostgreSQL refuses anything larger. */
const ID_MAX = 2n ** 63n - 1n;
/** An `observed_at` hint finds the month: the answer is looked for this far either side of it. */
const HINT_SLACK_MS = DAY_MS;
/** A provider's raw answer is kept 90 days; an answer past that is `410 raw_expired` (the API's retention). */
const RAW_RETENTION_MS = 90 * DAY_MS;

type Bound = { date: string } | { at: number } | null;

const hasCode = (value: unknown): value is ValidationItem =>
  typeof value === 'object' && value !== null && 'code' in value;

/** The start of a project day as an instant. */
const dayStart = (date: string, timeZone: string): number => {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new TZDate(year, month - 1, day, timeZone).getTime();
};

/** `from` or `to` of a list: a project day, an instant, or nothing; an error for anything else. */
function boundOf(url: URL, name: 'from' | 'to'): Bound | ValidationItem {
  const raw = url.searchParams.get(name);
  if (raw === null) return null;
  if (ISO_DATE.test(raw) && shiftIsoDate(raw, 0) === raw) return { date: raw };
  if (AWARE.test(raw) && !Number.isNaN(Date.parse(raw))) return { at: Date.parse(raw) };
  return NAIVE.test(raw)
    ? queryError(name, 'timezone_aware', 'Input should have timezone info')
    : queryError(name, 'date_parsing', 'Input should be a valid date or datetime');
}

/** A comma list or repeated parameters of the query, at most `max` of them, each one of `allowed` when given. */
function listOf(url: URL, name: string, allowed: readonly string[] | null, max: number): string[] | ValidationItem {
  const values = url.searchParams
    .getAll(name)
    .flatMap((value) => value.split(','))
    .filter((value) => value !== '');
  if (values.length > max) return queryError(name, 'too_long', `List should have at most ${String(max)} items.`);
  return allowed === null || values.every((value) => allowed.includes(value))
    ? values
    : queryError(name, 'enum', `Allowed: ${allowed.join(', ')}.`);
}

/** The cursor's scope: every query parameter but the page's own. */
function scopeOf(url: URL): string {
  const scope = new URLSearchParams(
    [...url.searchParams.entries()].filter(([name]) => name !== 'cursor' && name !== 'limit'),
  );
  scope.sort();
  return scope.toString();
}

/** An answer of a prompt on an engine, observed at `at`, with the answer the mock makes of it. */
function detailFrom(
  prompt: StoredPrompt,
  engine: StoredEngine,
  at: number,
  observationId: string,
  runId: string | null,
  answer: Answer,
): ObservationDetail {
  const code = engine.engine_code;
  return {
    observation_id: observationId,
    observed_at: isoOf(at),
    observed_date: isoOf(at).slice(0, 10),
    engine_code: code,
    observation_class: ENGINE_FACTS[code].observation_class,
    subject: { type: 'prompt', prompt_id: prompt.prompt_id, prompt_version_id: prompt.version_id, version_no: 1 },
    query_text: prompt.text,
    run_id: runId,
    replicate_index: 1,
    location_id: engine.location_ids.find((id) => countryOf(id) === prompt.country_iso) ?? null,
    language_code: prompt.language_code,
    device: 'desktop',
    status: answer.status,
    model_reported: answer.model_reported,
    answer_char_count: answer.answer_text === null ? null : [...answer.answer_text].length,
    citation_count: answer.citations.length,
    fanout_count: 0,
    served_from_cache: false,
    facts: answer.facts,
    answer_text: answer.answer_text,
    error_code: answer.error_code,
    check_url: answer.check_url,
    offsets_unit: 'utf16',
    citations: answer.citations,
    mentions: answer.mentions,
  };
}

/** The answer of a fixture prompt on an engine at a run. */
function detailOf(prompt: StoredPrompt, index: number, engine: StoredEngine, at: number): ObservationDetail {
  const day = Math.floor(at / DAY_MS);
  const id = observationIdOf(day, index, ENGINE_CODES.indexOf(engine.engine_code));
  return detailFrom(prompt, engine, at, id, null, answerOf(index, prompt.language_code, engine.engine_code, day));
}

/**
 * The observation Run now delivers: a valid answer of the prompt on the engine, observed at `at` for the run
 * `runId`. `index` is the prompt's place among the fixtures, or 0 for a prompt added here (it has none).
 */
export function deliveredOf(
  prompt: StoredPrompt,
  index: number,
  engine: StoredEngine,
  at: number,
  observationId: string,
  runId: string,
): ObservationDetail {
  const answer = validAnswerOf(index, prompt.language_code, engine.engine_code, Math.floor(at / DAY_MS));
  return detailFrom(prompt, engine, at, observationId, runId, answer);
}

/**
 * Every answer a project's fixture prompts got and every one Run now delivered, newest first. The fixtures'
 * history has no prompt added here nor an engine turned on here, and an engine turned off keeps what it answered.
 */
function answersOf(projectId: string, now: number): ObservationDetail[] {
  const prompts = FIXTURE_PROMPTS.get(projectId) ?? [];
  const engines = FIXTURE_ENGINES.get(projectId) ?? [];
  return [
    ...runInstants(now).flatMap((at) =>
      prompts.flatMap((prompt) =>
        prompt.index === null ? [] : engines.map((engine) => detailOf(prompt, prompt.index ?? 0, engine, at)),
      ),
    ),
    ...promptsOf(projectId).observations,
  ].sort(
    (a, b) =>
      Date.parse(b.observed_at) - Date.parse(a.observed_at) ||
      Number(BigInt(b.observation_id) - BigInt(a.observation_id)),
  );
}

/** The list's row of an answer: the detail without its text, its link, its sources and its mentions. */
const summaryOf = (detail: ObservationDetail): ObservationSummary => ({
  observation_id: detail.observation_id,
  observed_at: detail.observed_at,
  observed_date: detail.observed_date,
  engine_code: detail.engine_code,
  observation_class: detail.observation_class,
  subject: detail.subject,
  query_text: detail.query_text,
  run_id: detail.run_id,
  replicate_index: detail.replicate_index,
  location_id: detail.location_id,
  language_code: detail.language_code,
  device: detail.device,
  status: detail.status,
  model_reported: detail.model_reported,
  answer_char_count: detail.answer_char_count,
  citation_count: detail.citation_count,
  fanout_count: detail.fanout_count,
  served_from_cache: detail.served_from_cache,
  facts: detail.facts,
});

/** The number in an observation id's path, or the error the API answers with for a value it cannot take. */
function idOf(raw: string): bigint | ValidationItem {
  const path = (code: string, message: string): ValidationItem => ({
    location: 'path',
    path: 'observation_id',
    code,
    message,
  });
  if (!/^[+-]?\d+$/.test(raw))
    return path('int_parsing', 'Input should be a valid integer, unable to parse string as an integer');
  const id = BigInt(raw);
  if (id < 1n) return path('greater_than_equal', 'Input should be greater than or equal to 1');
  if (id > ID_MAX) return path('less_than_equal', `Input should be less than or equal to ${ID_MAX.toString()}`);
  return id;
}

/** The `observed_at` hint, as an instant (a time with no zone is UTC), `null` when not given, or its error. */
function hintOf(url: URL): number | null | ValidationItem {
  const raw = url.searchParams.get('observed_at');
  if (raw === null) return null;
  const given = NAIVE.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
  const at = AWARE.test(given) || ISO_DATE.test(given) ? Date.parse(given) : Number.NaN;
  return Number.isNaN(at)
    ? queryError('observed_at', 'datetime_from_date_parsing', 'Input should be a valid datetime or date')
    : at;
}

/** The answer an id names, when it is a fixture prompt's on an engine it was asked on at a run, within the hint. */
function findAnswer(projectId: string, id: bigint, hint: number | null, now: number): ObservationDetail | null {
  const delivered = promptsOf(projectId).observations.find((row) => row.observation_id === id.toString());
  if (delivered !== undefined) {
    return hint !== null && Math.abs(Date.parse(delivered.observed_at) - hint) > HINT_SLACK_MS ? null : delivered;
  }
  const parsed = parseObservationId(id.toString());
  if (parsed === null) return null;
  const prompt = (FIXTURE_PROMPTS.get(projectId) ?? []).find((candidate) => candidate.index === parsed.index);
  const engine = (FIXTURE_ENGINES.get(projectId) ?? []).find(
    (candidate) => candidate.engine_code === ENGINE_CODES[parsed.engine],
  );
  const at = parsed.day * DAY_MS + RUN_OFFSET_MS;
  if (prompt === undefined || engine === undefined || !runInstants(now).includes(at)) return null;
  if (hint !== null && Math.abs(at - hint) > HINT_SLACK_MS) return null;
  return detailOf(prompt, parsed.index, engine, at);
}

/** The strings of a plain term path as Python compares them (by code point): the order the API sorts topics in. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function entitiesOf(caller: ProjectCaller): PromptsSummary['entities'] {
  const roles = caller.world.roles.filter(
    (role) =>
      role.project_id === caller.project.project_id &&
      isActiveRole(role) &&
      (role.role === 'own' || role.role === 'competitor') &&
      role.track_ai !== false,
  );
  return roles
    .flatMap((role) => {
      const entity = caller.world.entities.find((candidate) => candidate.entity_id === role.entity_id);
      return entity === undefined || (role.role !== 'own' && role.role !== 'competitor')
        ? []
        : [{ entity_id: entity.entity_id, name: entity.canonical_name, role: role.role }];
    })
    .sort((a, b) => byText(a.role, b.role) || byText(a.name, b.name) || byText(a.entity_id, b.entity_id));
}

const CONTEXT_PER_PROMPT = 'Counts of valid answers to one prompt, so each answer weighs the same.';
const CONTEXT_TOPIC =
  "Prompt weighted: the mean over the topic's prompts of each prompt's share of valid answers (prompts with no valid answer are left out); `pooled` holds the answers.";

const metricContext = (): PromptsSummary['metric_context'] => ({
  mentioned: {
    metric: 'ai.mention_rate',
    prompt_rows: 'observation_weighted',
    topic_rows: 'prompt_weighted',
    method: `Valid answers that name the own brand. ${CONTEXT_PER_PROMPT} ${CONTEXT_TOPIC}`,
  },
  cited: {
    metric: 'ai.citation_rate',
    prompt_rows: 'observation_weighted',
    topic_rows: 'prompt_weighted',
    method: `Valid answers that cite the own domain. ${CONTEXT_PER_PROMPT} ${CONTEXT_TOPIC}`,
  },
  outcomes: {
    metric: 'ai.outcome_mix',
    prompt_rows: 'observation_weighted',
    topic_rows: 'prompt_weighted',
    method: `The four outcomes of valid answers, which add up to the denominator. ${CONTEXT_PER_PROMPT} ${CONTEXT_TOPIC}`,
  },
  share_of_voice: {
    metric: 'ai.share_of_voice',
    prompt_rows: 'observation_weighted',
    topic_rows: 'observation_weighted',
    method:
      "Per answer that names a tracked entity, the own brands' share of the entities it names (docs/16 section 5), summed over those answers; also in a topic row, where every answer weighs the same.",
  },
});

export const promptAnswerHandlers: HttpHandler[] = [
  mock('get', OBSERVATIONS, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: [
        'from',
        'to',
        'filter[engine_code_in]',
        'filter[prompt_id]',
        'filter[status_in]',
        'filter[is_valid]',
        'filter[outcome_in]',
        'limit',
        'cursor',
      ],
    });
    if (caller instanceof Response) return caller;
    const { url } = caller;
    const from = boundOf(url, 'from');
    const to = boundOf(url, 'to');
    const engines = listOf(url, 'filter[engine_code_in]', null, MAX_ENGINE_FILTER);
    const statuses = listOf(url, 'filter[status_in]', ANSWER_STATUSES, ANSWER_STATUSES.length);
    const outcomes = listOf(url, 'filter[outcome_in]', OUTCOMES, OUTCOMES.length);
    const promptId = url.searchParams.get('filter[prompt_id]');
    const validRaw = url.searchParams.get('filter[is_valid]');
    const paging = pageRequest(url);
    const errors = [
      ...[from, to, engines, statuses, outcomes].filter(hasCode),
      ...(promptId === null
        ? []
        : uuidError(promptId, 'filter[prompt_id]').map((item) => queryError(item.path, item.code, item.message))),
      ...(validRaw === null || validRaw === 'true' || validRaw === 'false'
        ? []
        : [queryError('filter[is_valid]', 'bool_parsing', 'Input should be a valid boolean')]),
      ...(Array.isArray(paging) ? paging : []),
    ];
    if (
      errors.length > 0 ||
      hasCode(from) ||
      hasCode(to) ||
      !Array.isArray(engines) ||
      !Array.isArray(statuses) ||
      !Array.isArray(outcomes) ||
      Array.isArray(paging)
    ) {
      return invalid(request, errors);
    }
    const now = Date.now();
    const zone = caller.project.timezone;
    const until = to === null ? now : 'at' in to ? to.at : dayStart(shiftIsoDate(to.date, 1), zone);
    const since = from === null ? until - DEFAULT_DAYS * DAY_MS : 'at' in from ? from.at : dayStart(from.date, zone);
    if (until - since > MAX_DAYS * DAY_MS) {
      return problem(request, 'window_too_large', {
        detail: `A request covers at most ${String(MAX_DAYS)} days.`,
        limit_days: MAX_DAYS,
      });
    }
    const valid = validRaw === null ? null : validRaw === 'true';
    const rows = answersOf(caller.project.project_id, now)
      .filter((answer) => {
        const at = Date.parse(answer.observed_at);
        return (
          at >= since &&
          at < until &&
          (promptId === null || answer.subject.prompt_id === promptId) &&
          (engines.length === 0 || engines.includes(answer.engine_code)) &&
          (statuses.length === 0 || statuses.includes(answer.status)) &&
          (valid === null || answer.facts?.is_valid === valid) &&
          // An outcome belongs to a valid answer: a refusal has both own flags false too, and is no "neither"
          (outcomes.length === 0 ||
            (answer.facts !== null && answer.facts.outcome !== null && outcomes.includes(answer.facts.outcome)))
        );
      })
      .map(summaryOf);
    const page = cursorPage(rows, paging, scopeOf(url));
    return page === null ? problem(request, 'invalid_cursor') : HttpResponse.json(page);
  }),

  mock('get', `${OBSERVATIONS}/{observation_id}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['observed_at'],
    });
    if (caller instanceof Response) return caller;
    const id = idOf(String(params.observation_id));
    const hint = hintOf(caller.url);
    const errors = [id, hint].filter(hasCode);
    if (errors.length > 0 || typeof id !== 'bigint' || hasCode(hint)) return invalid(request, errors);
    const found = findAnswer(caller.project.project_id, id, hint, Date.now());
    return found === null ? problem(request, 'not_found') : HttpResponse.json({ data: found });
  }),

  mock('get', `${OBSERVATIONS}/{observation_id}/raw`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'raw:read',
      query: ['observed_at'],
    });
    if (caller instanceof Response) return caller;
    const id = idOf(String(params.observation_id));
    const hint = hintOf(caller.url);
    const errors = [id, hint].filter(hasCode);
    if (errors.length > 0 || typeof id !== 'bigint' || hasCode(hint)) return invalid(request, errors);
    const found = findAnswer(caller.project.project_id, id, hint, Date.now());
    if (found === null) return problem(request, 'not_found');
    if (Date.now() - Date.parse(found.observed_at) > RAW_RETENTION_MS) return problem(request, 'raw_expired');
    // The provider's task answer, cut to what the answer holds: the mocks keep no real payload
    const failed = found.status === 'error';
    return HttpResponse.json(
      {
        status_code: 20000,
        status_message: 'Ok.',
        tasks: [
          {
            id: `task-${found.observation_id}`,
            status_code: failed ? 50000 : 20000,
            status_message: failed ? 'Internal error.' : 'Ok.',
            result: failed
              ? null
              : [
                  {
                    model: found.model_reported,
                    markdown: found.answer_text,
                    check_url: found.check_url,
                    sources: found.citations.map((citation) => ({
                      url: citation.raw_url,
                      title: citation.title,
                      domain: citation.host,
                    })),
                  },
                ],
          },
        ],
      },
      {
        headers: {
          'content-disposition': `attachment; filename="ai-observation-${found.observation_id}.json"`,
          'x-content-type-options': 'nosniff',
          'content-security-policy': 'sandbox',
          'cache-control': 'private, no-store',
        },
      },
    );
  }),

  mock('get', `${P}/ai/prompts-summary`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['from', 'to', 'filter[engine_code_in]', 'include_branded'],
    });
    if (caller instanceof Response) return caller;
    const { url } = caller;
    const projectId = caller.project.project_id;
    const zone = caller.project.timezone;
    const now = Date.now();
    const toParam = url.searchParams.get('to');
    const anchor =
      toParam !== null && ISO_DATE.test(toParam) ? toParam : formatIsoDate(new Date(now).toISOString(), zone);
    const fromParam = url.searchParams.get('from') ?? shiftIsoDate(anchor, 1 - DEFAULT_DAYS);
    const window = validateDateWindow(fromParam, toParam, now, zone, MAX_DAYS);
    if ('error' in window) return invalid(request, [window.error]);
    if ('problem' in window) {
      return problem(request, 'window_too_large', {
        detail: `A window is at most ${String(MAX_DAYS)} days.`,
        limit_days: window.limit_days,
      });
    }
    const asked = listOf(url, 'filter[engine_code_in]', null, MAX_ENGINE_FILTER);
    const branded = booleanQuery(url, 'include_branded', false);
    if (hasCode(asked) || typeof branded !== 'boolean') {
      return invalid(request, [asked, branded].filter(hasCode));
    }
    const { firstDate, lastDate } = window.range;
    // Branded prompts are left out unless asked for; the oldest prompt first
    const prompts = promptsOf(projectId)
      .prompts.filter((prompt) => prompt.is_active && (branded || !prompt.is_branded))
      .sort((a, b) => byText(a.created_at, b.created_at) || byText(a.prompt_id, b.prompt_id));
    const included = new Set(prompts.map((prompt) => prompt.prompt_id));
    // The answers of the window's project days that count: the fixtures' have a fact row each
    const byPrompt = new Map<string, Map<string, NonNullable<ObservationDetail['facts']>[]>>();
    for (const answer of answersOf(projectId, now)) {
      const day = formatIsoDate(answer.observed_at, zone);
      const prompt = answer.subject.prompt_id;
      if (day < firstDate || day > lastDate || !included.has(prompt) || answer.facts === null) continue;
      if (asked.length > 0 && !asked.includes(answer.engine_code)) continue;
      const engines = byPrompt.get(prompt) ?? new Map<string, NonNullable<ObservationDetail['facts']>[]>();
      engines.set(answer.engine_code, [...(engines.get(answer.engine_code) ?? []), answer.facts]);
      byPrompt.set(prompt, engines);
    }
    const counts = (promptId: string, code: string): Counts => {
      const facts = byPrompt.get(promptId)?.get(code);
      return facts === undefined ? NO_COUNTS : countsOf(facts);
    };
    // The engines that are on or have answers in the window, by code
    const seen = new Set([...byPrompt.values()].flatMap((engines) => [...engines.keys()]));
    const shown = [...new Set([...enabledEngines(projectId).map((engine) => engine.engine_code), ...seen])]
      .filter((code) => asked.length === 0 || asked.includes(code))
      .sort(byText);

    // A prompt's topics: the terms of a topic vocabulary it was given, which the workspace still has
    const { terms, vocabularies } = caller.world;
    const topicKinds = new Set(
      vocabularies.filter((vocabulary) => vocabulary.kind === 'topic').map((vocabulary) => vocabulary.vocabulary_id),
    );
    const topicTerms = new Map(
      terms.filter((term) => topicKinds.has(term.vocabulary_id)).map((term) => [term.term_id, term]),
    );
    const topicsOf = (termIds: readonly string[]): string[] => termIds.filter((id) => topicTerms.has(id)).sort(byText);
    // Each topic holds the prompts given it or a term below it, each once
    const held = new Map<string, Set<string>>();
    for (const prompt of prompts) {
      for (const given of topicsOf(prompt.term_ids)) {
        for (
          let at: string | null | undefined = given;
          at !== null && at !== undefined;
          at = topicTerms.get(at)?.parent_id
        ) {
          held.set(at, (held.get(at) ?? new Set()).add(prompt.prompt_id));
        }
      }
    }
    const topicRow = (termId: string | null, members: ReadonlySet<string>): TopicSummaryRow => ({
      term_id: termId,
      name: termId === null ? null : (topicTerms.get(termId)?.name ?? null),
      prompt_count: members.size,
      engines: shown.map((code) =>
        topicCells(
          code,
          [...members].flatMap((id) => (byPrompt.get(id)?.has(code) === true ? [counts(id, code)] : [])),
        ),
      ),
    });
    const rows: PromptSummaryRow[] = prompts.map((prompt) => ({
      prompt_id: prompt.prompt_id,
      text: prompt.text,
      is_branded: prompt.is_branded,
      topic_term_ids: topicsOf(prompt.term_ids),
      engines: shown.map((code) => promptCells(code, counts(prompt.prompt_id, code))),
    }));
    const untopiced = new Set(rows.filter((row) => row.topic_term_ids.length === 0).map((row) => row.prompt_id));
    const topics = [...held]
      .sort(([a], [b]) => byText(topicTerms.get(a)?.name ?? '', topicTerms.get(b)?.name ?? '') || byText(a, b))
      .map(([termId, members]) => topicRow(termId, members));
    if (untopiced.size > 0) topics.push(topicRow(null, untopiced));
    const counted = [...byPrompt.values()].some((engines) => engines.size > 0);
    const summary: PromptsSummary = {
      window: { from: firstDate, to: lastDate, timezone: zone },
      include_branded: branded,
      engine_codes: shown,
      metric_context: metricContext(),
      entities: entitiesOf(caller),
      // Every fixture answer was derived under the first entity configuration
      entity_config_versions: counted ? [1] : [],
      prompts: rows,
      topics,
    };
    return HttpResponse.json({ data: summary });
  }),
];
