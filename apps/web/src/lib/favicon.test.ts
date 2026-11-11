import { describe, expect, it } from 'vitest';

import { faviconUrl } from './favicon';
import { FAVICON_SOURCES } from './security/csp';

describe('faviconUrl', () => {
  it('asks the allowlisted service for the host at 64 px', () => {
    expect(faviconUrl('eventussecurity.com')).toBe(
      'https://www.google.com/s2/favicons?domain=eventussecurity.com&sz=64',
    );
    expect(FAVICON_SOURCES).toContain('https://www.google.com/s2/favicons');
  });

  it('encodes a host so it cannot add a parameter', () => {
    expect(faviconUrl('a.com&sz=1')).toBe('https://www.google.com/s2/favicons?domain=a.com%26sz%3D1&sz=64');
  });
});
