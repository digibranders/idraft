import { describe, expect, it } from 'vitest';

import { activeCitationTab, CITATION_TABS, defineCitationTabs, type CitationTabEntry } from './citation-tabs';
import type { CitationTab } from './citation-scope';

const entry = (id: CitationTab): CitationTabEntry => ({
  id,
  label: (t) => t(id === 'domains' ? 'tabs.domains' : 'tabs.pages'),
  render: () => null,
});

describe('defineCitationTabs', () => {
  it('lists Domains then Pages and throws on a repeated id', () => {
    expect(defineCitationTabs([entry('pages'), entry('domains')]).map((tab) => tab.id)).toEqual(['domains', 'pages']);
    expect(() => defineCitationTabs([entry('domains'), entry('pages'), entry('domains')])).toThrow(
      'The citation tab "domains" is listed twice',
    );
  });

  it('starts empty: T4b and T5a add their entries', () => {
    expect(CITATION_TABS).toEqual([]);
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
