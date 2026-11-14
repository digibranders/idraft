import { describe, expect, it } from 'vitest';

import { day, quiet, twoWeeks } from './daily-fixtures';
import { dayCounts, engineDays, engineTabs, isRunDay, STATUSES } from './status-model';

describe('the status model of a collection day', () => {
  it('adds the five statuses up to the answers of the day', () => {
    const counts = dayCounts(day({ date: '2026-11-06', complete: 700, partial: 42, empty: 3, refused: 6, error: 2 }));
    const sum = STATUSES.reduce((total, status) => total + counts[status], 0);
    expect(sum).toBe(counts.answers);
    expect(counts.answers).toBe(753);
  });

  it('adds up on every day of the two-week fixture, whatever the engine', () => {
    for (const row of twoWeeks().data) {
      const counts = dayCounts(row);
      expect(STATUSES.reduce((total, status) => total + counts[status], 0)).toBe(row.answers);
    }
  });

  it('counts valid as complete plus partial, as the route defines it, and not as complete alone', () => {
    const counts = dayCounts(day({ date: '2026-11-06', complete: 700, partial: 42, refused: 6, error: 2 }));
    expect(counts.valid).toBe(742);
    expect(counts.valid).toBe(counts.complete + counts.partial);
    // The route's own `valid` says the same: the model and the route do not disagree on what valid is
    expect(counts.valid).toBe(day({ date: '2026-11-06', complete: 700, partial: 42, refused: 6, error: 2 }).valid);
  });

  it('counts the failures of a day as refused plus error, and leaves the empty answers apart', () => {
    const counts = dayCounts(day({ date: '2026-11-06', complete: 700, partial: 42, empty: 3, refused: 6, error: 2 }));
    expect(counts.failures).toBe(8);
    expect(counts.empty).toBe(3);
  });

  it('keeps a schedule the route cannot name as null, never as 0', () => {
    expect(dayCounts(quiet('2026-11-03')).scheduled).toBeNull();
    expect(dayCounts(day({ date: '2026-11-13', scheduled: 0 })).scheduled).toBe(0);
  });

  it('says a day with no schedule, no answer and no blocked run is not a run day', () => {
    expect(isRunDay(dayCounts(quiet('2026-11-03')))).toBe(false);
    expect(isRunDay(dayCounts(day({ date: '2026-11-13' })))).toBe(true);
    expect(isRunDay(dayCounts(day({ date: '2026-11-09', scheduled: null, blocked: 1 })))).toBe(true);
    expect(isRunDay(dayCounts(day({ date: '2026-11-09', scheduled: null, complete: 4 })))).toBe(true);
  });
});

describe('the days of one engine', () => {
  it('lists only the engine asked for, oldest first, and never adds engines together', () => {
    const rows = twoWeeks().data;
    const chatgpt = engineDays(rows, 'chatgpt_web');
    const gemini = engineDays(rows, 'gemini_web');
    expect(chatgpt).toHaveLength(14);
    expect(gemini).toHaveLength(14);
    expect(chatgpt.map((entry) => entry.date)).toEqual([...chatgpt.map((entry) => entry.date)].sort());
    const friday = (days: typeof chatgpt): number | undefined =>
      days.find((entry) => entry.date === '2026-11-06')?.valid;
    expect(friday(chatgpt)).toBe(742);
    expect(friday(gemini)).toBe(440);
    expect(chatgpt.every((entry) => entry.engine === 'chatgpt_web')).toBe(true);
  });

  it('gives no days for an engine the response does not hold', () => {
    expect(engineDays(twoWeeks().data, 'google_ai_mode')).toEqual([]);
  });
});

describe('the engine tabs', () => {
  it('puts the asked engines first, in catalog order, then the others the response holds', () => {
    expect(engineTabs(['google_ai_mode', 'chatgpt_web', 'gemini_web'], ['gemini_web'])).toEqual([
      'gemini_web',
      'chatgpt_web',
      'google_ai_mode',
    ]);
    expect(engineTabs(['gemini_web', 'chatgpt_web'], ['chatgpt_web', 'gemini_web'])).toEqual([
      'chatgpt_web',
      'gemini_web',
    ]);
  });
});
