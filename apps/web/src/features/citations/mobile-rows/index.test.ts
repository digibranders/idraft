import { describe, expect, it } from 'vitest';

import { ChangeList, DomainList, PageList, useCitationListLayout } from './index';

describe('the mobile rows folder', () => {
  it('exports the three lists and the layout choice the tabs import', () => {
    for (const part of [ChangeList, DomainList, PageList, useCitationListLayout]) expect(typeof part).toBe('function');
  });
});
