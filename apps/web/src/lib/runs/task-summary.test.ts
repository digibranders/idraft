import { describe, expect, it } from 'vitest';

import { taskSummary } from './task-summary';

describe('taskSummary', () => {
  it('sums the tasks: done are the ones with an outcome, succeeded and failed apart', () => {
    expect(taskSummary({ tasks_total: 10, tasks_succeeded: 6, tasks_failed: 1 })).toEqual({
      done: 7,
      succeeded: 6,
      failed: 1,
      pending: 3,
      total: 10,
    });
  });

  it('leaves no negative pending when more tasks have an outcome than the total says', () => {
    expect(taskSummary({ tasks_total: 2, tasks_succeeded: 2, tasks_failed: 1 }).pending).toBe(0);
  });
});
