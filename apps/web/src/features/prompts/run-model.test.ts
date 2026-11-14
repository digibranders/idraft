import { describe, expect, it } from 'vitest';

import {
  BULK_ARCHIVE_MAX,
  BULK_RUN_MAX,
  chunkIds,
  isFreshCount,
  MANUAL_RUN_CAP,
  planRuns,
  runProblemOf,
  skipCounts,
  summarizeRuns,
  type ChunkAnswer,
} from './run-model';
import { ApiProblem } from '@/lib/api/problem';
import type { ProjectEngine, Prompt, RunSkip, ValidationItem } from '@/lib/api/types';
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

describe('the runs a choice of prompts makes', () => {
  const ids = (count: number): string[] => Array.from({ length: count }, (_, at) => `p${String(at)}`);

  it('knows the daily cap of manual runs and what one bulk run takes', () => {
    expect(MANUAL_RUN_CAP).toBe(20);
    expect(BULK_RUN_MAX).toBe(150);
  });

  it('keeps up to 150 prompts in one run, in order, and splits more into runs of 150', () => {
    expect(chunkIds(ids(150)).map((run) => run.length)).toEqual([150]);
    const runs = chunkIds(ids(160));
    expect(runs.map((run) => run.length)).toEqual([150, 10]);
    expect(runs[1]?.[0]).toBe('p150');
    expect(chunkIds(ids(301)).map((run) => run.length)).toEqual([150, 150, 1]);
    expect(chunkIds([])).toEqual([]);
  });

  it('takes 1,000 prompts in one archive request, and splits more into requests of 1,000', () => {
    expect(BULK_ARCHIVE_MAX).toBe(1000);
    expect(chunkIds(ids(1100), BULK_ARCHIVE_MAX).map((request) => request.length)).toEqual([1000, 100]);
  });
});

describe('how long the count of the day stays true', () => {
  const at = Date.parse('2026-11-12T12:00:00Z');
  const minutes = (count: number): number => count * 60_000;

  it('is true for half an hour of the same UTC day', () => {
    expect(isFreshCount(at, at)).toBe(true);
    expect(isFreshCount(at, at + minutes(29))).toBe(true);
    expect(isFreshCount(at, at + minutes(31))).toBe(false);
  });

  it('is not true on the next UTC day, however short the time since', () => {
    const late = Date.parse('2026-11-12T23:50:00Z');
    expect(isFreshCount(late, late + minutes(5))).toBe(true);
    expect(isFreshCount(late, late + minutes(20))).toBe(false);
  });

  it('is not true when the clock went back', () => {
    expect(isFreshCount(at, at - minutes(1))).toBe(false);
  });
});

const skip = (prompt_id: string, engine_code: RunSkip['engine_code'], reason: RunSkip['reason']): RunSkip => ({
  prompt_id,
  engine_code,
  reason,
});

describe('the pairs a run left out, in words', () => {
  it('counts each reason, an answer already on its way being one whether it is queued or the prompts', () => {
    expect(
      skipCounts([
        skip('a', 'chatgpt_web', 'prompt_too_long'),
        skip('b', 'chatgpt_web', 'prompt_too_long'),
        skip('b', 'gemini_web', 'location_not_enabled'),
        skip('c', 'chatgpt_web', 'check_pending'),
        skip('c', 'gemini_web', 'prompt_pending'),
      ]),
    ).toEqual({ tooLong: 2, noLocation: 1, pending: 2 });
    expect(skipCounts([])).toEqual({ tooLong: 0, noLocation: 0, pending: 0 });
  });
});

const problem = (
  status: number,
  code: string,
  body: Record<string, unknown> = {},
  retryAfterSeconds: number | null = null,
  errors: ValidationItem[] = [],
): ApiProblem =>
  new ApiProblem({ status, code, title: code, detail: null, requestId: null, errors, retryAfterSeconds, body });
const item = (path: string, code: string, message = ''): ValidationItem => ({ location: 'body', path, code, message });

