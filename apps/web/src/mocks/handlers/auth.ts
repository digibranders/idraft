import { HttpResponse, type HttpHandler } from 'msw';

import {
  MOCK_INVITED_USER,
  MOCK_PASSWORD,
  MOCK_RECOVERY_CODE,
  MOCK_TOKENS,
  MOCK_TOTP_CODE,
  MOCK_USERS,
  type MockUserSeed,
} from '../fixtures';
import { checkBody, freshSessionRequired, invalidField, mock, noContent, problem } from '../respond';
import {
  activeSessionCookie,
  clearedSessionCookie,
  isFresh,
  pendingSessionCookie,
  readSession,
  type MockSession,
} from '../session';
import { mockState } from '../state';
import type { Problem } from '@/lib/api/types';

/**
 * The auth routes of 19 section 3.1, with the behavior the auth and account screens depend on. The fixture
 * password and codes are in ../fixtures.ts. As in the API, wrong passwords and wrong codes count together
 * per address, and five lock it for 15 minutes.
 */

const LOCK_AFTER_FAILURES = 5;
const LOCK_SECONDS = 15 * 60;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
/** The API matches the local part of the address in a password from 4 characters on. */
const MIN_LOCAL_PART_MATCH = 4;

/** The lock of an address, if it is locked now. */
function lockOf(email: string, now: number = Date.now()): number | null {
  const attempts = mockState.attempts.get(email);
  return attempts !== undefined && attempts.lockedUntil > now ? attempts.lockedUntil : null;
}

function recordFailure(email: string, now: number = Date.now()): void {
  const failures = (mockState.attempts.get(email)?.failures ?? 0) + 1;
  mockState.attempts.set(email, {
    failures,
    lockedUntil: failures >= LOCK_AFTER_FAILURES ? now + LOCK_SECONDS * 1000 : 0,
  });
}

function lockedOut(request: Request, lockedUntil: number): HttpResponse<Problem> {
  const seconds = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000));
  return problem(request, 'rate_limited', {
    detail: 'Too many attempts. Try again later.',
    retry_after_seconds: seconds,
    headers: { 'retry-after': String(seconds) },
  });
}

/** The password rules the API applies to a new password (19 section 3.1, `weak_password`). */
function weakPasswordReason(password: string, email: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'too_short';
  if (password.length > MAX_PASSWORD_LENGTH) return 'too_long';
  const localPart = email.split('@')[0]?.toLowerCase() ?? '';
  if (localPart.length >= MIN_LOCAL_PART_MATCH && password.toLowerCase().includes(localPart)) return 'contains_email';
  return null;
}

const weakPassword = (request: Request, reason: string): HttpResponse<Problem> =>
  problem(request, 'weak_password', { detail: 'Choose a stronger password.', reason });

const isEmail = (value: string): boolean => /^[^@\s]+@[^@\s]+$/.test(value);

/** The fixture user with this address and password, or the invited person once they registered. */
function userFor(email: string, password: string): MockUserSeed | null {
  const fixture = MOCK_USERS.find((user) => user.email === email);
  if (fixture) return password === MOCK_PASSWORD ? fixture : null;
  const chosen = mockState.registered.get(email);
  return email === MOCK_INVITED_USER.email && chosen !== undefined && password === chosen ? MOCK_INVITED_USER : null;
}

const signedIn = (session: MockSession | null): session is MockSession => session?.state === 'active';

