import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { citationFilterFields, type CitationFilterInput } from './citations-filters';
import messages from '../../../messages/en.json';
import type { FilterField } from '@/components/app/filters/types';

const t = createTranslator({ locale: 'en', messages, namespace: 'citations.filters' });

const input = (over: Partial<CitationFilterInput> = {}): CitationFilterInput => ({
  t,
  tab: 'domains',
  engines: [
    { code: 'chatgpt_web', label: 'ChatGPT' },
    { code: 'gemini_web', label: 'Gemini' },
  ],
  enginesLoading: false,
  roleUnits: { own: 1676, competitor: 5000, third_party: 11744 },
  topics: [
    { termId: 't-1', name: 'Technical SEO', parentId: null, path: 'Technical SEO' },
    { termId: 't-2', name: 'Audits', parentId: 't-1', path: 'Technical SEO / Audits' },
  ],
  topicsLoading: false,
  ...over,
});

const field = (fields: readonly FilterField[], id: string): FilterField => {
  const found = fields.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No ${id} field`);
  return found;
};
const options = (
  fields: readonly FilterField[],
  id: string,
): readonly { value: string; label: string; count?: number | null | undefined }[] => {
  const found = field(fields, id);
  if (found.kind !== 'enum') throw new Error(`${id} is not an enum field`);
  return found.options;
};

describe('citationFilterFields', () => {
  it('builds Engine, Role, Topic and Branded for Domains and adds Domain for Pages', () => {
    expect(citationFilterFields(input()).map((entry) => entry.id)).toEqual(['engine', 'role', 'topic', 'branded']);
    const pages = citationFilterFields(input({ tab: 'pages' }));
    expect(pages.map((entry) => entry.id)).toEqual(['engine', 'role', 'topic', 'branded', 'domain']);
    expect(field(pages, 'domain')).toMatchObject({ kind: 'text', label: 'Domain', operators: ['equals'] });
  });

  it('says which fields take several values: Engine and Role do, Topic and Branded do not', () => {
    const fields = citationFilterFields(input());
    expect(fields.map((entry) => (entry.kind === 'enum' ? entry.multi : null))).toEqual([true, true, false, false]);
    expect(options(fields, 'branded')).toEqual([{ value: 'include', label: 'Include branded prompts' }]);
  });

  it('role options carry their units from meta.by_role and no count while unknown', () => {
    expect(options(citationFilterFields(input()), 'role')).toEqual([
      { value: 'own', label: 'Own', count: 1676 },
      { value: 'competitor', label: 'Competitor', count: 5000 },
      { value: 'third_party', label: 'Third party', count: 11744 },
    ]);
    expect(options(citationFilterFields(input({ roleUnits: null })), 'role')).toEqual([
      { value: 'own', label: 'Own', count: null },
      { value: 'competitor', label: 'Competitor', count: null },
      { value: 'third_party', label: 'Third party', count: null },
    ]);
  });

  it('engine options are the enabled engines, and a link is kept while they are unknown', () => {
    const fields = citationFilterFields(input());
    expect(options(fields, 'engine')).toEqual([
      { value: 'chatgpt_web', label: 'ChatGPT' },
      { value: 'gemini_web', label: 'Gemini' },
    ]);
    expect(field(fields, 'engine')).toMatchObject({ optionsLoading: false });
    expect(field(citationFilterFields(input({ enginesLoading: true, engines: [] })), 'engine')).toMatchObject({
      optionsLoading: true,
    });
  });

  it('topic options are the topic terms by name, and by place when two share a name', () => {
    expect(options(citationFilterFields(input()), 'topic')).toEqual([
      { value: 't-1', label: 'Technical SEO' },
      { value: 't-2', label: 'Audits' },
    ]);
    const twins = input({
      topics: [
        { termId: 't-1', name: 'Audits', parentId: null, path: 'Audits' },
        { termId: 't-2', name: 'Audits', parentId: 't-9', path: 'Services / Audits' },
      ],
    });
    expect(options(citationFilterFields(twins), 'topic').map((option) => option.label)).toEqual([
      'Audits',
      'Services / Audits',
    ]);
    expect(field(citationFilterFields(input({ topicsLoading: true })), 'topic')).toMatchObject({
      optionsLoading: true,
    });
  });
});
