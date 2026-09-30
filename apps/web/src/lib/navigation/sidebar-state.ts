/**
 * The person's choice of an expanded or collapsed sidebar at 1280 px and up (19-responsive-behavior.md
 * section 3.1). It is kept in a cookie, not in browser storage, so the server renders `<html
 * data-sidebar>` with it and the sidebar never changes width after the page loads. It is a display
 * preference only; nothing reads it on the server but the root layout.
 */
export const SIDEBAR_COOKIE = 'sightline-sidebar';

export type SidebarPreference = 'expanded' | 'collapsed';

export const parseSidebarPreference = (value: string | undefined): SidebarPreference =>
  value === 'collapsed' ? 'collapsed' : 'expanded';

/** One year: a preference, not a session. */
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * The `document.cookie` assignment that remembers `preference`. `Secure` like every cookie of the app:
 * browsers treat `localhost` as a secure origin, so development over plain http keeps it too.
 */
export const sidebarCookie = (preference: SidebarPreference): string =>
  `${SIDEBAR_COOKIE}=${preference}; Path=/; Max-Age=${String(MAX_AGE_SECONDS)}; SameSite=Lax; Secure`;
