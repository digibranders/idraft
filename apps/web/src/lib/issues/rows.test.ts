import { describe, expect, it } from 'vitest';

import { groupByCategory, SEVERITY_ORDER, tabCounts, visibleChecks } from './rows';
import type { IssueCheck } from './types';
import { parseIssuesSearch, type IssuesState } from './url-state';

const make = (patch: Partial<IssueCheck> & Pick<IssueCheck, 'id'>): IssueCheck => ({
  tab: 'technical',
  category: 'status',
  severity: 'error',
  found_by: 'crawl',
  state: 'ran',
  reason: null,
  pages: 1,
  clicks: null,
  example_path: null,
  ...patch,
});

/** Six checks in catalogue order, across both tabs and three categories. */
const CHECKS: readonly IssueCheck[] = [
  make({ id: 'status-4xx', category: 'status', severity: 'error', pages: 3 }),
  make({ id: 'status-5xx', category: 'status', severity: 'error', pages: 12 }),
  make({ id: 'redirect-pages', category: 'redirects', severity: 'notice', pages: 5 }),
  make({ id: 'redirect-broken', category: 'redirects', severity: 'error', pages: 0 }),
  make({
    id: 'clicks-page-broken',
    category: 'redirects',
    severity: 'error',
    found_by: 'gsc',
    state: 'not_run',
    reason: 'source_not_connected',
    pages: null,
  }),
  make({ id: 'title-long', tab: 'on_page', category: 'titles', severity: 'notice', pages: 7 }),
];

const NAMES: Readonly<Record<string, string>> = {
  'status-4xx': 'Pages that return a 4xx error',
  'status-5xx': 'Pages that return a 5xx error',
  'redirect-pages': 'Addresses that redirect',
  'redirect-broken': 'Redirects to a broken page',
  'clicks-page-broken': 'Broken pages with Google clicks',
  'title-long': 'Titles over 60 characters',
};
const CATEGORIES: Readonly<Record<string, string>> = {
  status: 'Status',
  redirects: 'Redirects',
  titles: 'Titles',
};
const options = {
  nameOf: (item: IssueCheck): string => NAMES[item.id] ?? '',
  categoryNameOf: (item: IssueCheck): string => CATEGORIES[item.category] ?? '',
};
const stateOf = (address: Record<string, string>): IssuesState => parseIssuesSearch(address);
const idsOf = (checks: readonly IssueCheck[]): string[] => checks.map((item) => item.id);

describe('SEVERITY_ORDER', () => {
  it('puts errors first', () => {
    expect(SEVERITY_ORDER).toEqual({ error: 0, warning: 1, notice: 2 });
  });
});

describe('visibleChecks', () => {
  it('keeps the checks of one tab', () => {
    expect(idsOf(visibleChecks(CHECKS, stateOf({}), options))).not.toContain('title-long');
    expect(idsOf(visibleChecks(CHECKS, stateOf({ tab: 'on-page' }), options))).toEqual(['title-long']);
  });

  it('orders a category by severity, then pages, with the checks that did not run last', () => {
    // In redirects: the two errors come before the notice, and the error that did not run comes after the one that passed
    expect(idsOf(visibleChecks(CHECKS, stateOf({}), options))).toEqual([
      'status-5xx',
      'status-4xx',
      'redirect-broken',
      'clicks-page-broken',
      'redirect-pages',
    ]);
  });

  it('keeps a category together, in the order of the catalogue', () => {
    const mixed = [
      make({ id: 'status-4xx', category: 'status' }),
      make({ id: 'redirect-pages', category: 'redirects' }),
      make({ id: 'status-5xx', category: 'status' }),
    ];
    expect(idsOf(visibleChecks(mixed, stateOf({}), options))).toEqual(['status-4xx', 'status-5xx', 'redirect-pages']);
  });

  it('filters by severity', () => {
    expect(idsOf(visibleChecks(CHECKS, stateOf({ severity: 'notice' }), options))).toEqual(['redirect-pages']);
  });

  it('filters by where the check is found', () => {
    expect(idsOf(visibleChecks(CHECKS, stateOf({ by: 'gsc' }), options))).toEqual(['clicks-page-broken']);
    expect(visibleChecks(CHECKS, stateOf({ by: 'ai' }), options)).toEqual([]);
  });

  it('finds a search in the translated name or the category name, ignoring case and outer spaces', () => {
    expect(idsOf(visibleChecks(CHECKS, stateOf({ q: ' 5XX ' }), options))).toEqual(['status-5xx']);
    expect(idsOf(visibleChecks(CHECKS, stateOf({ q: 'redirect' }), options))).toEqual([
      'redirect-broken',
      'clicks-page-broken',
      'redirect-pages',
    ]);
  });

  it('hides the checks with no page when passed checks are hidden, and keeps a check that did not run', () => {
    expect(idsOf(visibleChecks(CHECKS, stateOf({ passed: 'hide' }), options))).toEqual([
      'status-5xx',
      'status-4xx',
      'clicks-page-broken',
      'redirect-pages',
    ]);
  });

  it('does not change the list it is given', () => {
    const before = idsOf(CHECKS);
    visibleChecks(CHECKS, stateOf({}), options);
    expect(idsOf(CHECKS)).toEqual(before);
  });
});

describe('groupByCategory', () => {
  it('groups checks in the order the categories first appear', () => {
    const groups = groupByCategory(visibleChecks(CHECKS, stateOf({}), options));
    expect(groups.map((group) => group.category)).toEqual(['status', 'redirects']);
    expect(idsOf(groups[1]?.checks ?? [])).toEqual(['redirect-broken', 'clicks-page-broken', 'redirect-pages']);
  });

  it('returns no group for no check', () => {
    expect(groupByCategory([])).toEqual([]);
  });
});

describe('tabCounts', () => {
  it('counts the checks that ran and found at least one page, per tab', () => {
    expect(tabCounts(CHECKS)).toEqual({ technical: 3, 'on-page': 1 });
  });

  it('counts nothing for no check', () => {
    expect(tabCounts([])).toEqual({ technical: 0, 'on-page': 0 });
  });
});
