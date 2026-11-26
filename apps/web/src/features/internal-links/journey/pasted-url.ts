const bare = (host: string): string => host.toLowerCase().replace(/^www\./, '');

/**
 * The path to search for when `text` is a page address of the site `host` (with or without the scheme, `www.`, a
 * trailing slash, a query string or a `#fragment`); `null` for any other text, including an address of another site, so that text
 * is searched as typed.
 */
export function pastedPath(text: string, host: string): string | null {
  const trimmed = text.trim();
  if (host === '' || /\s/.test(trimmed)) return null;
  const address = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^(www\.)?[^/]+\.[^/]+\//i.test(trimmed)
      ? `https://${trimmed}`
      : null;
  if (address === null) return null;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (bare(url.hostname) !== bare(host)) return null;
  // The query string is dropped: pasted links carry tracking parameters, and crawled pages are told apart by path
  return url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
}
