import { describe, expect, it } from 'vitest';

import { categoryOf, scopeParts } from './header-model';
import { projectEngine, term } from '@/features/prompts/topics-by-engine/cells-fixtures';

const TREE = [
  term('seo', 'SEO'),
  term('technical', 'Technical SEO', 'seo', 'SEO / Technical SEO'),
  term('schema', 'Schema', 'technical', 'SEO / Technical SEO / Schema'),
  term('sales', 'Sales'),
];

describe('categoryOf', () => {
  it('gives no category for a top level topic', () => {
    expect(categoryOf('seo', TREE)).toBeNull();
    expect(categoryOf('sales', TREE)).toBeNull();
  });

  it('gives the parent name for a level 2 topic and the path above a level 3 topic', () => {
    expect(categoryOf('technical', TREE)).toEqual({ text: 'SEO', path: 'SEO / Technical SEO' });
    // The tree's own separator joins the names above the topic: nothing is joined here
    expect(categoryOf('schema', TREE)).toEqual({
      text: 'SEO / Technical SEO',
      path: 'SEO / Technical SEO / Schema',
    });
  });

  it('gives none for a topic the tree does not hold, and for the prompts without a topic', () => {
    expect(categoryOf('unknown', TREE)).toBeNull();
    expect(categoryOf('__none', TREE)).toBeNull();
  });
});

describe('scopeParts', () => {
  const two = [projectEngine('chatgpt_web'), projectEngine('gemini_web')];

  it('says the scope as engines, country and branded choice', () => {
    expect(scopeParts({ engines: two, country: 'DE', includeBranded: false })).toEqual({
      engines: 2,
      country: 'DE',
      branded: false,
    });
    expect(scopeParts({ engines: two, country: null, includeBranded: true })).toEqual({
      engines: 2,
      country: null,
      branded: true,
    });
  });

  it('names a single engine instead of counting it', () => {
    expect(scopeParts({ engines: [projectEngine('gemini_web')], country: null, includeBranded: false }).engines).toBe(
      'Gemini',
    );
  });
});
