import { describe, expect, it } from 'vitest';

import {
  STALE_AFTER_DAYS,
  listCut,
  newVerdict,
  previousWindow,
  rowKey,
  staleAt,
  timesUsedOf,
  truncatedOf,
  type PreviousRead,
} from './fanout-model';
import type { FanoutMeta, FanoutQueryPage, FanoutQueryRow } from './types';

const row = (over: Partial<FanoutQueryRow> = {}): FanoutQueryRow => ({
  query_text: 'best crm for startups',
  normalized_text: 'best crm for startups',
  engine_code: 'chatgpt_web',
  observations: 6,
  prompts: 2,
  prompt_ids: ['prompt-1', 'prompt-2'],
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  cited_domains: [],
  ...over,
});

const meta = (over: Partial<FanoutMeta> = {}): FanoutMeta => ({
  answers: 12,
  answers_truncated: 0,
  answers_with_fanout: 9,
  engine_codes: ['chatgpt_web'],
  engines_without_fanout: [],
  include_branded: false,
  min_support: 1,
  window: { from: '2026-09-18', to: '2026-10-15', timezone: 'UTC' },
  ...over,
});

/** A page of rows; `total` is what the route counted, which is more than the rows when the page was cut. */
const page = (
  rows: readonly FanoutQueryRow[],
  metaOver: Partial<FanoutMeta> = {},
  total = rows.length,
): FanoutQueryPage => ({
  data: [...rows],
  meta: meta(metaOver),
  page: { limit: 200, offset: 0, total },
});

const ready = (data: FanoutQueryPage): PreviousRead => ({ status: 'ready', data, refreshing: false });

/** Whole days from the first to the last day, both counted. */
const daysIn = ({ from, to }: { from: string; to: string }): number =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;

describe('previousWindow', () => {
  it('is the same number of days ending the day before from', () => {
    expect(previousWindow({ from: '2026-10-16', to: '2026-11-12' })).toEqual({ from: '2026-09-18', to: '2026-10-15' });
  });

  it('is the day before for a one day window', () => {
    expect(previousWindow({ from: '2026-11-12', to: '2026-11-12' })).toEqual({ from: '2026-11-11', to: '2026-11-11' });
  });

  it('crosses a month and a year end', () => {
    expect(previousWindow({ from: '2026-01-01', to: '2026-01-31' })).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(previousWindow({ from: '2026-03-01', to: '2026-03-07' })).toEqual({ from: '2026-02-22', to: '2026-02-28' });
  });

  it('is never more than 92 days when the window is 92', () => {
    const window = { from: '2026-08-13', to: '2026-11-12' };
    expect(daysIn(window)).toBe(92);
    const before = previousWindow(window);
    expect(daysIn(before)).toBe(92);
    expect(before.to).toBe('2026-08-12');
  });

  it('is not moved by a daylight saving change, because it counts days and not hours', () => {
    expect(previousWindow({ from: '2026-11-02', to: '2026-11-08' })).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  });
});

describe('rowKey', () => {
  it('is the engine and the normalized text, so two engines never merge', () => {
    const chat = row({ engine_code: 'chatgpt_web' });
    const other = row({ engine_code: 'google_ai_mode' });
    expect(rowKey(chat)).not.toBe(rowKey(other));
    expect(rowKey(chat)).toBe(rowKey(row({ query_text: 'Best CRM for startups', observations: 1 })));
  });

  it('tells two texts apart', () => {
    expect(rowKey(row({ normalized_text: 'crm' }))).not.toBe(rowKey(row({ normalized_text: 'crm pricing' })));
  });
});

