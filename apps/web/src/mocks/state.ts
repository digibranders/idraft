/**
 * What the mocks remember between requests: failed attempts and sessions signed out
 * elsewhere. It lives in the memory of one process, so a page reload (in the browser)
 * or a server restart forgets it. Identity, and anything the server's MSW must also see (a changed name),
 * is kept in cookies instead (./session.ts).
 */
export interface Attempts {
  failures: number;
  /** Epoch milliseconds; 0 while not locked. */
  lockedUntil: number;
}

export interface MockState {
  /**
   * Failed sign-in steps per email address, lower case. Wrong passwords and wrong codes count together, as
   * in the API; five lock the address for 15 minutes.
   */
  readonly attempts: Map<string, Attempts>;
  /** Sessions of the session list that were signed out, per user. */
  readonly revokedSessions: Map<string, Set<string>>;
}

export const mockState: MockState = {
  attempts: new Map(),
  revokedSessions: new Map(),
};

const resets = new Set<() => void>();

/**
 * Registers what a handler module keeps in memory of its own (the imports of the keyword import mock),
 * to be forgotten with the rest by `resetMockState`.
 */
export function onMockReset(reset: () => void): void {
  resets.add(reset);
}

/** Forgets everything, so each test starts from the fixtures. */
export function resetMockState(): void {
  mockState.attempts.clear();
  mockState.revokedSessions.clear();
  for (const reset of resets) reset();
}
