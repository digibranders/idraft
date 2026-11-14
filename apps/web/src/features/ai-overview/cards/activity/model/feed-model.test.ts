import { describe, expect, it } from 'vitest';

import { run } from './activity-fixtures';
import { day, dailyResponse, quiet } from './daily-fixtures';
import { buildFeed, startOfBusinessDay, type FeedEntry, type FeedInput } from './feed-model';
import { buildAggregates, type OverviewAggregates } from '../../../data/aggregates';
import { engineCells, promptRow, summaryOf } from '../../engines/engines-fixtures';
import type { Comparison } from '../../engines/facts-model';
import { projectEngine } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { EngineCode, PromptsSummary } from '@/lib/api/types';

const ALL: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];
const CODES = ['chatgpt_web', 'gemini_web'] as const;

function aggregatesOf(now: PromptsSummary, before: PromptsSummary | null): OverviewAggregates {
  return buildAggregates({
    current: now,
    previous: before,
    engines: ALL.map((code) => ({ ...projectEngine(code), is_enabled: (CODES as readonly string[]).includes(code) })),
    chosenEngines: null,
    topicsKept: null,
    sources: null,
    fanout: null,
  });
}

/** One prompt whose rates are the counts: ChatGPT mention, ChatGPT citation, Gemini mention. */
const windowOf = (
  chatgpt: readonly [k: number, n: number],
  chatgptCited: readonly [k: number, n: number],
  gemini: readonly [k: number, n: number],
): PromptsSummary =>
  summaryOf(
    [
      promptRow('p1', [
        engineCells('chatgpt_web', { mentioned: chatgpt, cited: chatgptCited }),
        engineCells('gemini_web', { mentioned: gemini, cited: [0, gemini[1]] }),
      ]),
    ],
    { codes: CODES },
  );

const STEADY: readonly [number, number] = [400, 1000];
// 700 of 1,800 against 575 of 1,800 is a detectable rise (the fixture of What changed)
const RISE = { now: [700, 1800], before: [575, 1800] } as const;
const FALL = { now: [575, 1800], before: [700, 1800] } as const;

function inputOf(over: Partial<FeedInput> = {}): FeedInput {
  const now = windowOf(STEADY, STEADY, STEADY);
  const before = windowOf(STEADY, STEADY, STEADY);
  return {
    aggregates: aggregatesOf(now, before),
    asked: CODES,
    comparison: 'read' satisfies Comparison,
    runs: null,
    daily: undefined,
    newSources: null,
    windowFrom: '2026-10-16',
    windowTo: '2026-11-12',
    timeZone: 'UTC',
    ...over,
  };
}

const idsOf = (entries: readonly FeedEntry[]): string[] => entries.map((entry) => entry.id);
const rateIds = (entries: readonly FeedEntry[]): string[] => idsOf(entries.filter((entry) => entry.kind === 'rate'));

