import { describe, expect, it } from 'vitest';

import { faviconUrl } from './favicon';

describe('faviconUrl', () => {
  it('has no icon for any host until a first-party route exists, so no domain leaves for a third party', () => {
    expect(faviconUrl('eventussecurity.com')).toBeNull();
    expect(faviconUrl('a.com&sz=1')).toBeNull();
  });
});
