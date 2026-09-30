import { describe, expect, it } from 'vitest';

import { safeNextPath } from './next-path';

describe('safeNextPath', () => {
  it.each([
    ['/acme/crm?x=1', '/acme/crm?x=1'],
    ['/digibranders/fynix/settings/profile', '/digibranders/fynix/settings/profile'],
    ['/', '/'],
    ['/login?next=%2Fsettings', '/login?next=%2Fsettings'],
    ['/a/../b', '/b'],
    // An encoded slash is not a separator: this stays a path of this origin
    ['/./%2F/evil', '/%2F/evil'],
  ])('keeps the path of this app %s', (value, expected) => {
    expect(safeNextPath(value)).toBe(expected);
  });

  it.each([
    ['protocol-relative', '//evil.example'],
    ['absolute', 'https://evil.example'],
    ['backslash', '/\\evil'],
    ['backslash inside', '/ok\\@evil.example'],
    ['script', 'javascript:alert(1)'],
    ['data', 'data:text/html,hi'],
    ['relative', 'settings'],
    ['api', '/api/v1/me'],
    ['api root', '/api'],
    ['tab', '/\t/evil.example'],
    ['newline', '/ok\nLocation: https://evil.example'],
    ['empty', ''],
    // Resolving the dot segments would leave a protocol-relative URL
    ['dot then double slash', '/.//evil.example'],
    ['dot-dot then double slash', '/..//evil.example'],
    ['segment, dot-dot, double slash', '/a/..//evil.example'],
    ['encoded dot-dot then double slash', '/%2e%2e//evil.example'],
    ['upper-case api', '/API/v1/me'],
    ['overlong', `/${'a'.repeat(2048)}`],
  ])('sends a %s value home', (_, value) => {
    expect(safeNextPath(value)).toBe('/');
  });

  it('sends a missing value home', () => {
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath(undefined)).toBe('/');
  });
});
