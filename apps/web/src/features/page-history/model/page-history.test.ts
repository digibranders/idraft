import { describe, expect, it } from 'vitest';

import { change, HISTORY, VERSIONS } from '../history-fixtures';
import { forgetOpenRows, keepOpenRows, openRows } from './open-state';
import {
  changeLabel,
  googleState,
  headingText,
  historyDate,
  isNewPage,
  lastEditedLine,
  newestContentRun,
  stripCells,
} from './page-history';

describe('changeLabel', () => {
  it.each([
    [change({ type: 'title' }), { key: 'title' }],
    [change({ type: 'description' }), { key: 'description' }],
    [change({ type: 'heading_added', level: 2 }), { key: 'headingAdded' }],
    [change({ type: 'heading_removed', level: 2 }), { key: 'headingRemoved' }],
    [change({ type: 'edited' }), { key: 'edited' }],
    [change({ type: 'words', delta: 40 }), { key: 'wordsGrew', count: 40 }],
    [change({ type: 'words', delta: -7 }), { key: 'wordsShrank', count: 7 }],
    [change({ type: 'words', delta: 0 }), { key: 'edited' }],
    [change({ type: 'words' }), { key: 'edited' }],
    [change({ type: 'links', before: 'all', delta: 3 }), { key: 'linksAdded', count: 3 }],
    [change({ type: 'links', before: 'all', delta: -1 }), { key: 'linksRemoved', count: 1 }],
    [change({ type: 'links', before: 'editorial', delta: 2 }), { key: 'editorialAdded', count: 2 }],
    [change({ type: 'links', before: 'editorial', delta: -4 }), { key: 'editorialRemoved', count: 4 }],
  ])('labels %j as %j', (input, expected) => {
    expect(changeLabel(input)).toEqual(expected);
  });
});

describe('headingText', () => {
  it('reads the new text of an added heading and the old text of a removed one', () => {
    expect(headingText(change({ type: 'heading_added', after: 'New' }))).toBe('New');
    expect(headingText(change({ type: 'heading_removed', before: 'Old' }))).toBe('Old');
    expect(headingText(change({ type: 'title', after: 'T' }))).toBeNull();
  });
});

describe('dates', () => {
  it('writes the date with its year in the project time zone', () => {
    expect(historyDate('2026-11-20T23:30:00Z', 'UTC')).toBe('Nov 20, 2026');
    expect(historyDate('2026-11-20T23:30:00Z', 'Asia/Kolkata')).toBe('Nov 21, 2026');
  });
});

describe('timeline', () => {
  it('opens the newest content change by default and keeps what a person opened per page', () => {
    forgetOpenRows();
    expect(newestContentRun(VERSIONS)).toBe(VERSIONS[0]?.run_id);
    expect([...openRows('1', VERSIONS)]).toEqual([VERSIONS[0]?.run_id]);
    keepOpenRows('1', new Set());
    expect(openRows('1', VERSIONS).size).toBe(0);
    expect(openRows('2', VERSIONS).size).toBe(1);
    forgetOpenRows();
  });

  it('has no row open when there is no content change', () => {
    expect(newestContentRun(VERSIONS.filter((version) => version.kind !== 'content'))).toBeNull();
  });
});

describe('googleState', () => {
  it('is none without Google data or a crawl date, behind or crawled otherwise', () => {
    expect(googleState({ google: null })).toBe('none');
    expect(googleState({ google: { crawled_at: null, behind: false, coverage_state: null } })).toBe('none');
    expect(googleState({ google: { crawled_at: '2026-11-15T10:00:00Z', behind: true, coverage_state: null } })).toBe(
      'behind',
    );
    expect(googleState({ google: { crawled_at: '2026-11-25T10:00:00Z', behind: false, coverage_state: null } })).toBe(
      'crawled',
    );
  });
});

describe('isNewPage', () => {
  it('is true when the page was found after the history started', () => {
    expect(isNewPage({ first_seen: '2026-11-06T00:00:00Z', history_starts: '2026-10-30T00:00:00Z' })).toBe(true);
    expect(isNewPage({ first_seen: '2026-10-30T00:00:00Z', history_starts: '2026-10-30T00:00:00Z' })).toBe(false);
    expect(isNewPage({ first_seen: '2026-10-30T00:00:00Z', history_starts: null })).toBe(false);
  });
});

describe('stripCells', () => {
  it('gives four cells with the declared date, the last change, the first crawl and Google behind', () => {
    const [edited, changed, first, google] = stripCells(HISTORY, 'UTC');
    expect(edited).toMatchObject({ date: 'Nov 18, 2026', note: { key: 'editedFrom', origin: 'json_ld' } });
    expect(changed).toMatchObject({ date: 'Nov 20, 2026', note: { key: 'changeCount', count: 2 } });
    expect(first).toMatchObject({ date: 'Oct 30, 2026', note: { key: 'firstStarts', date: 'Oct 30, 2026' } });
    expect(google).toMatchObject({ date: 'Nov 15, 2026', note: { key: 'googleBefore' }, warn: true });
  });

  it('says None with the reason when there is nothing to show', () => {
    const cells = stripCells(
      {
        ...HISTORY,
        declared: null,
        declared_unreliable: true,
        last_change: null,
        changes: 0,
        google: null,
        first_seen: '2026-11-06T00:00:00Z',
      },
      'UTC',
    );
    expect(cells[0]).toMatchObject({ date: null, note: { key: 'editedUnreliable' } });
    expect(cells[1]).toMatchObject({ date: null, note: { key: 'changeSince', date: 'Oct 30, 2026' } });
    expect(cells[2]?.note).toEqual({ key: 'firstNew' });
    expect(cells[3]).toMatchObject({ date: null, note: { key: 'googleNone' }, warn: false });
  });

  it('marks a Google crawl after the last change as such', () => {
    const cells = stripCells(
      { ...HISTORY, google: { crawled_at: '2026-11-25T10:00:00Z', behind: false, coverage_state: null } },
      'UTC',
    );
    expect(cells[3]).toMatchObject({ note: { key: 'googleAfter' }, warn: false });
  });
});

describe('lastEditedLine', () => {
  it('prefers the declared date, then the last change, then the start of the history', () => {
    expect(lastEditedLine(HISTORY, 'UTC')).toEqual({ kind: 'edited', date: 'Nov 18, 2026' });
    expect(lastEditedLine({ ...HISTORY, declared: null }, 'UTC')).toEqual({ kind: 'changed', date: 'Nov 20, 2026' });
    expect(lastEditedLine({ ...HISTORY, declared: null, last_change: null }, 'UTC')).toEqual({
      kind: 'unchanged',
      date: 'Oct 30, 2026',
    });
  });

  it('says nothing for an unreadable page or when no crawl was kept', () => {
    expect(lastEditedLine({ ...HISTORY, readable: false, why: 'redirect' }, 'UTC')).toBeNull();
    expect(lastEditedLine({ ...HISTORY, declared: null, last_change: null, history_starts: null }, 'UTC')).toBeNull();
  });
});