describe('what a refused run means', () => {
  it('reads the waits in whole minutes, at least one', () => {
    expect(runProblemOf(problem(503, 'provider_paused', {}, 300))).toEqual({ kind: 'provider_paused', minutes: 5 });
    expect(runProblemOf(problem(429, 'rate_limited', {}, 61))).toEqual({ kind: 'rate_limited', minutes: 2 });
    expect(runProblemOf(problem(503, 'provider_paused'))).toEqual({ kind: 'provider_paused', minutes: 1 });
  });

  it('reads the limit of manual runs and the numbers of the month of answers', () => {
    expect(runProblemOf(problem(429, 'manual_run_limit', { limit: 20 }))).toEqual({
      kind: 'manual_run_limit',
      limit: 20,
    });
    expect(runProblemOf(problem(429, 'manual_run_limit'))).toEqual({ kind: 'manual_run_limit', limit: null });
    expect(runProblemOf(problem(422, 'quota_exceeded', { limit: 100, used: 99, requested: 2 }))).toEqual({
      kind: 'quota_exceeded',
      limit: 100,
      used: 99,
      requested: 2,
    });
    expect(runProblemOf(problem(422, 'quota_exceeded'))).toEqual({
      kind: 'quota_exceeded',
      limit: null,
      used: null,
      requested: null,
    });
  });

  it('says no permission by the status, whatever the problem calls it', () => {
    expect(runProblemOf(problem(403, 'forbidden'))).toEqual({ kind: 'forbidden' });
    expect(runProblemOf(problem(403, 'permission_denied'))).toEqual({ kind: 'forbidden' });
  });

  it('says that some prompts are archived or gone for a prompt id the project does not ask', () => {
    expect(
      runProblemOf(problem(422, 'validation_failed', {}, null, [item('prompt_ids', 'prompt_unknown', 'Unknown')])),
    ).toEqual({ kind: 'prompt_unknown' });
  });

  it('names the engines that are refused, by reason, from the engine before the colon of the message', () => {
    expect(
      runProblemOf(
        problem(422, 'validation_failed', {}, null, [
          item('engine_codes', 'engine_not_enabled', 'gemini_web: The engine is not turned on for the project.'),
          item('engine_codes', 'engine_not_enabled', 'google_ai_mode: The engine is not turned on for the project.'),
          item('engine_codes', 'prompt_too_long', 'chatgpt_web: The prompt is longer than this engine takes.'),
        ]),
      ),
    ).toEqual({
      kind: 'engines_refused',
      refused: { engine_not_enabled: ['gemini_web', 'google_ai_mode'], prompt_too_long: ['chatgpt_web'] },
    });
  });

  it('takes a missing price as the run is, whether it is a problem of its own or an item', () => {
    expect(runProblemOf(problem(422, 'price_unavailable'))).toEqual({
      kind: 'engines_refused',
      refused: { price_unavailable: [] },
    });
    expect(
      runProblemOf(
        problem(422, 'validation_failed', {}, null, [item('engine_codes', 'price_unavailable', 'No price')]),
      ),
    ).toEqual({ kind: 'engines_refused', refused: { price_unavailable: [] } });
  });

  it('says nothing was started, with the reasons, when every pair was left out', () => {
    const skipped = [
      skip('a', 'chatgpt_web', 'prompt_too_long'),
      skip('b', 'chatgpt_web', 'location_not_enabled'),
      skip('b', 'gemini_web', 'location_not_enabled'),
    ];
    expect(runProblemOf(problem(422, 'nothing_to_run', { skipped }))).toEqual({
      kind: 'nothing_to_run',
      skips: { tooLong: 1, noLocation: 2, pending: 0 },
    });
    expect(
      runProblemOf(
        problem(409, 'check_pending', { prompt_ids: ['a'], skipped: [skip('a', 'chatgpt_web', 'check_pending')] }),
      ),
    ).toEqual({ kind: 'check_pending', engines: [], skips: { tooLong: 0, noLocation: 0, pending: 1 } });
    // Run now of one prompt names the engines instead
    expect(runProblemOf(problem(409, 'check_pending', { engine_codes: ['gemini_web'] }))).toEqual({
      kind: 'check_pending',
      engines: ['gemini_web'],
      skips: { tooLong: 0, noLocation: 0, pending: 0 },
    });
  });

  it('never throws on a skipped list that is not one', () => {
    expect(runProblemOf(problem(422, 'nothing_to_run', { skipped: 'x' }))).toEqual({
      kind: 'nothing_to_run',
      skips: { tooLong: 0, noLocation: 0, pending: 0 },
    });
    expect(runProblemOf(problem(422, 'nothing_to_run', { skipped: [null, { reason: 4 }, 'x'] }))).toEqual({
      kind: 'nothing_to_run',
      skips: { tooLong: 0, noLocation: 0, pending: 0 },
    });
  });

  it('keeps a prompt that is gone, and every other failure, apart', () => {
    expect(runProblemOf(problem(404, 'not_found'))).toEqual({ kind: 'gone' });
    expect(runProblemOf(problem(500, 'internal_error'))).toEqual({ kind: 'failed' });
    expect(runProblemOf(problem(422, 'validation_failed'))).toEqual({ kind: 'failed' });
    expect(runProblemOf(new Error('network'))).toEqual({ kind: 'failed' });
  });
});

