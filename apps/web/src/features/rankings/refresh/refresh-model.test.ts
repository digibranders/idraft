import { describe, expect, it } from 'vitest';

import {
  FINISH_KEYS,
  MAX_REFRESH_KEYWORDS,
  REASON_KEYS,
  STALE_DAYS,
  collectionStatusOf,
  isFinished,
  isOpenRun,
  isPendingMetrics,
  leftToday,
  reasonKeyOf,
  refreshBody,
  uniqueKeywordIds,
} from './refresh-model';
import messages from '../../../../messages/en.json';
import { keywordMetrics } from '@/mocks/keyword-metrics';

const keywordRow = (keywordId: string): { keyword: { keyword_id: string } } => ({ keyword: { keyword_id: keywordId } });

describe('The request of a refresh', () => {
  it('sends the keyword ids of the keywords chosen, or of the keywords in the list', () => {
    expect(refreshBody('selection', ['a', 'b'])).toEqual({ keyword_ids: ['a', 'b'] });
    expect(refreshBody('matching', ['a'])).toEqual({ keyword_ids: ['a'] });
  });

  it('sends stale_days alone for the stale keywords, so the API picks them', () => {
    expect(refreshBody('stale', [])).toEqual({ stale_days: STALE_DAYS });
    expect(STALE_DAYS).toBe(25);
    // Not a keyword_ids member at all, which the API reads as "the stale ones"
    expect(Object.keys(refreshBody('stale', ['ignored']))).toEqual(['stale_days']);
  });

  it('takes at most the 1,000 ids the API takes', () => {
    expect(MAX_REFRESH_KEYWORDS).toBe(1000);
  });

  it('names each keyword once, in order, however many places it is tracked at', () => {
    const rows = [keywordRow('k1'), keywordRow('k2'), keywordRow('k1'), keywordRow('k3'), keywordRow('k2')];
    expect(uniqueKeywordIds(rows)).toEqual(['k1', 'k2', 'k3']);
    expect(uniqueKeywordIds([])).toEqual([]);
  });
});

describe('The day of manual refreshes', () => {
  it('counts what is left, never below none', () => {
    expect(leftToday({ used: 6, limit: 20 })).toBe(14);
    expect(leftToday({ used: 20, limit: 20 })).toBe(0);
    expect(leftToday({ used: 23, limit: 20 })).toBe(0);
  });
});

describe('Waiting for first metrics', () => {
  it('waits on an active keyword with no metrics, and on nothing else', () => {
    const metrics = keywordMetrics({
      keywordId: 'k1',
      locationId: 2276,
      languageCode: 'en',
      volume: 880,
      difficulty: 40,
      cpc: '1.20',
      intent: 'commercial',
      fetchedAt: '2026-10-05T09:00:00Z',
    });
    expect(isPendingMetrics({ is_active: true, metrics: null })).toBe(true);
    expect(isPendingMetrics({ is_active: true, metrics: undefined })).toBe(true);
    expect(isPendingMetrics({ is_active: false, metrics: null })).toBe(false);
    expect(isPendingMetrics({ is_active: true, metrics })).toBe(false);
  });
});

describe('Runs', () => {
  it('are queued while planned, and open until they end', () => {
    expect(collectionStatusOf('planned')).toBe('queued');
    expect(collectionStatusOf('running')).toBe('running');
    expect(collectionStatusOf('budget_blocked')).toBe('budget_blocked');
    expect(isOpenRun({ status: 'planned' })).toBe(true);
    expect(isOpenRun({ status: 'running' })).toBe(true);
    expect(isOpenRun({ status: 'completed' })).toBe(false);
    expect(isFinished('planned')).toBe(false);
    expect(isFinished('cancelled')).toBe(true);
  });
});

describe('The words for how a refresh ends', () => {
  it('names a message for every way a run ends, and for every reason code, in camelCase', () => {
    const { finished, reasons } = messages.rankings.refresh;
    expect(Object.keys(FINISH_KEYS).sort()).toEqual(
      ['budget_blocked', 'cancelled', 'completed', 'completed_with_errors', 'failed'].sort(),
    );
    // "nothing" is the words for a completed run that had nothing to read
    expect([...Object.values(FINISH_KEYS), 'nothing'].sort()).toEqual(Object.keys(finished).sort());
    expect(Object.values(REASON_KEYS).sort()).toEqual(Object.keys(reasons).sort());
  });

  it('knows the reason codes it has words for, and nothing the API wrote in English', () => {
    expect(reasonKeyOf('workload_unavailable')).toBe('workloadUnavailable');
    expect(reasonKeyOf('cancelled_by_user')).toBe('cancelledByUser');
    expect(reasonKeyOf('A budget for keyword research is used up for this month.')).toBeNull();
    expect(reasonKeyOf(null)).toBeNull();
    expect(reasonKeyOf(undefined)).toBeNull();
  });
});
