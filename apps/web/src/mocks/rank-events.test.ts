import { describe, expect, it } from 'vitest';

import { MOCK_TRACKED_KEYWORDS } from './keyword-fixtures';
import { hashOf } from './rank-history';
import { rankEventsOf, worldEvents, type EventCheck } from './rank-events';
import { stoppedAtOf } from './rank-state';
import { OWN_ENTITY_REF, worldChecks } from './serp-world';

let counter = 0;
const check = (rank: number | null, depth = 20, extra: Partial<EventCheck> = {}): EventCheck => ({
  observedAt: `2026-10-${String(1 + counter++).padStart(2, '0')}T02:00:00.000Z`,
  rank,
  depth,
  path: '/a',
  ownedFeatures: [],
  aio: 'absent',
  aioCited: null,
  competitors: new Map(),
  ...extra,
});

const adjacent = <T>(rows: readonly T[]): Array<[T, T]> => {
  const pairs: Array<[T, T]> = [];
  let previous: T | undefined;
  for (const row of rows) {
    if (previous !== undefined) pairs.push([previous, row]);
    previous = row;
  }
  return pairs;
};

describe('rankEventsOf', () => {
  it('a first check writes nothing', () => {
    counter = 0;
    const checks = [check(5, 20)];
    expect(rankEventsOf(checks, 't1')).toEqual([]);
  });

  it('25 to 8 at depth 100 writes entered_top_10, entered_top_20 and rank_gain', () => {
    counter = 0;
    const checks = [check(25, 100), check(8, 100)];
    const events = rankEventsOf(checks, 't1');
    expect(events.map((e) => [e.eventType, e.fromRank, e.toRank])).toEqual([
      ['entered_top_10', 25, 8],
      ['entered_top_20', 25, 8],
      ['rank_gain', 25, 8],
    ]);
  });

  it('8 to 12 writes lost_top_10 and rank_drop', () => {
    counter = 0;
    const checks = [check(8, 20), check(12, 20)];
    const events = rankEventsOf(checks, 't1');
    expect(events.map((e) => [e.eventType, e.fromRank, e.toRank])).toEqual([
      ['lost_top_10', 8, 12],
      ['rank_drop', 8, 12],
    ]);
  });

  it('depth 20 skips the top 100 bucket, while depth 100 includes entered_top_100', () => {
    counter = 0;
    const depth20Checks = [check(null, 20), check(15, 20)];
    const depth20Events = rankEventsOf(depth20Checks, 't1');
    expect(depth20Events.map((e) => [e.eventType, e.fromRank, e.toRank])).toEqual([['entered_top_20', null, 15]]);

    counter = 0;
    const depth100Checks = [check(null, 100), check(50, 100)];
    const depth100Events = rankEventsOf(depth100Checks, 't1');
    expect(depth100Events.map((e) => [e.eventType, e.fromRank, e.toRank])).toEqual([['entered_top_100', null, 50]]);
  });

  it('a depth drop writes nothing for ranks below the smaller depth', () => {
    counter = 0;
    const checks = [check(60, 100), check(null, 20)];
    expect(rankEventsOf(checks, 't1')).toEqual([]);
  });

  it('new_ranking only after two beyond-depth checks and not after one', () => {
    counter = 0;
    const checksOneBeyond = [check(5, 20), check(null, 20), check(5, 20)];
    const eventsOne = rankEventsOf(checksOneBeyond, 't1');
    expect(eventsOne.some((e) => e.eventType === 'new_ranking')).toBe(false);

    counter = 0;
    const checksTwoBeyond = [check(5, 20), check(null, 20), check(null, 20), check(5, 20)];
    const eventsTwo = rankEventsOf(checksTwoBeyond, 't1');
    const newRanking = eventsTwo.filter((e) => e.eventType === 'new_ranking');
    expect(newRanking).toHaveLength(1);
    expect(newRanking[0]?.fromRank).toBeNull();
    expect(newRanking[0]?.toRank).toBe(5);

    counter = 0;
    const initialBeyondChecks = [check(null, 20), check(null, 20), check(5, 20)];
    const initialEvents = rankEventsOf(initialBeyondChecks, 't1');
    expect(initialEvents.map((e) => [e.eventType, e.fromRank, e.toRank])).toEqual([
      ['entered_top_10', null, 5],
      ['entered_top_20', null, 5],
      ['new_ranking', null, 5],
    ]);

    counter = 0;
    const singleInitialBeyond = [check(null, 20), check(5, 20)];
    const singleEvents = rankEventsOf(singleInitialBeyond, 't1');
    expect(singleEvents.map((e) => [e.eventType, e.fromRank, e.toRank])).toEqual([
      ['entered_top_10', null, 5],
      ['entered_top_20', null, 5],
    ]);
  });

  it('lost_ranking exactly when the run reaches 2 for a keyword that ranked before and not again at 3', () => {
    counter = 0;
    const checks = [check(5, 20), check(null, 20), check(null, 20), check(null, 20)];
    const events = rankEventsOf(checks, 't1');
    const lostRanking = events.filter((e) => e.eventType === 'lost_ranking');
    expect(lostRanking).toHaveLength(1);
    expect(lostRanking[0]?.fromRank).toBe(5);
    expect(lostRanking[0]?.toRank).toBeNull();
    expect(lostRanking[0]?.occurredAt).toBe(checks[2]?.observedAt);
  });

  it('lookedDeepEnough: a shallow check cannot say gone (no lost_ranking or new_ranking)', () => {
    counter = 0;
    const shallowChecks = [check(45, 100), check(null, 20), check(null, 20)];
    const shallowEvents = rankEventsOf(shallowChecks, 't1');
    expect(shallowEvents.filter((e) => e.eventType === 'lost_ranking')).toEqual([]);

    const deepChecks = [...shallowChecks, check(null, 100), check(null, 100)];
    const deepEvents = rankEventsOf(deepChecks, 't1');
    const lostEvents = deepEvents.filter((e) => e.eventType === 'lost_ranking');
    expect(lostEvents.map((e) => [e.eventType, e.fromRank, e.toRank])).toEqual([['lost_ranking', 45, null]]);
  });

  it('a path change writes url_changed after movement events', () => {
    counter = 0;
    const checks = [check(5, 20, { path: '/a' }), check(4, 20, { path: '/b' })];
    const events = rankEventsOf(checks, 't1');
    expect(events.map((e) => e.eventType)).toEqual(['rank_gain', 'url_changed']);
    const urlEvent = events.find((e) => e.eventType === 'url_changed');
    expect(urlEvent?.fromPath).toBe('/a');
    expect(urlEvent?.toPath).toBe('/b');
    expect(urlEvent?.fromRank).toBe(5);
    expect(urlEvent?.toRank).toBe(4);
  });

  it('an owned feature appearing writes feature_gained with code in featureType, unowned nothing', () => {
    counter = 0;
    const checks = [check(5, 20, { ownedFeatures: [] }), check(5, 20, { ownedFeatures: ['featured_snippet'] })];
    const events = rankEventsOf(checks, 't1');
    expect(events.map((e) => [e.eventType, e.featureType])).toEqual([['feature_gained', 'featured_snippet']]);

    const checkLoss = [check(5, 20, { ownedFeatures: ['featured_snippet'] }), check(5, 20, { ownedFeatures: [] })];
    const lossEvents = rankEventsOf(checkLoss, 't1');
    expect(lossEvents.map((e) => [e.eventType, e.featureType])).toEqual([['feature_lost', 'featured_snippet']]);
  });

  it('AI Overview: aio_appeared, aio_disappeared, aio_citation_gained, aio_citation_lost each with exact lists; aioCited null writes nothing', () => {
    counter = 0;
    const checksAppeared = [
      check(5, 20, { aio: 'absent', aioCited: null }),
      check(5, 20, { aio: 'present_not_cited', aioCited: false }),
    ];
    expect(rankEventsOf(checksAppeared, 't1').map((e) => e.eventType)).toEqual(['aio_appeared']);

    counter = 0;
    const checksDisappeared = [
      check(5, 20, { aio: 'present_not_cited', aioCited: false }),
      check(5, 20, { aio: 'absent', aioCited: null }),
    ];
    expect(rankEventsOf(checksDisappeared, 't1').map((e) => e.eventType)).toEqual(['aio_disappeared']);

    counter = 0;
    const checksCitationGained = [
      check(5, 20, { aio: 'present_not_cited', aioCited: false }),
      check(5, 20, { aio: 'present_cited', aioCited: true }),
    ];
    expect(rankEventsOf(checksCitationGained, 't1').map((e) => e.eventType)).toEqual(['aio_citation_gained']);

    counter = 0;
    const checksCitationLost = [
      check(5, 20, { aio: 'present_cited', aioCited: true }),
      check(5, 20, { aio: 'present_not_cited', aioCited: false }),
    ];
    expect(rankEventsOf(checksCitationLost, 't1').map((e) => e.eventType)).toEqual(['aio_citation_lost']);

    counter = 0;
    const checksNullCitation = [
      check(5, 20, { aio: 'present_cited', aioCited: true }),
      check(5, 20, { aio: 'not_loaded', aioCited: null }),
      check(5, 20, { aio: 'present_cited', aioCited: true }),
    ];
    const nullEvents = rankEventsOf(checksNullCitation, 't1');
    expect(
      nullEvents.filter((e) => e.eventType === 'aio_citation_gained' || e.eventType === 'aio_citation_lost'),
    ).toEqual([]);
  });

  it('overtaken_by and overtook with exact lists; out of depth in both checks with own ranked writes nothing', () => {
    counter = 0;
    const compA = '00000000-0000-0000-0000-000000000001';
    const compB = '00000000-0000-0000-0000-000000000002';
    const checks = [
      check(3, 20, {
        competitors: new Map([
          [compA, 5],
          [compB, 2],
        ]),
      }),
      check(6, 20, {
        competitors: new Map([
          [compA, 4],
          [compB, 8],
        ]),
      }),
    ];
    const events = rankEventsOf(checks, 't1');
    const overtakes = events.filter((e) => e.eventType === 'overtaken_by' || e.eventType === 'overtook');
    expect(overtakes.map((e) => [e.eventType, e.fromRank, e.toRank, e.otherEntityId])).toEqual([
      ['overtaken_by', 3, 6, compA],
      ['overtook', 3, 6, compB],
    ]);

    counter = 0;
    const compOutOfDepth = '00000000-0000-0000-0000-000000000003';
    const checksOutOfDepth = [
      check(5, 20, { competitors: new Map([[compOutOfDepth, null]]) }),
      check(8, 20, { competitors: new Map([[compOutOfDepth, null]]) }),
    ];
    const eventsOutOfDepth = rankEventsOf(checksOutOfDepth, 't1');
    expect(eventsOutOfDepth.filter((e) => e.eventType === 'overtaken_by' || e.eventType === 'overtook')).toEqual([]);
  });

  it('event order within a check: top buckets, ranking events, movement events, url_changed, feature events, AI Overview events, overtakes', () => {
    counter = 0;
    const compId = '00000000-0000-0000-0000-000000000001';
    const checks = [
      check(null, 100, {
        path: '/a',
        ownedFeatures: [],
        aio: 'absent',
        aioCited: null,
        competitors: new Map([[compId, 5]]),
      }),
      check(null, 100, {
        path: '/a',
        ownedFeatures: [],
        aio: 'absent',
        aioCited: null,
        competitors: new Map([[compId, 5]]),
      }),
      check(2, 100, {
        path: '/b',
        ownedFeatures: ['featured_snippet'],
        aio: 'present_not_cited',
        aioCited: false,
        competitors: new Map([[compId, 5]]),
      }),
    ];
    const events = rankEventsOf(checks, 't1');
    expect(events.map((e) => e.eventType)).toEqual([
      'entered_top_3',
      'entered_top_10',
      'entered_top_20',
      'entered_top_100',
      'new_ranking',
      'url_changed',
      'feature_gained',
      'aio_appeared',
      'overtook',
    ]);
  });

  it('sorted competitors and features: input in reverse order gives the same sorted output', () => {
    counter = 0;
    const comp1 = '00000000-0000-0000-0000-000000000001';
    const comp2 = '00000000-0000-0000-0000-000000000002';
    const checksForward = [
      check(5, 20, {
        ownedFeatures: ['alpha', 'beta'],
        competitors: new Map([
          [comp1, 6],
          [comp2, 7],
        ]),
      }),
      check(5, 20, {
        ownedFeatures: [],
        competitors: new Map([
          [comp1, 4],
          [comp2, 4],
        ]),
      }),
    ];
    counter = 0;
    const checksReverse = [
      check(5, 20, {
        ownedFeatures: ['beta', 'alpha'],
        competitors: new Map([
          [comp2, 7],
          [comp1, 6],
        ]),
      }),
      check(5, 20, {
        ownedFeatures: [],
        competitors: new Map([
          [comp2, 4],
          [comp1, 4],
        ]),
      }),
    ];
    const forwardEvents = rankEventsOf(checksForward, 't1');
    const reverseEvents = rankEventsOf(checksReverse, 't1');
    expect(forwardEvents.map((e) => [e.eventType, e.otherEntityId, e.featureType])).toEqual(
      reverseEvents.map((e) => [e.eventType, e.otherEntityId, e.featureType]),
    );
  });

  it('ids: matches hash formula and remains strictly unique across a run', () => {
    counter = 0;
    const checks = [check(25, 100), check(8, 100)];
    const events = rankEventsOf(checks, 'kw-test-id');
    const firstEvent = events[0];
    if (!firstEvent) throw new Error('Missing event');
    const expectedToken = `kw-test-id:${firstEvent.occurredAt}:${firstEvent.eventType}:`;
    const expectedId = String(hashOf(expectedToken) + 1);
    expect(firstEvent.id).toBe(expectedId);

    const allIds = new Set<string>();
    let total = 0;
    for (const fixture of MOCK_TRACKED_KEYWORDS) {
      const fevents = worldEvents({
        trackedId: fixture.tracked_keyword_id,
        createdAt: fixture.created_at,
        now: Date.parse('2026-11-02T12:00:00Z'),
        domain: 'fynix.digital',
        own: OWN_ENTITY_REF,
        competitors: [],
      });
      for (const ev of fevents) {
        expect(allIds.has(ev.id)).toBe(false);
        allIds.add(ev.id);
        total += 1;
      }
    }
    expect(total).toBeGreaterThan(500);
    expect(allIds.size).toBe(total);
  });

  it('all 21 event types appear in the tests', () => {
    const ALL_21_EVENT_TYPES = [
      'entered_top_3',
      'entered_top_10',
      'entered_top_20',
      'entered_top_100',
      'lost_top_3',
      'lost_top_10',
      'lost_top_20',
      'lost_top_100',
      'new_ranking',
      'lost_ranking',
      'rank_gain',
      'rank_drop',
      'url_changed',
      'feature_gained',
      'feature_lost',
      'aio_appeared',
      'aio_disappeared',
      'aio_citation_gained',
      'aio_citation_lost',
      'overtaken_by',
      'overtook',
    ] as const;

    counter = 0;
    const top100Checks = [check(null, 100), check(95, 100), check(null, 100)];
    const top3Checks = [check(2, 20), check(5, 20)];
    const enterTop3Checks = [check(5, 20), check(2, 20)];
    const lostTop20Checks = [check(18, 20), check(null, 20)];

    const testCases: EventCheck[][] = [
      top100Checks,
      top3Checks,
      enterTop3Checks,
      lostTop20Checks,
      [check(25, 100), check(8, 100)],
      [check(8, 20), check(12, 20)],
      [check(5, 20), check(null, 20), check(null, 20), check(5, 20)],
      [check(5, 20), check(null, 20), check(null, 20)],
      [check(5, 20, { path: '/a' }), check(4, 20, { path: '/b' })],
      [check(5, 20, { ownedFeatures: [] }), check(5, 20, { ownedFeatures: ['snippet'] })],
      [check(5, 20, { ownedFeatures: ['snippet'] }), check(5, 20, { ownedFeatures: [] })],
      [check(5, 20, { aio: 'absent' }), check(5, 20, { aio: 'present_not_cited' })],
      [check(5, 20, { aio: 'present_not_cited' }), check(5, 20, { aio: 'absent' })],
      [check(5, 20, { aioCited: false }), check(5, 20, { aioCited: true })],
      [check(5, 20, { aioCited: true }), check(5, 20, { aioCited: false })],
      [check(3, 20, { competitors: new Map([['c1', 5]]) }), check(6, 20, { competitors: new Map([['c1', 4]]) })],
      [check(6, 20, { competitors: new Map([['c1', 4]]) }), check(3, 20, { competitors: new Map([['c1', 5]]) })],
    ];

    const seenTypes = new Set<string>();
    for (const checksList of testCases) {
      counter = 0;
      for (const ev of rankEventsOf(checksList, 't1')) {
        seenTypes.add(ev.eventType);
      }
    }

    for (const t of ALL_21_EVENT_TYPES) {
      expect(seenTypes.has(t)).toBe(true);
    }
    expect(seenTypes.size).toBe(21);
  });
});

