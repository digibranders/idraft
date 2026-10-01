/**
 * The host a person means when they type a domain, for the preview under `DomainInput`
 * (10-forms.md section 12). A preview only: the API canonicalizes every domain it stores
 * (14-citation-intelligence.md section 3) and its answer wins, so this never decides what is kept.
 */

export type DomainProblem = 'empty' | 'spaces' | 'scheme' | 'host' | 'private';

export type NormalizedDomain =
  { ok: true; domain: string; ignoredPath: string | null } | { ok: false; code: DomainProblem };

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
  const hasScheme = scheme !== undefined && !PORT_AFTER_HOST.test(value);
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
  const ignored = `${path}${url.search}`;
  return { ok: true, domain: host, ignoredPath: ignored === '' ? null : ignored };
}

/** The catalog key of the message for each problem, under `common.domain` (10-forms.md section 12). */
export type DomainMessageKey = 'empty' | 'spaces' | 'scheme' | 'invalid' | 'private';

export const domainMessageKey = (problem: DomainProblem): DomainMessageKey =>
  problem === 'host' ? 'invalid' : problem;
