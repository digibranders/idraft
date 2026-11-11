import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_TERM_IDS, MOCK_TERMS } from '../entity-fixtures';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { MOCK_GROUP_IDS, MOCK_GROUP_MEMBERS, MOCK_KEYWORD_GROUPS, MOCK_TERM_LINKS } from '../keyword-fixtures';
import { KEYWORD_TABLE } from '../keyword-table';
import { mockId } from '../mock-ids';
import { clearManualChecks, recordManualCheck } from '../serp-world';
import { RANK_EVENT_PAGE, RANK_HISTORY } from '@/test/api-shapes';
import { dataOf, fieldCodes, mockBrowser, type MockBrowser } from '@/test/mock-api';
import type { Schemas } from '@/lib/api/types';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix] = MOCK_PROJECTS;
if (!fynix) throw new Error('The Fynix project fixture is missing');
const P = `${W}/projects/${fynix.project_id}`;

const trackedId = (text: string): string => {
  const index = KEYWORD_TABLE.findIndex(
    (row) => row.text === text && row.location === 2276 && row.device === 'desktop',
  );
  if (index < 0) throw new Error(`No fixture row for ${text}`);
  return mockId('tracked', index + 1);
};

type RankEvent = Schemas['RankEventOut'];

/** Every event the route answers for `query`, following the cursor to the end. */
const collectEvents = async (browser: MockBrowser, query: string): Promise<RankEvent[]> => {
  const rows: RankEvent[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const cursorQuery: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
    const res = await browser.call('GET', `${P}/seo/rank-events?${query}&limit=200${cursorQuery}`);
    expect(res.status).toBe(200);
    const page = RANK_EVENT_PAGE.parse(res.body);
    rows.push(...page.data);
    cursor = page.page.next_cursor;
    pages += 1;
  } while (cursor !== null && pages < 50);
  expect(cursor).toBeNull();
  return rows;
};

const adjacent = <T>(rows: readonly T[]): Array<[T, T]> => {
  const pairs: Array<[T, T]> = [];
  let previous: T | undefined;
  for (const row of rows) {
    if (previous !== undefined) pairs.push([previous, row]);
    previous = row;
  }
  return pairs;
};

const idsOf = (events: readonly RankEvent[]): string[] => events.map((e) => e.rank_event_id);

/** The group with the groups below it, from the fixtures. */
const groupFamily = (root: string): Set<string> => {
  const family = new Set([root]);
  for (const group of MOCK_KEYWORD_GROUPS) {
    if (group.parent_id !== null && family.has(group.parent_id)) family.add(group.group_id);
  }
  return family;
};

/** The term with the terms below it, from the fixtures. */
const termFamily = (root: string): Set<string> => {
  const family = new Set([root]);
  for (const term of MOCK_TERMS) {
    if (term.parent_id !== null && term.parent_id !== undefined && family.has(term.parent_id)) {
      family.add(term.term_id);
    }
  }
  return family;
};

/** `from` and `to` that cover exactly `days` project local days ending on `to`. */
const windowOf = (to: string, days: number): string => {
  const first = new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86_400_000);
  return `from=${first.toISOString().slice(0, 10)}&to=${to}`;
};

