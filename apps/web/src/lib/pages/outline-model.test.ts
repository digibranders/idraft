import { describe, expect, it } from 'vitest';

import type { PageIssue } from './issue-source';
import { HEADINGS_FOLDED, HEADINGS_LISTED_MAX, outlineModel } from './outline-model';
import type { PageOutlineBody } from '@/lib/internal-links/types';

type Heading = PageOutlineBody['headings'][number];
const heading = (level: number, text: string): Heading => ({ level, text });
const counts = (headings: readonly Heading[]): number[] =>
  [1, 2, 3, 4, 5, 6].map((level) => headings.filter((item) => item.level === level).length);

const HEALTHY_HEADINGS = [heading(1, 'Plans'), heading(2, 'Free'), heading(2, 'Paid'), heading(3, 'Teams')];

function outline(overrides: Partial<PageOutlineBody> = {}): PageOutlineBody {
  return {
    url: 'https://example.com/plans',
    truncated: false,
    title: { text: 'Plans and pricing for every team', chars: 32, state: 'ok' },
    description: {
      text: 'A description of the right length for a search result, about the plans.',
      chars: 72,
      state: 'ok',
    },
    canonical: { state: 'self', href: 'https://example.com/plans' },
    robots: { meta: 'index, follow', noindex: false },
    html_lang: 'en',
    headings: HEALTHY_HEADINGS,
    headings_total: HEALTHY_HEADINGS.length,
    level_counts: counts(HEALTHY_HEADINGS),
    skipped_at: null,
    languages: { x_default: false, pairs: [] },
    social: { og_title: 'Plans', og_description: 'About', og_image: null, og_type: null, twitter_card: null },
    structured_data: [],
    content: { words: 690, read_minutes: 3, thin: false, images: 4, images_without_alt: 0 },
    ...overrides,
  };
}

const PROBLEM_HEADINGS = [heading(2, 'Who we are'), heading(4, 'Deep one'), heading(1, 'One'), heading(1, 'Two')];
const problem = (): PageOutlineBody =>
  outline({
    title: { text: 'Short', chars: 5, state: 'short' },
    description: { text: null, chars: 0, state: 'missing' },
    canonical: { state: 'elsewhere', href: 'https://example.com/other' },
    robots: { meta: 'noindex', noindex: true },
    headings: PROBLEM_HEADINGS,
    headings_total: 4,
    level_counts: counts(PROBLEM_HEADINGS),
    skipped_at: 1,
    content: { words: 120, read_minutes: 1, thin: true, images: 3, images_without_alt: 2 },
  });

describe('the strip', () => {
  it('has the four cells of a healthy page, none warning', () => {
    const { strip } = outlineModel(outline(), null);
    expect(strip.map((cell) => cell.id)).toEqual(['h1', 'headings', 'words', 'images']);
    expect(strip[0]).toMatchObject({ value: 1, note: { id: 'h1One' }, warn: false });
    expect(strip[1]).toMatchObject({ value: 4, note: { id: 'headingsNote', values: { h2: 2, h3: 1 } }, warn: false });
    expect(strip[2]).toMatchObject({ value: 690, note: { id: 'readTime', values: { minutes: 3 } }, warn: false });
    expect(strip[3]).toMatchObject({ value: 4, note: { id: 'imagesFine' }, warn: false });
  });

  it('warns for no H1, two H1, thin text and images without alt text', () => {
    const none = outlineModel(outline({ level_counts: [0, 2, 0, 0, 0, 0] }), null).strip[0];
    expect(none).toMatchObject({ value: null, note: { id: 'h1Missing' }, warn: true });
    const many = outlineModel(problem(), null).strip;
    expect(many[0]).toMatchObject({ value: 2, note: { id: 'h1Many' }, warn: true });
    expect(many[2]).toMatchObject({ note: { id: 'thin' }, warn: true });
    expect(many[3]).toMatchObject({ note: { id: 'imagesNoAlt', values: { count: 2 } }, warn: true });
  });
});

