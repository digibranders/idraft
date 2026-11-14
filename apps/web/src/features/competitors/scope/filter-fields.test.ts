import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { competitorFilterFields, type CompetitorFilterInput } from './filter-fields';
import messages from '../../../../messages/en.json';
import type { FilterField } from '@/components/app/filters/types';

const t = createTranslator({ locale: 'en', messages, namespace: 'competitors.filters' });

const input = (over: Partial<CompetitorFilterInput> = {}): CompetitorFilterInput => ({
  t,
  engines: [
    { code: 'chatgpt_web', label: 'ChatGPT' },
    { code: 'gemini_web', label: 'Gemini' },
  ],
  enginesLoading: false,
  topics: [
    { termId: 't-1', name: 'Technical SEO', parentId: null, path: 'Technical SEO' },
    { termId: 't-2', name: 'Audits', parentId: 't-1', path: 'Technical SEO / Audits' },
    { termId: 't-3', name: 'Audits', parentId: null, path: 'Content / Audits' },
  ],
  topicsLoading: false,
  ...over,
});

const field = (fields: readonly FilterField[], id: string): FilterField => {
  const found = fields.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No ${id} field`);
  return found;
};
const options = (fields: readonly FilterField[], id: string): readonly { value: string; label: string }[] => {
  const found = field(fields, id);
  if (found.kind !== 'enum') throw new Error(`${id} is not an enum field`);
  return found.options;
};

describe('competitorFilterFields', () => {
  it('fields are engine multi, topic single and branded with one option', () => {
    const fields = competitorFilterFields(input());
    expect(fields.map((entry) => entry.id)).toEqual(['engine', 'topic', 'branded']);
    expect(fields.map((entry) => (entry.kind === 'enum' ? entry.multi : null))).toEqual([true, false, false]);
    expect(options(fields, 'branded')).toEqual([{ value: 'include', label: 'Include branded prompts' }]);
    expect(options(fields, 'engine')).toEqual([
      { value: 'chatgpt_web', label: 'ChatGPT' },
      { value: 'gemini_web', label: 'Gemini' },
    ]);
  });

  it('a topic of a shared name is told apart by its path', () => {
    expect(options(competitorFilterFields(input()), 'topic')).toEqual([
      { value: 't-1', label: 'Technical SEO' },
      { value: 't-2', label: 'Technical SEO / Audits' },
      { value: 't-3', label: 'Content / Audits' },
    ]);
  });

  it("a link's engine is kept while the engines load, and a topic while the vocabularies do", () => {
    const loading = competitorFilterFields(input({ engines: [], enginesLoading: true, topicsLoading: true }));
    expect(field(loading, 'engine')).toMatchObject({ optionsLoading: true, options: [] });
    expect(field(loading, 'topic')).toMatchObject({ optionsLoading: true });
    const ready = competitorFilterFields(input());
    expect(field(ready, 'engine')).toMatchObject({ optionsLoading: false });
  });
});
