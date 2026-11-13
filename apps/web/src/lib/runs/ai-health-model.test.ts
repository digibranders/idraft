import { describe, expect, it } from 'vitest';

import {
  coverageRows,
  DEGRADED_BELOW,
  DEGRADED_MIN_PLANNED,
  degradedEngines,
  formatCoverageRate,
  lineOf,
  MISSING_SHOWN,
  missingShown,
  progressOf,
  type CoverageEngine,
  type CoverageMissing,
  type LineRun,
  type ProgressRun,
} from './ai-health-model';

/** Saturday 14 November 2026, 10:00 UTC: 11:00 in Berlin. */
const NOW = new Date('2026-11-14T10:00:00Z');
const BERLIN = 'Europe/Berlin';

const run = (over: Partial<LineRun> = {}): LineRun => ({
  status: 'completed',
  workload: 'ai_prompt',
  tasks_total: 150,
  tasks_succeeded: 141,
  created_at: '2026-11-14T05:00:00Z',
  completed_at: '2026-11-14T05:12:00Z',
  ...over,
});

const finished = (over: Partial<LineRun> = {}, zone = BERLIN): ReturnType<typeof lineOf> =>
  lineOf({ state: 'ready', run: run(over) }, zone, NOW);

describe('lineOf', () => {
  it('a finished run reads Last run with the time in the project zone', () => {
    expect(finished()).toEqual({
      kind: 'finished',
      status: 'completed',
      when: '06:12',
      counts: { done: 141, total: 150, noun: 'answers' },
    });
    // The same instant in another zone is another clock time, and a run near midnight is still today there
    expect(finished({}, 'America/New_York')).toMatchObject({ when: '00:12' });
    expect(finished({ completed_at: '2026-11-13T23:30:00Z' })).toMatchObject({ kind: 'finished', when: '00:30' });
  });

  it('a run on another day shows the date', () => {
    expect(finished({ completed_at: '2026-11-12T05:12:00Z' })).toMatchObject({ when: 'Nov 12' });
    // 23:30 UTC on the 13th is already the 14th in Berlin (a time), and still the 13th in Los Angeles (a date)
    expect(finished({ completed_at: '2026-11-13T23:30:00Z' })).toMatchObject({ when: '00:30' });
    expect(finished({ completed_at: '2026-11-13T23:30:00Z' }, 'America/Los_Angeles')).toMatchObject({
      when: 'Nov 13',
    });
    expect(finished({ completed_at: '2025-12-30T05:12:00Z' })).toMatchObject({ when: 'Dec 30, 2025' });
  });

  it('a run that has no end yet falls back to its start for the time', () => {
    expect(finished({ status: 'failed', completed_at: null })).toMatchObject({ kind: 'finished', when: '06:00' });
  });

  it('an open run reads Running now', () => {
    expect(finished({ status: 'running', completed_at: null })).toEqual({ kind: 'running', status: 'running' });
    // A planned run reads the same words, so it gets the same spinning icon, not the static queued one (D13)
    expect(finished({ status: 'planned', completed_at: null })).toEqual({ kind: 'running', status: 'running' });
  });

  it('no run reads No runs yet', () => {
    expect(lineOf({ state: 'ready', run: null }, BERLIN, NOW)).toEqual({ kind: 'none' });
  });

  it('the noun follows the workload (answers, checks, keywords)', () => {
    const nounOf = (workload: LineRun['workload']): string | undefined => {
      const line = finished({ workload });
      return line.kind === 'finished' ? line.counts?.noun : undefined;
    };
    expect(nounOf('ai_prompt')).toBe('answers');
    expect(nounOf('ai_mode_keyword')).toBe('answers');
    expect(nounOf('seo_rank')).toBe('checks');
    expect(nounOf('keyword_metrics')).toBe('keywords');
    // A workload with no word of its own is counted as tasks, which is what its counts are
    expect(nounOf('gsc_sync')).toBe('tasks');
  });

  it('a run that planned no task has no counts, not a zero', () => {
    expect(finished({ status: 'budget_blocked', tasks_total: 0, tasks_succeeded: 0 })).toEqual({
      kind: 'finished',
      status: 'budget_blocked',
      when: '06:12',
      counts: null,
    });
  });

  it('a failed read reads Run status unavailable, never a time', () => {
    expect(lineOf({ state: 'failed' }, BERLIN, NOW)).toEqual({ kind: 'unavailable' });
  });
});