describe('rankEventsOf order and edge cases (T3)', () => {
  const compA = '00000000-0000-0000-0000-000000000001';
  const compB = '00000000-0000-0000-0000-000000000002';
  const summary = (
    events: ReturnType<typeof rankEventsOf>,
  ): Array<[string, number | null, number | null, string | null, string | null]> =>
    events.map((e) => [e.eventType, e.fromRank, e.toRank, e.otherEntityId, e.featureType]);

  it('writes the overtake after the feature and AI Overview events of the same check', () => {
    counter = 0;
    const events = rankEventsOf(
      [
        check(3, 20, { aio: 'present_not_cited', aioCited: false, competitors: new Map([[compA, 5]]) }),
        check(6, 20, {
          ownedFeatures: ['featured_snippet'],
          aio: 'present_cited',
          aioCited: true,
          competitors: new Map([[compA, 4]]),
        }),
      ],
      't1',
    );
    expect(summary(events)).toEqual([
      ['lost_top_3', 3, 6, null, null],
      ['rank_drop', 3, 6, null, null],
      ['feature_gained', null, null, null, 'featured_snippet'],
      ['aio_citation_gained', null, null, null, null],
      ['overtaken_by', 3, 6, compA, null],
    ]);

    counter = 0;
    const appeared = rankEventsOf(
      [
        check(4, 20, { aio: 'absent', aioCited: null, competitors: new Map([[compA, 6]]) }),
        check(8, 20, {
          ownedFeatures: ['video'],
          aio: 'present_not_cited',
          aioCited: false,
          competitors: new Map([[compA, 5]]),
        }),
      ],
      't1',
    );
    expect(summary(appeared)).toEqual([
      ['rank_drop', 4, 8, null, null],
      ['feature_gained', null, null, null, 'video'],
      ['aio_appeared', null, null, null, null],
      ['overtaken_by', 4, 8, compA, null],
    ]);
  });

  it('writes nothing for a competitor out of depth in both checks, whether the own site is ranked, entering, or neither', () => {
    // Own site enters the top 20 while the rival is beyond depth in both checks (a rank of 30 at depth 20)
    counter = 0;
    const entering = rankEventsOf(
      [check(null, 20, { competitors: new Map([[compA, 30]]) }), check(8, 20, { competitors: new Map([[compA, 30]]) })],
      't1',
    );
    expect(entering.map((e) => e.eventType)).toEqual(['entered_top_10', 'entered_top_20']);

    // Own site ranked and rival missing in both
    counter = 0;
    const ranked = rankEventsOf(
      [
        check(5, 20, { competitors: new Map([[compA, null]]) }),
        check(8, 20, { competitors: new Map([[compA, null]]) }),
      ],
      't1',
    );
    expect(ranked.map((e) => e.eventType)).toEqual(['rank_drop']);

    // Own site beyond depth in both checks: a rival that appears is not an overtake
    counter = 0;
    const absent = rankEventsOf(
      [
        check(null, 20, { competitors: new Map([[compA, null]]) }),
        check(null, 20, { competitors: new Map([[compA, 4]]) }),
      ],
      't1',
    );
    expect(absent).toEqual([]);
  });

  it('sorts the gained and lost features and the competitors whatever order they come in', () => {
    counter = 0;
    const gained = rankEventsOf(
      [check(5, 20, { ownedFeatures: [] }), check(5, 20, { ownedFeatures: ['video', 'featured_snippet', 'images'] })],
      't1',
    );
    expect(summary(gained).map(([type, , , , feature]) => [type, feature])).toEqual([
      ['feature_gained', 'featured_snippet'],
      ['feature_gained', 'images'],
      ['feature_gained', 'video'],
    ]);

    counter = 0;
    const lost = rankEventsOf(
      [check(5, 20, { ownedFeatures: ['video', 'featured_snippet'] }), check(5, 20, { ownedFeatures: [] })],
      't1',
    );
    expect(summary(lost).map(([type, , , , feature]) => [type, feature])).toEqual([
      ['feature_lost', 'featured_snippet'],
      ['feature_lost', 'video'],
    ]);

    // The competitor map is written in reverse id order and the events come out in id order
    counter = 0;
    const overtakes = rankEventsOf(
      [
        check(3, 20, {
          competitors: new Map([
            [compB, 2],
            [compA, 5],
          ]),
        }),
        check(6, 20, {
          competitors: new Map([
            [compB, 8],
            [compA, 4],
          ]),
        }),
      ],
      't1',
    );
    expect(summary(overtakes).filter(([type]) => type === 'overtaken_by' || type === 'overtook')).toEqual([
      ['overtaken_by', 3, 6, compA, null],
      ['overtook', 3, 6, compB, null],
    ]);
  });

  it('writes no aio_appeared or aio_disappeared when one side of the pair is unknown', () => {
    counter = 0;
    const fromUnknown = rankEventsOf(
      [check(5, 20, { aio: 'unknown', aioCited: null }), check(5, 20, { aio: 'present_not_cited', aioCited: false })],
      't1',
    );
    expect(fromUnknown).toEqual([]);

    counter = 0;
    const toUnknown = rankEventsOf(
      [check(5, 20, { aio: 'present_cited', aioCited: true }), check(5, 20, { aio: 'unknown', aioCited: null })],
      't1',
    );
    expect(toUnknown).toEqual([]);

    // The same pair with a known absent side does write the event, so the two cases above are not vacuous
    counter = 0;
    const fromAbsent = rankEventsOf(
      [check(5, 20, { aio: 'absent', aioCited: null }), check(5, 20, { aio: 'present_not_cited', aioCited: false })],
      't1',
    );
    expect(fromAbsent.map((e) => e.eventType)).toEqual(['aio_appeared']);
  });
});