describe('buildFeed: rates', () => {
  it('a detectable rise of an engine rate is a change and a detectable fall needs attention, with the counts of both windows', () => {
    const now = windowOf(RISE.now, FALL.now, STEADY);
    const before = windowOf(RISE.before, FALL.before, STEADY);
    const { entries } = buildFeed(inputOf({ aggregates: aggregatesOf(now, before) }));
    const rise = entries.find((entry) => entry.id === 'rate:chatgpt_web:mention');
    const fall = entries.find((entry) => entry.id === 'rate:chatgpt_web:citation');
    expect(rise).toMatchObject({
      kind: 'rate',
      group: 'changes',
      direction: 'rose',
      engine: 'chatgpt_web',
      metric: 'mention',
      now: { k: 700, n: 1800 },
      before: { k: 575, n: 1800 },
      link: { kind: 'prompts', engine: 'chatgpt_web', metric: 'mention' },
    });
    expect(fall).toMatchObject({ group: 'needs_attention', direction: 'fell', metric: 'citation' });
    expect(fall?.kind === 'rate' && fall.points).toBeLessThan(0);
  });

  it('a move within normal variation is never a row', () => {
    const now = windowOf([404, 1000], [400, 1000], [400, 1000]);
    const before = windowOf([400, 1000], [404, 1000], [400, 1000]);
    expect(rateIds(buildFeed(inputOf({ aggregates: aggregatesOf(now, before) })).entries)).toEqual([]);
  });

  it('a rate with too few valid answers in either window has no row, and is not read as 0', () => {
    const now = windowOf([2, 3], STEADY, STEADY);
    const before = windowOf([700, 1800], STEADY, STEADY);
    expect(rateIds(buildFeed(inputOf({ aggregates: aggregatesOf(now, before) })).entries)).toEqual([]);
  });

  it('keeps engines apart: one row for each engine that moved, none pooled', () => {
    const now = windowOf(RISE.now, STEADY, FALL.now);
    const before = windowOf(RISE.before, STEADY, FALL.before);
    const { entries } = buildFeed(inputOf({ aggregates: aggregatesOf(now, before) }));
    expect(rateIds(entries).sort()).toEqual(['rate:chatgpt_web:mention', 'rate:gemini_web:mention']);
  });

  it('leaves out an engine that is not asked', () => {
    const now = windowOf(RISE.now, STEADY, STEADY);
    const before = windowOf(RISE.before, STEADY, STEADY);
    const input = inputOf({ aggregates: aggregatesOf(now, before), asked: ['gemini_web'] });
    expect(rateIds(buildFeed(input).entries)).toEqual([]);
  });
});

describe('buildFeed: hold', () => {
  const now = windowOf(RISE.now, FALL.now, STEADY);
  const before = windowOf(RISE.before, FALL.before, STEADY);
  const moving = aggregatesOf(now, before);
  const withFailures = [run({ n: 1, createdAt: '2026-11-10T00:00:00Z', completedAt: '2026-11-10T01:00:00Z' })];

  it('with the comparison off the feed holds the changes and lists only the collection notices', () => {
    const feed = buildFeed(
      inputOf({ aggregates: aggregatesOf(now, null), comparison: 'off', runs: withFailures, newSources: 37 }),
    );
    expect(feed.hold).toBe('off');
    expect(idsOf(feed.entries)).toEqual(['run:00000001-0000-4000-8000-000000000001']);
  });

  it('holds when the window before has no valid answer', () => {
    const empty = windowOf([0, 0], [0, 0], [0, 0]);
    const feed = buildFeed(inputOf({ aggregates: aggregatesOf(now, empty), newSources: 12 }));
    expect(feed.hold).toBe('noPrevious');
    expect(feed.entries).toEqual([]);
  });

  it('is not held while the two windows are compared, and an unread window is not a hold', () => {
    expect(buildFeed(inputOf({ aggregates: moving })).hold).toBeNull();
    const unread = buildFeed(inputOf({ aggregates: aggregatesOf(now, null), comparison: 'unread' }));
    expect(unread.hold).toBeNull();
    expect(rateIds(unread.entries)).toEqual([]);
  });
});

describe('buildFeed: new sources', () => {
  it('is a change with its count of domains', () => {
    const { entries } = buildFeed(inputOf({ newSources: 37 }));
    expect(entries).toEqual([
      expect.objectContaining({ id: 'new-sources', kind: 'newSources', group: 'changes', count: 37 }),
    ]);
  });

  it('is no row when it cannot be told (null) and none when no domain is new', () => {
    expect(buildFeed(inputOf({ newSources: null })).entries).toEqual([]);
    expect(buildFeed(inputOf({ newSources: 0 })).entries).toEqual([]);
  });
});

