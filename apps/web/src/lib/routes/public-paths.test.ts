import { describe, expect, it } from 'vitest';

import { isPublicPath } from './public-paths';

describe('isPublicPath', () => {
  it.each([
    '/login',
    '/two-factor',
    '/reset-password',
    '/verify-email',
    '/invite',
    '/login/',
    '/public',
    '/public/internal-links/abc',
  ])('%s is public', (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([
    '/',
    '/digibranders',
    '/loginx',
    '/publicity',
    '/digibranders/public',
    '/digibranders/login',
    '/settings/security',
  ])('%s is not', (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});
