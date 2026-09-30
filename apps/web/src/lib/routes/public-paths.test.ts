import { describe, expect, it } from 'vitest';

import { isPublicPath } from './public-paths';

describe('isPublicPath', () => {
  it.each(['/login', '/two-factor', '/reset-password', '/verify-email', '/invite', '/login/'])(
    '%s is public',
    (path) => {
      expect(isPublicPath(path)).toBe(true);
    },
  );

  it.each(['/', '/digibranders', '/loginx', '/digibranders/login', '/settings/security'])('%s is not', (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});
