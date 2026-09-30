/**
 * The Content Security Policy of every page (20-frontend-specification.md section 7.3, 24-security.md
 * section 7.1). It carries a nonce that is new for every response, so it is built per request by the
 * proxy, not set as a static header.
 *
 * - Scripts run only with the nonce, and what they load (`strict-dynamic`); inline `<style>` elements need
 *   the nonce too. Next.js reads the nonce from the request's policy and puts it on its own tags, and Base UI
 *   gets it through `CSPProvider`.
 * - Style attributes in the server-rendered HTML are allowed (`style-src-attr 'unsafe-inline'`): React and
 *   Base UI render them (the hidden input of a radio group, a size read from a token), a nonce cannot cover
 *   an attribute, and an attribute can style one element but never run script or load anything.
 * - The API is on the same origin, so `connect-src` names only Sentry's ingest.
 * - Images: the app's own, data and blob URLs, and the favicon endpoint of domain-first tables (07-icons.md
 *   section 5). The endpoint answers with a redirect to a `gstatic.com` host, and a browser checks the
 *   host it is redirected to, so that host is allowed too.
 * - `upgrade-insecure-requests` only when the page was requested over https: on plain http (a test run
 *   against `http://web:3000`, WebKit on localhost) it would move the page's own requests to an https
 *   origin that does not answer.
 * - Development adds `'unsafe-eval'`, which React uses to rebuild server error stacks, and `ws:` for hot
 *   reload, and allows inline styles without the nonce: the dev overlay's styles carry none. Production
 *   never has any of these.
 */

export const FAVICON_SOURCES = ['https://www.google.com/s2/favicons', 'https://*.gstatic.com'] as const;
const SENTRY_INGEST = 'https://*.ingest.sentry.io';

export interface CspOptions {
  /** Base64, fresh for every response. */
  nonce: string;
  development: boolean;
  /** Whether the page was requested over https (directly, or through the TLS proxy). */
  secure: boolean;
}

export function buildCsp({ nonce, development, secure }: CspOptions): string {
  const nonceSource = `'nonce-${nonce}'`;
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    ['script-src', "'self'", nonceSource, "'strict-dynamic'", ...(development ? ["'unsafe-eval'"] : [])],
    // A nonce makes browsers ignore 'unsafe-inline', so development drops the nonce here
    ['style-src', "'self'", development ? "'unsafe-inline'" : nonceSource],
    ['style-src-attr', "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', 'blob:', ...FAVICON_SOURCES],
    ['font-src', "'self'"],
    ['connect-src', "'self'", SENTRY_INGEST, ...(development ? ['ws:'] : [])],
    ['worker-src', "'self'", 'blob:'],
    ['object-src', "'none'"],
    ['frame-ancestors', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ...(secure ? [['upgrade-insecure-requests'] as [string]] : []),
  ];
  return directives.map((directive) => directive.join(' ')).join('; ');
}

/** 128 random bits in base64, for one response. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