describe('buildFeed: collection issues', () => {
  it('a run that failed outright needs attention; a run with some failed answers is a notice', () => {
    const failed = [
      run({ n: 1, status: 'failed', createdAt: '2026-11-10T00:00:00Z', completedAt: '2026-11-10T01:00:00Z' }),
    ];
    const partial = [run({ n: 2, createdAt: '2026-11-10T00:00:00Z' })];
    expect(buildFeed(inputOf({ runs: failed })).entries[0]).toMatchObject({
      kind: 'run',
      group: 'needs_attention',
      status: 'failed',
      failed: 12,
      total: 250,
      link: { kind: 'runs' },
    });
    expect(buildFeed(inputOf({ runs: partial })).entries[0]).toMatchObject({ kind: 'run', group: 'notices' });
  });

  it('a finished run with no failed answer is no row, and a run before the window is none either', () => {
    const clean = [run({ n: 1, status: 'completed', failed: 0, succeeded: 250 })];
    const before = [run({ n: 2, createdAt: '2026-10-15T23:00:00Z', completedAt: '2026-10-16T01:00:00Z' })];
    expect(buildFeed(inputOf({ runs: clean })).entries).toEqual([]);
    expect(buildFeed(inputOf({ runs: before })).entries).toEqual([]);
  });

  it('a run after the last day of the window is none, with or without a blocked run beside it', () => {
    const past = { windowFrom: '2026-10-01', windowTo: '2026-10-14' };
    const failedAfter = run({
      n: 1,
      status: 'failed',
      createdAt: '2026-11-12T00:10:00Z',
      completedAt: '2026-11-12T01:10:00Z',
    });
    const blockedAfter = run({ n: 2, status: 'budget_blocked', createdAt: '2026-11-12T08:00:00Z', completedAt: null });
    expect(buildFeed(inputOf({ ...past, runs: [failedAfter] })).entries).toEqual([]);
    expect(buildFeed(inputOf({ ...past, runs: [blockedAfter, failedAfter] })).entries).toEqual([]);
    // The last day itself is inside the window, at any hour of the project's day
    const lastDay = run({ n: 3, status: 'failed', createdAt: '2026-10-14T23:30:00Z', completedAt: null });
    expect(idsOf(buildFeed(inputOf({ ...past, runs: [lastDay] })).entries)).toEqual([
      'run:00000001-0000-4000-8000-000000000003',
    ]);
  });

  it('runs a budget blocked need attention, counted', () => {
    const blocked = [
      run({ n: 1, status: 'budget_blocked', createdAt: '2026-11-09T00:00:00Z', completedAt: null }),
      run({ n: 2, status: 'budget_blocked', createdAt: '2026-11-11T00:00:00Z', completedAt: null }),
    ];
    expect(buildFeed(inputOf({ runs: blocked })).entries).toEqual([
      expect.objectContaining({ id: 'blocked', kind: 'blocked', group: 'needs_attention', count: 2 }),
    ]);
  });

  it('counts only the blocked runs inside the window, not the ones after it', () => {
    const runs = [
      run({ n: 1, status: 'budget_blocked', createdAt: '2026-11-11T00:00:00Z', completedAt: null }),
      run({ n: 2, status: 'budget_blocked', createdAt: '2026-11-13T00:00:00Z', completedAt: null }),
      run({ n: 3, status: 'budget_blocked', createdAt: '2026-11-14T00:00:00Z', completedAt: null }),
    ];
    expect(buildFeed(inputOf({ runs })).entries).toEqual([expect.objectContaining({ id: 'blocked', count: 1 })]);
  });

  it('names the latest day with refused or error answers for each engine, never pooled', () => {
    const daily = dailyResponse(
      [
        day({ date: '2026-11-02', complete: 740, refused: 6, error: 4 }),
        day({ date: '2026-11-06', complete: 742, refused: 6, error: 2 }),
        quiet('2026-11-07'),
        day({ date: '2026-11-06', engine: 'gemini_web', scheduled: 500, complete: 440, refused: 40, error: 20 }),
        day({ date: '2026-11-09', engine: 'gemini_web', scheduled: 500, complete: 500 }),
      ],
      { from: '2026-11-02', to: '2026-11-15' },
    );
    const { entries } = buildFeed(inputOf({ daily }));
    expect(
      entries.map((entry) => entry.kind === 'day' && [entry.id, entry.refused, entry.error, entry.answers]),
    ).toEqual([
      ['day:chatgpt_web:2026-11-06', 6, 2, 750],
      ['day:gemini_web:2026-11-06', 40, 20, 500],
    ]);
    expect(entries.every((entry) => entry.group === 'notices')).toBe(true);
  });

  it('a day without a failed answer, and an engine that is not asked, give no row', () => {
    const daily = dailyResponse(
      [
        day({ date: '2026-11-06', complete: 750 }),
        day({ date: '2026-11-06', engine: 'gemini_web', complete: 10, error: 2 }),
      ],
      {
        from: '2026-11-02',
        to: '2026-11-15',
      },
    );
    expect(buildFeed(inputOf({ daily, asked: ['chatgpt_web'] })).entries).toEqual([]);
  });
});

