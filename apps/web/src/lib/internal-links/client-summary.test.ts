import { describe, expect, it } from 'vitest';

import messages from '../../../messages/en.json';

import { clientSummaryHtml, type ClientSummaryInput, type ClientSummaryWords } from './client-summary';

const words: ClientSummaryWords = {
  title: (host) => `Internal links summary for ${host}`,
  crawlLine: (when, pages) => `Crawl of ${when}, ${pages} pages.`,
  tiersHeading: 'Tiers',
  tiersHead: ['Tier', 'Pages', 'Share of pages', 'Average depth'],
  flowHeading: 'Links between tiers',
  flowNote: 'Editorial links, one per pair of pages. Rows link to columns.',
  flowFrom: 'From',
  flowTo: (code) => `To ${code}`,
  worklistsHeading: 'Open worklists',
  worklistsHead: ['Worklist', 'Pages'],
  worklistsNone: 'No worklist has pages in this crawl.',
  lostHeading: (tiers) => `Lost editorial links to ${tiers} pages`,
  lostHead: ['Source page', 'Target page', 'Anchor'],
  lostNone: (tiers) => `No editorial links to ${tiers} pages were lost since the last crawl.`,
  footer: 'Link counts use editorial links.',
  lostMore: (count) => `Plus ${count} more.`,
  tierPair: (a, b) => `${a} and ${b}`,
  tierRange: (a, b) => `${a} to ${b}`,
  notAvailable: 'n/a',
};

const input: ClientSummaryInput = {
  host: 'eventussecurity.com',
  crawledOn: '7 Nov 2026',
  pages: 1234,
  tiers: [
    { label: 'T1 Money pages', code: 'T1', pages: 12, depth: 1.25 },
    { label: 'T2 Supporting', code: 'T2', pages: 0, depth: null },
    { label: 'Untiered', code: 'Untiered', pages: 988, depth: 3 },
  ],
  matrix: [
    [26, 3, 0],
    [22, 5, 1],
    [1, 0, 9],
  ],
  worklists: [
    { label: 'Orphans', count: 4 },
    { label: 'Deep pages', count: 0 },
    { label: 'Weak outlinks', count: 12400 },
  ],
  lost: [{ from: '/a', to: '/b', anchor: 'read more' }],
  importantMaxPosition: 2,
};

describe('client summary html', () => {
  const html = clientSummaryHtml(input, words);

  it('is a standalone page with the host in the title', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Internal links summary for eventussecurity.com</title>');
    expect(html).toContain('Crawl of 7 Nov 2026, 1,234 pages.');
    expect(html).not.toMatch(/\ssrc=|\shref=|<script|<link|<img|@import|url\(/i);
  });

  it('has a row per tier with pages, share of pages and average depth', () => {
    expect(html).toMatch(/<td style="[^"]*">T1 Money pages<\/td>/);
    // total of the tier pages is 1000: 12 is 1.2%, 988 is 98.8%
    expect(html).toContain('>1.2%</td>');
    expect(html).toContain('>98.8%</td>');
    expect(html).toContain('>1.3</td>');
    expect(html).toContain('>3.0</td>');
    expect(html).toContain('>n/a</td>');
  });

  it('has the flow matrix with From and To headers', () => {
    expect(html).toContain('>From</th>');
    expect(html).toContain('>To T1</th>');
    expect(html).toContain('>To Untiered</th>');
    expect(html).toContain('>26</td>');
  });

  it('lists only worklists with a count above zero, grouped', () => {
    expect(html).toContain('Orphans');
    expect(html).toContain('12,400');
    expect(html).not.toContain('Deep pages');
  });

  it('says so when no worklist has pages and when no important link was lost', () => {
    const empty = clientSummaryHtml({ ...input, worklists: [{ label: 'Orphans', count: 0 }], lost: [] }, words);
    expect(empty).toContain('No worklist has pages in this crawl.');
    expect(empty).not.toContain('Orphans');
    expect(empty).toContain('No editorial links to T1 and T2 pages were lost since the last crawl.');
    expect(html).toContain('Lost editorial links to T1 and T2 pages');
    expect(html).toContain('read more');
  });

  it('escapes every interpolated string', () => {
    const nasty = '<script>alert("x")</script> & \'q\'';
    const out = clientSummaryHtml(
      {
        ...input,
        host: nasty,
        crawledOn: nasty,
        tiers: [{ label: nasty, code: nasty, pages: 1, depth: 1 }],
        matrix: [[1]],
        worklists: [{ label: nasty, count: 1 }],
        lost: [{ from: `/${nasty}`, to: nasty, anchor: nasty }],
        locale: nasty,
      },
      {
        ...words,
        footer: nasty,
        title: (host) => `T ${host}`,
        crawlLine: (when, pages) => `${when} ${pages} ${nasty}`,
        flowNote: nasty,
        lostHeading: () => nasty,
      },
    );
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;');
    expect(out.match(/<script/gi)).toBeNull();
    expect(out).not.toContain('lang="<');
  });

  it('keeps wide content inside the page and prints well', () => {
    expect(html).toContain('overflow-x:auto');
    expect(html).toContain('overflow-wrap:anywhere');
    expect(html).toMatch(/<style>[^<]*@media print[^<]*page-break-inside:\s*avoid[^<]*table-header-group/);
  });

  it('sets the page language from the locale, English by default', () => {
    expect(html).toContain('<html lang="en">');
    expect(clientSummaryHtml({ ...input, locale: 'fr-FR' }, words)).toContain('<html lang="fr-FR">');
  });

  it('caps the lost links list and says how many more there are', () => {
    const many = Array.from({ length: 103 }, (_, i) => ({ from: `/from-${String(i)}`, to: '/to', anchor: 'a' }));
    const out = clientSummaryHtml({ ...input, lost: many }, words);
    expect(out).toContain('/from-99<');
    expect(out).not.toContain('/from-100<');
    expect(out).toContain('Plus 3 more.');
    const exact = clientSummaryHtml({ ...input, lost: many.slice(0, 100) }, words);
    expect(exact).not.toContain('Plus');
  });

  it('names the important tiers through the words', () => {
    expect(html).toContain('Lost editorial links to T1 and T2 pages');
    expect(clientSummaryHtml({ ...input, importantMaxPosition: 4, lost: [] }, words)).toContain('to T1 to T4 pages');
  });

  it('the catalog strings that will feed the summary have no dash and never the word equity', () => {
    // The words come from the caller (Task 19); this checks the whole internal links catalog they are read from.
    const strings: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === 'string') strings.push(node);
      else if (typeof node === 'object' && node !== null) Object.values(node).forEach(walk);
    };
    walk(messages.internalLinks);
    expect(strings.length).toBeGreaterThan(0);
    expect(strings.filter((text) => /equity/i.test(text))).toEqual([]);
    expect(strings.filter((text) => /[\u2014\u2013]/.test(text))).toEqual([]);
  });

  it('never carries the word equity or a dash', () => {
    expect(html.toLowerCase()).not.toContain('equity');
    expect(html).not.toMatch(/[\u2014\u2013]/);
  });

  it('survives a long path and an empty crawl', () => {
    const long = `/${'a'.repeat(5000)}`;
    expect(clientSummaryHtml({ ...input, lost: [{ from: long, to: '/b', anchor: '' }] }, words)).toContain(long);
    const none = clientSummaryHtml({ ...input, pages: 0, tiers: [], matrix: [], worklists: [], lost: [] }, words);
    expect(none).toContain('Crawl of 7 Nov 2026, 0 pages.');
  });
});
