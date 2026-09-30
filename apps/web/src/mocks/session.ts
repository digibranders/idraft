import { MOCK_INVITED_USER, MOCK_USERS, type MockUserSeed } from './fixtures';
import { SESSION_COOKIE } from '@/lib/security/session-cookie';

/**
 * The mock session lives in the session cookie itself, so the browser's worker and the server's MSW (two
 * processes that share no memory) agree on who is signed in. The value is readable on purpose: this is
 * a development fixture, and the real cookie is an opaque token set by the API.
 *
 *   __Host-session=mock.active.<user id>.<fresh until, epoch ms>
 *   __Host-session=mock.totp.<user id>.<pending until, epoch ms>   (password given, second factor owed)
 *
 * Unlike the API's cookie it cannot be HttpOnly: MSW sets a mocked cookie through `document.cookie`, which
 * refuses HttpOnly, so page scripts can read it. Nothing in the app may rely on that.
 */
export { SESSION_COOKIE };

/** A sign-in or re-authentication counts as fresh for 10 minutes (backend auth/sessions.py, FRESH_FOR). */
export const FRESH_MS = 10 * 60 * 1000;
/** A pending second-factor session lasts 10 minutes (PENDING_TOTP_LIFETIME). */
export const PENDING_MS = 10 * 60 * 1000;
/** The API's absolute session lifetime (SESSION_ABSOLUTE), as the cookie's lifetime. */
const ACTIVE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const PENDING_MAX_AGE_SECONDS = PENDING_MS / 1000;
/** The name a user saved through `PATCH /me`, kept in a cookie so the server's MSW sees it too. */
export const NAME_COOKIE = 'mock-name';

export interface MockSession {
  readonly state: 'active' | 'totp';
  readonly user: MockUserSeed;
  /** Fresh until, for an active session; valid until, for a pending one. Epoch milliseconds. */
  readonly until: number;
}

/**
 * A cookie of the page, where there is a page. A browser sends it with every same-origin request; the fetch
 * of a jsdom test does not, so component tests would otherwise never be signed in.
 */
function documentCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const pair = document.cookie.split('; ').find((cookie) => cookie.startsWith(`${name}=`));
  return pair?.slice(name.length + 1);
}

/** A cookie of the request, or of the page. */
export const cookieOf = (cookies: Readonly<Record<string, string>>, name: string): string | undefined =>
  cookies[name] ?? documentCookie(name);

export function readSession(cookies: Readonly<Record<string, string>>): MockSession | null {
  const [prefix, state, userId, until] = (cookieOf(cookies, SESSION_COOKIE) ?? '').split('.');
  if (prefix !== 'mock' || (state !== 'active' && state !== 'totp')) return null;
  const user = [...MOCK_USERS, MOCK_INVITED_USER].find((candidate) => candidate.user_id === userId);
  return user ? { state, user, until: Number(until) || 0 } : null;
}

/** Whether an active session may do something sensitive now, without signing in again. */
export const isFresh = (session: MockSession, now: number = Date.now()): boolean =>
  session.state === 'active' && session.until > now;

/** The `Set-Cookie` of an active session, fresh for 10 minutes. `__Host-` needs `Secure` and `Path=/`. */
export function activeSessionCookie(user: MockUserSeed, now: number = Date.now()): string {
  return `${SESSION_COOKIE}=mock.active.${user.user_id}.${String(now + FRESH_MS)}; Path=/; Secure; SameSite=Lax; Max-Age=${String(ACTIVE_MAX_AGE_SECONDS)}`;
}

/** The `Set-Cookie` of a pending second-factor session, valid for 10 minutes. */
export function pendingSessionCookie(user: MockUserSeed, now: number = Date.now()): string {
  return `${SESSION_COOKIE}=mock.totp.${user.user_id}.${String(now + PENDING_MS)}; Path=/; Secure; SameSite=Lax; Max-Age=${String(PENDING_MAX_AGE_SECONDS)}`;
}

export const clearedSessionCookie = `${SESSION_COOKIE}=; Path=/; Secure; SameSite=Lax; Max-Age=0`;

/** A cookie of the mocks' memory: it outlives a page load, and the server's MSW sees it too. */
const memoryCookie = (name: string, value: string): string =>
  `${name}=${encodeURIComponent(value)}; Path=/; Secure; SameSite=Lax; Max-Age=${String(ACTIVE_MAX_AGE_SECONDS)}`;

export const nameCookie = (name: string): string => memoryCookie(NAME_COOKIE, name);

/**
 * The password the invited person chose when they registered with the invitation token. A development
 * fixture, readable on purpose like the session cookie: the page loads between registering and signing in,
 * and memory does not survive that.
 */
export const INVITEE_COOKIE = 'mock-invitee';
export const inviteeCookie = (password: string): string => memoryCookie(INVITEE_COOKIE, password);
/** Set once the invited person accepted the invitation; until then they belong to no workspace. */
export const JOINED_COOKIE = 'mock-joined';
export const joinedCookie = memoryCookie(JOINED_COOKIE, 'yes');

/** Every cookie of the mocks: a test expires them all, so it starts from the fixtures, signed out. */
export const MOCK_COOKIES: readonly string[] = [SESSION_COOKIE, NAME_COOKIE, INVITEE_COOKIE, JOINED_COOKIE];

/** The `Set-Cookie` that expires cookie `name`. */
export const expiredCookie = (name: string): string => `${name}=; Path=/; Secure; SameSite=Lax; Max-Age=0`;

/** The password the invited person registered with, if they did. */
export function inviteePassword(cookies: Readonly<Record<string, string>>): string | undefined {
  const saved = cookieOf(cookies, INVITEE_COOKIE);
  return saved === undefined || saved === '' ? undefined : decodeURIComponent(saved);
}

/** Whether the invited person has joined the workspace. */
export const hasJoined = (cookies: Readonly<Record<string, string>>): boolean =>
  cookieOf(cookies, JOINED_COOKIE) === 'yes';
