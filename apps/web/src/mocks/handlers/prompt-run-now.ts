import { HttpResponse, type HttpHandler } from 'msw';

import { type ProjectCaller } from './access';
import { deliveredOf } from './prompt-answers';
import { MANUAL_RUN_LIMIT, manualRunsToday, operationsProjectCaller, savedOperations } from './operations-rules';
import { countryOf, isoOf, workspaceProjects } from './prompts';
import { bodyError, extraMembers, isOneOf, isRecord, notAnObject, uuidError } from './rules';
import { operationIdMinter, runTime, withRun, type StoredRun } from '../operations-state';
import {
  ENGINE_CODES,
  ENGINE_FACTS,
  fixtureEngines,
  fixturePrompts,
  runInstants,
  type StoredPrompt,
} from '../prompt-fixtures';
import { AI_ANSWER_QUOTA, isProviderPaused, mintPromptNumber, PENDING_MS, promptsOf } from '../prompts-state';
import { invalid, mock, problem } from '../respond';
import type { EngineCode, Run, ValidationItem } from '@/lib/api/types';
import { textLength } from '@/lib/text/length';

/**
 * Run now (slice 1, plan B of 2026-11-11, `ai_run_now` in the backend's `api/operations/runs.py`): one prompt
 * asked on engines now, through the provider's standard queue. The answer is `202` with a planned manual run.
 * The checks are the API's, in its order: the provider is not paused, the prompt is one the project collects,
 * every engine can be asked (one field error for each that cannot), no answer is on its way, the project has
 * manual runs left today, and the month's answers of the workspace still fit.
 * The day's 20 manual runs are shared with every other manual run of the project (./runs.ts counts Run now's too).
 * The run goes into the browser's runs (`GET .../runs` lists it, and its own link answers). Its answers arrive at once,
 * one valid answer per engine, in the project's observations (./prompt-answers.ts), which live in memory with the
 * prompts: a page reload keeps the run but not its answers.
 * shortcut: the answers are kept in memory, not in a cookie like the runs; move them there if a reload should keep them.
 * shortcut: the answers exist from the first instant, whatever the run's own state says, and cancelling the run leaves
 * them; the run's `config_snapshot` is the keyword runs' (`provider_mode` live, a keyword count) and not the backend's
 * `{prompt_ids, engine_codes}` on the standard queue, since the stored run keeps no prompt or engine ids. Keep them on
 * the run if a screen reads them.
 */

const PROMPT = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/{prompt_id}';
const ENGINES_MAX = 3;
const RUN_WINDOW_MS = 3_600_000;
/** What a refused engine is told, by the planner's own reason (`_NOT_ASKED_WHY`). */
const NOT_ASKED_WHY = {
  engine_not_enabled: 'The engine is not turned on for the project.',
  prompt_too_long: 'The prompt is longer than this engine takes.',
  location_not_enabled: "The engine has no location in the prompt's country.",
} as const;
const RETRY_AFTER_SECONDS = '300';
const month = (instant: number): string => isoOf(instant).slice(0, 7);

/** The engines of a body, or its errors: one to three codes of an engine, each valid. */
function enginesOf(body: unknown): EngineCode[] | ValidationItem[] {
  if (!isRecord(body)) return [notAnObject()];
  const errors = extraMembers(body, ['engine_codes']);
  const codes = body.engine_codes;
  if (codes === undefined) errors.push(bodyError('engine_codes', 'missing', 'Field required'));
  else if (!Array.isArray(codes)) errors.push(bodyError('engine_codes', 'list_type', 'Input should be a valid list'));
  else if (codes.length === 0) errors.push(bodyError('engine_codes', 'too_short', 'List should have at least 1 item'));
  else if (codes.length > ENGINES_MAX)
    errors.push(bodyError('engine_codes', 'too_long', 'List should have at most 3 items'));
  else {
    codes.forEach((code: unknown, place) => {
      if (!isOneOf(code, ENGINE_CODES)) {
        errors.push(bodyError(`engine_codes.${String(place)}`, 'enum', `Allowed: ${ENGINE_CODES.join(', ')}.`));
      }
    });
  }
  if (errors.length > 0 || !Array.isArray(codes)) return errors;
  // Each once, by code
  return [...new Set(codes.filter((code): code is EngineCode => isOneOf(code, ENGINE_CODES)))].sort();
}