describe('buildFeed: order', () => {
  it('lists the groups most urgent first: needs attention, changes, notices', () => {
    const now = windowOf(RISE.now, FALL.now, STEADY);
    const before = windowOf(RISE.before, FALL.before, STEADY);
    const runs = [run({ n: 1, createdAt: '2026-11-10T00:00:00Z' })];
    const { entries } = buildFeed(inputOf({ aggregates: aggregatesOf(now, before), runs, newSources: 5 }));
    expect(entries.map((entry) => entry.group)).toEqual(['needs_attention', 'changes', 'changes', 'notices']);
    expect(new Set(idsOf(entries)).size).toBe(entries.length);
  });

  it('inside a group the newest comes first, as the feed draws it', () => {
    const runs = [
      run({ n: 1, status: 'budget_blocked', createdAt: '2026-11-11T00:00:00Z', completedAt: null }),
      run({ n: 2, status: 'failed', createdAt: '2026-11-10T00:00:00Z', completedAt: '2026-11-10T01:00:00Z' }),
    ];
    const { entries } = buildFeed(inputOf({ runs }));
    // Both need attention: the blocked run (Nov 11) is newer than the failed run's end (Nov 10, 01:00)
    expect(idsOf(entries)).toEqual(['blocked', 'run:00000001-0000-4000-8000-000000000002']);
  });

  it('ranks moves dated alike by how far the rate moved, so a cut keeps the larger ones', () => {
    // ChatGPT mention moved 6.9 points, Gemini mention 20 points: the larger move comes first
    const now = windowOf(RISE.now, STEADY, [600, 1000]);
    const before = windowOf(RISE.before, STEADY, [400, 1000]);
    const { entries } = buildFeed(inputOf({ aggregates: aggregatesOf(now, before) }));
    expect(rateIds(entries)).toEqual(['rate:gemini_web:mention', 'rate:chatgpt_web:mention']);
  });
});

describe('buildFeed: dating', () => {
  it('dates a row about the whole window by the start of its last day in the project zone, never by a time of day', () => {
    const now = windowOf(RISE.now, FALL.now, STEADY);
    const before = windowOf(RISE.before, FALL.before, STEADY);
    const { entries } = buildFeed(
      inputOf({ aggregates: aggregatesOf(now, before), newSources: 5, timeZone: 'Europe/Berlin' }),
    );
    // Berlin is one hour ahead of UTC in November: its Nov 12 begins at 23:00 UTC on Nov 11
    for (const entry of entries) {
      expect(entry).toMatchObject({ at: '2026-11-11T23:00:00.000Z', day: '2026-11-12' });
    }
    expect(entries).toHaveLength(3);
  });

  it('dates a day row by its own business day, and a run by its own instant with no day', () => {
    const daily = dailyResponse([day({ date: '2026-11-06', complete: 742, refused: 6, error: 2 })], {
      from: '2026-10-16',
      to: '2026-11-12',
    });
    const runs = [run({ n: 1, createdAt: '2026-11-10T00:00:00Z', completedAt: '2026-11-10T01:00:00Z' })];
    const { entries } = buildFeed(inputOf({ daily, runs }));
    expect(entries.find((entry) => entry.kind === 'day')).toMatchObject({
      at: '2026-11-06T00:00:00.000Z',
      day: '2026-11-06',
    });
    expect(entries.find((entry) => entry.kind === 'run')).toMatchObject({ at: '2026-11-10T01:00:00Z', day: null });
  });

  it('starts a business day at midnight of the project zone, summer time included', () => {
    expect(startOfBusinessDay('2026-07-01', 'Europe/Berlin')).toBe('2026-06-30T22:00:00.000Z');
    expect(startOfBusinessDay('2026-07-01', 'UTC')).toBe('2026-07-01T00:00:00.000Z');
  });
});