const answer = (
  ids: readonly string[],
  prompts: number,
  cost: string,
  skipped: RunSkip[],
  used: number,
): ChunkAnswer => ({
  ids,
  meta: {
    prompts,
    answers: prompts * 2,
    estimated_cost_usd: cost,
    skipped,
    manual_runs_today: { used, limit: 20 },
  },
});

describe('the summary of the runs that were queued', () => {
  const CODES = ['chatgpt_web', 'gemini_web'];

  it('counts the prompts and the engines asked, the cost, and the pairs left out in words', () => {
    const summary = summarizeRuns(
      [
        answer(
          ['a', 'b', 'c'],
          2,
          '0.024000',
          [
            skip('c', 'chatgpt_web', 'prompt_too_long'),
            skip('c', 'gemini_web', 'prompt_too_long'),
            skip('b', 'gemini_web', 'location_not_enabled'),
          ],
          3,
        ),
      ],
      CODES,
    );
    expect(summary.prompts).toBe(2);
    expect(summary.engines).toBe(2);
    expect(summary.cost).toBeCloseTo(0.024);
    expect(summary.skips).toEqual({ tooLong: 2, noLocation: 1, pending: 0 });
    // The prompt left out on every engine did not start; the one left out on one engine did
    expect(summary.startedIds).toEqual(['a', 'b']);
    expect(summary.manualRuns).toEqual({ used: 3, limit: 20 });
  });

  it('does not count an engine that every prompt was left out on', () => {
    const summary = summarizeRuns(
      [
        answer(
          ['a', 'b'],
          2,
          '0.010000',
          [skip('a', 'gemini_web', 'location_not_enabled'), skip('b', 'gemini_web', 'location_not_enabled')],
          1,
        ),
      ],
      CODES,
    );
    expect(summary.engines).toBe(1);
    expect(summary.startedIds).toEqual(['a', 'b']);
  });

  it('adds up the runs of more than one request, and reads the day from the last of them', () => {
    const summary = summarizeRuns(
      [
        answer(['a', 'b'], 2, '0.010000', [], 4),
        answer(['c'], 1, '0.005000', [skip('c', 'gemini_web', 'prompt_pending')], 5),
      ],
      CODES,
    );
    expect(summary.prompts).toBe(3);
    expect(summary.engines).toBe(2);
    expect(summary.cost).toBeCloseTo(0.015);
    expect(summary.skips).toEqual({ tooLong: 0, noLocation: 0, pending: 1 });
    expect(summary.startedIds).toEqual(['a', 'b', 'c']);
    expect(summary.manualRuns).toEqual({ used: 5, limit: 20 });
  });

  it('has no cost when one is not a price, and no day when nothing was queued', () => {
    expect(summarizeRuns([answer(['a'], 1, 'unknown', [], 1)], CODES).cost).toBeNull();
    expect(summarizeRuns([], CODES)).toMatchObject({ prompts: 0, engines: 0, startedIds: [], manualRuns: null });
  });
});
