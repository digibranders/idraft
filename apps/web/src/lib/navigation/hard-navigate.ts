/**
 * A full page load of `url`. Used when the session changes (signed in, signed out): the server renders the
 * next page with the new cookie, and nothing of the previous session stays in the browser's memory. A
 * module of its own so tests can replace it; jsdom cannot navigate.
 */
export function hardNavigate(url: string): void {
  window.location.assign(url);
}
