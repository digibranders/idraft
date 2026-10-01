import { describe, expect, it } from 'vitest';

import { normalizeDomain } from './normalize';

describe('normalizeDomain', () => {
  it.each([
    ['example.com', 'example.com'],
    ['Acme.COM.', 'acme.com'],
    ['www.acme.com', 'acme.com'],
    ['  docs.acme.com  ', 'docs.acme.com'],
    ['http://acme.co.uk', 'acme.co.uk'],
    ['acme.com:8080', 'acme.com'],
    ['acme.com:', 'acme.com'],
  ])('reads %s as the host %s', (raw, domain) => {
    expect(normalizeDomain(raw)).toEqual({ ok: true, domain, display: domain, ignoredPath: null });
  });

  it('keeps www. for a rule on one host', () => {
    expect(normalizeDomain('https://www.acme.com/x', { keepWww: true })).toMatchObject({
      domain: 'www.acme.com',
      display: 'www.acme.com',
    });
  });

  it('compares an international name in punycode and shows it in its own letters', () => {
    expect(normalizeDomain('https://www.Bücher.de/')).toEqual({
      ok: true,
      domain: 'xn--bcher-kva.de',
      display: 'bücher.de',
      ignoredPath: null,
    });
  });

  it('drops a path and a query, and says which path it dropped', () => {
    expect(normalizeDomain('https://www.hubspot.com/products/crm')).toEqual({
      ok: true,
      domain: 'hubspot.com',
      display: 'hubspot.com',
      ignoredPath: '/products/crm',
    });
    expect(normalizeDomain('acme.com/pricing?plan=pro#top')).toEqual({
      ok: true,
      domain: 'acme.com',
      display: 'acme.com',
      ignoredPath: '/pricing?plan=pro',
    });
    expect(normalizeDomain('https://acme.com/')).toEqual({
      ok: true,
      domain: 'acme.com',
      display: 'acme.com',
      ignoredPath: null,
    });
    expect(normalizeDomain('acme.com/café')).toMatchObject({ ignoredPath: '/café' });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['acme .com', 'spaces'],
    ['ftp://acme.com', 'scheme'],
    ['mailto:team@acme.com', 'scheme'],
    ['acme', 'host'],
    ['-acme.com', 'host'],
    ['acme..com', 'host'],
    ['user@acme.com', 'host'],
    ['acme.com:abc', 'host'],
    ['https://', 'host'],
    ['localhost', 'private'],
    ['localhost:3000', 'private'],
    ['intranet.local', 'private'],
    ['192.168.1.10', 'private'],
    ['8.8.8.8', 'private'],
    ['[::1]', 'private'],
  ])('refuses %j as %s', (raw, code) => {
    expect(normalizeDomain(raw)).toEqual({ ok: false, code });
  });
});
