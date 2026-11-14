import { describe, expect, it } from 'vitest';

import { trimIdleWeeks } from './trim-weeks';

interface Week {
  weekStart: string;
  answers: number;
}

const weeks = (...answers: number[]): Week[] =>
  answers.map((count, index) => ({ weekStart: `2026-10-${String(12 + index * 7).padStart(2, '0')}`, answers: count }));
const empty = (week: Week): boolean => week.answers === 0;
const answersOf = (list: readonly Week[]): number[] => list.map((week) => week.answers);

describe('trimIdleWeeks', () => {
  it('drops the leading and trailing weeks that are idle', () => {
    expect(answersOf(trimIdleWeeks(weeks(0, 0, 5, 7, 0), empty))).toEqual([5, 7]);
  });

  it('keeps a gap in the middle as a gap', () => {
    expect(answersOf(trimIdleWeeks(weeks(0, 5, 0, 0, 7, 0), empty))).toEqual([5, 0, 0, 7]);
  });

  it('keeps a week with thin answers at either end', () => {
    expect(answersOf(trimIdleWeeks(weeks(0, 2, 5, 3, 0), (week) => week.answers === 0))).toEqual([2, 5, 3]);
  });

  it('gives nothing when every week is idle, and the same weeks when none is', () => {
    expect(trimIdleWeeks(weeks(0, 0, 0), empty)).toEqual([]);
    expect(answersOf(trimIdleWeeks(weeks(4, 5), empty))).toEqual([4, 5]);
  });

  it('does not change the list it is given', () => {
    const given = weeks(0, 5, 0);
    trimIdleWeeks(given, empty);
    expect(answersOf(given)).toEqual([0, 5, 0]);
  });
});
