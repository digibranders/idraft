import { describe, expect, it } from 'vitest';

import { MOCK_RUNS, MOCK_SCHEDULE_IDS, MOCK_SCHEDULES } from './operations-fixtures';
import {
  OPERATIONS_COOKIE,
  operationsCookie,
  operationWorld,
  readOperationChanges,
  type OperationChanges,
  type StoredRun,
} from './operations-state';
import { mockId } from './mock-ids';

/** The cookie's value, as a browser sends it back. */
const valueOf = (cookie: string | null): string => (cookie ?? '').split(';')[0]?.split('=').slice(1).join('=') ?? '';

const run = (n: number): StoredRun => ({
  run_id: mockId('run', 100 + n),
  project_id: '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b01',
  schedule_id: null,
  workload: 'keyword_metrics',
  trigger: 'manual',
  created_at: `2026-10-01T12:00:${String(n).padStart(2, '0')}.000Z`,
  created_by: '0192d1a8-5b10-7c01-9a11-000000000003',
  tasks_total: 59,
  tasks_failed: 0,
  calls: 3,
  keyword_count: null,
  stale_days: 25,
  ending: 'completed',
  status_reason: null,
  blocked_by_budget_id: null,
  cancelled_at: n === 0 ? '2026-10-01T12:00:05.000Z' : null,
  cancel_reason: n === 0 ? 'Started by mistake' : null,
});

describe('the operations cookie', () => {
  it('reads back what it keeps: an edited fixture schedule, a new one and manual runs', () => {
    const [metrics] = MOCK_SCHEDULES;
    if (metrics === undefined) throw new Error('No fixture schedule');
    const changes: OperationChanges = {
      minted: 121,
      schedules: [
        { ...metrics, is_active: false, selector: { stale_days: 10 } },
        { ...metrics, schedule_id: mockId('schedule', 100), name: 'Copy', deleted_at: '2026-10-01T12:00:00.000Z' },
      ],
      runs: Array.from({ length: 21 }, (_, n) => run(n)),
    };
    const cookie = operationsCookie(changes);
    expect(cookie).not.toBeNull();
    const read = readOperationChanges({ [OPERATIONS_COOKIE]: valueOf(cookie) });
    expect(read).toEqual(changes);
    const world = operationWorld(read);
    expect(world.schedules.find((row) => row.schedule_id === MOCK_SCHEDULE_IDS.keywordMetrics)?.is_active).toBe(false);
    expect(world.runs).toHaveLength(MOCK_RUNS.length + 21);
  });

  it('makes room by dropping the oldest runs of earlier days, keeping today’s', () => {
    const now = Date.parse('2026-10-01T12:30:00Z');
    const earlier = Array.from({ length: 60 }, (_, n) => ({
      ...run(n + 1),
      run_id: mockId('run', 200 + n),
      created_at: new Date(Date.parse('2026-09-28T08:00:00Z') + n * 60_000).toISOString(),
    }));
    const today = Array.from({ length: 20 }, (_, n) => run(n + 1));
    const cookie = operationsCookie({ minted: 300, runs: [...earlier, ...today] }, now);
    expect(cookie).not.toBeNull();
    const read = readOperationChanges({ [OPERATIONS_COOKIE]: valueOf(cookie) });
    const kept = read.runs ?? [];
    expect(kept.filter((row) => row.created_at.startsWith('2026-10-01'))).toHaveLength(20);
    // What is left of the earlier days is the newest of them
    const left = kept.filter((row) => !row.created_at.startsWith('2026-10-01'));
    expect(left.length).toBeLessThan(60);
    expect(left.at(-1)?.run_id).toBe(earlier.at(-1)?.run_id);
  });

  it('ignores a cookie it cannot read', () => {
    expect(readOperationChanges({ [OPERATIONS_COOKIE]: 'not-json' })).toEqual({});
    expect(readOperationChanges({ [OPERATIONS_COOKIE]: "{'s':[[1]]}" })).toEqual({});
  });
});