describe('the listing', () => {
  it('is ok with no findings for a healthy page', () => {
    expect(outlineModel(outline(), null).listing).toEqual({ tone: 'ok', findings: [] });
  });

  it('lists the findings in order with the check ids of spec 9.6.3', () => {
    const { listing } = outlineModel(problem(), [
      { checkId: 'description-duplicate', severity: 'notice', detail: null },
    ]);
    expect(listing.tone).toBe('warning');
    expect(listing.findings.map((finding) => [finding.id, finding.checkId])).toEqual([
      ['titleShort', 'title-short'],
      ['descriptionMissing', 'description-missing'],
      ['descriptionDuplicate', 'description-duplicate'],
      ['noindex', 'noindex'],
      ['canonicalElsewhere', 'canonical-elsewhere'],
    ]);
  });

  it('gives a short or long description no check', () => {
    const short = outline({ description: { text: 'x', chars: 1, state: 'short' } });
    const long = outline({ description: { text: 'x', chars: 400, state: 'long' } });
    expect(outlineModel(short, null).listing.findings).toEqual([{ id: 'descriptionShort', values: {}, checkId: null }]);
    expect(outlineModel(long, null).listing.findings[0]).toMatchObject({ id: 'descriptionLong', checkId: null });
  });

  it('reports a duplicate description only when the page issues list it', () => {
    const duplicate: PageIssue = { checkId: 'description-duplicate', severity: 'notice', detail: null };
    expect(outlineModel(outline(), null).listing.findings).toEqual([]);
    expect(outlineModel(outline(), []).listing.findings).toEqual([]);
    expect(outlineModel(outline(), [duplicate]).listing.findings.map((finding) => finding.id)).toEqual([
      'descriptionDuplicate',
    ]);
  });
});

describe('the headings', () => {
  it('folds after the first 12', () => {
    const many = Array.from({ length: 14 }, (_, index) => heading(2, `Heading ${String(index)}`));
    const { headings } = outlineModel(
      outline({ headings: many, headings_total: 14, level_counts: counts(many) }),
      null,
    );
    expect(HEADINGS_FOLDED).toBe(12);
    expect(headings.first).toHaveLength(12);
    expect(headings.rest).toHaveLength(2);
    expect(headings.capped).toBeNull();
  });

  const listOf = (count: number): Heading[] =>
    Array.from({ length: count }, (_, index) => heading(2, `Heading ${String(index)}`));

  it('says the list is capped only when the backend list hit its 200', () => {
    const full = listOf(HEADINGS_LISTED_MAX);
    const { headings } = outlineModel(
      outline({ headings: full, headings_total: 1240, level_counts: counts(full) }),
      null,
    );
    expect(headings.capped).toEqual({ shown: 200, total: 1240 });
    expect(headings.withoutText).toBe(0);
  });

  it('counts headings without text apart, and does not call a 13 with 1 empty a cap', () => {
    const twelve = listOf(12);
    const { headings } = outlineModel(
      outline({ headings: twelve, headings_total: 13, level_counts: [0, 13, 0, 0, 0, 0] }),
      null,
    );
    expect(headings.first).toHaveLength(12);
    expect(headings.rest).toHaveLength(0);
    expect(headings.capped).toBeNull();
    expect(headings.withoutText).toBe(1);
  });

  it('lists 14 with 2 empty as 12 listed, 2 more to show later and no cap', () => {
    const listed = listOf(14);
    const { headings } = outlineModel(
      outline({ headings: listed, headings_total: 16, level_counts: [0, 16, 0, 0, 0, 0] }),
      null,
    );
    expect(headings.first).toHaveLength(12);
    expect(headings.rest).toHaveLength(2);
    expect(headings.capped).toBeNull();
    expect(headings.withoutText).toBe(2);
  });

  it('finds no skipped level when skipped_at is past the list or at the first row', () => {
    const past = outlineModel(outline({ skipped_at: 9 }), null).headings.findings;
    expect(past.map((item) => item.id)).toEqual([]);
    // Nothing is before the first row, so there is no level to name
    const first = outlineModel(outline({ skipped_at: 0 }), null).headings.findings;
    expect(first.map((item) => item.id)).toEqual([]);
  });

  it('finds no H1, several H1 and a skipped level', () => {
    const twos = [heading(2, 'A'), heading(2, 'B')];
    const none = outlineModel(outline({ headings: twos, level_counts: counts(twos) }), null).headings;
    expect(none.findings).toEqual([{ id: 'h1Missing', values: {}, checkId: 'h1-missing' }]);
    expect(none.h1Text).toBeNull();
    const bad = outlineModel(problem(), null).headings;
    expect(bad.tone).toBe('warning');
    expect(bad.h1Text).toBe('One');
    expect(bad.findings).toEqual([
      { id: 'h1Multiple', values: { count: 2 }, checkId: 'h1-multiple' },
      { id: 'skippedLevel', values: { text: 'Deep one', level: 4, before: 2 }, checkId: null },
    ]);
  });

  it('holds no visible text: every string is an id or comes from the page', () => {
    const model = outlineModel(problem(), null);
    const strings: string[] = [];
    JSON.stringify(model, (_key, value: unknown) => {
      if (typeof value === 'string') strings.push(value);
      return value;
    });
    for (const text of strings) expect(text).toMatch(/^(?:[A-Za-z0-9-]+|Who we are|Deep one)$/);
  });
});

