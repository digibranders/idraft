import { describe, expect, it } from 'vitest';

import { SEO_SHARE } from './seo-share';

describe('SEO_SHARE', () => {
  it('search share of voice is not available and carries a reason, never a number', () => {
    expect(SEO_SHARE).toEqual({ available: false, reason: 'not_built' });
    expect(Object.values(SEO_SHARE).some((entry) => typeof entry === 'number')).toBe(false);
    expect('value' in SEO_SHARE).toBe(false);
  });
});
