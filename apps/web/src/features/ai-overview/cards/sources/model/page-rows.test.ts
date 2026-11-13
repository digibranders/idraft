import { describe, expect, it } from 'vitest';

import { pageRows } from './page-rows';
import { pageRow, pagePage } from './page-fixtures';
import { at } from './source-fixtures';

const PRICING = pageRow({
  url: 'https://fynix.com/pricing?utm_source=x',
  urlId: 11,
  units: 612,
  answers: 540,
  prompts: 88,
  title: 'Pricing',
  engines: [
    ['chatgpt_web', 301],
    ['gemini_web', 112],
  ],
  firstSeenAt: '2026-10-17T09:00:00Z',
});
const BLOG = pageRow({ url: 'https://fynix.com/blog/crm-guide', urlId: 12, units: 300, prompts: 40 });
const OTHER = pageRow({ url: 'https://fynix.io/docs', urlId: 13, units: 120, domain: 'fynix.io' });

describe('pageRows', () => {
  it('carries the units, answers and prompts of the row, and the engines it was cited on', () => {
    const [row] = pageRows(pagePage([PRICING]));
    expect(row).toMatchObject({
      urlId: 11,
      units: 612,
      answers: 540,
      prompts: 88,
      title: 'Pricing',
      firstSeenAt: '2026-10-17T09:00:00Z',
    });
    expect(row?.engines.map((engine) => [engine.engine_code, engine.citation_units])).toEqual([
      ['chatgpt_web', 301],
      ['gemini_web', 112],
    ]);
  });

  it('hides the host when one own domain holds every page, and the path is what is left', () => {
    const rows = pageRows(pagePage([PRICING, BLOG]));
    expect(rows.map((row) => row.label)).toEqual(['/pricing', '/blog/crm-guide']);
    expect(rows.every((row) => !row.hostShown)).toBe(true);
  });

  it('keeps the host when the own pages are on several domains', () => {
    const rows = pageRows(pagePage([PRICING, OTHER]));
    expect(rows.map((row) => row.label)).toEqual(['fynix.com/pricing', 'fynix.io/docs']);
    expect(rows.every((row) => row.hostShown)).toBe(true);
  });

  it('keeps the host when the list is cut, because a page that is not shown may be on another domain', () => {
    const rows = pageRows(pagePage([PRICING, BLOG], undefined, 9));
    expect(rows.map((row) => row.label)).toEqual(['fynix.com/pricing', 'fynix.com/blog/crm-guide']);
  });

  it('keeps the host when one domain has subdomains, since its pages are not on one host', () => {
    const docs = pageRow({ url: 'https://docs.fynix.com/start', urlId: 14, units: 50, host: 'docs.fynix.com' });
    const rows = pageRows(pagePage([PRICING, docs]));
    expect(at(rows, 1).label).toBe('docs.fynix.com/start');
  });

  it('shows an address a browser would run, or one with credentials, as the text it is and marks it not safe', () => {
    const script = pageRow({ url: 'javascript:alert(1)', urlId: 15, units: 9 });
    const decoy = pageRow({ url: 'https://fynix.com@evil.example/', urlId: 16, units: 8 });
    const [first, second] = pageRows(pagePage([script, decoy]));
    expect(first).toMatchObject({ label: 'javascript:alert(1)', safe: false });
    expect(second).toMatchObject({ label: 'https://fynix.com@evil.example/', safe: false });
  });

  it('says a page is safe for an http or https address, and keeps a missing title missing', () => {
    const [row] = pageRows(pagePage([BLOG]));
    expect(row).toMatchObject({ safe: true, title: null });
  });

  it('has no rows for an empty page', () => {
    expect(pageRows(pagePage([]))).toEqual([]);
  });
});
