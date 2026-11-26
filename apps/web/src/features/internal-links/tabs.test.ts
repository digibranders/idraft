import { FileText } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { activeLinksTab, defineLinksTabs, LINK_LEVEL_TABS, LINKS_TABS, type LinksTabEntry } from './tabs';
import type { LinksTabId } from './url-state';

const entry = (id: LinksTabId): LinksTabEntry => ({ id, label: () => id, icon: FileText, render: () => null });

describe('the tabs of Internal links', () => {
  it('lists them in the page order, whatever order they were added in', () => {
    expect(
      defineLinksTabs([entry('flow'), entry('pages'), entry('journey'), entry('links')]).map((tab) => tab.id),
    ).toEqual(['pages', 'links', 'journey', 'flow']);
  });

  it('refuses a tab listed twice', () => {
    expect(() => defineLinksTabs([entry('pages'), entry('pages')])).toThrow('listed twice');
  });

  it('falls back to the first tab built when the address names one that is not, and to none for none', () => {
    const tabs = defineLinksTabs([entry('pages'), entry('links')]);
    expect(activeLinksTab(tabs, 'links')?.id).toBe('links');
    expect(activeLinksTab(tabs, 'flow')?.id).toBe('pages');
    expect(activeLinksTab([], 'pages')).toBeNull();
  });

  it('places the Link map after the Journey and before the Tier flow', () => {
    expect(
      defineLinksTabs([entry('opportunities'), entry('flow'), entry('map'), entry('journey')]).map((tab) => tab.id),
    ).toEqual(['journey', 'map', 'flow', 'opportunities']);
  });

  it('lists the seven tabs of the page in order', () => {
    expect(LINKS_TABS.map((tab) => tab.id)).toEqual([
      'pages',
      'links',
      'journey',
      'map',
      'flow',
      'changes',
      'opportunities',
    ]);
    // The map reads the links of the crawl, so a crawl whose links were dropped cannot be chosen for it
    expect(LINK_LEVEL_TABS.has('map')).toBe(true);
  });
});