/** The locations an engine would ask a prompt in: those of the engine in the prompt's country. */
const locationsFor = (engine: { location_ids: readonly number[] }, prompt: StoredPrompt): number =>
  engine.location_ids.filter((id) => countryOf(id) === prompt.country_iso).length;

/** The answers the fixtures' schedules asked of the workspace's projects in the month of `now`. */
function scheduledAnswers(projectIds: readonly string[], now: number): number {
  const runs = runInstants(now).filter((at) => month(at) === month(now)).length;
  return projectIds.reduce((sum, id) => sum + runs * fixturePrompts(id).length * fixtureEngines(id).length, 0);
}

/** The run an answer of Run now is, as the API answers it: planned, asked of nobody yet, to be planned within a minute. */
function runOf(caller: ProjectCaller, now: number, runId: string): Run {
  const self = `/api/v1/workspaces/${caller.access.workspace.workspace_id}/projects/${caller.project.project_id}/runs/${runId}`;
  const user = caller.session.user;
  return {
    run_id: runId,
    project_id: caller.project.project_id,
    schedule_id: null,
    workload: 'ai_prompt',
    trigger: 'manual',
    status: 'planned',
    status_reason: null,
    window_start: isoOf(now),
    window_end: isoOf(now + RUN_WINDOW_MS),
    tasks_total: 0,
    tasks_succeeded: 0,
    tasks_failed: 0,
    estimated_cost_usd: null,
    actual_cost_usd: null,
    blocked_by_budget_id: null,
    created_by: { actor_id: user.user_id, actor_type: 'user', label: user.name },
    created_at: isoOf(now),
    completed_at: null,
    operation: {
      kind: 'collection_run',
      status: 'queued',
      progress: { done: 0, total: null, unit: 'tasks' },
      started_at: null,
      finished_at: null,
      error: null,
      links: { self, cancel: `${self}/cancel` },
    },
  };
}

/** What the run is in the browser's runs once the planner has it: an AI run of the project, its answers at once. */
function aiRunOf(caller: ProjectCaller, runId: string, answers: number, now: number): StoredRun {
  return {
    run_id: runId,
    project_id: caller.project.project_id,
    schedule_id: null,
    workload: 'ai_prompt',
    trigger: 'manual',
    created_at: runTime(now),
    created_by: caller.session.user.user_id,
    tasks_total: answers,
    tasks_failed: 0,
    // No Labs calls: an AI answer is priced by the answer
    calls: 0,
    keyword_count: null,
    stale_days: null,
    ending: 'completed',
    status_reason: null,
    blocked_by_budget_id: null,
    cancelled_at: null,
    cancel_reason: null,
  };
}

/** The observation ids Run now gives its answers: far above the fixtures' (`observationIdOf`), one per answer. */
const DELIVERED_ID_BASE = 1_000_000_000_000;

