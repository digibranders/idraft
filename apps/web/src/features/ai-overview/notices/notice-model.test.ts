import { describe, expect, it } from 'vitest';

import { noticeOf, staleDaysOf, STALE_AFTER_DAYS, type EngineCounts, type NoticeInputs } from './notice-model';

const NOW = new Date('2026-11-12T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number): string => new Date(NOW.getTime() - days * DAY).toISOString();

const engine = (patch: Partial<EngineCounts> & Pick<EngineCounts, 'engineCode' | 'label'>): EngineCounts => ({
  asked: true,
  allAnswers: 750,
  validAnswers: 750,
  ...patch,
});

/** A project in good shape: engines on, prompts asked, answers a day old, nothing invalid. */
const HEALTHY: NoticeInputs = {
  enginesOn: 2,
  activePrompts: 24,
  country: null,
  promptsInScope: 24,
  schedule: { nextRunAt: '2026-11-13T02:00:00Z', paused: false },
  freshness: { lastObservedAt: ago(1), lastValidAt: ago(1) },
  engines: [
    engine({ engineCode: 'chatgpt_web', label: 'ChatGPT' }),
    engine({ engineCode: 'gemini_web', label: 'Gemini' }),
  ],
  days: 28,
  now: NOW,
};
const noticeWith = (patch: Partial<NoticeInputs>): ReturnType<typeof noticeOf> => noticeOf({ ...HEALTHY, ...patch });

describe('noticeOf', () => {
  it('is none for a project in good shape', () => {
    expect(noticeOf(HEALTHY)).toBeNull();
  });

  it('is none while what it needs has not been read', () => {
    expect(noticeWith({ enginesOn: null })).toBeNull();
    expect(noticeWith({ freshness: null })).toBeNull();
    expect(noticeWith({ engines: null })).toBeNull();
  });

  it('no engine beats everything', () => {
    expect(
      noticeWith({
        enginesOn: 0,
        activePrompts: 0,
        schedule: { nextRunAt: null, paused: true },
        freshness: { lastObservedAt: null, lastValidAt: null },
      }),
    ).toEqual({ kind: 'noEngine' });
  });

  it('no prompts, with an engine on, beats the rest', () => {
    expect(
      noticeWith({
        activePrompts: 0,
        schedule: { nextRunAt: null, paused: true },
        freshness: { lastObservedAt: null, lastValidAt: null },
      }),
    ).toEqual({ kind: 'noPrompts' });
  });

  it('a country with no prompts is its own state, and only while a country is chosen', () => {
    expect(noticeWith({ country: 'DE', promptsInScope: 0 })).toEqual({ kind: 'noCountryPrompts', country: 'DE' });
    expect(noticeWith({ country: null, promptsInScope: 0 })).toBeNull();
    expect(noticeWith({ country: 'DE', promptsInScope: 3 })).toBeNull();
  });

  it('first collection pending names the next run from the schedule', () => {
    expect(noticeWith({ freshness: { lastObservedAt: null, lastValidAt: null } })).toEqual({
      kind: 'firstAnswers',
      nextRunAt: '2026-11-13T02:00:00Z',
    });
  });

  it('first collection pending without a next run says so without a time', () => {
    expect(
      noticeWith({
        freshness: { lastObservedAt: null, lastValidAt: null },
        schedule: { nextRunAt: null, paused: false },
      }),
    ).toEqual({ kind: 'firstAnswers', nextRunAt: null });
  });

  it('waits for the schedule before saying when the first answers come', () => {
    expect(noticeWith({ freshness: { lastObservedAt: null, lastValidAt: null }, schedule: null })).toBeNull();
  });

  it('paused schedules are told, before any answer and after', () => {
    const paused = { nextRunAt: null, paused: true };
    expect(noticeWith({ schedule: paused })).toEqual({ kind: 'paused' });
    expect(noticeWith({ schedule: paused, freshness: { lastObservedAt: null, lastValidAt: null } })).toEqual({
      kind: 'paused',
    });
  });

  it('invalid answers name the worst engine and its counts, with the days of the window', () => {
    expect(
      noticeWith({
        engines: [
          engine({ engineCode: 'chatgpt_web', label: 'ChatGPT', allAnswers: 750, validAnswers: 740 }),
          engine({ engineCode: 'gemini_web', label: 'Gemini', allAnswers: 750, validAnswers: 712 }),
        ],
      }),
    ).toEqual({ kind: 'invalid', engineCode: 'gemini_web', label: 'Gemini', invalid: 38, total: 750, days: 28 });
  });

  it('the worst engine is the one with the larger share of its answers not valid', () => {
    expect(
      noticeWith({
        engines: [
          engine({ engineCode: 'chatgpt_web', label: 'ChatGPT', allAnswers: 1000, validAnswers: 950 }),
          engine({ engineCode: 'gemini_web', label: 'Gemini', allAnswers: 100, validAnswers: 90 }),
        ],
      }),
    ).toMatchObject({ kind: 'invalid', engineCode: 'gemini_web', invalid: 10, total: 100 });
  });

  it('an engine outside the filter is not counted', () => {
    expect(
      noticeWith({
        engines: [
          engine({ engineCode: 'chatgpt_web', label: 'ChatGPT' }),
          engine({ engineCode: 'gemini_web', label: 'Gemini', asked: false, allAnswers: 750, validAnswers: 100 }),
        ],
      }),
    ).toBeNull();
  });

  it('invalid counts use the same denominator as the numbers: all answers minus the valid ones of the engine', () => {
    const notice = noticeWith({
      engines: [engine({ engineCode: 'chatgpt_web', label: 'ChatGPT', allAnswers: 1862, validAnswers: 1800 })],
    });
    expect(notice).toMatchObject({ kind: 'invalid', invalid: 62, total: 1862 });
  });

  it('is stale after 5 days and not at 5', () => {
    expect(STALE_AFTER_DAYS).toBe(5);
    expect(noticeWith({ freshness: { lastObservedAt: ago(4), lastValidAt: ago(4) } })).toBeNull();
    expect(noticeWith({ freshness: { lastObservedAt: ago(5), lastValidAt: ago(5) } })).toBeNull();
    expect(noticeWith({ freshness: { lastObservedAt: ago(6), lastValidAt: ago(6) } })).toEqual({
      kind: 'stale',
      days: 6,
    });
  });

  it('a failed freshness read leaves out the first answers and stale notices and keeps the others', () => {
    expect(noticeWith({ freshness: 'failed' })).toBeNull();
    expect(noticeWith({ freshness: 'failed', schedule: { nextRunAt: null, paused: true } })).toEqual({
      kind: 'paused',
    });
    expect(
      noticeWith({
        freshness: 'failed',
        engines: [engine({ engineCode: 'gemini_web', label: 'Gemini', allAnswers: 10, validAnswers: 9 })],
      }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('only one notice is returned: invalid answers come before stale', () => {
    const notice = noticeWith({
      freshness: { lastObservedAt: ago(9), lastValidAt: ago(9) },
      engines: [engine({ engineCode: 'chatgpt_web', label: 'ChatGPT', allAnswers: 10, validAnswers: 8 })],
    });
    expect(notice).toMatchObject({ kind: 'invalid' });
  });
});

describe('staleDaysOf', () => {
  it('is the whole days of the newest valid answer once it is over 5 days old, else null', () => {
    expect(staleDaysOf(ago(4), NOW)).toBeNull();
    expect(staleDaysOf(ago(5), NOW)).toBeNull();
    expect(staleDaysOf(ago(5.5), NOW)).toBe(5);
    expect(staleDaysOf(ago(6), NOW)).toBe(6);
  });

  it('is null with no valid answer, which is no age to state', () => {
    expect(staleDaysOf(null, NOW)).toBeNull();
  });
});
