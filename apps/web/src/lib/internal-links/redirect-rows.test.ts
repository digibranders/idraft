import { describe, expect, it } from 'vitest';

import { isRedirectRow, redirectNote, type RedirectFacts } from './redirect-rows';

const HOST = 'eventussecurity.com';
const row = (over: Partial<RedirectFacts>): RedirectFacts => ({
  resource_type: 'html',
  status_code: 200,
  url: 'https://eventussecurity.com/',
  redirect_url: null,
  ...over,
});

describe('redirectNote', () => {
  it('is nothing for a page that answers 200', () => {
    expect(isRedirectRow(row({}))).toBe(false);
    expect(redirectNote(row({}), HOST)).toBeNull();
  });

  it('names where a redirect leads, and no host when the row is on the site host', () => {
    const redirect = row({
      resource_type: 'redirect',
      status_code: 301,
      url: 'https://eventussecurity.com/services/penetration-testing',
      redirect_url: 'https://eventussecurity.com/services/vapt?x=1',
    });
    expect(redirectNote(redirect, HOST)).toEqual({ target: '/services/vapt?x=1', host: null });
  });

  it('names the own host of the www form, so it is not the same as the home page', () => {
    const www = row({
      status_code: 301,
      url: 'https://www.eventussecurity.com/',
      redirect_url: 'https://eventussecurity.com/',
    });
    expect(isRedirectRow(www)).toBe(true);
    expect(redirectNote(www, HOST)).toEqual({ target: '/', host: 'www.eventussecurity.com' });
  });

  it('says "?" for a redirect whose target is not known', () => {
    expect(redirectNote(row({ resource_type: 'redirect', status_code: 302 }), HOST)?.target).toBe('?');
  });
});
