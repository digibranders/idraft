import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import messages from '../../../messages/en.json';
import { activeCitationTab, CITATION_TABS, defineCitationTabs, type CitationTabEntry } from './citation-tabs';
import type { CitationTab } from './citation-scope';

const LABELS: Readonly<Record<CitationTab, 'tabs.domains' | 'tabs.pages' | 'newLost.tab'>> = {
  domains: 'tabs.domains',
  pages: 'tabs.pages',
  'new-lost': 'newLost.tab',
};
const entry = (id: CitationTab): CitationTabEntry => ({
  id,
  label: (t) => t(LABELS[id]),
  render: () => null,
});

describe('defineCitationTabs', () => {
  it('lists Domains, Pages then New and lost and throws on a repeated id', () => {
    expect(defineCitationTabs([entry('new-lost'), entry('pages'), entry('domains')]).map((tab) => tab.id)).toEqual([
      'domains',
      'pages',
      'new-lost',
    ]);
    expect(() => defineCitationTabs([entry('domains'), entry('pages'), entry('domains')])).toThrow(
      'The citation tab "domains" is listed twice',
    );
  });

  it('lists Domains, Pages and New and lost, with their labels', () => {
    expect(CITATION_TABS.map((tab) => tab.id)).toEqual(['domains', 'pages', 'new-lost']);
    const words = createTranslator({ locale: 'en', messages, namespace: 'citations' });
    expect(CITATION_TABS.map((tab) => tab.label(words))).toEqual(['Domains', 'Pages', 'New and lost']);
  });

  it('chooses New and lost when the address names it', () => {
    expect(activeCitationTab(CITATION_TABS, 'new-lost')?.id).toBe('new-lost');
  });

  it('chooses Pages when the address names it', () => {
    expect(activeCitationTab(CITATION_TABS, 'pages')?.id).toBe('pages');
  });
});

describe('activeCitationTab', () => {
  it('is the tab asked for when it is listed', () => {
    const tabs = defineCitationTabs([entry('domains'), entry('pages')]);
    expect(activeCitationTab(tabs, 'pages')?.id).toBe('pages');
  });

  it('falls back to Domains when the tab asked for is not listed yet', () => {
    const tabs = defineCitationTabs([entry('domains')]);
    expect(activeCitationTab(tabs, 'pages')?.id).toBe('domains');
  });

  it('is nothing when no tab is listed', () => {
    expect(activeCitationTab([], 'domains')).toBeNull();
  });
});
