import { describe, expect, it } from 'vitest';

import { buildCsp, createNonce, FAVICON_SOURCES } from './csp';

const NONCE = 'bm9uY2Utb2YtdGhpcy10ZXN0';

/** The policy as directive name to sources. */
function parse(policy: string): Map<string, string[]> {
  return new Map(
    policy.split('; ').map((directive) => {
      const [name = '', ...sources] = directive.split(' ');
      return [name, sources];
    }),
  );
}

describe('buildCsp in production', () => {
  const policy = parse(buildCsp({ nonce: NONCE, development: false, secure: true }));

  it('allows scripts and inline styles only with the nonce', () => {
    expect(policy.get('script-src')).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
    expect(policy.get('style-src')).toEqual(["'self'", `'nonce-${NONCE}'`]);
  });

  it('has every directive of 20 section 7.3', () => {
    expect(Object.fromEntries(policy)).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"],
      'style-src': ["'self'", `'nonce-${NONCE}'`],
      'style-src-attr': ["'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:', ...FAVICON_SOURCES],
      'font-src': ["'self'"],
      'connect-src': ["'self'", 'https://*.ingest.sentry.io'],
      'worker-src': ["'self'", 'blob:'],
      'object-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'upgrade-insecure-requests': [],
    });
  });

  it('never allows eval, and allows nothing inline without the nonce but style attributes', () => {
    const text = buildCsp({ nonce: NONCE, development: false, secure: true });
    expect(text).not.toContain('unsafe-eval');
    expect(text).not.toContain('ws:');
    const inline = [...policy].filter(([, sources]) => sources.includes("'unsafe-inline'")).map(([name]) => name);
    expect(inline).toEqual(['style-src-attr']);
  });

  it('upgrades insecure requests only on a page requested over https', () => {
    expect(parse(buildCsp({ nonce: NONCE, development: false, secure: false })).has('upgrade-insecure-requests')).toBe(
      false,
    );
  });
});

describe('buildCsp in development', () => {
  const policy = parse(buildCsp({ nonce: NONCE, development: true, secure: false }));

  it('adds eval for React and the hot-reload socket', () => {
    expect(policy.get('script-src')).toContain("'unsafe-eval'");
    expect(policy.get('connect-src')).toContain('ws:');
  });

  it('allows the dev overlay inline styles, which carry no nonce', () => {
    expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
  });
});

describe('createNonce', () => {
  it('is 128 random bits in base64, different every time', () => {
    const nonces = new Set(Array.from({ length: 50 }, createNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(atob(nonce)).toHaveLength(16);
    }
  });
});
