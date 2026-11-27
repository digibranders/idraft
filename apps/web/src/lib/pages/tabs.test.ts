import { describe, expect, it } from 'vitest';

import { livePagesTabs, PAGES_TABS } from './tabs';

describe('the tabs of Pages', () => {
  it('are Overview, All pages and Monitoring, in that order', () => {
    expect(PAGES_TABS.map((tab) => tab.id)).toEqual(['overview', 'all', 'monitoring']);
  });

  it('are all live, and Monitoring is at /monitoring', () => {
    expect(livePagesTabs().map((tab) => tab.id)).toEqual(['overview', 'all', 'monitoring']);
    expect(PAGES_TABS.find((tab) => tab.id === 'monitoring')?.path).toBe('/monitoring');
  });
});