describe('newVerdict', () => {
  const fresh = row();
  const old = row({ query_text: 'crm pricing', normalized_text: 'crm pricing' });
  const current = [fresh, old];

  it('calls a row absent from a complete previous page new', () => {
    const verdict = newVerdict(current, ready(page([row({ normalized_text: 'crm pricing' })])));
    if (verdict.kind !== 'known') throw new Error('The verdict should be known');
    expect(verdict.newKeys.has(rowKey(fresh))).toBe(true);
  });

  it('does not call a row that is in the previous page new', () => {
    const verdict = newVerdict(current, ready(page([row({ normalized_text: 'crm pricing' })])));
    if (verdict.kind !== 'known') throw new Error('The verdict should be known');
    expect(verdict.newKeys.has(rowKey(old))).toBe(false);
    expect(verdict.newKeys.size).toBe(1);
  });

  it('does not match a query of another engine in the previous page', () => {
    const verdict = newVerdict([row()], ready(page([row({ engine_code: 'google_ai_mode' })])));
    if (verdict.kind !== 'known') throw new Error('The verdict should be known');
    expect(verdict.newKeys.size).toBe(1);
  });

  it('is unknown for a previous page with no valid answer, never new', () => {
    expect(newVerdict(current, ready(page([], { answers: 0, answers_with_fanout: 0 })))).toEqual({
      kind: 'unknown',
      reason: 'noPrevious',
    });
  });

  it('is unknown for a previous page whose total exceeds its rows', () => {
    expect(newVerdict(current, ready(page([row()], {}, 240)))).toEqual({ kind: 'unknown', reason: 'tooMany' });
  });

  it('is known when the previous page has answers and no query at all', () => {
    const verdict = newVerdict(current, ready(page([], { answers: 4, answers_with_fanout: 0 })));
    expect(verdict.kind).toBe('known');
  });

  it('is unknown for a failed previous read', () => {
    expect(newVerdict(current, { status: 'error', data: undefined, refreshing: false })).toEqual({
      kind: 'unknown',
      reason: 'failed',
    });
  });

  it('is unknown while the previous read loads, and while it has not been asked, never new', () => {
    expect(newVerdict(current, { status: 'loading', data: undefined, refreshing: false })).toEqual({
      kind: 'unknown',
      reason: 'loading',
    });
    expect(newVerdict(current, { status: 'idle', data: undefined, refreshing: false })).toEqual({
      kind: 'unknown',
      reason: 'loading',
    });
  });

  it('is unknown while the previous read is refreshing, because its page is the old window and not this one', () => {
    // keepPreviousData: status is ready and data is complete, but it belongs to the window that was left
    const oldWindow = page([row({ normalized_text: 'crm pricing' })]);
    expect(newVerdict(current, { status: 'ready', data: oldWindow, refreshing: true })).toEqual({
      kind: 'unknown',
      reason: 'loading',
    });
  });
});

describe('truncatedOf', () => {
  it('is the cut answers of the answers read', () => {
    expect(truncatedOf(meta({ answers: 12, answers_truncated: 3 }))).toEqual({ cut: 3, answers: 12 });
  });

  it('is null when none is cut', () => {
    expect(truncatedOf(meta({ answers_truncated: 0 }))).toBeNull();
  });
});

describe('listCut', () => {
  it('is shown of total only when the total exceeds the rows', () => {
    expect(listCut(page([row(), row()], {}, 57))).toEqual({ shown: 2, total: 57 });
  });

  it('is null when every row is in the page', () => {
    expect(listCut(page([row(), row()], {}, 2))).toBeNull();
    expect(listCut(page([], {}, 0))).toBeNull();
  });
});

describe('staleAt', () => {
  const now = new Date('2026-11-12T12:00:00Z');

  it('is the newest last_seen_at when it is older than 7 days', () => {
    const rows = [row({ last_seen_at: '2026-10-20T08:00:00Z' }), row({ last_seen_at: '2026-11-02T08:00:00Z' })];
    expect(staleAt(rows, now, true)).toBe('2026-11-02T08:00:00Z');
  });

  it('is null for a fresh list', () => {
    expect(staleAt([row({ last_seen_at: '2026-11-10T08:00:00Z' })], now, true)).toBeNull();
  });

  it('is null at exactly 7 days and stale one second past it', () => {
    const edge = new Date(Date.parse('2026-11-05T08:00:00Z') + STALE_AFTER_DAYS * 86_400_000);
    expect(staleAt([row({ last_seen_at: '2026-11-05T08:00:00Z' })], edge, true)).toBeNull();
    expect(staleAt([row({ last_seen_at: '2026-11-05T08:00:00Z' })], new Date(edge.getTime() + 1000), true)).toBe(
      '2026-11-05T08:00:00Z',
    );
  });

  it('is null with no rows, because there is nothing to call old', () => {
    expect(staleAt([], now, true)).toBeNull();
  });

  it('is null when the window does not reach today, because a past window is old by its nature', () => {
    const rows = [row({ last_seen_at: '2026-09-20T08:00:00Z' })];
    expect(staleAt(rows, now, true)).toBe('2026-09-20T08:00:00Z');
    expect(staleAt(rows, now, false)).toBeNull();
  });
});

describe('timesUsedOf', () => {
  it("is the row's observations and the answers read, with the engine kept", () => {
    expect(timesUsedOf(row({ observations: 6, engine_code: 'chatgpt_web' }), meta({ answers: 12 }))).toEqual({
      count: 6,
      total: 12,
      engine: 'chatgpt_web',
    });
  });
});
