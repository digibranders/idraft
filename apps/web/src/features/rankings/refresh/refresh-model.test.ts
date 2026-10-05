import { describe, expect, it } from 'vitest';

import {
  FINISH_KEYS,
  MAX_REFRESH_KEYWORDS,
  STALE_DAYS,
  chosenKeywordIds,
  isPendingMetrics,
  leftTheList,
  leftToday,
  refreshBody,
  uniqueKeywordIds,
  unknownPositions,
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

describe('The keywords behind a choice', () => {
  const seen = new Map([
    ['t1', { keywordId: 'k1', active: true }],
    ['t2', { keywordId: 'k2', active: true }],
    ['t3', { keywordId: 'k1', active: true }],
    ['t4', { keywordId: 'k4', active: false }],
  ]);

  it('names the keywords of the chosen rows seen and still active, each once, and none it has not seen', () => {
    expect(chosenKeywordIds(new Set(['t1', 't2', 't3']), seen)).toEqual(['k1', 'k2']);
    expect(chosenKeywordIds(new Set(['t4', 't9']), seen)).toEqual([]);
    expect(chosenKeywordIds(new Set(), seen)).toEqual([]);
  });

  it('finds the chosen rows a list read again no longer holds, all of them when it holds every keyword', () => {
    const chosen = new Set(['t1', 't2', 't5']);
    const now = [{ tracked_keyword_id: 't1' }];
    const before = [{ tracked_keyword_id: 't1' }, { tracked_keyword_id: 't2' }];
    expect(leftTheList(chosen, before, now, true)).toEqual(['t2', 't5']);
  });

  it('finds, in a list of one page, only the chosen rows that were on the page and are not any more', () => {
    const chosen = new Set(['t1', 't2', 't5']);
    const now = [{ tracked_keyword_id: 't1' }];
    const before = [{ tracked_keyword_id: 't1' }, { tracked_keyword_id: 't2' }];
    // t5 is on another page: nothing says it left
    expect(leftTheList(chosen, before, now, false)).toEqual(['t2']);
  });

  it('reads which keywords a keyword_unknown error names, and nothing from one that names the field', () => {
    const item = (
      path: string,
      code = 'keyword_unknown',
    ): { location: string; path: string; code: string; message: string } => ({
      location: 'body',
      path,
      code,
      message: 'A keyword is not one this project tracks.',
    });
    expect(unknownPositions([item('keyword_ids.2'), item('keyword_ids[5]'), item('keyword_ids/7')])).toEqual([2, 5, 7]);
    expect(unknownPositions([item('keyword_ids')])).toEqual([]);
    expect(unknownPositions([item('keyword_ids.2', 'value_error')])).toEqual([]);
    expect(unknownPositions([item('stale_days.2')])).toEqual([]);
  });
});

describe('The words for how a refresh ends', () => {
  it('names a message for every way a run ends, in camelCase', () => {
    const { finished } = messages.rankings.refresh;
    expect(Object.keys(FINISH_KEYS).sort()).toEqual(
      ['budget_blocked', 'cancelled', 'completed', 'completed_with_errors', 'failed'].sort(),
    );
    // "nothing" is the words for a completed run that had nothing to read
    expect([...Object.values(FINISH_KEYS), 'nothing'].sort()).toEqual(Object.keys(finished).sort());
  });
});
