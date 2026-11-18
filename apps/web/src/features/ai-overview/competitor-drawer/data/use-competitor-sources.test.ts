import { describe, expect, it } from 'vitest';

import { parseSources } from './use-competitor-sources';

const domain = { domain: 'g2.com', share: 0.2, third_party: true };

describe('parseSources', () => {
  it('reads the two lists of the overlap read', () => {
    expect(parseSources({ data: { theirs: [domain], yours: [] } })).toEqual({
      theirs: [{ domain: 'g2.com', share: 0.2, thirdParty: true }],
      yours: [],
    });
  });

  it('refuses a body that is not the shape, instead of showing an empty list', () => {
    expect(() => parseSources(null)).toThrow('no data');
    expect(() => parseSources({ data: { theirs: [domain] } })).toThrow('no domain list');
    expect(() => parseSources({ data: { theirs: [{ domain: 'g2.com' }], yours: [] } })).toThrow('malformed');
  });
});
