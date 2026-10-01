import type { components } from '@/lib/api/schema';

type DomainRef = components['schemas']['DomainRef'];

/**
 * Domains as the API returns them (`DomainRef`, 19 section 3.3). The API keeps one row per host in a global
 * dictionary with an integer id; the mocks derive the id from the host, so the same host has the same id in
 * every process and nothing needs to be stored.
 */

/**
 * Suffixes under which anyone can register a name, beyond the last label: a small part of the Public Suffix
 * List, enough for the mocks to refuse a registrable rule on one (19 section 3.4, `domain_is_public_suffix`).
 */
const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.in',
  'co.jp',
  'com.br',
  'co.nz',
  'com.mx',
  'github.io',
  'gitlab.io',
  'netlify.app',
  'vercel.app',
  'pages.dev',
  'herokuapp.com',
  'blogspot.com',
]);

/** The public suffix of `host`: the longest listed suffix it ends with, else its last label. */
function publicSuffix(host: string): string {
  const labels = host.split('.');
  for (let index = 0; index < labels.length - 1; index += 1) {
    const candidate = labels.slice(index).join('.');
    if (MULTI_LABEL_SUFFIXES.has(candidate)) return candidate;
  }
  return labels.at(-1) ?? host;
}

/** Whether `host` is itself a public suffix (`co.uk`, `github.io`), so a registrable rule would claim every site. */
export const isPublicSuffix = (host: string): boolean => publicSuffix(host) === host;

/** The name registered under the public suffix: `blog.acme.co.uk` is `acme.co.uk`. */
export function registrableDomain(host: string): string {
  const suffix = publicSuffix(host);
  if (suffix === host) return host;
  const owner = host
    .slice(0, -(suffix.length + 1))
    .split('.')
    .at(-1);
  return owner === undefined ? host : `${owner}.${suffix}`;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const POSITIVE_INT = 0x7fffffff;

/** A stable positive id for `host` (FNV-1a), as the API's `domain_id` would be. */
export function domainId(host: string): number {
  let hash = FNV_OFFSET;
  for (const char of host) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash & POSITIVE_INT) + 1;
}

/** The `DomainRef` of a canonical host. The mocks classify nothing, so the category is null. */
export function domainRefFactory(host: string, overrides: Partial<DomainRef> = {}): DomainRef {
  return {
    domain_id: domainId(host),
    host,
    registrable_domain: registrableDomain(host),
    category: null,
    category_source: null,
    ...overrides,
  };
}
