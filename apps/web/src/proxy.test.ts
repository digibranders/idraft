import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { config, proxy } from './proxy';
import type { AppEnvironment } from '@/lib/env/public';

const env = vi.hoisted(() => ({ NEXT_PUBLIC_APP_ENV: 'development' as AppEnvironment }));
vi.mock('@/lib/env/public', () => ({ publicEnv: env }));

const ORIGIN = 'http://localhost:3000';
const SIGNED_IN = { cookie: '__Host-session=anything' };

const request = (path: string, headers: Record<string, string> = {}): NextRequest =>
  new NextRequest(`${ORIGIN}${path}`, { headers });

/** The nonce the policy of a response allows. */
const nonceOf = (policy: string | null): string | undefined => /'nonce-([^']+)'/.exec(policy ?? '')?.[1];

describe('proxy', () => {
  afterEach(() => {
    env.NEXT_PUBLIC_APP_ENV = 'development';
  });

  it('sends an anonymous request to sign in, keeping where it was going', () => {
    const response = proxy(request('/acme/crm?loc=2840&dev=mobile'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?next=%2Facme%2Fcrm%3Floc%3D2840%26dev%3Dmobile`);
  });

  it('lets a request with the session cookie through, with a policy whose nonce it hands to the render', () => {
    const response = proxy(request('/acme', SIGNED_IN));
    const policy = response.headers.get('content-security-policy');
    const nonce = nonceOf(policy);
    expect(nonce).toBeDefined();
    // NextResponse.next passes changed request headers on in this form
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('makes a new nonce for every response', () => {
    const first = nonceOf(proxy(request('/acme', SIGNED_IN)).headers.get('content-security-policy'));
    const second = nonceOf(proxy(request('/acme', SIGNED_IN)).headers.get('content-security-policy'));
    expect(first).not.toBe(second);
  });

  it.each(['/login', '/two-factor', '/reset-password', '/verify-email', '/invite'])(
    'lets an anonymous request to %s through, with the policy and no private cache header',
    (path) => {
      const response = proxy(request(path));
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('content-security-policy')).toContain("'nonce-");
      expect(response.headers.get('cache-control')).toBeNull();
    },
  );

  it('lets the component preview through without a session outside production only', () => {
    expect(proxy(request('/design-system/tokens')).headers.get('location')).toBeNull();
    env.NEXT_PUBLIC_APP_ENV = 'production';
    expect(proxy(request('/design-system/tokens')).headers.get('location')).toContain('/login?next=');
  });

  it('does not treat a path that only starts like a public one as public', () => {
    expect(proxy(request('/loginx')).headers.get('location')).toContain('/login?next=%2Floginx');
    expect(proxy(request('/design-systemx')).headers.get('location')).toContain('/login?next=%2Fdesign-systemx');
    expect(proxy(request('/design-system')).headers.get('location')).toBeNull();
  });

  it('replaces a nonce the client sent with its own', () => {
    const response = proxy(request('/acme', { ...SIGNED_IN, 'x-nonce': 'chosen-by-the-client' }));
    const nonce = nonceOf(response.headers.get('content-security-policy'));
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(nonce).not.toBe('chosen-by-the-client');
  });

  it('upgrades insecure requests only for a page the browser asked for over https', () => {
    const policyOf = (response: Response): string => response.headers.get('content-security-policy') ?? '';
    expect(policyOf(proxy(request('/login')))).not.toContain('upgrade-insecure-requests');
    expect(policyOf(proxy(request('/login', { 'x-forwarded-proto': 'https' })))).toContain('upgrade-insecure-requests');
    expect(policyOf(proxy(new NextRequest('https://app.example/login')))).toContain('upgrade-insecure-requests');
  });
});

describe('the proxy matcher', () => {
  const matches = (path: string, headers: Record<string, string> = {}): boolean =>
    unstable_doesMiddlewareMatch({ config, url: `${ORIGIN}${path}`, headers });

  it.each(['/', '/acme', '/acme/fynix/settings/profile', '/login', '/design-system/tokens', '/x/y.png'])(
    'runs for the page %s',
    (path) => {
      expect(matches(path)).toBe(true);
    },
  );

  it.each([
    '/api',
    '/api/v1/me',
    '/_next/static/chunks/app.js',
    '/_next/image',
    '/_next/webpack-hmr',
    '/.well-known/security.txt',
    '/mockServiceWorker.js',
    '/favicon.ico',
  ])('skips %s', (path) => {
    expect(matches(path)).toBe(false);
  });

  it('runs for a prefetch too, so a header cannot turn off the policy or the redirect', () => {
    expect(matches('/acme', { 'next-router-prefetch': '1' })).toBe(true);
    expect(matches('/login', { purpose: 'prefetch' })).toBe(true);
  });
});
