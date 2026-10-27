/**
 * Where a person's preferences live in `localStorage` (density, number format, shortcuts; the Preferences
 * page of account settings). Every key starts with the prefix and the user id, so two people who share a
 * browser never read each other's, and signing out can remove them all.
 *
 * The theme is not among them: next-themes keeps it under its own key, for the device.
 */
const PREFIX = 'idraft.pref.';

export function preferenceKey(userId: string, name: string): string {
  return `${PREFIX}${userId}.${name}`;
}

/**
 * Removes every preference of every user from `storage` (the page's `localStorage` unless given), on
 * sign-out. A browser that refuses storage (a private window with storage off) has none to remove: even
 * reading `localStorage` throws there, so that is inside the `try` too.
 */
export function clearPreferences(storage?: Storage): void {
  try {
    const store = storage ?? globalThis.localStorage;
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index)).filter(
      (key): key is string => key?.startsWith(PREFIX) === true,
    );
    for (const key of keys) store.removeItem(key);
  } catch (error) {
    // Access to storage throws where the browser forbids it; there is nothing stored to clear then
    if (!(error instanceof DOMException)) throw error;
  }
}
