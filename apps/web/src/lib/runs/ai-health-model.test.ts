import { describe, expect, it } from 'vitest';

import { DEGRADED_BELOW, DEGRADED_MIN_PLANNED, lineOf, type LineRun } from './ai-health-model';

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

describe('the degraded thresholds', () => {
  it('are 90 percent of at least 10 planned tasks (decision D12)', () => {
    expect(DEGRADED_BELOW).toBe(0.9);
    expect(DEGRADED_MIN_PLANNED).toBe(10);
  });
});
