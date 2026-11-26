import { describe, expect, it } from 'vitest';

import { livePagesTabs, PAGES_TABS } from './tabs';

describe('the tabs of Pages', () => {
  it('are Overview, All pages and Monitoring, in that order', () => {
    expect(PAGES_TABS.map((tab) => tab.id)).toEqual(['overview', 'all', 'monitoring']);
  });

  it('list only the live tabs: a planned one is not offered', () => {
    expect(livePagesTabs().map((tab) => tab.id)).toEqual(['overview', 'all']);
  });
});
