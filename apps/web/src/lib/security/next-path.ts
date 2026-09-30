/**
 * Where to send a person after they sign in, from the `next` query parameter. Only a path of this app is
 * accepted; anything else could send them to another site with the app's trust (an open redirect), so it
 * becomes `/`.
 *
 * Refused: an empty or overlong value; anything not starting with exactly one `/` (`//evil.example` and
 * `/\evil` are read by browsers as another host); a scheme (`javascript:`, `https:`); control characters,
 * which browsers strip before parsing; and API paths, which are not pages. The value is normalised (dot
 * segments resolved) and the checks run again on the result, because resolving `/.//evil.example` gives
 * `//evil.example`.
 */
const HOME = '/';
const BASE = 'http://app.invalid';
/** Longer than any path of the app with its filters; a longer value is not one the app made. */
const MAX_LENGTH = 2048;
const DELETE = 0x7f;

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === DELETE;
  });

/** Whether a browser reads `value` as a path on this origin. */
function isLocalPath(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  if (hasControlCharacter(value) || value.includes('\\')) return false;
  return new URL(value, BASE).origin === BASE;
}

/** API paths are matched without regard to case, as the dev server's rewrite matches them. */
function isApiPath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return lower === '/api' || lower.startsWith('/api/');
}

export function safeNextPath(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '' || value.length > MAX_LENGTH) return HOME;
  if (!isLocalPath(value)) return HOME;
  const url = new URL(value, BASE);
  const result = `${url.pathname}${url.search}${url.hash}`;
  if (!isLocalPath(result) || isApiPath(url.pathname)) return HOME;
  return result;
}
