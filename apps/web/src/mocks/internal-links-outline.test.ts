import { describe, expect, it } from 'vitest';

import { crawledPage, crawledPages, MOCK_RUN_ID, pageRow } from './internal-links-world';
import { OUTLINE_LONG_PAGE, OUTLINE_NO_HTML_PAGE, OUTLINE_PROBLEM_PAGE, outlineOf } from './internal-links-outline';
import type { PageOutline, PageOutlineBody, PageRow } from '@/lib/internal-links/types';

const rowOf = (id: string): PageRow => {
  const page = crawledPage(id);
  if (page === undefined) throw new Error(`The fixture crawl has no page ${id}`);
  return pageRow(page, 'all');
};
const bodyOf = (outline: PageOutline): PageOutlineBody => {
  if (outline.outline === null) throw new Error(`The outline is ${outline.state}, not a body`);
  return outline.outline;
};
const stateOf = (chars: number): string =>
  chars === 0 ? 'missing' : chars < 30 ? 'short' : chars > 60 ? 'long' : 'ok';
const LIVE = crawledPages()
  .map((page) => pageRow(page, 'all'))
  .filter((row) => row.status_code === 200 && row.url_id !== OUTLINE_NO_HTML_PAGE);

describe('the mocked outline of a live page', () => {
  it.each(LIVE.map((row) => [row.path, row] as const))('is complete for %s', (_path, row) => {
    const answer = outlineOf(row, MOCK_RUN_ID);
    const body = bodyOf(answer);
    expect(answer).toMatchObject({ state: 'ok', run_id: MOCK_RUN_ID, status_code: 200 });
    expect(body.url).toBe(row.url);
    expect(body.title.text).toBe(row.title);
    expect(body.title.state).toBe(stateOf(body.title.chars));
    expect(body.description.chars).toBe(row.url_id === OUTLINE_PROBLEM_PAGE ? 0 : 120);
    expect(body.level_counts).toHaveLength(6);
    expect(body.level_counts[0]).toBe(body.headings.filter((item) => item.level === 1).length);
    expect(body.headings_total).toBeGreaterThanOrEqual(body.headings.length);
    expect(body.canonical).toEqual({ state: 'self', href: row.url });
    expect(body.robots.noindex).toBe(!row.is_indexable);
    expect(body.content.read_minutes).toBeGreaterThanOrEqual(1);
  });

  it('is the same every time', () => {
    const row = rowOf('102');
    expect(outlineOf(row, MOCK_RUN_ID)).toEqual(outlineOf(row, MOCK_RUN_ID));
  });

  it('is a plain, healthy page for an ordinary row', () => {
    const body = bodyOf(outlineOf(rowOf('102'), MOCK_RUN_ID));
    expect(body.headings.map((item) => item.level)).toEqual([1, 2, 2, 2, 2]);
    expect(body).toMatchObject({
      html_lang: 'en',
      languages: { x_default: false, pairs: [] },
      structured_data: [{ types: ['WebPage'], parses: true }],
      content: { words: 640, images: 4, images_without_alt: 0, thin: false },
    });
    expect(Object.values(body.social).every((value) => value !== null)).toBe(true);
  });
});

describe('the three fixed pages', () => {
  it('has a long page with more than 12 headings', () => {
    const body = bodyOf(outlineOf(rowOf(OUTLINE_LONG_PAGE), MOCK_RUN_ID));
    expect(body.headings.length).toBeGreaterThan(12);
    expect(body.level_counts.reduce((sum, count) => sum + count, 0)).toBe(body.headings_total);
  });

  it('has a page whose HTML was not kept', () => {
    expect(outlineOf(rowOf(OUTLINE_NO_HTML_PAGE), MOCK_RUN_ID)).toMatchObject({ state: 'no_html', outline: null });
  });

  it('has a page with one finding of every kind', () => {
    const body = bodyOf(outlineOf(rowOf(OUTLINE_PROBLEM_PAGE), MOCK_RUN_ID));
    expect(body.level_counts[0]).toBe(0);
    expect(body.description).toEqual({ text: null, chars: 0, state: 'missing' });
    expect(body.languages.pairs.filter((pair) => !pair.valid)).toHaveLength(1);
    expect(body.social.og_title).toBeNull();
    expect(body.structured_data.filter((block) => !block.parses)).toHaveLength(1);
    expect(body.content.thin).toBe(true);
    expect(body.content.images_without_alt).toBe(1);
  });

  it('are three different live pages', () => {
    const ids = [OUTLINE_LONG_PAGE, OUTLINE_PROBLEM_PAGE, OUTLINE_NO_HTML_PAGE];
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(rowOf(id).status_code).toBe(200);
  });
});

describe('the mocked outline of a page that is not live', () => {
  it('is a redirect for a 301', () => {
    expect(outlineOf(rowOf('106'), MOCK_RUN_ID)).toMatchObject({ state: 'redirect', status_code: 301, outline: null });
  });

  it('is an error for a 404', () => {
    expect(outlineOf(rowOf('107'), MOCK_RUN_ID)).toMatchObject({ state: 'error', status_code: 404, outline: null });
  });

  it('is not HTML for a 200 that is not HTML', () => {
    expect(outlineOf({ ...rowOf('102'), resource_type: 'other' }, MOCK_RUN_ID).state).toBe('not_html');
  });
});
