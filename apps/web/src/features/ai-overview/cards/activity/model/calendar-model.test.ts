import { describe, expect, it } from 'vitest';

import { calendarWeeks, validShare, weekdayOf, type CalendarCell } from './calendar-model';
import { day, quiet, twoWeeks } from './daily-fixtures';
import { dayCounts, engineDays } from './status-model';

const days = (...rows: Parameters<typeof day>[0][]): ReturnType<typeof dayCounts>[] =>
  rows.map((row) => dayCounts(day(row)));

const cellOn = (weeks: ReturnType<typeof calendarWeeks>, date: string): CalendarCell | null => {
  for (const week of weeks) {
    for (const cell of week.cells) if (cell?.counts.date === date) return cell;
  }
  return null;
};

describe('the calendar of a collection window', () => {
  it('starts each week on a Monday and fills a week from its first day in the window', () => {
    const weeks = calendarWeeks(
      Array.from({ length: 13 }, (_, place) => dayCounts(quiet(`2026-11-${String(place + 4).padStart(2, '0')}`))),
    );
    expect(weeks.map((week) => week.start)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16']);
    // Nov 4 is a Wednesday: the Monday and Tuesday before it are not in the window
    expect(weeks[0]?.cells.map((cell) => cell?.counts.date ?? null)).toEqual([
      null,
      null,
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
    expect(weeks[2]?.cells.filter((cell) => cell !== null)).toHaveLength(1);
  });

  it('names the weekday of a project day by its date, whatever the zone of the machine', () => {
    const before = process.env.TZ;
    try {
      for (const zone of ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']) {
        process.env.TZ = zone;
        expect(weekdayOf('2026-11-08')).toBe('sunday');
        expect(weekdayOf('2026-11-09')).toBe('monday');
        expect(weekdayOf('2026-11-06')).toBe('friday');
        expect(calendarWeeks([dayCounts(quiet('2026-11-08'))])[0]?.start).toBe('2026-11-02');
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it('puts the weekday of each cell in the row of that weekday', () => {
    const weeks = calendarWeeks(engineDays(twoWeeks().data, 'chatgpt_web'));
    expect(weeks).toHaveLength(2);
    expect(cellOn(weeks, '2026-11-06')?.weekday).toBe('friday');
    expect(weeks[0]?.cells[4]?.counts.date).toBe('2026-11-06');
    expect(weeks[1]?.cells[0]?.counts.date).toBe('2026-11-09');
  });

  it('values a cell as the valid answers over the scheduled ones, partial answers included', () => {
    const [counts] = days({ date: '2026-11-06', scheduled: 750, complete: 700, partial: 42, refused: 6, error: 2 });
    expect(counts).toBeDefined();
    if (counts === undefined) return;
    expect(validShare(counts)).toBeCloseTo(742 / 750, 10);
    const cell = cellOn(calendarWeeks([counts]), '2026-11-06');
    expect(cell?.state).toEqual({ kind: 'rate', rate: 742 / 750 });
  });

  it('keeps a schedule that is unknown as unknown, with no rate, never as 0', () => {
    const [counts] = days({ date: '2026-11-03', scheduled: null, complete: 12 });
    if (counts === undefined) throw new Error('no day');
    expect(validShare(counts)).toBeNull();
    const cell = cellOn(calendarWeeks([counts]), '2026-11-03');
    expect(cell?.state).toEqual({ kind: 'unknown' });
  });

  it('says nothing was scheduled for a day planned at 0, which is not a rate either', () => {
    const [counts] = days({ date: '2026-11-03', scheduled: 0 });
    if (counts === undefined) throw new Error('no day');
    expect(validShare(counts)).toBeNull();
    expect(cellOn(calendarWeeks([counts]), '2026-11-03')?.state).toEqual({ kind: 'nothing' });
  });

  it('gives a scheduled day with no answer a rate of 0, a fact and not an unknown', () => {
    const [counts] = days({ date: '2026-11-13', scheduled: 750 });
    if (counts === undefined) throw new Error('no day');
    expect(cellOn(calendarWeeks([counts]), '2026-11-13')?.state).toEqual({ kind: 'rate', rate: 0 });
  });

  it('does not let answers beyond the schedule take the rate past 1', () => {
    const [counts] = days({ date: '2026-11-06', scheduled: 100, complete: 130 });
    if (counts === undefined) throw new Error('no day');
    expect(validShare(counts)).toBe(1);
  });

  it('draws one engine at a time: the cells of ChatGPT do not hold the answers of Gemini', () => {
    const rows = twoWeeks().data;
    const chatgpt = cellOn(calendarWeeks(engineDays(rows, 'chatgpt_web')), '2026-11-06');
    const gemini = cellOn(calendarWeeks(engineDays(rows, 'gemini_web')), '2026-11-06');
    expect(chatgpt?.counts.valid).toBe(742);
    expect(chatgpt?.counts.scheduled).toBe(750);
    expect(gemini?.counts.valid).toBe(440);
    expect(gemini?.counts.scheduled).toBe(500);
  });

  it('is empty for no days', () => {
    expect(calendarWeeks([])).toEqual([]);
  });
});