export const authHandlers: HttpHandler[] = [
  mock('post', '/api/v1/auth/sign-in', async ({ request }) => {
    const body = await request.json();
    const refused = checkBody(request, body, { required: ['email', 'password'] });
    if (refused) return refused;
    if (!isEmail(body.email)) return invalidField(request, 'email', 'value_error', 'Enter an email address.');
    const address = body.email.toLowerCase();
    const lock = lockOf(address);
    if (lock !== null) return lockedOut(request, lock);
    const user = userFor(address, body.password);
    if (!user) {
      recordFailure(address);
      return problem(request, 'invalid_credentials');
    }
    // The count is cleared only once the second factor is given too, so the code step cannot reset it
    if (user.two_factor_enabled) {
      return HttpResponse.json({ status: 'totp_required' }, { headers: { 'set-cookie': pendingSessionCookie(user) } });
    }
    mockState.attempts.delete(address);
    return HttpResponse.json({ status: 'signed_in' }, { headers: { 'set-cookie': activeSessionCookie(user) } });
  }),

  mock('post', '/api/v1/auth/totp/verify', async ({ request, cookies }) => {
    const session = readSession(cookies);
    if (!session) return problem(request, 'unauthenticated');
    if (session.state === 'totp' && session.until <= Date.now()) return problem(request, 'session_expired');
    const body = await request.json();
    const refused = checkBody(request, body, { exactlyOne: ['code', 'recovery_code'] });
    if (refused) return refused;
    const address = session.user.email;
    const lock = lockOf(address);
    if (lock !== null) return lockedOut(request, lock);
    const accepted = body.code === MOCK_TOTP_CODE || body.recovery_code === MOCK_RECOVERY_CODE;
    if (!accepted || !session.user.two_factor_enabled) {
      recordFailure(address);
      return problem(request, 'invalid_code');
    }
    mockState.attempts.delete(address);
    // A pending session becomes active; an active one is made fresh again
    return HttpResponse.json({ status: 'ok' }, { headers: { 'set-cookie': activeSessionCookie(session.user) } });
  }),

  mock('post', '/api/v1/auth/sign-out', () => noContent({ 'set-cookie': clearedSessionCookie })),

  // The same answer whether or not the address has an account, so the form cannot be used to find accounts
  mock('post', '/api/v1/auth/password-reset/request', async ({ request }) => {
    const refused = checkBody(request, await request.json(), { required: ['email'] });
    return refused ?? HttpResponse.json({ status: 'accepted' }, { status: 202 });
  }),

  mock('post', '/api/v1/auth/password-reset/confirm', async ({ request }) => {
    const body = await request.json();
    const refused = checkBody(request, body, { required: ['token', 'new_password'] });
    if (refused) return refused;
    if (body.token !== MOCK_TOKENS.reset) return problem(request, 'invalid_token');
    const reason = weakPasswordReason(body.new_password, '');
    return reason ? weakPassword(request, reason) : HttpResponse.json({ status: 'ok' });
  }),

  mock('post', '/api/v1/auth/verify-email', async ({ request }) => {
    const body = await request.json();
    const refused = checkBody(request, body, { required: ['token'] });
    if (refused) return refused;
    return body.token === MOCK_TOKENS.verifyEmail
      ? HttpResponse.json({ status: 'ok' })
      : problem(request, 'invalid_token');
  }),

  mock('post', '/api/v1/auth/verify-email/request', async ({ request }) => {
    const refused = checkBody(request, await request.json(), { required: ['email'] });
    return refused ?? HttpResponse.json({ status: 'accepted' }, { status: 202 });
  }),

  mock('post', '/api/v1/auth/register', async ({ request }) => {
    const body = await request.json();
    const refused = checkBody(request, body, {
      required: ['name', 'email', 'password'],
      optional: ['invitation_token'],
    });
    if (refused) return refused;
    if (body.name.trim() === '') return invalidField(request, 'name', 'string_too_short', 'Enter your name.');
    if (!isEmail(body.email)) return invalidField(request, 'email', 'value_error', 'Enter an email address.');
    const address = body.email.toLowerCase();
    // The invitation is bound to the address it was sent to; one answer for every reason it cannot be used
    if (body.invitation_token !== MOCK_TOKENS.invitation || address !== MOCK_INVITED_USER.email) {
      return problem(request, 'registration_closed');
    }
    const reason = weakPasswordReason(body.password, address);
    if (reason) return weakPassword(request, reason);
    if (mockState.registered.has(address)) {
      return problem(request, 'duplicate', { detail: 'An account with this email exists.' });
    }
    mockState.registered.set(address, body.password);
    return HttpResponse.json({ user_id: MOCK_INVITED_USER.user_id, email_verified: true }, { status: 201 });
  }),

  mock('post', '/api/v1/auth/password/change', async ({ request, cookies }) => {
    const session = readSession(cookies);
    if (!signedIn(session)) return problem(request, 'unauthenticated');
    if (!isFresh(session)) return freshSessionRequired(request);
    const body = await request.json();
    const refused = checkBody(request, body, { required: ['current_password', 'new_password'] });
    if (refused) return refused;
    if (body.current_password !== MOCK_PASSWORD) return problem(request, 'invalid_credentials');
    const reason =
      body.new_password === body.current_password
        ? 'unchanged'
        : weakPasswordReason(body.new_password, session.user.email);
    if (reason) return weakPassword(request, reason);
    // A new password signs out every other session (19 section 3.1)
    revoke(session.user.user_id, otherSessionIds());
    return HttpResponse.json({ status: 'ok' });
  }),

  mock('get', '/api/v1/auth/sessions', ({ request, cookies }) => {
    const session = readSession(cookies);
    if (!signedIn(session)) return problem(request, 'unauthenticated');
    const revoked = mockState.revokedSessions.get(session.user.user_id) ?? new Set<string>();
    return HttpResponse.json({ data: sessionList().filter((item) => !revoked.has(item.session_id)) });
  }),

  mock('delete', '/api/v1/auth/sessions/{session_id}', ({ request, cookies, params }) => {
    const session = readSession(cookies);
    if (!signedIn(session)) return problem(request, 'unauthenticated');
    const revoked = mockState.revokedSessions.get(session.user.user_id) ?? new Set<string>();
    const target = sessionList().find((item) => item.session_id === params.session_id);
    if (!target || revoked.has(target.session_id)) return problem(request, 'not_found');
    // Signing out this device's own session ends it here too
    if (target.is_current) return noContent({ 'set-cookie': clearedSessionCookie });
    revoke(session.user.user_id, [target.session_id]);
    return noContent();
  }),

  mock('post', '/api/v1/auth/sessions/revoke-others', ({ request, cookies }) => {
    const session = readSession(cookies);
    if (!signedIn(session)) return problem(request, 'unauthenticated');
    revoke(session.user.user_id, otherSessionIds());
    return noContent();
  }),
];