describe('Rank events route', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T15:00:00Z'));
    clearManualChecks();
  });

  afterEach(() => {
    clearManualChecks();
    vi.useRealTimers();
  });

  it('answers keyword events newest first with own entity, snapshot id matching rank history, and URL refs on url_changed', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');

    const historyRes = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?include=url`);
    expect(historyRes.status).toBe(200);
    const history = dataOf(historyRes, RANK_HISTORY);
    const historySnapshotIds = new Set(
      (history.series?.[0]?.points ?? []).map((p) => p.serp_snapshot_id).filter((s): s is string => s !== null),
    );

    const res = await browser.call('GET', `${P}/seo/rank-events?filter[tracked_keyword_id]=${id}`);
    expect(res.status).toBe(200);
    const page = RANK_EVENT_PAGE.parse(res.body);
    expect(page.data.length).toBeGreaterThan(0);

    for (const event of page.data) {
      expect(event.entity.role).toBe('own');
      expect(event.tracked_keyword_id).toBe(id);
      expect(event.keyword).toBe('seo agency berlin');
      expect(historySnapshotIds.has(event.serp_snapshot_id)).toBe(true);
    }
    const pairs = adjacent(page.data);
    expect(pairs.length).toBeGreaterThan(0);
    for (const [prev, event] of pairs) {
      expect(prev.occurred_at >= event.occurred_at).toBe(true);
    }

    const urlRes = await browser.call('GET', `${P}/seo/rank-events?filter[event_type_in]=url_changed`);
    expect(urlRes.status).toBe(200);
    const urlPage = RANK_EVENT_PAGE.parse(urlRes.body);
    expect(urlPage.data.length).toBeGreaterThan(0);
    for (const ev of urlPage.data) {
      expect(ev.from_url?.canonical_url).toMatch(/^https:\/\/\S+$/);
      expect(ev.from_url?.host).toMatch(/\S/);
      expect(ev.to_url?.canonical_url).toMatch(/^https:\/\/\S+$/);
      expect(ev.to_url?.host).toMatch(/\S/);
    }
  });

  it('sorts events with identical timestamps by numeric BigInt rank_event_id descending', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');

    const res = await browser.call('GET', `${P}/seo/rank-events?filter[tracked_keyword_id]=${id}&limit=100`);
    expect(res.status).toBe(200);
    const page = RANK_EVENT_PAGE.parse(res.body);

    const sameTimestamp = adjacent(page.data).filter(([prev, cur]) => prev.occurred_at === cur.occurred_at);
    expect(sameTimestamp.length).toBeGreaterThan(0);
    for (const [prev, cur] of sameTimestamp) {
      expect(BigInt(prev.rank_event_id) > BigInt(cur.rank_event_id)).toBe(true);
    }
  });

  it('respects project-local date bounds near midnight UTC on Europe/Berlin (I4)', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');

    // 2026-11-02T23:30:00Z is 2026-11-03 00:30:00 in Europe/Berlin (UTC+1)
    const checkTime = Date.parse('2026-11-02T23:30:00Z');
    recordManualCheck(id, checkTime);
    vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));

    // from=to=2026-11-03: MUST return the event from the check at 23:30Z
    const resLocalNextDay = await browser.call(
      'GET',
      `${P}/seo/rank-events?filter[tracked_keyword_id]=${id}&from=2026-11-03&to=2026-11-03`,
    );
    expect(resLocalNextDay.status).toBe(200);
    const pageNextDay = RANK_EVENT_PAGE.parse(resLocalNextDay.body);
    const nextDayEvent = pageNextDay.data.find((e) => e.occurred_at === '2026-11-02T23:30:00.000Z');
    expect(nextDayEvent).not.toBeUndefined();

    // from=to=2026-11-02: MUST NOT return the event from the check at 23:30Z
    const resLocalPrevDay = await browser.call(
      'GET',
      `${P}/seo/rank-events?filter[tracked_keyword_id]=${id}&from=2026-11-02&to=2026-11-02`,
    );
    expect(resLocalPrevDay.status).toBe(200);
    const pagePrevDay = RANK_EVENT_PAGE.parse(resLocalPrevDay.body);
    const prevDayEvent = pagePrevDay.data.find((e) => e.occurred_at === '2026-11-02T23:30:00.000Z');
    expect(prevDayEvent).toBeUndefined();

    // Same test for rank-history include=events
    const resHistoryNextDay = await browser.call(
      'GET',
      `${P}/tracked-keywords/${id}/rank-history?include=events&from=2026-11-03&to=2026-11-03`,
    );
    expect(resHistoryNextDay.status).toBe(200);
    const historyNextDay = dataOf(resHistoryNextDay, RANK_HISTORY);
    const historyNextDayEvents = historyNextDay.events ?? [];
    const foundInHistory = historyNextDayEvents.find((e) => e.occurred_at === '2026-11-02T23:30:00.000Z');
    expect(foundInHistory).not.toBeUndefined();

    const resHistoryPrevDay = await browser.call(
      'GET',
      `${P}/tracked-keywords/${id}/rank-history?include=events&from=2026-11-02&to=2026-11-02`,
    );
    expect(resHistoryPrevDay.status).toBe(200);
    const historyPrevDay = dataOf(resHistoryPrevDay, RANK_HISTORY);
    const historyPrevDayEvents = historyPrevDay.events ?? [];
    const notInHistory = historyPrevDayEvents.find((e) => e.occurred_at === '2026-11-02T23:30:00.000Z');
    expect(notInHistory).toBeUndefined();
  });

  it('validates 422 for malformed from/to, range_invalid, and non-UUID filters (M2)', async () => {
    const browser = mockBrowser('viewer');

    // Malformed from/to gives 422 date_from_datetime_parsing
    const resBadFrom = await browser.call('GET', `${P}/seo/rank-events?from=not-a-date`);
    expect(resBadFrom.status).toBe(422);
    expect(fieldCodes(resBadFrom)).toContain('from:date_from_datetime_parsing');

    const resBadTo = await browser.call('GET', `${P}/seo/rank-events?to=garbage`);
    expect(resBadTo.status).toBe(422);
    expect(fieldCodes(resBadTo)).toContain('to:date_from_datetime_parsing');

    // from > to gives 422 range_invalid
    const resInverted = await browser.call('GET', `${P}/seo/rank-events?from=2026-11-05&to=2026-11-01`);
    expect(resInverted.status).toBe(422);
    expect(fieldCodes(resInverted)).toContain('from:range_invalid');

    // Non-UUID query params gives 422 uuid_parsing with location query
    const resBadKwId = await browser.call('GET', `${P}/seo/rank-events?filter[tracked_keyword_id]=non-uuid`);
    expect(resBadKwId.status).toBe(422);
    expect(fieldCodes(resBadKwId)).toContain('filter[tracked_keyword_id]:uuid_parsing');

    const resBadEntityId = await browser.call('GET', `${P}/seo/rank-events?filter[entity_id]=bad-uuid`);
    expect(resBadEntityId.status).toBe(422);
    expect(fieldCodes(resBadEntityId)).toContain('filter[entity_id]:uuid_parsing');

    const resBadGroup = await browser.call('GET', `${P}/seo/rank-events?filter[group]=not-uuid`);
    expect(resBadGroup.status).toBe(422);
    expect(fieldCodes(resBadGroup)).toContain('filter[group]:uuid_parsing');

    const resBadTerm = await browser.call('GET', `${P}/seo/rank-events?filter[term]=not-uuid`);
    expect(resBadTerm.status).toBe(422);
    expect(fieldCodes(resBadTerm)).toContain('filter[term]:uuid_parsing');
  });

  it('filter[entity_id] filters events matching the entity', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');

    const allRes = await browser.call('GET', `${P}/seo/rank-events?filter[tracked_keyword_id]=${id}`);
    expect(allRes.status).toBe(200);
    const allPage = RANK_EVENT_PAGE.parse(allRes.body);

    const overtakeEvent = allPage.data.find((e) => e.other_entity !== null);
    expect(overtakeEvent).not.toBeUndefined();
    const otherEntityId = overtakeEvent?.other_entity?.entity_id ?? '';
    expect(otherEntityId).toBeTruthy();

    const filteredRes = await browser.call(
      'GET',
      `${P}/seo/rank-events?filter[tracked_keyword_id]=${id}&filter[entity_id]=${otherEntityId}`,
    );
    expect(filteredRes.status).toBe(200);
    const filteredPage = RANK_EVENT_PAGE.parse(filteredRes.body);
    expect(filteredPage.data.length).toBeGreaterThan(0);
    for (const ev of filteredPage.data) {
      const match = ev.entity.entity_id === otherEntityId || ev.other_entity?.entity_id === otherEntityId;
      expect(match).toBe(true);
    }
  });

  it('filter[event_type_in] returns only matching types, and unknown type returns empty page', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');

    const res = await browser.call(
      'GET',
      `${P}/seo/rank-events?filter[tracked_keyword_id]=${id}&filter[event_type_in]=rank_gain,rank_drop`,
    );
    expect(res.status).toBe(200);
    const page = RANK_EVENT_PAGE.parse(res.body);
    expect(page.data.length).toBeGreaterThan(0);
    for (const event of page.data) {
      expect(['rank_gain', 'rank_drop']).toContain(event.event_type);
    }

    const resUnknown = await browser.call(
      'GET',
      `${P}/seo/rank-events?filter[tracked_keyword_id]=${id}&filter[event_type_in]=unknown_nonexistent_type`,
    );
    expect(resUnknown.status).toBe(200);
    const pageUnknown = RANK_EVENT_PAGE.parse(resUnknown.body);
    expect(pageUnknown.data).toHaveLength(0);
    expect(pageUnknown.page.has_more).toBe(false);
  });

  it('pages with cursor, refuses reused cursor with different filters, and rejects invalid limits', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');

    const page1Res = await browser.call('GET', `${P}/seo/rank-events?filter[tracked_keyword_id]=${id}&limit=2`);
    expect(page1Res.status).toBe(200);
    const page1 = RANK_EVENT_PAGE.parse(page1Res.body);
    expect(page1.data).toHaveLength(2);
    expect(page1.page.has_more).toBe(true);
    expect(page1.page.next_cursor).not.toBeNull();

    const cursor = page1.page.next_cursor ?? '';
    const page2Res = await browser.call(
      'GET',
      `${P}/seo/rank-events?filter[tracked_keyword_id]=${id}&limit=2&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(page2Res.status).toBe(200);
    const page2 = RANK_EVENT_PAGE.parse(page2Res.body);
    expect(page2.data).toHaveLength(2);

    const ids1 = new Set(page1.data.map((e) => e.rank_event_id));
    for (const e2 of page2.data) {
      expect(ids1.has(e2.rank_event_id)).toBe(false);
    }

    // Reusing cursor with different filter returns 400 invalid_cursor
    const invalidCursorRes = await browser.call(
      'GET',
      `${P}/seo/rank-events?filter[tracked_keyword_id]=${id}&filter[event_type_in]=rank_gain&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(invalidCursorRes.status).toBe(400);
    expect(invalidCursorRes.code).toBe('invalid_cursor');
    expect(invalidCursorRes.body.title).toBe('Cursor is not valid');

    // Limit 0 and 201 are 422
    const resLimit0 = await browser.call('GET', `${P}/seo/rank-events?limit=0`);
    expect(resLimit0.status).toBe(422);
    expect(fieldCodes(resLimit0)).toEqual(['limit:value_error']);

    const resLimit201 = await browser.call('GET', `${P}/seo/rank-events?limit=201`);
    expect(resLimit201.status).toBe(422);
    expect(fieldCodes(resLimit201)).toEqual(['limit:value_error']);
  });

  it('from/to as dates are project local days with to included, and timestamps are instants', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');

    const resDate = await browser.call(
      'GET',
      `${P}/seo/rank-events?filter[tracked_keyword_id]=${id}&from=2026-10-01&to=2026-10-15`,
    );
    expect(resDate.status).toBe(200);
    const pageDate = RANK_EVENT_PAGE.parse(resDate.body);
    expect(pageDate.data.length).toBeGreaterThan(0);
    for (const event of pageDate.data) {
      expect(event.occurred_at >= '2026-10-01T00:00:00Z').toBe(true);
      expect(event.occurred_at < '2026-10-16T00:00:00Z').toBe(true);
    }

    const resInstant = await browser.call(
      'GET',
      `${P}/seo/rank-events?filter[tracked_keyword_id]=${id}&from=2026-10-05T00:00:00Z&to=2026-10-10T12:00:00Z`,
    );
    expect(resInstant.status).toBe(200);
    const pageInstant = RANK_EVENT_PAGE.parse(resInstant.body);
    expect(pageInstant.data.length).toBeGreaterThan(0);
    for (const event of pageInstant.data) {
      expect(event.occurred_at >= '2026-10-05T00:00:00Z').toBe(true);
      expect(event.occurred_at <= '2026-10-10T12:00:00Z').toBe(true);
    }
  });

  it('viewer can read, billing gets 403, and unknown keyword uuid returns empty page', async () => {
    const id = trackedId('seo agency berlin');
    const viewer = mockBrowser('viewer');
    const viewerRes = await viewer.call('GET', `${P}/seo/rank-events?filter[tracked_keyword_id]=${id}`);
    expect(viewerRes.status).toBe(200);

    const billing = mockBrowser('billing');
    const billingRes = await billing.call('GET', `${P}/seo/rank-events?filter[tracked_keyword_id]=${id}`);
    expect(billingRes.status).toBe(403);

    const unknownUuid = '00000000-0000-0000-0000-000000000000';
    const unknownRes = await viewer.call('GET', `${P}/seo/rank-events?filter[tracked_keyword_id]=${unknownUuid}`);
    expect(unknownRes.status).toBe(200);
    const unknownPage = RANK_EVENT_PAGE.parse(unknownRes.body);
    expect(unknownPage.data).toHaveLength(0);
  });

  it('T1: include=events on rank-history is the events route events of the window, for the returned entities only', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');
    const window = 'from=2026-10-12&to=2026-10-24';

    const toHistoryEvent = (e: RankEvent) => ({
      rank_event_id: e.rank_event_id,
      occurred_at: e.occurred_at,
      event_type: e.event_type,
      entity_id: e.entity.entity_id,
      from_rank: e.from_rank,
      to_rank: e.to_rank,
    });
    const byId = (a: { rank_event_id: string }, b: { rank_event_id: string }): number =>
      a.rank_event_id.localeCompare(b.rank_event_id);

    const inWindow = await collectEvents(browser, `filter[tracked_keyword_id]=${id}&${window}`);
    expect(inWindow.length).toBeGreaterThan(3);
    const expected = inWindow.map(toHistoryEvent).sort(byId);

    const historyRes = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?include=events&${window}`);
    expect(historyRes.status).toBe(200);
    const history = dataOf(historyRes, RANK_HISTORY);
    expect([...(history.events ?? [])].sort(byId)).toEqual(expected);

    // The events of the keyword outside the window are not in the history
    const everything = await collectEvents(browser, `filter[tracked_keyword_id]=${id}`);
    const inWindowIds = new Set(idsOf(inWindow));
    const outside = everything.filter((e) => !inWindowIds.has(e.rank_event_id));
    expect(outside.length).toBeGreaterThan(0);
    const historyIds = new Set((history.events ?? []).map((e) => e.rank_event_id));
    for (const event of outside) {
      expect(historyIds.has(event.rank_event_id)).toBe(false);
    }

    // Only a competitor is asked for: the events belong to the own site, so none is returned
    const competitor = history.series?.find((s) => s.entity.role === 'competitor')?.entity.entity_id ?? '';
    expect(competitor).toMatch(/^[0-9a-f-]{36}$/);
    const competitorRes = await browser.call(
      'GET',
      `${P}/tracked-keywords/${id}/rank-history?include=events&${window}&entity_ids=${competitor}`,
    );
    expect(dataOf(competitorRes, RANK_HISTORY).events).toEqual([]);

    const ownRes = await browser.call(
      'GET',
      `${P}/tracked-keywords/${id}/rank-history?include=events&${window}&entity_ids=own`,
    );
    expect([...(dataOf(ownRes, RANK_HISTORY).events ?? [])].sort(byId)).toEqual(expected);

    // Without include=events there is no member
    const plain = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?${window}`);
    expect(dataOf(plain, RANK_HISTORY).events).toBeNull();
  });

  it('T2: filter[group] and filter[term] keep the events of the keywords in the group or term, with the ones below', async () => {
    const browser = mockBrowser('viewer');
    const everything = await collectEvents(browser, 'from=2026-08-05&to=2026-11-02');
    expect(everything.length).toBeGreaterThan(100);

    const membersOfGroups = (groups: Set<string>): Set<string> =>
      new Set(MOCK_GROUP_MEMBERS.filter((m) => groups.has(m.group_id)).map((m) => m.tracked_keyword_id));
    const linksOfTerms = (terms: Set<string>): Set<string> =>
      new Set(MOCK_TERM_LINKS.filter((l) => terms.has(l.term_id)).map((l) => l.tracked_keyword_id));

    const cases: Array<[string, string, Set<string>]> = [
      ['filter[group]', MOCK_GROUP_IDS.local, membersOfGroups(groupFamily(MOCK_GROUP_IDS.local))],
      ['filter[group]', MOCK_GROUP_IDS.services, membersOfGroups(groupFamily(MOCK_GROUP_IDS.services))],
      ['filter[term]', MOCK_TERM_IDS.localSeo, linksOfTerms(termFamily(MOCK_TERM_IDS.localSeo))],
      ['filter[term]', MOCK_TERM_IDS.seo, linksOfTerms(termFamily(MOCK_TERM_IDS.seo))],
    ];
    expect(groupFamily(MOCK_GROUP_IDS.services).size).toBe(3);
    expect(termFamily(MOCK_TERM_IDS.seo).size).toBe(3);

    for (const [name, value, keywordIds] of cases) {
      const expected = everything.filter((e) => keywordIds.has(e.tracked_keyword_id));
      // Something is kept and something is left out, so a filter that does nothing is seen
      expect(expected.length).toBeGreaterThan(0);
      expect(everything.length - expected.length).toBeGreaterThan(0);
      const actual = await collectEvents(browser, `from=2026-08-05&to=2026-11-02&${name}=${value}`);
      expect(idsOf(actual)).toEqual(idsOf(expected));
    }
  });

  it('T2: a window of exactly 90 days is answered, 91 days is 422 window_too_large, and a keyword filter has no bound', async () => {
    const browser = mockBrowser('viewer');

    const exactly90 = await browser.call('GET', `${P}/seo/rank-events?${windowOf('2026-11-01', 90)}`);
    expect(exactly90.status).toBe(200);

    const over = await browser.call('GET', `${P}/seo/rank-events?${windowOf('2026-11-01', 91)}`);
    expect(over.status).toBe(422);
    expect(over.code).toBe('window_too_large');
    expect(over.body.limit_days).toBe(90);
    expect(over.body.title).toBe('The window is too large');

    const id = trackedId('seo agency berlin');
    const withKeyword = await browser.call(
      'GET',
      `${P}/seo/rank-events?filter[tracked_keyword_id]=${id}&${windowOf('2026-11-01', 120)}`,
    );
    expect(withKeyword.status).toBe(200);
    expect(RANK_EVENT_PAGE.parse(withKeyword.body).data.length).toBeGreaterThan(0);
  });

  it('T8: 30 event types are accepted and 31 are 422 too_long, as the backend list parameter says', async () => {
    const browser = mockBrowser('viewer');
    const types = (n: number): string => Array.from({ length: n }, (_, i) => `type_${String(i)}`).join(',');

    const thirty = await browser.call('GET', `${P}/seo/rank-events?filter[event_type_in]=${types(30)}`);
    expect(thirty.status).toBe(200);

    const thirtyOne = await browser.call('GET', `${P}/seo/rank-events?filter[event_type_in]=${types(31)}`);
    expect(thirtyOne.status).toBe(422);
    expect(fieldCodes(thirtyOne)).toEqual(['filter[event_type_in]:too_long']);
  });

  it('PERF: the local day bounds are instants, so an event on the last millisecond of a Berlin day stays in that day', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');

    // 2026-11-02T22:59:59.999Z is the last millisecond of 2026-11-02 in Europe/Berlin (UTC+1)
    recordManualCheck(id, Date.parse('2026-11-02T22:59:59.999Z'));
    vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
    const lastMs = await collectEvents(browser, `filter[tracked_keyword_id]=${id}&from=2026-11-02&to=2026-11-02`);
    expect(lastMs.filter((e) => e.occurred_at === '2026-11-02T22:59:59.999Z').length).toBeGreaterThan(0);

    // One millisecond later it is the next day
    clearManualChecks();
    recordManualCheck(id, Date.parse('2026-11-02T23:00:00.000Z'));
    const nextDay = await collectEvents(browser, `filter[tracked_keyword_id]=${id}&from=2026-11-03&to=2026-11-03`);
    expect(nextDay.filter((e) => e.occurred_at === '2026-11-02T23:00:00.000Z').length).toBeGreaterThan(0);
    const sameDay = await collectEvents(browser, `filter[tracked_keyword_id]=${id}&from=2026-11-02&to=2026-11-02`);
    expect(sameDay.filter((e) => e.occurred_at === '2026-11-02T23:00:00.000Z')).toEqual([]);
  });
});
