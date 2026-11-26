import { describe, expect, it } from 'vitest';

import { parseIssuesSearch, tabOfApi } from './url-state';
import type { IssueCheck } from './types';

const check = (id: IssueCheck['id'], tab: IssueCheck['tab']): IssueCheck => ({
  id,
  tab,
  category: 'status',
  severity: 'error',
  found_by: 'crawl',
  state: 'ran',
  reason: null,
  pages: 1,
  clicks: null,
  example_path: null,
});

describe('parseIssuesSearch', () => {
  it('reads an empty address as the defaults', () => {
    expect(parseIssuesSearch({})).toEqual({
      tab: 'technical',
      check: null,
      severity: 'all',
      by: 'all',
      q: '',
      showPassed: true,
      sort: null,
    });
  });

  it('reads every key', () => {
    expect(
      parseIssuesSearch({
        tab: 'on-page',
        check: 'title-long',
        severity: 'notice',
        by: 'gsc',
        q: 'title',
        passed: 'hide',
        sort: '-clicks',
      }),
    ).toEqual({
      tab: 'on-page',
      check: 'title-long',
      severity: 'notice',
      by: 'gsc',
      q: 'title',
      showPassed: false,
      sort: '-clicks',
    });
  });

  it('falls back to the default for an unknown tab, severity, found by, check, sort or passed', () => {
    const state = parseIssuesSearch({
      tab: 'speed',
      check: 'no-such-check',
      severity: 'critical',
      by: 'ga4',
      sort: 'colour',
      passed: 'show',
    });
    expect(state).toMatchObject({
      tab: 'technical',
      check: null,
      severity: 'all',
      by: 'all',
      sort: null,
      showPassed: true,
    });
  });

  it('treats null and empty values as no choice', () => {
    expect(parseIssuesSearch({ tab: null, check: '', q: null, sort: undefined })).toMatchObject({
      tab: 'technical',
      check: null,
      q: '',
      sort: null,
    });
  });

  it('cuts the search at 200 characters and keeps it as typed', () => {
    expect(parseIssuesSearch({ q: 'x'.repeat(250) }).q).toBe('x'.repeat(200));
    expect(parseIssuesSearch({ q: '  spaced out ' }).q).toBe('  spaced out ');
  });

  it('cuts the search at 200 code points, so an emoji is never split', () => {
    const emoji = String.fromCodePoint(0x1f600);
    expect(parseIssuesSearch({ q: `${'a'.repeat(199)}${emoji}` }).q).toBe(`${'a'.repeat(199)}${emoji}`);
    expect(parseIssuesSearch({ q: `${'a'.repeat(200)}${emoji}` }).q).toBe('a'.repeat(200));
  });

  it('lets the tab of a check win over the tab of the address', () => {
    const checks = [check('status-4xx', 'technical'), check('title-long', 'on_page')];
    expect(parseIssuesSearch({ tab: 'technical', check: 'title-long' }, checks).tab).toBe('on-page');
    expect(parseIssuesSearch({ tab: 'on-page', check: 'status-4xx' }, checks).tab).toBe('technical');
  });

  it('keeps the tab when no list of checks is given or the check is not in it', () => {
    expect(parseIssuesSearch({ tab: 'technical', check: 'title-long' }).tab).toBe('technical');
    expect(parseIssuesSearch({ tab: 'technical', check: 'title-long' }, [check('status-4xx', 'technical')]).tab).toBe(
      'technical',
    );
  });
});

describe('tabOfApi', () => {
  it('writes the tab as the address does', () => {
    expect(tabOfApi('technical')).toBe('technical');
    expect(tabOfApi('on_page')).toBe('on-page');
  });
});