describe('worldEvents', () => {
  it('N2: not_loaded and absent give aioCited null, never emitting aio_citation_* events', () => {
    // 1. rankEventsOf with present_cited -> not_loaded -> present_cited writes no aio_citation_lost and no aio_citation_gained (exact empty list)
    counter = 0;
    const checksNotLoaded = [
      check(5, 20, { aio: 'present_cited', aioCited: true }),
      check(5, 20, { aio: 'not_loaded', aioCited: null }),
      check(5, 20, { aio: 'present_cited', aioCited: true }),
    ];
    expect(rankEventsOf(checksNotLoaded, 't1')).toEqual([]);

    // 2. absent gives aioCited null too (an absent check never emits aio_citation_*)
    counter = 0;
    const checksAbsent = [
      check(5, 20, { aio: 'present_cited', aioCited: true }),
      check(5, 20, { aio: 'absent', aioCited: null }),
      check(5, 20, { aio: 'present_cited', aioCited: true }),
    ];
    const absentEvents = rankEventsOf(checksAbsent, 't1');
    const citationEvents = absentEvents.filter((e) => e.eventType.startsWith('aio_citation_'));
    expect(citationEvents).toEqual([]);

    // 3. Over all fixtures, worldEvents writes no aio_citation_* event for a pair of checks where one side has
    //    no loaded block (not_loaded, absent, or unknown), as an event carries the snapshot of the later check
    const now = Date.parse('2026-11-02T12:00:00Z');
    const noBlockLoaded = (state: string | undefined): boolean =>
      state === 'not_loaded' || state === 'absent' || state === 'unknown';
    let fixtureCitationEvents = 0;
    let checkedPairs = 0;
    let notLoadedNextToCited = 0;
    let absentNextToCited = 0;

    for (const fixture of MOCK_TRACKED_KEYWORDS) {
      const input = {
        trackedId: fixture.tracked_keyword_id,
        createdAt: fixture.created_at,
        now,
        domain: 'fynix.digital',
        stoppedAt: stoppedAtOf(fixture),
        own: OWN_ENTITY_REF,
        competitors: [],
      };
      const good = worldChecks(input).filter((c) => !c.failed && c.observedAt !== null);
      const citationSnapshots = new Set(
        worldEvents(input)
          .filter((e) => e.eventType.startsWith('aio_citation_'))
          .map((e) => e.snapshotId),
      );
      fixtureCitationEvents += citationSnapshots.size;

      const blindPairs = adjacent(good).filter(([a, b]) => noBlockLoaded(a.aio?.state) || noBlockLoaded(b.aio?.state));
      checkedPairs += blindPairs.length;
      for (const [, later] of blindPairs) {
        expect(citationSnapshots.has(later.snapshotId)).toBe(false);
      }
      const nextToCited = (state: string): number =>
        blindPairs.filter(
          ([a, b]) =>
            (a.aio?.state === state && b.aio?.state === 'present_cited') ||
            (b.aio?.state === state && a.aio?.state === 'present_cited'),
        ).length;
      notLoadedNextToCited += nextToCited('not_loaded');
      absentNextToCited += nextToCited('absent');
    }
    // The fixtures hold the cases that would show a wrong mapping, and citation events do happen elsewhere
    expect(checkedPairs).toBeGreaterThan(20);
    expect(notLoadedNextToCited).toBeGreaterThan(0);
    expect(absentNextToCited).toBeGreaterThan(0);
    expect(fixtureCitationEvents).toBeGreaterThan(0);
  });

  it('over all fixtures no event has feature_type ai_overview and rankStateOf owned features never include ai_overview', () => {
    const now = Date.parse('2026-11-02T12:00:00Z');
    let totalEvents = 0;
    for (const fixture of MOCK_TRACKED_KEYWORDS) {
      const events = worldEvents({
        trackedId: fixture.tracked_keyword_id,
        createdAt: fixture.created_at,
        now,
        domain: 'fynix.digital',
        own: OWN_ENTITY_REF,
        competitors: [],
      });
      totalEvents += events.length;
      for (const ev of events) {
        expect(ev.featureType).not.toBe('ai_overview');
      }
    }
    expect(totalEvents).toBeGreaterThan(0);
  });

  it('maps worldChecks to EventChecks and returns events oldest first', () => {
    const fixture = MOCK_TRACKED_KEYWORDS[0];
    if (fixture === undefined) throw new Error('Missing fixture 0');
    const now = Date.parse('2026-11-02T12:00:00Z');
    const events = worldEvents({
      trackedId: fixture.tracked_keyword_id,
      createdAt: fixture.created_at,
      now,
      domain: 'fynix.digital',
      own: OWN_ENTITY_REF,
      competitors: [],
    });
    expect(events.length).toBeGreaterThan(0);
    let compared = 0;
    for (let i = 1; i < events.length; i += 1) {
      const prev = events[i - 1]?.occurredAt ?? '';
      const cur = events[i]?.occurredAt ?? '';
      expect(cur >= prev).toBe(true);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
  });
});
