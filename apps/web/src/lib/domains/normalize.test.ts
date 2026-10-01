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
    ['bücher.de', 'xn--bcher-kva.de'],
  ])('reads %s as the host %s', (raw, domain) => {
    expect(normalizeDomain(raw)).toEqual({ ok: true, domain, ignoredPath: null });
  });

  it('drops a path and a query, and says which path it dropped', () => {
    expect(normalizeDomain('https://www.hubspot.com/products/crm')).toEqual({
      ok: true,
      domain: 'hubspot.com',
      ignoredPath: '/products/crm',
    });
    expect(normalizeDomain('acme.com/pricing?plan=pro#top')).toEqual({
      ok: true,
      domain: 'acme.com',
      ignoredPath: '/pricing?plan=pro',
    });
    expect(normalizeDomain('https://acme.com/')).toEqual({ ok: true, domain: 'acme.com', ignoredPath: null });
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
