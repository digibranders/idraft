const bare = (host: string): string => host.toLowerCase().replace(/^www\./, '');

/**
 * The host and path of `text` when it is a web address: with `http(s)://`, or a host with a dot followed by a
 * path (`www.site.com/pricing`). The query string and the `#fragment` are dropped (pasted links carry tracking
 * parameters, and crawled pages are told apart by path), and so is a trailing slash. `null` for anything else.
 */
export function parseAddress(text: string): { host: string; path: string } | null {
  const trimmed = text.trim();
  if (/\s/.test(trimmed)) return null;
  const address = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^(www\.)?[^/]+\.[^/]+\//i.test(trimmed)
      ? `https://${trimmed}`
      : null;
  if (address === null) return null;
  try {
    const url = new URL(address);
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    return { host: url.hostname, path };
  } catch {
    return null;
  }
}

/**
 * The path to search for when `text` is a page address of the site `host`; `null` for any other text, including
 * an address of another site, so that text is searched as typed.
 */
export function pastedPath(text: string, host: string): string | null {
  const address = host === '' ? null : parseAddress(text);
  return address !== null && bare(address.host) === bare(host) ? address.path : null;
}

/** The text of a path search: the path of a pasted address of the site, any other text as it is. */
export const searchPathOf = (text: string | null, host: string): string | null =>
  text === null ? null : (pastedPath(text, host) ?? text);

/** A host list entry: the host of a pasted address, any other text as it is. */
export const hostOfEntry = (entry: string): string => parseAddress(entry)?.host ?? entry;
