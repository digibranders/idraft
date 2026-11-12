import { describe, expect, it } from 'vitest';

import {
  classifyRunError,
  MANUAL_RUN_CAP,
  planRuns,
  runInTurn,
  tallyRuns,
  type RunResult,
  type Stop,
} from './run-model';
import { ApiProblem } from '@/lib/api/problem';
import type { ProjectEngine, Prompt } from '@/lib/api/types';
import type { Country } from '@/lib/locations/countries';

const country = (location_id: number, country_iso: string): Country => ({
  location_id,
  country_iso,
  name: country_iso,
  location_type: 'Country',
  parent_id: null,
  supports: ['serp'],
});
const COUNTRIES = [country(2276, 'DE'), country(2356, 'IN')];

const engine = (code: ProjectEngine['engine']['engine_code'], max: number, locations: number[]): ProjectEngine => ({
  engine: {
    engine_code: code,
    label: code,
    observation_class: 'consumer_ui',
    vendor: 'openai',
    exposes_citations: true,
    exposes_fanout: false,
    max_prompt_chars: max,
  },
  is_configured: true,
  is_enabled: true,
  location_ids: locations,
  replicates: 1,
  provider_code: 'dataforseo',
  active_prompts: 0,
  estimated_monthly_cost_usd: '0.000000',
});
/** ChatGPT takes 100 characters and has only Germany; Gemini takes 50 and has Germany and India. */
const CHATGPT = engine('chatgpt_web', 100, [2276]);
const GEMINI = engine('gemini_web', 50, [2276, 2356]);

const prompt = (id: string, text: string, countryIso: string | null): Prompt =>
  ({ prompt_id: id, country_iso: countryIso, current_version: { text } }) as unknown as Prompt;

describe('the prompts a run can ask', () => {
  it('asks each prompt on every engine that takes its length and has a location in its country', () => {
    const plan = planRuns(
      [
        prompt('both', 'short', 'DE'),
        prompt('long', 'x'.repeat(80), 'DE'),
        prompt('india', 'short', 'IN'),
        prompt('anywhere', 'short', null),
      ],
      [CHATGPT, GEMINI],
      COUNTRIES,
    );
    expect(plan.runnable).toEqual([
      { promptId: 'both', engineCodes: ['chatgpt_web', 'gemini_web'] },
      { promptId: 'long', engineCodes: ['chatgpt_web'] },
      { promptId: 'india', engineCodes: ['gemini_web'] },
      { promptId: 'anywhere', engineCodes: ['chatgpt_web', 'gemini_web'] },
    ]);
    expect(plan.blocked).toEqual([]);
  });

  it('sets aside a prompt no engine takes, and says whether it is too long or has no location', () => {
    const plan = planRuns(
      [prompt('huge', 'x'.repeat(200), 'DE'), prompt('india', 'short', 'IN')],
      [CHATGPT],
      COUNTRIES,
    );
    expect(plan.runnable).toEqual([]);
    expect(plan.blocked).toEqual([
      { promptId: 'huge', reason: 'too_long' },
      { promptId: 'india', reason: 'no_location' },
    ]);
  });

  it('leaves the locations to the API while the countries are not known', () => {
    const plan = planRuns([prompt('india', 'short', 'IN')], [CHATGPT], null);
    expect(plan.runnable).toEqual([{ promptId: 'india', engineCodes: ['chatgpt_web'] }]);
  });

  it('sets aside every prompt while no engine is on', () => {
    expect(planRuns([prompt('a', 'short', 'DE')], [], COUNTRIES).blocked).toEqual([
      { promptId: 'a', reason: 'no_engine' },
    ]);
  });
});

const problem = (
  status: number,
  code: string,
  body: Record<string, unknown> = {},
  retryAfterSeconds: number | null = null,
): ApiProblem =>
  new ApiProblem({ status, code, title: code, detail: null, requestId: null, errors: [], retryAfterSeconds, body });

const LIMIT: Stop = { reason: 'manual_run_limit', limit: 20, used: null, requested: null, retryMinutes: null };

