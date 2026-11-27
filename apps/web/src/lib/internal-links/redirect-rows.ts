import type { PageRow } from './types';

/** The fields of a page the redirect note reads. */
export type RedirectFacts = Pick<PageRow, 'status_code' | 'url' | 'redirect_url'> &
  Partial<Pick<PageRow, 'resource_type'>>;

/** What a redirect row says beside its path: where it leads, and its own host when that is not the site's. */
export interface RedirectNote {
  /** The path the redirect leads to, "?" when its target is not known. */
  target: string;
  /** The row's own host when it differs from the site's (the www form), else `null`. */
  host: string | null;
}

const urlOf = (text: string | null): URL | null => {
  if (text === null) return null;
  try {
    return new URL(text);
  } catch {
    return null;
  }
};

/** Whether the row is a redirect: a crawled address that answers 3xx and leads elsewhere, never a page of its own. */
export const isRedirectRow = (row: RedirectFacts): boolean =>
  row.resource_type === 'redirect' ||
  (row.status_code !== null && row.status_code >= 300 && row.status_code < 400 && row.redirect_url !== null);

/** The host of an address when it is not the site's (the www form), else `null`: two rows can share a path across hosts. */
export function otherHost(url: string | null, siteHost: string): string | null {
  const own = urlOf(url)?.hostname ?? null;
  return own !== null && siteHost !== '' && own.toLowerCase() !== siteHost.toLowerCase() ? own : null;
}

/**
 * The note of a redirect row, `null` for any other row. Two rows can share a path (`/` on the site and `/` on its www
 * form, which answers 301), so the note names the row's own host when it is not `siteHost`.
 */
export function redirectNote(row: RedirectFacts, siteHost: string): RedirectNote | null {
  if (!isRedirectRow(row)) return null;
  const target = urlOf(row.redirect_url);
  return {
    target: target === null ? (row.redirect_url ?? '?') : `${target.pathname}${target.search}`,
    host: otherHost(row.url, siteHost),
  };
}
