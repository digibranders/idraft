import { describe, expect, it } from 'vitest';

import { parseUserAgent } from './user-agent';

describe('parseUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      { browser: 'Chrome', system: 'macOS' },
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
      { browser: 'Edge', system: 'Windows' },
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      { browser: 'Safari', system: 'iOS' },
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', { browser: 'Firefox', system: 'Linux' }],
    [
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36',
      { browser: 'Chrome', system: 'Android' },
    ],
  ])('names %s', (userAgent, expected) => {
    expect(parseUserAgent(userAgent)).toEqual(expected);
  });

  it('says nothing it does not know', () => {
    expect(parseUserAgent(null)).toBeNull();
    expect(parseUserAgent('')).toBeNull();
    expect(parseUserAgent('curl/8.4.0')).toBeNull();
  });

  it('names the half it knows', () => {
    expect(parseUserAgent('SomeBrowser/1.0 (Windows NT 10.0)')).toEqual({ browser: null, system: 'Windows' });
  });
});
