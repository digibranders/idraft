import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env/public';
import { isPublicPath } from '@/lib/routes/public-paths';
import { PATHNAME_HEADER } from '@/lib/routes/paths';
import { buildCsp, createNonce } from '@/lib/security/csp';
import { SESSION_COOKIE } from '@/lib/security/session-cookie';

/**
 * Runs before every page (20-frontend-specification.md section 7.3):
 *
 * - Sets the Content Security Policy with a nonce made for this response, and hands the nonce to the render
 *   in the `x-nonce` request header. Next.js also reads it from the request's policy for its own tags.
 * - Sends a request without a session cookie to sign in, keeping where it was going in `next`. It never
 *   validates the session; the API does, and a page whose session is gone hears 401 from it.
 * - Marks every page that needs a session `private, no-store`, so no cache keeps one person's page.
 */

/** Pages that need no session, besides the auth pages: the component preview outside production. */
function needsSession(pathname: string): boolean {
  if (isPublicPath(pathname)) return false;
  const preview = pathname === '/design-system' || pathname.startsWith('/design-system/');
  return !(preview && publicEnv.NEXT_PUBLIC_APP_ENV !== 'production');
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const { pathname, search, protocol } = request.nextUrl;
  // Behind the TLS proxy the app hears plain http; the proxy says what the browser used
  const secure = protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  const policy = buildCsp({ nonce, development: process.env.NODE_ENV === 'development', secure });
  const privatePage = needsSession(pathname);

  if (privatePage && !request.cookies.has(SESSION_COOKIE)) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${pathname}${search}`);
    const redirect = NextResponse.redirect(login);
    redirect.headers.set('Content-Security-Policy', policy);
    return redirect;
  }

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  // Where the page is, for a layout that sends a stale session to sign in and back (it has no other way
  // to know the path below it). Set here, so a client cannot choose it.
  headers.set(PATHNAME_HEADER, `${pathname}${search}`);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  if (privatePage) response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not the API, not Next.js's own routes and assets, not `/.well-known/*`, not top-level
      // files such as the mock worker or icons. Prefetches run it too: a header that skipped it would let
      // any client turn off the policy and the redirect. A dotted path below the top level is a page (slugs
      // have no dots, so it is a 404 page), and it gets the policy.
      source: '/((?!api(?:/|$)|_next/|\\.well-known/|[^/]*\\.[a-z0-9]+$).*)',
    },
  ],
};