function revoke(userId: string, sessionIds: readonly string[]): void {
  const revoked = mockState.revokedSessions.get(userId) ?? new Set<string>();
  for (const id of sessionIds) revoked.add(id);
  mockState.revokedSessions.set(userId, revoked);
}

const otherSessionIds = (): string[] =>
  sessionList()
    .filter((item) => !item.is_current)
    .map((item) => item.session_id);

/** The signed-in sessions of a fixture user: this browser, a phone and a laptop elsewhere. */
function sessionList(): {
  session_id: string;
  created_at: string;
  last_seen_at: string;
  ip: string | null;
  user_agent: string | null;
  is_current: boolean;
}[] {
  return [
    {
      session_id: '0192d1a8-6c20-7d01-8b11-000000000001',
      created_at: '2026-09-28T08:12:00Z',
      last_seen_at: new Date().toISOString(),
      ip: '203.0.113.24',
      user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141.0 Safari/537.36',
      is_current: true,
    },
    {
      session_id: '0192d1a8-6c20-7d01-8b11-000000000002',
      created_at: '2026-09-25T17:40:00Z',
      last_seen_at: '2026-09-29T21:05:00Z',
      ip: '198.51.100.7',
      user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) Version/18.6 Mobile Safari/604.1',
      is_current: false,
    },
    {
      session_id: '0192d1a8-6c20-7d01-8b11-000000000003',
      created_at: '2026-09-10T10:02:00Z',
      last_seen_at: '2026-09-22T14:31:00Z',
      ip: null,
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/143.0',
      is_current: false,
    },
  ];
}
