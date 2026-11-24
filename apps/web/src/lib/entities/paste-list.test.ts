import { describe, expect, it } from 'vitest';

import { MAX_PASTED, nameFromDomain, readCompetitorList } from './paste-list';

const none = new Set<string>();

describe('nameFromDomain', () => {
  it('capitalizes the first label of the host', () => {
    expect(nameFromDomain('hubspot.com')).toBe('Hubspot');
    expect(nameFromDomain('')).toBe('');
  });
});

describe('reading a pasted list of competitors', () => {
  it('takes a site alone, and names it from the site', () => {
    const { rows, issues } = readCompetitorList('hubspot.com\nhttps://www.pipedrive.com/pricing', none);
    expect(issues).toEqual([]);
    expect(rows.map((row) => [row.line, row.domain, row.name])).toEqual([
      [1, 'hubspot.com', 'Hubspot'],
      [2, 'pipedrive.com', 'Pipedrive'],
    ]);
  });

  it('takes a name and a site in either order, with a comma, a tab or a bar between them', () => {
    const { rows, issues } = readCompetitorList(
      'HubSpot CRM, hubspot.com\npipedrive.com | Pipedrive\nZoho\tzoho.com',
      none,
    );
    expect(issues).toEqual([]);
    expect(rows.map((row) => [row.domain, row.name])).toEqual([
      ['hubspot.com', 'HubSpot CRM'],
      ['pipedrive.com', 'Pipedrive'],
      ['zoho.com', 'Zoho'],
    ]);
  });

  it('skips blank lines and keeps the line numbers of the paste', () => {
    const { rows } = readCompetitorList('\n\nhubspot.com\r\n\r\nzoho.com\n', none);
    expect(rows.map((row) => row.line)).toEqual([3, 5]);
  });

  it('refuses a line that is no site, with the reason', () => {
    const { rows, issues } = readCompetitorList('hubspot.com\nnot a site\nlocalhost\na, b, c', none);
    expect(rows.map((row) => row.domain)).toEqual(['hubspot.com']);
    expect(issues.map((issue) => [issue.line, issue.problem.kind])).toEqual([
      [2, 'domain'],
      [3, 'domain'],
      [4, 'format'],
    ]);
  });

  it('refuses a site that is repeated in the list or that the project already has', () => {
    const { rows, issues } = readCompetitorList(
      'hubspot.com\nwww.hubspot.com\nzoho.com\npipedrive.com',
      new Set(['zoho.com']),
    );
    expect(rows.map((row) => row.domain)).toEqual(['hubspot.com', 'pipedrive.com']);
    expect(issues.map((issue) => [issue.line, issue.problem.kind])).toEqual([
      [2, 'duplicate'],
      [3, 'alreadyTracked'],
    ]);
  });

  it('refuses a name past the API limit', () => {
    const { rows, issues } = readCompetitorList(`${'a'.repeat(201)}, hubspot.com`, none);
    expect(rows).toEqual([]);
    expect(issues[0]?.problem.kind).toBe('nameTooLong');
  });

  it('reads at most the first MAX_PASTED competitors and says so for the rest', () => {
    const text = Array.from({ length: MAX_PASTED + 2 }, (_, index) => `site${String(index)}.com`).join('\n');
    const { rows, issues } = readCompetitorList(text, none);
    expect(rows).toHaveLength(MAX_PASTED);
    expect(issues.map((issue) => issue.problem.kind)).toEqual(['tooMany', 'tooMany']);
  });
});
