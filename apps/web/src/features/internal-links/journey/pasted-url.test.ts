import { describe, expect, it } from 'vitest';

import { pastedPath } from './pasted-url';

const HOST = 'eventussecurity.com';

describe('pastedPath', () => {
  it.each([
    ['https://eventussecurity.com/services/vapt', '/services/vapt'],
    ['http://www.eventussecurity.com/services/vapt/', '/services/vapt'],
    ['  https://EventusSecurity.com/pricing?plan=pro#top  ', '/pricing'],
    ['www.eventussecurity.com/pricing', '/pricing'],
    ['eventussecurity.com/pricing', '/pricing'],
    ['https://eventussecurity.com', '/'],
  ])('reads %s as %s', (text, path) => {
    expect(pastedPath(text, HOST)).toBe(path);
  });

  it.each([
    'https://example.com/pricing',
    'https://eventussecurity.com.evil.test/pricing',
    '/services/vapt',
    'services/vapt',
    'penetration testing',
    'https://eventussecurity.com/a page',
    'https://',
    '',
  ])('leaves %j to be searched as typed', (text) => {
    expect(pastedPath(text, HOST)).toBeNull();
  });

  it('reads nothing when the site host is not known', () => {
    expect(pastedPath('https://eventussecurity.com/pricing', '')).toBeNull();
  });
});
