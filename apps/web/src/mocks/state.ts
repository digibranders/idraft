/**
 * What the mocks remember between requests: failed attempts, accounts registered through the invitation,
 * sessions signed out elsewhere. It lives in the memory of one process, so a page reload (in the browser)
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
  /** Accounts registered with the invitation token: email address to the password chosen. */
  readonly registered: Map<string, string>;
  /** Sessions of the session list that were signed out, per user. */
  readonly revokedSessions: Map<string, Set<string>>;
}

export const mockState: MockState = {
  attempts: new Map(),
  registered: new Map(),
  revokedSessions: new Map(),
};

/** Forgets everything, so each test starts from the fixtures. */
export function resetMockState(): void {
  mockState.attempts.clear();
  mockState.registered.clear();
  mockState.revokedSessions.clear();
}