export const promptRunHandlers: HttpHandler[] = [
  mock('post', `${PROMPT}/run-now`, async ({ request, cookies, params }) => {
    const caller = operationsProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'runs:trigger',
    });
    if (caller instanceof Response) return caller;
    // The path and the body are checked together, before anything is looked up
    const text = await request.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return invalid(request, [bodyError('', 'json_invalid', 'JSON decode error')]);
    }
    const asked = enginesOf(body);
    const errors = [
      ...uuidError(params.prompt_id, 'prompt_id').map((item): ValidationItem => ({ ...item, location: 'path' })),
      ...(asked.every((entry) => typeof entry === 'string') ? [] : (asked as ValidationItem[])),
    ];
    if (errors.length > 0) return invalid(request, errors);
    const engines = asked.filter((code): code is EngineCode => typeof code === 'string');
    if (isProviderPaused()) {
      return problem(request, 'provider_paused', {
        detail: 'The data provider is not being asked just now. Try again in a few minutes.',
        headers: { 'retry-after': RETRY_AFTER_SECONDS },
      });
    }
    const projectId = caller.project.project_id;
    const state = promptsOf(projectId);
    const prompt = state.prompts.find((candidate) => candidate.prompt_id === params.prompt_id && candidate.is_active);
    if (prompt === undefined) return problem(request, 'not_found');

    // An engine the planner would ask nothing of is refused now, each with its reason
    const length = textLength(prompt.text);
    const refused = engines.flatMap((code): ValidationItem[] => {
      const engine = state.engines.find((candidate) => candidate.engine_code === code && candidate.is_enabled);
      const why =
        engine === undefined
          ? 'engine_not_enabled'
          : length > ENGINE_FACTS[code].max_prompt_chars
            ? 'prompt_too_long'
            : locationsFor(engine, prompt) === 0
              ? 'location_not_enabled'
              : null;
      return why === null ? [] : [bodyError('engine_codes', why, `${code}: ${NOT_ASKED_WHY[why]}`)];
    });
    if (refused.length > 0) return invalid(request, refused);

    const now = Date.now();
    const pending = engines.filter(
      (code) => now - (state.asked.get(`${prompt.prompt_id} ${code}`) ?? -PENDING_MS) < PENDING_MS,
    );
    if (pending.length > 0) {
      return problem(request, 'check_pending', {
        detail: 'This prompt already has an answer queued or under way on these engines. Wait for it to end.',
        engine_codes: pending,
      });
    }
    // Every manual run of the project counts (keyword refreshes, checks and Run now's own), not only Run now's
    if (manualRunsToday(caller.operations, projectId, now) >= MANUAL_RUN_LIMIT) {
      // The API carries only `limit`: no `used`, and no Retry-After
      return problem(request, 'manual_run_limit', {
        detail: `The project has had its ${String(MANUAL_RUN_LIMIT)} manual runs today (UTC).`,
        limit: MANUAL_RUN_LIMIT,
      });
    }
    // One answer for each location of each engine, in the prompt's country
    const requested = engines.reduce((sum, code) => {
      const engine = state.engines.find((candidate) => candidate.engine_code === code);
      return sum + (engine === undefined ? 0 : locationsFor(engine, prompt));
    }, 0);
    const projects = workspaceProjects(caller);
    const used =
      scheduledAnswers(projects, now) +
      projects.reduce((sum, id) => sum + (promptsOf(id).answersAsked.get(month(now)) ?? 0), 0);
    if (used + requested > AI_ANSWER_QUOTA) {
      return problem(request, 'quota_exceeded', {
        detail: `The workspace has asked for ${String(used)} of its ${String(AI_ANSWER_QUOTA)} AI answers this month (UTC); ${String(requested)} more do not fit.`,
        limit: AI_ANSWER_QUOTA,
        used,
        requested,
        quota: 'max_ai_observations_per_month',
      });
    }
    // The run is saved first: a full cookie refuses the request before anything else moves
    const minter = operationIdMinter(caller.operationChanges);
    const runId = minter.next('run');
    const changes = minter.commit(withRun(caller.operationChanges, aiRunOf(caller, runId, engines.length, now)));
    const cookie = savedOperations(request, changes);
    if (typeof cookie !== 'string') return cookie;
    state.answersAsked.set(month(now), (state.answersAsked.get(month(now)) ?? 0) + requested);
    for (const code of engines) state.asked.set(`${prompt.prompt_id} ${code}`, now);
    // One answer per engine, delivered now. A prompt added here has no fixture place, so it answers as the first one does.
    for (const code of engines) {
      const engine = state.engines.find((candidate) => candidate.engine_code === code);
      if (engine === undefined) continue;
      const id = String(DELIVERED_ID_BASE + mintPromptNumber());
      state.observations.push(deliveredOf(prompt, prompt.index ?? 0, engine, now, id, runId));
    }
    return HttpResponse.json({ data: runOf(caller, now, runId) }, { status: 202, headers: { 'set-cookie': cookie } });
  }),
];