describe('the languages', () => {
  const pair = (
    code: string,
    valid = true,
    suggestion: string | null = null,
  ): PageOutlineBody['languages']['pairs'][number] => ({
    code,
    href: `https://example.com/${code}`,
    is_self: false,
    valid,
    suggestion,
  });

  it('is neutral with no pairs and names the language of the page', () => {
    expect(outlineModel(outline(), null).languages).toEqual({
      tone: 'neutral',
      findings: [],
      summary: { id: 'summaryOne', values: { lang: 'en' } },
    });
    expect(outlineModel(outline({ html_lang: null }), null).languages.summary.id).toBe('summaryOneUnknown');
  });

  it('counts the versions without the x-default pair', () => {
    const pairs = [pair('en'), pair('de'), pair('x-default')];
    const withDefault = outlineModel(outline({ languages: { x_default: true, pairs } }), null).languages;
    expect(withDefault).toEqual({ tone: 'ok', findings: [], summary: { id: 'summary', values: { count: 2 } } });
    const without = outlineModel(outline({ languages: { x_default: false, pairs: pairs.slice(0, 2) } }), null);
    expect(without.languages.summary).toEqual({ id: 'summaryNoDefault', values: { count: 2 } });
  });

  it('gives a finding with the suggestion, or without it, for a code that is not valid', () => {
    const pairs = [pair('en-UK', false, 'en-GB'), pair('xx', false)];
    const { languages } = outlineModel(outline({ languages: { x_default: false, pairs } }), null);
    expect(languages.tone).toBe('warning');
    expect(languages.findings).toEqual([
      { id: 'hreflangSuggest', values: { code: 'en-UK', suggestion: 'en-GB' }, checkId: 'hreflang' },
      { id: 'hreflang', values: { code: 'xx' }, checkId: 'hreflang' },
    ]);
  });
});

describe('the social sharing', () => {
  const social = (overrides: Partial<PageOutlineBody['social']>): PageOutlineBody =>
    outline({
      social: { og_title: 'T', og_description: null, og_image: null, og_type: null, twitter_card: null, ...overrides },
    });

  it('says none, with one finding, when there is no og:title', () => {
    const { sharing } = outlineModel(social({ og_title: null }), null);
    expect(sharing).toEqual({
      tone: 'warning',
      findings: [{ id: 'socialTags', values: {}, checkId: 'social-tags' }],
      summary: { id: 'summaryNone', values: {} },
    });
  });

  it('says partly when only the X card is missing, and fine when both are set', () => {
    const partly = outlineModel(social({}), null).sharing;
    expect(partly).toMatchObject({ tone: 'ok', findings: [], summary: { id: 'summaryPartly' } });
    const fine = outlineModel(social({ twitter_card: 'summary' }), null).sharing;
    expect(fine).toMatchObject({ tone: 'ok', summary: { id: 'summaryFine' } });
  });
});

describe('the structured data', () => {
  it('is neutral with no blocks', () => {
    expect(outlineModel(outline(), null).structured).toEqual({
      tone: 'neutral',
      findings: [],
      summary: { id: 'summaryNone', values: {} },
    });
  });

  it('joins the types, counts a block without types, and finds each block that does not parse', () => {
    const blocks = [
      { types: ['Article', 'WebPage'], parses: true },
      { types: [], parses: false },
      { types: ['Organization'], parses: false },
    ];
    const { structured } = outlineModel(outline({ structured_data: blocks }), null);
    expect(structured.summary).toEqual({
      id: 'summary',
      values: { count: 3, types: 'Article, WebPage, Organization' },
    });
    expect(structured.tone).toBe('warning');
    expect(structured.findings).toEqual([
      { id: 'schemaErrors', values: {}, checkId: 'schema-errors' },
      { id: 'schemaErrors', values: {}, checkId: 'schema-errors' },
    ]);
  });

  it('counts blocks that name no type without a list of types', () => {
    const { structured } = outlineModel(outline({ structured_data: [{ types: [], parses: true }] }), null);
    expect(structured).toEqual({ tone: 'ok', findings: [], summary: { id: 'summaryUnnamed', values: { count: 1 } } });
  });
});

describe('the content', () => {
  it('is ok with no finding for a healthy page', () => {
    expect(outlineModel(outline(), null).content).toEqual({
      tone: 'ok',
      findings: [],
      summary: { id: 'summary', values: { words: 690, images: 4 } },
    });
  });

  it('finds thin text and images without alt text', () => {
    const { content } = outlineModel(problem(), null);
    expect(content.tone).toBe('warning');
    expect(content.findings).toEqual([
      { id: 'thinContent', values: {}, checkId: 'thin-content' },
      { id: 'imageAlt', values: { count: 2 }, checkId: 'image-alt' },
    ]);
  });
});