const engine = (over: Partial<CoverageEngine> = {}): CoverageEngine => ({
  engine_code: 'gemini_web',
  planned: 150,
  observed: 148,
  valid: 141,
  partial: 3,
  invalid_by_status: { empty: 2, refused: 1, error: 1 },
  valid_rate: { numerator: 141, denominator: 150, n_observations: 148, value: 0.94 },
  ...over,
});

describe('coverageRows', () => {
  it('rates valid over planned, so an answer that never arrived lowers the rate', () => {
    // 141 of 150 planned; observed is 148, and a denominator of observed would say 95.3 percent
    const [row] = coverageRows([engine()]);
    expect(row).toMatchObject({ kind: 'rated', planned: 150, valid: 141 });
    expect(row?.rate).toBeCloseTo(0.94, 10);
  });

  it('names the invalid answers by status, partial first, and leaves out a status with none', () => {
    const [row] = coverageRows([engine()]);
    expect(row?.parts).toEqual([
      { part: 'partial', count: 3 },
      { part: 'empty', count: 2 },
      { part: 'refused', count: 1 },
      { part: 'error', count: 1 },
    ]);
    const [clean] = coverageRows([engine({ partial: 0, invalid_by_status: { empty: 0, refused: 0, error: 4 } })]);
    expect(clean?.parts).toEqual([{ part: 'error', count: 4 }]);
  });

  it('an engine with nothing planned is none, with no rate: never 0', () => {
    const [row] = coverageRows([
      engine({
        planned: 0,
        observed: 0,
        valid: 0,
        partial: 0,
        invalid_by_status: { empty: 0, refused: 0, error: 0 },
        valid_rate: { numerator: 0, denominator: 0, n_observations: 0, value: null },
      }),
    ]);
    expect(row).toMatchObject({ kind: 'none', rate: null, degraded: false, parts: [] });
  });

  it('under 10 planned is a thin sample: counts, no rate and never degraded', () => {
    const [row] = coverageRows([engine({ planned: 8, observed: 8, valid: 2, partial: 0 })]);
    expect(row).toMatchObject({ kind: 'thin', rate: null, degraded: false, planned: 8, valid: 2 });
    // Exactly 10 planned is rated
    expect(coverageRows([engine({ planned: 10, observed: 10, valid: 3, partial: 0 })])[0]?.kind).toBe('rated');
  });

  it('is degraded below 90 percent of at least 10 planned, and exactly 90 percent is not', () => {
    const rowOf = (valid: number): ReturnType<typeof coverageRows>[number] | undefined =>
      coverageRows([engine({ planned: 100, observed: 100, valid, partial: 0 })])[0];
    expect(rowOf(89)?.degraded).toBe(true);
    expect(rowOf(90)?.degraded).toBe(false);
  });

  it('keeps one row per engine in the order given and never pools them', () => {
    const rows = coverageRows([
      engine({ engine_code: 'chatgpt_web', valid: 147, planned: 150 }),
      engine({ engine_code: 'gemini_web', valid: 132, planned: 150 }),
    ]);
    expect(rows.map((row) => [row.engine, row.valid, row.planned])).toEqual([
      ['chatgpt_web', 147, 150],
      ['gemini_web', 132, 150],
    ]);
  });
});

describe('missingShown', () => {
  const missing = (count: number): CoverageMissing[] =>
    Array.from({ length: count }, (_, place) => ({
      prompt_id: `prompt-${String(place)}`,
      engine_code: 'gemini_web',
      location_id: null,
      replicate_index: 0,
      task_status: 'failed',
    }));

  it('shows the first 50 and says how many more there are', () => {
    expect(MISSING_SHOWN).toBe(50);
    const shown = missingShown(missing(73), false);
    expect(shown.rows).toHaveLength(50);
    expect(shown.rows[0]?.prompt_id).toBe('prompt-0');
    expect(shown.hidden).toBe(23);
  });

  it('shows every row when asked, and when there are 50 or fewer', () => {
    expect(missingShown(missing(73), true)).toMatchObject({ hidden: 0 });
    expect(missingShown(missing(73), true).rows).toHaveLength(73);
    expect(missingShown(missing(50), false)).toMatchObject({ hidden: 0 });
  });
});

describe('the degraded thresholds', () => {
  it('are 90 percent of at least 10 planned tasks (decision D12)', () => {
    expect(DEGRADED_BELOW).toBe(0.9);
    expect(DEGRADED_MIN_PLANNED).toBe(10);
  });
});

