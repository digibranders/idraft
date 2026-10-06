import { describe, expect, it } from 'vitest';

import { collectionStatusOf, isFinished, isOpenRun, reasonKeyOf, REASON_KEYS } from './run-status';
import messages from '../../../messages/en.json';
import { pathsApiV1WorkspacesWorkspace_idProjectsProject_idRunsGetParametersQueryFilterStatus_inAnyOf0Values as statusValues } from '@/lib/api/schema';

describe('Run statuses', () => {
  it('shows a planned run with the queued look and every other status as the API names it', () => {
    expect(collectionStatusOf('planned')).toBe('queued');
    for (const status of statusValues.filter((value) => value !== 'planned')) {
      expect(collectionStatusOf(status)).toBe(status);
    }
  });

  it('knows which runs are still open and which have ended, for every status the API has', () => {
    expect(isOpenRun({ status: 'planned' })).toBe(true);
    expect(isOpenRun({ status: 'running' })).toBe(true);
    expect(isOpenRun({ status: 'completed' })).toBe(false);
    expect(isOpenRun({ status: 'cancelled' })).toBe(false);
    for (const status of statusValues) {
      expect(isFinished(status)).toBe(!isOpenRun({ status }));
    }
  });
});

describe('Run reasons', () => {
  it('names a message in camelCase for every reason code, and no message without a code', () => {
    expect(Object.values(REASON_KEYS).sort()).toEqual(Object.keys(messages.runReasons).sort());
  });

  it('has words for every status_reason code the backend writes', () => {
    // collectors/planner.py (missed_window, not_planned, workload_unavailable), collectors/ledger.py
    // (budget_exceeded, project_not_collecting) and api/operations/runs.py (cancelled_by_user)
    const codes = [
      'missed_window',
      'not_planned',
      'budget_exceeded',
      'cancelled_by_user',
      'project_not_collecting',
      'workload_unavailable',
    ];
    expect(Object.keys(REASON_KEYS).sort()).toEqual([...codes].sort());
    for (const code of codes) expect(reasonKeyOf(code)).not.toBeNull();
  });

  it('puts a reason in words only when it is one of the codes the API documents', () => {
    expect(reasonKeyOf('cancelled_by_user')).toBe('cancelledByUser');
    expect(reasonKeyOf('missed_window')).toBe('missedWindow');
    expect(reasonKeyOf('not_planned')).toBe('notPlanned');
    expect(reasonKeyOf('workload_unavailable')).toBe('workloadUnavailable');
    expect(reasonKeyOf('toString')).toBeNull();
    expect(reasonKeyOf('DataForSEO Labs did not answer in time.')).toBeNull();
    expect(reasonKeyOf(null)).toBeNull();
    expect(reasonKeyOf(undefined)).toBeNull();
  });
});
