import { describe, expect, it } from 'vitest';

import { NewLostTab } from './index';
import { CITATION_TABS } from '../citation-tabs';

describe('the New and lost folder', () => {
  it('exports the tab the tab list renders', () => {
    expect(typeof NewLostTab).toBe('function');
    expect(CITATION_TABS.find((tab) => tab.id === 'new-lost')).toBeDefined();
  });
});
