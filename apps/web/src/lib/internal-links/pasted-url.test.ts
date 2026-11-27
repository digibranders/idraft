import { describe, expect, it } from 'vitest';

import { hostOfEntry, parseAddress, pastedPath, searchPathOf } from './pasted-url';

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

describe('parseAddress and the helpers built on it', () => {
  it('reads the host and the path, without the query, the fragment or a trailing slash', () => {
    expect(parseAddress('https://Blog.EventusSecurity.com/a/b/?x=1#y')).toEqual({
      host: 'blog.eventussecurity.com',
      path: '/a/b',
    });
    expect(parseAddress('/a/b')).toBeNull();
    expect(parseAddress('blog.eventussecurity.com')).toBeNull();
  });

  it('searches a pasted address of the site as its path, and other text as it is', () => {
    expect(searchPathOf('https://eventussecurity.com/pricing/', HOST)).toBe('/pricing');
    expect(searchPathOf('https://example.com/pricing', HOST)).toBe('https://example.com/pricing');
    expect(searchPathOf('pricing', HOST)).toBe('pricing');
    expect(searchPathOf(null, HOST)).toBeNull();
  });

  it('keeps the host of a pasted address in a host list, and a plain host as it is', () => {
    expect(hostOfEntry('https://blog.eventussecurity.com/')).toBe('blog.eventussecurity.com');
    expect(hostOfEntry('blog.eventussecurity.com')).toBe('blog.eventussecurity.com');
  });
});
