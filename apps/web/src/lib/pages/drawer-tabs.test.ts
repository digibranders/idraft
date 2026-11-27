import { describe, expect, it } from 'vitest';

import { PAGE_DRAWER_TABS, pageDrawerTab } from './drawer-tabs';

describe('the tabs of the page drawer', () => {
  it('are in the owner order', () => {
    expect([...PAGE_DRAWER_TABS]).toEqual(['overview', 'search', 'outline', 'issues', 'ai', 'links', 'history', 'notes']);
  });

  it('read a known tab as itself', () => {
    expect(pageDrawerTab('notes')).toBe('notes');
    expect(pageDrawerTab('links')).toBe('links');
  });

  it('read an unknown value and the first tab as Overview', () => {
    expect(pageDrawerTab('nope')).toBe('overview');
    expect(pageDrawerTab('overview')).toBe('overview');
    expect(pageDrawerTab('')).toBe('overview');
  });
});
