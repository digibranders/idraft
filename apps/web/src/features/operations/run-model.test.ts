import { describe, expect, it } from 'vitest';

import {
  canCancel,
  collectionStatusOf,
  isOpen,
  reasonKeyOf,
  REASON_KEYS,
  RUN_STATUS_KEYS,
  taskStatusRows,
  taskSummary,
  TASK_STATUS_KEYS,
  TRIGGER_KEYS,
  type RunFacts,
} from './run-model';
import messages from '../../../messages/en.json';
import {
  pathsApiV1WorkspacesWorkspace_idProjectsProject_idRunsGetParametersQueryFilterStatus_inAnyOf0Values as statusValues,
  pathsApiV1WorkspacesWorkspace_idProjectsProject_idRunsGetParametersQueryFilterTrigger_inAnyOf0Values as triggerValues,
  pathsApiV1WorkspacesWorkspace_idProjectsProject_idRunsGetParametersQueryFilterWorkload_inAnyOf0Values as runWorkloadValues,
} from '@/lib/api/schema';
import { WORKLOAD_KEYS } from '@/lib/workloads/workloads';

const run = (over: Partial<RunFacts> = {}): RunFacts => ({
  status: 'running',
  trigger: 'manual',
  created_by: { actor_type: 'user', actor_id: 'u1', label: 'Ana' },
  tasks_total: 10,
  tasks_succeeded: 6,
  tasks_failed: 1,
  ...over,
});

describe('run model', () => {
  it('names a message for every run status, trigger and known task status, in camelCase as the catalog keys are', () => {
    const { statuses, triggers, taskStatuses, reasons } = messages.runs;
    expect(Object.keys(RUN_STATUS_KEYS).sort()).toEqual([...statusValues].sort());
    expect(Object.values(RUN_STATUS_KEYS).sort()).toEqual(Object.keys(statuses).sort());
    expect(Object.keys(TRIGGER_KEYS).sort()).toEqual([...triggerValues].sort());
    expect(Object.values(TRIGGER_KEYS).sort()).toEqual(Object.keys(triggers).sort());
    expect(Object.values(TASK_STATUS_KEYS).sort()).toEqual(Object.keys(taskStatuses).sort());
    expect(Object.values(REASON_KEYS).sort()).toEqual(Object.keys(reasons).sort());
  });

  it('has a workload name for every workload a run can have', () => {
    expect(runWorkloadValues.every((workload) => Object.hasOwn(WORKLOAD_KEYS, workload))).toBe(true);
  });

  it('shows a planned run with the queued look', () => {
    expect(collectionStatusOf('planned')).toBe('queued');
    expect(collectionStatusOf('budget_blocked')).toBe('budget_blocked');
  });

  it('knows which runs are still open', () => {
    expect(isOpen(run())).toBe(true);
    expect(isOpen(run({ status: 'planned' }))).toBe(true);
    expect(isOpen(run({ status: 'completed' }))).toBe(false);
    expect(isOpen(run({ status: 'cancelled' }))).toBe(false);
  });

  it('lets schedules:write cancel any open run, runs:trigger only the manual runs its holder asked for', () => {
    expect(canCancel(run({ trigger: 'schedule' }), { userId: 'u2', permissions: ['schedules:write'] })).toBe(true);
    expect(canCancel(run(), { userId: 'u1', permissions: ['runs:trigger'] })).toBe(true);
    expect(canCancel(run(), { userId: 'u2', permissions: ['runs:trigger'] })).toBe(false);
    expect(canCancel(run({ trigger: 'schedule' }), { userId: 'u1', permissions: ['runs:trigger'] })).toBe(false);
    expect(canCancel(run({ trigger: 'retry' }), { userId: 'u1', permissions: ['runs:trigger'] })).toBe(false);
    expect(canCancel(run({ status: 'failed' }), { userId: 'u1', permissions: ['schedules:write'] })).toBe(false);
    expect(canCancel(run(), { userId: 'u1', permissions: ['data:read'] })).toBe(false);
  });

  it('does not match a run made by a system actor or an API key to a member whose id is the same', () => {
    const asked = (actorType: 'system' | 'api_key'): RunFacts =>
      run({ created_by: { actor_type: actorType, actor_id: 'u1', label: 'x' } });
    expect(canCancel(asked('system'), { userId: 'u1', permissions: ['runs:trigger'] })).toBe(false);
    expect(canCancel(asked('api_key'), { userId: 'u1', permissions: ['runs:trigger'] })).toBe(false);
    expect(canCancel(run({ created_by: null }), { userId: 'u1', permissions: ['runs:trigger'] })).toBe(false);
  });

  it('sums the tasks', () => {
    expect(taskSummary(run())).toEqual({ done: 7, succeeded: 6, failed: 1, pending: 3, total: 10 });
    expect(taskSummary(run({ tasks_total: 2, tasks_succeeded: 2, tasks_failed: 1 })).pending).toBe(0);
  });

  it('lists the tasks by status in reading order, with the statuses it has no name for last as sent', () => {
    expect(taskStatusRows({ pending: 3, mystery: 1, ingested: 6, failed: 1 })).toEqual([
      { code: 'ingested', key: 'ingested', count: 6 },
      { code: 'failed', key: 'failed', count: 1 },
      { code: 'pending', key: 'pending', count: 3 },
      { code: 'mystery', key: null, count: 1 },
    ]);
    expect(taskStatusRows({})).toEqual([]);
  });

  it('puts a reason in words only when it is one of the codes the API documents', () => {
    expect(reasonKeyOf('cancelled_by_user')).toBe('cancelledByUser');
    expect(reasonKeyOf('toString')).toBeNull();
    expect(reasonKeyOf('DataForSEO Labs did not answer in time.')).toBeNull();
    expect(reasonKeyOf(null)).toBeNull();
  });
});
