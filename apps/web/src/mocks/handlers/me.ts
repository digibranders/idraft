import { HttpResponse, type HttpHandler } from 'msw';

import { meFactory, membershipFactory, workspaceFactory } from '../factories/identity';
import { MOCK_PASSWORD, MOCK_TOTP_CODE } from '../fixtures';
import { checkBody, invalidField, mock, problem } from '../respond';
import {
  activeSessionCookie,
  cookieOf,
  FRESH_MS,
  isFresh,
  NAME_COOKIE,
  nameCookie,
  plainCookieText,
  readSession,
  type MockSession,
} from '../session';
import { readChanges, workspacesOf } from '../workspace-state';
import type { Me } from '@/lib/api/types';

/** The API allows names up to 120 characters. */
const MAX_NAME_LENGTH = 120;

/**
 * `/me` for the signed-in fixture user, with the name they last saved (kept in a cookie, so the server's
 * MSW sees it as well as the browser's), the freshness of their session, and their workspaces as this
 * browser changed them (../workspace-state.ts). The invited person belongs to no workspace until they
 * accept the invitation.
 */
export function currentMe(session: MockSession, cookies: Readonly<Record<string, string>>): Me {
  const saved = cookieOf(cookies, NAME_COOKIE);
  const memberships = workspacesOf(session.user, readChanges(cookies), cookies).map(({ workspace, membership }) =>
    membershipFactory(membership.role, {
      projectIds: membership.project_ids,
      workspace: workspaceFactory(workspace),
    }),
  );
  return meFactory(session.user, {
    user: saved === undefined || saved === '' ? {} : { name: plainCookieText(saved) },
    session: { fresh_until: isFresh(session) ? new Date(session.until).toISOString() : null },
    memberships,
  });
}

const signedIn = (session: MockSession | null): session is MockSession => session?.state === 'active';

export const meHandlers: HttpHandler[] = [
  // A pending second-factor session is not signed in: every route but totp/verify and sign-out answers 401
  mock('get', '/api/v1/me', ({ request, cookies }) => {
    const session = readSession(cookies);
    return signedIn(session)
      ? HttpResponse.json({ data: currentMe(session, cookies) })
      : problem(request, 'unauthenticated');
  }),

  mock('patch', '/api/v1/me', async ({ request, cookies }) => {
    const session = readSession(cookies);
    if (!signedIn(session)) return problem(request, 'unauthenticated');
    const body = await request.json();
    const refused = checkBody(request, body, { optional: ['name', 'image'] });
    if (refused) return refused;
    if (body.name === undefined) return HttpResponse.json({ data: currentMe(session, cookies) });
    const name = body.name.trim();
    if (name === '') return invalidField(request, 'name', 'string_too_short', 'Enter your name.');
    if (name.length > MAX_NAME_LENGTH) {
      return invalidField(request, 'name', 'string_too_long', `At most ${String(MAX_NAME_LENGTH)} characters.`);
    }
    const saved = { ...cookies, [NAME_COOKIE]: encodeURIComponent(name) };
    return HttpResponse.json({ data: currentMe(session, saved) }, { headers: { 'set-cookie': nameCookie(name) } });
  }),

  mock('post', '/api/v1/me/reauthenticate', async ({ request, cookies }) => {
    const session = readSession(cookies);
    if (!signedIn(session)) return problem(request, 'unauthenticated');
    const body = await request.json();
    const refused = checkBody(request, body, { exactlyOne: ['password', 'totp_code'] });
    if (refused) return refused;
    // A user with a second factor confirms with the code; the password alone is refused (19 section 3.1)
    if (session.user.two_factor_enabled && typeof body.totp_code !== 'string') {
      return problem(request, 'second_factor_required');
    }
    // One answer for a wrong password and a wrong code, as in the API
    const accepted = session.user.two_factor_enabled
      ? body.totp_code === MOCK_TOTP_CODE
      : body.password === MOCK_PASSWORD;
    if (!accepted) return problem(request, 'invalid_credentials');
    const now = Date.now();
    return HttpResponse.json(
      { fresh_until: new Date(now + FRESH_MS).toISOString() },
      { headers: { 'set-cookie': activeSessionCookie(session.user, now) } },
    );
  }),
];
