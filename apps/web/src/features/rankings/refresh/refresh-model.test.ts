import { describe, expect, it } from 'vitest';

import {
  FINISH_KEYS,
  FIRST_CHECK_WINDOW_MS,
  MAX_REFRESH_KEYWORDS,
  STALE_DAYS,
  chosenKeywordIds,
  isPendingMetrics,
  isWaiting,
  leftTheList,
  leftToday,
  refreshBody,
  uniqueKeywordIds,
  unknownPositions,
  waitsForFirstCheck,
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

  const NOW = Date.parse('2026-10-06T12:00:00Z');
  const minutesAgo = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

  it('knows a keyword waits for its first rank check until the API says it was checked', () => {
    const state = (
      kind: 'not_checked' | 'ranked' | 'beyond_depth' | 'failed',
    ): { current: { state: typeof kind } } => ({
      current: { state: kind },
    });
    const added = minutesAgo(5);
    expect(waitsForFirstCheck({ is_active: true, created_at: added, state: state('not_checked') }, NOW)).toBe(true);
    // A check that ran and failed is a check: the keyword does not wait for a first one any more
    expect(waitsForFirstCheck({ is_active: true, created_at: added, state: state('failed') }, NOW)).toBe(false);
    expect(waitsForFirstCheck({ is_active: true, created_at: added, state: state('ranked') }, NOW)).toBe(false);
    expect(waitsForFirstCheck({ is_active: true, created_at: added, state: state('beyond_depth') }, NOW)).toBe(false);
    // Archived keywords are not collected
    expect(waitsForFirstCheck({ is_active: false, created_at: added, state: state('not_checked') }, NOW)).toBe(false);
  });

  it('waits for a first check only while the keyword is new: an old one is not collected soon, so it is not polled for', () => {
    const unchecked = { current: { state: 'not_checked' as const } };
    const row = (created_at: string): Parameters<typeof waitsForFirstCheck>[0] => ({
      is_active: true,
      created_at,
      state: unchecked,
    });
    expect(FIRST_CHECK_WINDOW_MS).toBe(60 * 60_000);
    expect(waitsForFirstCheck(row(minutesAgo(0)), NOW)).toBe(true);
    expect(waitsForFirstCheck(row(minutesAgo(59)), NOW)).toBe(true);
    expect(waitsForFirstCheck(row(minutesAgo(60)), NOW)).toBe(true);
    expect(waitsForFirstCheck(row(minutesAgo(61)), NOW)).toBe(false);
    // Imported weeks ago, in a paused or budget-blocked project
    expect(waitsForFirstCheck(row(minutesAgo(21 * 24 * 60)), NOW)).toBe(false);
    // A clock a little behind the server's puts the keyword slightly in the future: still new
    expect(waitsForFirstCheck(row(minutesAgo(-3)), NOW)).toBe(true);
    // A date that is not a date is not waited for
    expect(waitsForFirstCheck(row('not a date'), NOW)).toBe(false);
  });

  it('waits for either: the metrics, or the first check', () => {
    const metrics = { volume: 880 };
    const checked = { current: { state: 'ranked' as const } };
    const unchecked = { current: { state: 'not_checked' as const } };
    const created_at = minutesAgo(5);
    expect(isWaiting({ is_active: true, created_at, metrics, state: checked }, NOW)).toBe(false);
    expect(isWaiting({ is_active: true, created_at, metrics: null, state: checked }, NOW)).toBe(true);
    expect(isWaiting({ is_active: true, created_at, metrics, state: unchecked }, NOW)).toBe(true);
    expect(isWaiting({ is_active: true, created_at, metrics: null, state: unchecked }, NOW)).toBe(true);
    expect(isWaiting({ is_active: false, created_at, metrics: null, state: unchecked }, NOW)).toBe(false);
  });

  it('keeps waiting for the metrics of an old keyword, whatever its first check', () => {
    // The metrics wait is not changed: only the first check is limited to a new keyword
    const old = minutesAgo(30 * 24 * 60);
    const unchecked = { current: { state: 'not_checked' as const } };
    expect(isWaiting({ is_active: true, created_at: old, metrics: null, state: unchecked }, NOW)).toBe(true);
    expect(isWaiting({ is_active: true, created_at: old, metrics: { volume: 1 }, state: unchecked }, NOW)).toBe(false);
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