describe('what a refused run means', () => {
  it('stops the loop for the limits that every other prompt would meet too', () => {
    expect(classifyRunError(problem(429, 'manual_run_limit', { limit: 20 }))).toEqual({ kind: 'stop', stop: LIMIT });
    expect(classifyRunError(problem(422, 'quota_exceeded', { limit: 100, used: 99, requested: 2 }))).toEqual({
      kind: 'stop',
      stop: { reason: 'quota_exceeded', limit: 100, used: 99, requested: 2, retryMinutes: null },
    });
    expect(classifyRunError(problem(503, 'provider_paused', {}, 300))).toMatchObject({
      kind: 'stop',
      stop: { reason: 'provider_paused', retryMinutes: 5 },
    });
    expect(classifyRunError(problem(429, 'rate_limited', {}, 61))).toMatchObject({
      kind: 'stop',
      stop: { reason: 'rate_limited', retryMinutes: 2 },
    });
    expect(classifyRunError(problem(403, 'forbidden'))).toMatchObject({ kind: 'stop', stop: { reason: 'forbidden' } });
    // Whatever the API calls a refusal for want of permission, it is the same for every prompt after it
    expect(classifyRunError(problem(403, 'permission_denied'))).toMatchObject({
      kind: 'stop',
      stop: { reason: 'forbidden' },
    });
  });

  it('goes on after a refusal that belongs to the prompt', () => {
    expect(classifyRunError(problem(409, 'check_pending'))).toEqual({ kind: 'refused', why: 'pending' });
    expect(classifyRunError(problem(422, 'validation_failed'))).toEqual({ kind: 'refused', why: 'engines' });
    expect(classifyRunError(problem(404, 'not_found'))).toEqual({ kind: 'refused', why: 'gone' });
    expect(classifyRunError(problem(500, 'internal_error'))).toEqual({ kind: 'refused', why: 'failed' });
    expect(classifyRunError(new Error('network'))).toEqual({ kind: 'refused', why: 'failed' });
  });
});

const STOP: RunResult = { kind: 'stop', stop: LIMIT };

describe('running one prompt after the other', () => {
  it('stops at the first limit and does not ask the prompts after it', async () => {
    const asked: string[] = [];
    const answers: RunResult[] = [{ kind: 'started' }, { kind: 'refused', why: 'pending' }, STOP];
    const outcome = await runInTurn(['a', 'b', 'c', 'd', 'e'], (id) => {
      asked.push(id);
      return Promise.resolve(answers[asked.length - 1] ?? { kind: 'started' });
    });
    expect(asked).toEqual(['a', 'b', 'c']);
    expect(outcome.results).toEqual([{ kind: 'started' }, { kind: 'refused', why: 'pending' }]);
    expect(outcome.stop).toMatchObject({ reason: 'manual_run_limit' });
    expect(outcome.notTried).toBe(2);
  });

  it('asks every prompt when none is stopped', async () => {
    const outcome = await runInTurn(['a', 'b'], () => Promise.resolve({ kind: 'started' }));
    expect(outcome).toMatchObject({ stop: null, notTried: 0 });
    expect(outcome.results).toHaveLength(2);
  });

  it('can be told to stop between two prompts', async () => {
    let stopped = false;
    const outcome = await runInTurn(
      ['a', 'b', 'c'],
      () => {
        stopped = true;
        return Promise.resolve({ kind: 'started' });
      },
      () => stopped,
    );
    expect(outcome.results).toHaveLength(1);
    expect(outcome.notTried).toBe(2);
  });
});

describe('the summary of a run', () => {
  it('counts what started, what was refused and why, what was set aside and what was not tried', () => {
    const tally = tallyRuns(22, 2, {
      results: [
        { kind: 'started' },
        { kind: 'started' },
        { kind: 'refused', why: 'pending' },
        { kind: 'refused', why: 'failed' },
        { kind: 'refused', why: 'failed' },
      ],
      stop: LIMIT,
      notTried: 14,
    });
    expect(tally).toMatchObject({
      total: 22,
      started: 2,
      blocked: 2,
      refused: { pending: 1, engines: 0, gone: 0, failed: 2 },
      notTried: 14,
    });
    expect(tally.stop?.reason).toBe('manual_run_limit');
  });

  it('knows the daily cap of manual runs', () => {
    expect(MANUAL_RUN_CAP).toBe(20);
  });
});
