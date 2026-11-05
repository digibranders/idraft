import { FAVICON_ENDPOINT } from '@/lib/security/csp';

/** Asked for at twice the size it is shown at, so it stays sharp on a dense screen. */
const REQUEST_SIZE = 64;

/**
 * Below this width the service has no icon of the site and sent its own placeholder globe (16 px, with a
 * 404 status that an image element still draws), so the caller shows its own mark instead. A real icon
 * arrives at 32 px or more.
 */
export const FAVICON_MIN_WIDTH = 32;

/** The address of a site's icon on the allowlisted favicon service (07-icons.md section 5). */
export function faviconUrl(host: string): string {
  return `${FAVICON_ENDPOINT}?domain=${encodeURIComponent(host)}&sz=${String(REQUEST_SIZE)}`;
}