describe('degradedEngines', () => {
  const counted = (code: CoverageEngine['engine_code'], planned: number, valid: number): CoverageEngine =>
    engine({ engine_code: code, planned, valid, partial: 0 });

  it('an engine at 89.9 percent with 150 planned is degraded', () => {
    // 134 of 150 is the largest count under 90 percent with 150 planned (89.3); 899 of 1,000 is 89.9 exactly
    expect(degradedEngines([counted('gemini_web', 150, 134)])).toEqual([
      { engine: 'gemini_web', planned: 150, valid: 134, rate: 134 / 150 },
    ]);
    expect(degradedEngines([counted('gemini_web', 1000, 899)])).toHaveLength(1);
  });

  it('exactly 90 percent is not degraded', () => {
    expect(degradedEngines([counted('gemini_web', 150, 135)])).toEqual([]);
    expect(degradedEngines([counted('gemini_web', 100, 90)])).toEqual([]);
  });

  it('under 10 planned is never degraded', () => {
    expect(degradedEngines([counted('gemini_web', 9, 0)])).toEqual([]);
    expect(degradedEngines([counted('gemini_web', 1, 0)])).toEqual([]);
    // Exactly 10 planned is judged
    expect(degradedEngines([counted('gemini_web', 10, 8)])).toHaveLength(1);
  });

  it('an engine with nothing planned is never degraded', () => {
    expect(degradedEngines([counted('gemini_web', 0, 0)])).toEqual([]);
  });

  it('each engine is judged alone, a pooled 95 percent hides nothing', () => {
    // 147 + 132 + 150 = 429 of 450 valid is 95.3 percent pooled, and 132 of 150 is 88 percent alone
    const engines = [
      counted('chatgpt_web', 150, 147),
      counted('gemini_web', 150, 132),
      counted('google_ai_mode', 150, 150),
    ];
    expect(degradedEngines(engines).map((row) => row.engine)).toEqual(['gemini_web']);
    // Two of three engines under the line are both named, in the order given
    expect(
      degradedEngines([
        counted('chatgpt_web', 150, 100),
        counted('gemini_web', 150, 147),
        counted('google_ai_mode', 20, 10),
      ]).map((row) => row.engine),
    ).toEqual(['chatgpt_web', 'google_ai_mode']);
  });

  it('degradedEngines agrees with coverageRows', () => {
    const engines = [counted('chatgpt_web', 100, 90), counted('gemini_web', 150, 132), counted('google_ai_mode', 9, 1)];
    const fromRows = coverageRows(engines)
      .filter((row) => row.degraded)
      .map((row) => row.engine);
    expect(degradedEngines(engines).map((row) => row.engine)).toEqual(fromRows);
  });
});

describe('formatCoverageRate', () => {
  it('is a whole percent', () => {
    expect(formatCoverageRate(0.94)).toBe('94%');
    expect(formatCoverageRate(1)).toBe('100%');
    expect(formatCoverageRate(0.88)).toBe('88%');
  });

  it('exactly 90 percent is a whole 90%: it is not below the line', () => {
    expect(formatCoverageRate(0.9)).toBe('90%');
    expect(formatCoverageRate(0.905)).toBe('91%');
  });

  it('never prints a rate below the line as 90%: it floors to one decimal', () => {
    expect(formatCoverageRate(0.896)).toBe('89.6%');
    // Rounding to one decimal would give "90.0%" here: the figure is floored, never rounded up
    expect(formatCoverageRate(0.8996)).toBe('89.9%');
    expect(formatCoverageRate(0.8995)).toBe('89.9%');
    expect(formatCoverageRate(0.8999999)).toBe('89.9%');
  });

  it('keeps a whole percent for a rate that rounds to 89 or less', () => {
    expect(formatCoverageRate(0.8933)).toBe('89%');
    expect(formatCoverageRate(0.8949)).toBe('89%');
  });
});

describe('progressOf', () => {
  const open = (over: Partial<ProgressRun> = {}): ProgressRun => ({
    tasks_total: 1000,
    tasks_succeeded: 409,
    tasks_failed: 3,
    ...over,
  });

  it('counts the tasks that ended, failed ones included, of the tasks planned', () => {
    expect(progressOf(open())).toEqual({ processed: 412, failed: 3, total: 1000 });
  });

  it('never counts more tasks than were planned', () => {
    expect(progressOf(open({ tasks_total: 10, tasks_succeeded: 9, tasks_failed: 3 }))).toEqual({
      processed: 10,
      failed: 3,
      total: 10,
    });
  });

  it('is null while no task is planned yet: a count of 0 of 0 would be a claim', () => {
    expect(progressOf(open({ tasks_total: 0, tasks_succeeded: 0, tasks_failed: 0 }))).toBeNull();
  });
});
