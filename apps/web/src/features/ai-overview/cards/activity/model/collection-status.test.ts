import { describe, expect, it } from 'vitest';

import { run } from './activity-fixtures';
import { collectionStatus, nextRunOf } from './collection-status';

describe('collectionStatus', () => {
  it('chooses the newest finished run whatever order the runs come in, and its counts are the run own', () => {
    const older = run({
      n: 1,
      createdAt: '2026-11-09T01:10:00Z',
      completedAt: '2026-11-09T02:10:00Z',
      succeeded: 250,
      failed: 0,
    });
    const newer = run({ n: 2, createdAt: '2026-11-12T01:10:00Z', completedAt: '2026-11-12T02:10:00Z' });
    for (const runs of [
      [older, newer],
      [newer, older],
    ]) {
      const { latest } = collectionStatus(runs);
      expect(latest).toMatchObject({
        runId: newer.run_id,
        status: 'completed_with_errors',
        collected: 238,
        failed: 12,
        total: 250,
        at: '2026-11-12T02:10:00Z',
      });
    }
  });

  it('counts completed, completed with errors and failed runs as finished, and nothing else', () => {
    expect(collectionStatus([run({ n: 1, status: 'completed' })]).latest?.status).toBe('completed');
    expect(collectionStatus([run({ n: 1, status: 'failed' })]).latest?.status).toBe('failed');
    for (const status of ['planned', 'running', 'cancelled', 'budget_blocked'] as const) {
      expect(collectionStatus([run({ n: 1, status })]).latest).toBeNull();
    }
  });

  it('keeps a run under way apart from the finished one, with the answers collected so far', () => {
    const { latest, open } = collectionStatus([
      run({ n: 1, status: 'running', createdAt: '2026-11-14T01:00:00Z', completedAt: null, succeeded: 90, failed: 0 }),
      run({ n: 2 }),
    ]);
    expect(open).toMatchObject({ status: 'running', collected: 90, failed: 0, total: 250 });
    expect(latest?.runId).toBe(run({ n: 2 }).run_id);
  });

  it('is empty for no run, and ignores a run of another workload', () => {
    expect(collectionStatus([])).toEqual({ latest: null, open: null, blocked: null });
    expect(collectionStatus([run({ n: 1, workload: 'seo_rank' })])).toEqual({
      latest: null,
      open: null,
      blocked: null,
    });
  });

  it('names the runs a budget blocked after the latest finished run, with how many and the latest day', () => {
    const { blocked } = collectionStatus([
      run({ n: 1, createdAt: '2026-11-09T01:10:00Z' }),
      run({
        n: 2,
        status: 'budget_blocked',
        createdAt: '2026-11-12T01:00:00Z',
        completedAt: null,
        succeeded: 0,
        failed: 0,
      }),
      run({
        n: 3,
        status: 'budget_blocked',
        createdAt: '2026-11-13T01:00:00Z',
        completedAt: null,
        succeeded: 0,
        failed: 0,
      }),
      run({
        n: 4,
        status: 'budget_blocked',
        createdAt: '2026-11-05T01:00:00Z',
        completedAt: null,
        succeeded: 0,
        failed: 0,
      }),
    ]);
    // The run of Nov 5 is older than the finished run of Nov 9: it is history, not news
    expect(blocked).toEqual({ count: 2, latestAt: '2026-11-13T01:00:00Z' });
  });

  it('names a blocked run when nothing has finished yet', () => {
    const { blocked } = collectionStatus([run({ n: 1, status: 'budget_blocked', completedAt: null })]);
    expect(blocked?.count).toBe(1);
  });
});

describe('nextRunOf', () => {
  it('says paused for a project whose every schedule is paused, and never none', () => {
    expect(nextRunOf({ nextRunAt: null, paused: true })).toEqual({ kind: 'paused' });
  });

  it('says none for a project with no schedule at all', () => {
    expect(nextRunOf({ nextRunAt: null, paused: false })).toEqual({ kind: 'none' });
  });

  it('gives the time of the next run, and unknown while the schedules are not read', () => {
    expect(nextRunOf({ nextRunAt: '2026-11-16T19:30:00Z', paused: false })).toEqual({
      kind: 'at',
      at: '2026-11-16T19:30:00Z',
    });
    expect(nextRunOf(undefined)).toEqual({ kind: 'unknown' });
  });
});
