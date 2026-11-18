/**
 * Below this width a favicon source sent its own placeholder globe (16 px, with a 404 status that an image
 * element still draws), so the caller shows its own mark instead. A real icon arrives at 32 px or more.
 */
export const FAVICON_MIN_WIDTH = 32;

/**
 * The address of a site's icon, or `null` when the app has none to give, in which case the caller draws its own
 * placeholder mark. The one seam for icons: there is no first-party favicon endpoint yet (backend request 22 in
 * docs/ai-visibility/backend-requests-prompts-page.md), and a cited domain is never sent to a third party, so
 * this answers `null` for every host. Plug the API's route in here when it exists; no caller changes.
 */
export function faviconUrl(host: string): string | null {
  void host;
  return null;
}
