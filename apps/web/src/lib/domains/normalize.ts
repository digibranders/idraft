/**
 * The host a person means when they type a domain, for the preview under `DomainInput`
 * (10-forms.md section 12). A preview only: the API canonicalizes every domain it stores
 * (14-citation-intelligence.md section 3) and its answer wins, so this never decides what is kept.
 */

export type DomainProblem = 'empty' | 'spaces' | 'scheme' | 'host' | 'private';

export type NormalizedDomain =
  | {
      ok: true;
      /** The host as the API compares it: lower case, ASCII (punycode for international names). */
      domain: string;
      /** The same host to show: an international name in its own letters, "bücher.de". */
      display: string;
      /** The path and query that were dropped, decoded for reading, or `null`. */
      ignoredPath: string | null;
    }
  | { ok: false; code: DomainProblem };

/** A scheme at the start: `https:`, `mailto:`. A host with a port (`acme.com:8080`) is not one. */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const PORT_AFTER_HOST = /^[^/:]+:\d+(?:[/?#]|$)/;
/** Labels of letters, digits and inner hyphens, at least two of them, at most 253 characters. */
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
/** Names that only resolve inside a network: never a site to track. */
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

const refuse = (code: DomainProblem): NormalizedDomain => ({ ok: false, code });

function isPrivate(host: string): boolean {
  if (host === 'localhost' || host.startsWith('[') || IPV4.test(host)) return true;
  return PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function normalizeDomain(raw: string): NormalizedDomain {
  const value = raw.trim();
  if (value === '') return refuse('empty');
  if (/\s/.test(value)) return refuse('spaces');

  const scheme = SCHEME.exec(value)?.[1]?.toLowerCase();
  // `acme.com:8080` and `acme.com:` start with a host, not a scheme: a scheme has no dot
  const hasScheme = scheme !== undefined && !scheme.includes('.') && !PORT_AFTER_HOST.test(value);
  if (hasScheme && scheme !== 'http' && scheme !== 'https') return refuse('scheme');

  let url: URL;
  try {
    url = new URL(hasScheme ? value : `https://${value}`);
  } catch {
    return refuse('host');
  }
  if (url.username !== '' || url.password !== '') return refuse('host');

  const withoutDot = url.hostname.toLowerCase().replace(/\.$/, '');
  const host = withoutDot.startsWith('www.') ? withoutDot.slice('www.'.length) : withoutDot;
  if (host === '') return refuse('host');
  if (isPrivate(host)) return refuse('private');
  if (!HOST.test(host)) return refuse('host');

  const path = url.pathname === '/' ? '' : url.pathname;
  const ignored = readable(`${path}${url.search}`);
  return {
    ok: true,
    domain: host,
    display: typedHost(value, hasScheme, host),
    ignoredPath: ignored === '' ? null : ignored,
  };
}

/** Percent-encoded text as the person typed it: `/caf%C3%A9` reads `/café`. */
function readable(encoded: string): string {
  try {
    return decodeURI(encoded);
  } catch {
    return encoded;
  }
}

/**
 * The host in the letters it was typed in, when it is the same host as `ascii`: the URL parser turns an
 * international name into punycode, which nobody reads.
 */
function typedHost(value: string, hasScheme: boolean, ascii: string): string {
  const withoutScheme = hasScheme ? value.replace(/^[a-z][a-z0-9+.-]*:\/*/i, '') : value;
  const hostPart = (withoutScheme.split(/[/?#]/, 1)[0] ?? '').replace(/:\d*$/, '').toLowerCase().replace(/\.$/, '');
  const typed = hostPart.startsWith('www.') ? hostPart.slice('www.'.length) : hostPart;
  try {
    return new URL(`https://${typed}`).hostname === ascii ? typed : ascii;
  } catch {
    return ascii;
  }
}

/** The catalog key of the message for each problem, under `common.domain` (10-forms.md section 12). */
export type DomainMessageKey = 'empty' | 'spaces' | 'scheme' | 'invalid' | 'private';

export const domainMessageKey = (problem: DomainProblem): DomainMessageKey =>
  problem === 'host' ? 'invalid' : problem;
