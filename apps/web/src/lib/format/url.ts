/**
 * URL and domain display. Display only: the original URL is always kept in data and in the copy action.
 * Canonicalization for identity is a backend concern (docs/14-citation-intelligence.md section 3).
 * Spec: docs/design-system/22-content-formatting.md section 5.
 */

const TRACKING_PARAMS = new Set([
  'gclid',
  'gbraid',
  'wbraid',
  'dclid',
  'fbclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  'igshid',
  'srsltid',
  'yclid',
  'ref',
  'ref_src',
  'spm',
  '_ga',
  '_gl',
  'mkt_tok',
]);

export interface DisplayUrl {
  /** Host without "www.": "example.com", "docs.example.com" */
  host: string;
  /** Path plus meaningful query, no fragment: "/blog/article-title" */
  path: string;
  /** "example.com/blog/article-title" */
  display: string;
  /** Original input, used for copy and open actions. */
  original: string;
  /** False when the input could not be parsed; display then equals the input. */
  valid: boolean;
}

/**
 * `raw` when it is an absolute http or https address, `null` for anything else: a script or data scheme, a
 * relative address, text that is no address, an address with a user name or a password (its host is the part
 * after the `@`, which is not the one that reads first). For a link's `href`, which must never carry a scheme
 * the browser would run. It reads the address as the browser does, so whitespace and control characters
 * before the scheme, or inside it, do not hide a scheme. The value comes back exactly as it was given, since
 * it is what a click opens and a copy puts on the clipboard.
 */
export function webHref(raw: string): string | null {
  try {
    const { protocol, username, password } = new URL(raw);
    const web = protocol === 'http:' || protocol === 'https:';
    return web && username === '' && password === '' ? raw : null;
  } catch {
    return null;
  }
}

export function displayDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h.startsWith('www.') ? h.slice(4) : h;
}

export function displayUrl(raw: string): DisplayUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { host: raw, path: '', display: raw, original: raw, valid: false };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { host: raw, path: '', display: raw, original: raw, valid: false };
  }
  const host = displayDomain(url.hostname);
  const kept = [...url.searchParams.entries()].filter(
    ([k]) => !k.toLowerCase().startsWith('utm_') && !TRACKING_PARAMS.has(k.toLowerCase()),
  );
  let path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  try {
    path = decodeURI(path);
  } catch {
    // keep encoded path when it is not valid UTF-8
  }
  if (kept.length > 0) path += `?${new URLSearchParams(kept).toString()}`;
  return { host, path: path || '/', display: `${host}${path}`, original: raw, valid: true };
}

/**
 * Middle truncation for paths that keep the start and the last segment:
 * "/blog/2026/09/how-to-choose-a-crm" at 24 -> "/blog/…/how-to-choose-a-crm" when it fits.
 */
export function truncatePath(path: string, maxChars: number): string {
  if (path.length <= maxChars) return path;
  const segments = path.split('/');
  const last = segments[segments.length - 1] ?? '';
  const first = segments[1] ? `/${segments[1]}` : '';
  const candidate = `${first}/…/${last}`;
  if (candidate.length <= maxChars) return candidate;
  return `${path.slice(0, Math.max(1, maxChars - 1))}…`;
}
