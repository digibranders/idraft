import { describe, expect, it } from 'vitest';

import { handlersFor, unhandledStrategy } from './index';
import { MOCK_INVITATION, pendingHandlers } from './pending';
import {
  MOCK_INVITED_USER,
  MOCK_PASSWORD,
  MOCK_PROJECTS,
  MOCK_RECOVERY_CODE,
  MOCK_TOKENS,
  MOCK_TOTP_CODE,
  MOCK_WORKSPACE,
  mockUser,
} from '../fixtures';
import { SESSION_COOKIE } from '../session';
import { newRequestId } from '@/lib/request-id';
import { TEST_API_ORIGIN } from '@/test/api-server';

interface Answer {
  status: number;
  body: Record<string, unknown>;
  /** The `name=value` of the cookie the answer set, if any. */
  cookie: string | undefined;
  headers: Headers;
}

/** Sends a request to the mocks, as the browser would, with `cookie` as its Cookie header when given. */
async function call(
  method: string,
  path: string,
  {
    body,
    cookie,
    headers = {},
  }: { body?: unknown; cookie?: string | undefined; headers?: Record<string, string> } = {},
): Promise<Answer> {
  const response = await fetch(`${TEST_API_ORIGIN}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie === undefined ? {} : { cookie }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
    cookie: response.headers.get('set-cookie')?.split(';')[0],
    headers: response.headers,
  };
}

async function signIn(email: string, password: string = MOCK_PASSWORD): Promise<string | undefined> {
  return (await call('POST', '/api/v1/auth/sign-in', { body: { email, password } })).cookie;
}

/** An active session of `role` that is no longer fresh. */
const staleSession = (role: 'editor' | 'owner'): string => `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.0`;

describe('sign-in', () => {
  it('signs a user without a second factor in, and /me knows them', async () => {
    const editor = mockUser('editor');
    const answer = await call('POST', '/api/v1/auth/sign-in', {
      body: { email: editor.email, password: MOCK_PASSWORD },
    });
    expect(answer).toMatchObject({ status: 200, body: { status: 'signed_in' } });
    expect(answer.cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=mock\\.active\\.`));
    const me = await call('GET', '/api/v1/me', { cookie: answer.cookie });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      data: {
        user: { email: editor.email },
        memberships: [{ role: 'editor' }],
        session: { fresh_until: expect.any(String) },
      },
    });
  });

  it('answers 401 unauthenticated to /me without a session', async () => {
    expect(await call('GET', '/api/v1/me')).toMatchObject({ status: 401, body: { code: 'unauthenticated' } });
  });

  it('asks a user with two-factor for the code, and /me waits for it', async () => {
    const pending = await signIn(mockUser('owner').email);
    expect((await call('GET', '/api/v1/me', { cookie: pending })).status).toBe(401);
    const wrong = await call('POST', '/api/v1/auth/totp/verify', { body: { code: '000000' }, cookie: pending });
    expect(wrong).toMatchObject({ status: 401, body: { code: 'invalid_code' } });
    const right = await call('POST', '/api/v1/auth/totp/verify', { body: { code: MOCK_TOTP_CODE }, cookie: pending });
    expect(right).toMatchObject({ status: 200, body: { status: 'ok' } });
    expect((await call('GET', '/api/v1/me', { cookie: right.cookie })).status).toBe(200);
  });

  it('accepts a recovery code instead of the code, and one of the two only', async () => {
    const pending = await signIn(mockUser('owner').email);
    const both = await call('POST', '/api/v1/auth/totp/verify', {
      body: { code: MOCK_TOTP_CODE, recovery_code: MOCK_RECOVERY_CODE },
      cookie: pending,
    });
    expect(both).toMatchObject({ status: 422, body: { code: 'validation_failed' } });
    const answer = await call('POST', '/api/v1/auth/totp/verify', {
      body: { recovery_code: MOCK_RECOVERY_CODE },
      cookie: pending,
    });
    expect(answer.status).toBe(200);
  });

  it('answers unauthenticated without a session, and session_expired once the pending one is over', async () => {
    const none = await call('POST', '/api/v1/auth/totp/verify', { body: { code: MOCK_TOTP_CODE } });
    expect(none).toMatchObject({ status: 401, body: { code: 'unauthenticated' } });
    const expired = `${SESSION_COOKIE}=mock.totp.${mockUser('owner').user_id}.${String(Date.now() - 1)}`;
    const late = await call('POST', '/api/v1/auth/totp/verify', { body: { code: MOCK_TOTP_CODE }, cookie: expired });
    expect(late).toMatchObject({ status: 401, body: { code: 'session_expired' } });
  });

  it('sets a pending cookie that lasts 10 minutes', async () => {
    const answer = await call('POST', '/api/v1/auth/sign-in', {
      body: { email: mockUser('owner').email, password: MOCK_PASSWORD },
    });
    expect(answer.headers.get('set-cookie')).toContain('Max-Age=600');
  });

  it('refuses a wrong password, then locks the address after five failures, codes included', async () => {
    const email = mockUser('owner').email;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const answer = await call('POST', '/api/v1/auth/sign-in', { body: { email, password: 'not-the-password' } });
      expect(answer).toMatchObject({ status: 401, body: { code: 'invalid_credentials' } });
    }
    const pending = await signIn(email);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await call('POST', '/api/v1/auth/totp/verify', { body: { code: '000000' }, cookie: pending });
    }
    const locked = await call('POST', '/api/v1/auth/sign-in', { body: { email, password: MOCK_PASSWORD } });
    expect(locked).toMatchObject({ status: 429, body: { code: 'rate_limited', retry_after_seconds: 900 } });
    expect(locked.headers.get('retry-after')).toBe('900');
    expect(locked.headers.get('content-type')).toContain('application/problem+json');
  });

  it('refuses a body the API would refuse: a missing member, an unknown one, an address that is not one', async () => {
    const missing = await call('POST', '/api/v1/auth/sign-in', { body: { email: 'ana@digibranders.test' } });
    expect(missing.body).toMatchObject({ code: 'validation_failed', errors: [{ path: 'password', code: 'missing' }] });
    const extra = await call('POST', '/api/v1/auth/sign-in', {
      body: { email: 'ana@digibranders.test', password: MOCK_PASSWORD, remember: true },
    });
    expect(extra.body).toMatchObject({ errors: [{ path: 'remember', code: 'extra_forbidden' }] });
    const notEmail = await call('POST', '/api/v1/auth/sign-in', { body: { email: 'ana', password: MOCK_PASSWORD } });
    expect(notEmail).toMatchObject({ status: 422, body: { errors: [{ location: 'body', path: 'email' }] } });
  });

  it('answers with the request id it was given', async () => {
    const id = newRequestId();
    const answer = await call('GET', '/api/v1/me', { headers: { 'x-request-id': id } });
    expect(answer.body).toMatchObject({ request_id: id });
    expect(answer.headers.get('x-request-id')).toBe(id);
  });

  it('signs out by clearing the cookie', async () => {
    const answer = await call('POST', '/api/v1/auth/sign-out');
    expect(answer.status).toBe(204);
    expect(answer.cookie).toBe(`${SESSION_COOKIE}=`);
  });
});

describe('registration and emailed links', () => {
  const invited = { name: 'Lena Vogel', email: MOCK_INVITED_USER.email, password: 'a-long-enough-passphrase' };

  it('registers the invited address with the token once, and the new account can sign in', async () => {
    const body = { ...invited, invitation_token: MOCK_TOKENS.invitation };
    const registered = await call('POST', '/api/v1/auth/register', { body });
    expect(registered).toMatchObject({ status: 201, body: { email_verified: true } });
    // The registration is remembered in a cookie, which the browser sends back from then on
    const account = registered.cookie;
    expect(await call('POST', '/api/v1/auth/register', { body, cookie: account })).toMatchObject({
      status: 409,
      body: { code: 'duplicate' },
    });
    const signedIn = await call('POST', '/api/v1/auth/sign-in', {
      body: { email: invited.email, password: invited.password },
      cookie: account,
    });
    const cookie = [account, signedIn.cookie].join('; ');
    expect((await call('GET', '/api/v1/me', { cookie })).body).toMatchObject({
      data: { user: { name: 'Lena Vogel' }, memberships: [] },
    });
  });

  it('lets the invited person join once signed in, and refuses the token to anyone else', async () => {
    const account = (
      await call('POST', '/api/v1/auth/register', { body: { ...invited, invitation_token: MOCK_TOKENS.invitation } })
    ).cookie;
    const session = (
      await call('POST', '/api/v1/auth/sign-in', {
        body: { email: invited.email, password: invited.password },
        cookie: account,
      })
    ).cookie;
    const cookie = [account, session].join('; ');
    expect(await call('POST', '/api/v1/invitations/accept', { body: { token: 'unknown' }, cookie })).toMatchObject({
      status: 400,
      body: { code: 'invalid_token' },
    });
    const accepted = await call('POST', '/api/v1/invitations/accept', {
      body: { token: MOCK_TOKENS.invitation },
      cookie,
    });
    expect(accepted).toMatchObject({ status: 200, body: { data: { workspace: { slug: 'digibranders' } } } });
    const me = await call('GET', '/api/v1/me', { cookie: [cookie, accepted.cookie].join('; ') });
    expect(me.body).toMatchObject({ data: { memberships: [{ workspace: { slug: 'digibranders' }, role: 'editor' }] } });

    const admin = await signIn(mockUser('admin').email);
    expect(
      await call('POST', '/api/v1/invitations/accept', { body: { token: MOCK_TOKENS.invitation }, cookie: admin }),
    ).toMatchObject({ status: 400, body: { code: 'invalid_token' } });
    expect(await call('POST', '/api/v1/invitations/accept', { body: { token: MOCK_TOKENS.invitation } })).toMatchObject(
      { status: 401 },
    );
  });

  it('gives one answer for every unusable invitation, another address included', async () => {
    for (const body of [
      { ...invited, invitation_token: 'expired' },
      { ...invited, email: 'someone.else@example.test', invitation_token: MOCK_TOKENS.invitation },
    ]) {
      expect(await call('POST', '/api/v1/auth/register', { body })).toMatchObject({
        status: 403,
        body: { code: 'registration_closed' },
      });
    }
  });

  it.each([
    ['short', 'too_short'],
    ['x'.repeat(129), 'too_long'],
  ])('refuses the weak password %s with its reason', async (password, reason) => {
    const answer = await call('POST', '/api/v1/auth/register', {
      body: { ...invited, password, invitation_token: MOCK_TOKENS.invitation },
    });
    expect(answer).toMatchObject({ status: 422, body: { code: 'weak_password', reason } });
  });

  it('confirms a password reset with the fixture token only', async () => {
    const confirm = (token: string, newPassword: string): Promise<Answer> =>
      call('POST', '/api/v1/auth/password-reset/confirm', { body: { token, new_password: newPassword } });
    expect((await confirm(MOCK_TOKENS.reset, 'a-long-enough-passphrase')).body).toEqual({ status: 'ok' });
    expect((await confirm('used', 'a-long-enough-passphrase')).body).toMatchObject({ code: 'invalid_token' });
    expect((await confirm(MOCK_TOKENS.reset, 'short')).body).toMatchObject({ reason: 'too_short' });
  });

  it('accepts every reset request the same way', async () => {
    for (const email of [mockUser('admin').email, 'nobody@example.test']) {
      expect(await call('POST', '/api/v1/auth/password-reset/request', { body: { email } })).toMatchObject({
        status: 202,
        body: { status: 'accepted' },
      });
    }
  });

  it('verifies an email with the fixture token only', async () => {
    const verify = (token: string): Promise<Answer> => call('POST', '/api/v1/auth/verify-email', { body: { token } });
    expect((await verify(MOCK_TOKENS.verifyEmail)).status).toBe(200);
    expect((await verify('x')).status).toBe(400);
  });

  it('describes the fixture invitation through the pending endpoint', async () => {
    const preview = (token: string): Promise<Answer> =>
      call('POST', '/api/v1/invitations/preview', { body: { token } });
    expect((await preview(MOCK_TOKENS.invitation)).body).toEqual({ data: MOCK_INVITATION });
    expect((await preview('nope')).status).toBe(400);
  });
});

describe('fresh sessions and the account', () => {
  it('asks a user with a second factor for the code, not the password, and gives one answer for a wrong one', async () => {
    const pending = await signIn(mockUser('owner').email);
    const active = (await call('POST', '/api/v1/auth/totp/verify', { body: { code: MOCK_TOTP_CODE }, cookie: pending }))
      .cookie;
    const reauth = (body: Record<string, string>): Promise<Answer> =>
      call('POST', '/api/v1/me/reauthenticate', { body, cookie: active });
    expect((await reauth({ password: MOCK_PASSWORD })).body).toMatchObject({ code: 'second_factor_required' });
    expect((await reauth({ totp_code: '000000' })).body).toMatchObject({ code: 'invalid_credentials' });
    expect((await reauth({ totp_code: MOCK_TOTP_CODE })).body).toMatchObject({ fresh_until: expect.any(String) });
  });

  it('re-authenticates a user without a second factor with the password', async () => {
    const reauth = (password: string): Promise<Answer> =>
      call('POST', '/api/v1/me/reauthenticate', { body: { password }, cookie: staleSession('editor') });
    expect((await reauth('wrong-password')).body).toMatchObject({ code: 'invalid_credentials' });
    const fresh = await reauth(MOCK_PASSWORD);
    expect(fresh.status).toBe(200);
    expect(fresh.cookie).toMatch(/^__Host-session=mock\.active\./);
  });

  it('refuses a password change from a stale session, with where to re-authenticate', async () => {
    const answer = await call('POST', '/api/v1/auth/password/change', {
      body: { current_password: MOCK_PASSWORD, new_password: 'a-long-enough-passphrase' },
      cookie: staleSession('editor'),
    });
    expect(answer).toMatchObject({
      status: 403,
      body: { code: 'fresh_session_required', reauth_url: '/api/v1/me/reauthenticate' },
    });
  });

  it('changes the password from a fresh session, and signs out the other sessions', async () => {
    const cookie = await signIn(mockUser('editor').email);
    const change = (current: string, next: string): Promise<Answer> =>
      call('POST', '/api/v1/auth/password/change', { body: { current_password: current, new_password: next }, cookie });
    expect((await change('wrong-password', 'a-long-enough-passphrase')).body).toMatchObject({
      code: 'invalid_credentials',
    });
    expect((await change(MOCK_PASSWORD, MOCK_PASSWORD)).body).toMatchObject({ reason: 'unchanged' });
    expect((await change(MOCK_PASSWORD, 'a-long-enough-passphrase')).body).toEqual({ status: 'ok' });
    const sessions = await call('GET', '/api/v1/auth/sessions', { cookie });
    expect(sessions.body).toMatchObject({ data: [{ is_current: true }] });
    expect((sessions.body.data as unknown[]).length).toBe(1);
  });

  it('signs out one other session, then says it is gone; signing out this one ends it here', async () => {
    const cookie = await signIn(mockUser('editor').email);
    const list = (await call('GET', '/api/v1/auth/sessions', { cookie })).body.data as {
      session_id: string;
      is_current: boolean;
    }[];
    const other = list.find((item) => !item.is_current)?.session_id ?? '';
    const current = list.find((item) => item.is_current)?.session_id ?? '';
    expect((await call('DELETE', `/api/v1/auth/sessions/${other}`, { cookie })).status).toBe(204);
    expect((await call('DELETE', `/api/v1/auth/sessions/${other}`, { cookie })).status).toBe(404);
    const own = await call('DELETE', `/api/v1/auth/sessions/${current}`, { cookie });
    expect(own.status).toBe(204);
    expect(own.cookie).toBe(`${SESSION_COOKIE}=`);
  });

  it('keeps a changed name in a cookie, so every process that serves /me sees it', async () => {
    const cookie = await signIn(mockUser('editor').email);
    const saved = await call('PATCH', '/api/v1/me', { body: { name: 'Priya N.' }, cookie });
    expect(saved.body).toMatchObject({ data: { user: { name: 'Priya N.' } } });
    const both = `${cookie ?? ''}; ${saved.cookie ?? ''}`;
    expect((await call('GET', '/api/v1/me', { cookie: both })).body).toMatchObject({
      data: { user: { name: 'Priya N.' } },
    });
    expect((await call('PATCH', '/api/v1/me', { body: { name: ' ' }, cookie })).status).toBe(422);
  });
});

describe('workspaces and projects', () => {
  const projectsOf = async (role: 'viewer' | 'analyst', query = ''): Promise<Answer> => {
    const cookie = await signIn(mockUser(role).email);
    return call('GET', `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects${query}`, { cookie });
  };

  it('lists every project for a member of the whole workspace, by name', async () => {
    const { body } = await projectsOf('viewer');
    expect(body).toMatchObject({ page: { total: MOCK_PROJECTS.length, offset: 0, limit: 50 } });
    expect((body.data as { name: string }[]).map((project) => project.name)).toEqual([
      'Cleanstart',
      'Eventus Security',
      'Firstfold',
      'Fynix',
      'Oyechats',
    ]);
  });

  it('lists only their projects for a member limited to some', async () => {
    const { body } = await projectsOf('analyst');
    expect((body.data as { slug: string }[]).map((project) => project.slug)).toEqual(['cleanstart', 'fynix']);
  });

  it('pages and filters, and refuses what the API refuses', async () => {
    const page = await projectsOf('viewer', '?offset=1&limit=2&filter%5Bstatus_in%5D=active,paused');
    expect(page.body).toMatchObject({ page: { offset: 1, limit: 2, total: 5 } });
    expect((page.body.data as unknown[]).length).toBe(2);
    expect((await projectsOf('viewer', '?filter%5Bstatus_in%5D=archived')).body).toMatchObject({ page: { total: 0 } });
    expect((await projectsOf('viewer', '?limit=500')).status).toBe(422);
    expect((await projectsOf('viewer', '?page=2')).body).toMatchObject({
      errors: [{ location: 'query', path: 'page', code: 'extra_forbidden' }],
    });
  });

  it('answers 404 for another workspace and for a project outside the membership', async () => {
    const cookie = await signIn(mockUser('analyst').email);
    const otherWorkspace = await call('GET', '/api/v1/workspaces/0192d1a8-0000-7000-8000-000000000000/projects', {
      cookie,
    });
    expect(otherWorkspace.status).toBe(404);
    const outside = MOCK_PROJECTS.find((project) => project.slug === 'oyechats')?.project_id ?? '';
    const project = await call('GET', `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${outside}`, {
      cookie,
    });
    expect(project.status).toBe(404);
  });

  it('answers 401 to a pending second-factor session', async () => {
    const pending = await signIn(mockUser('owner').email);
    const answer = await call('GET', `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects`, { cookie: pending });
    expect(answer.status).toBe(401);
  });
});

describe('the mock modes', () => {
  it('answers only the pending endpoints in pending mode', () => {
    expect(handlersFor('pending')).toEqual(pendingHandlers);
    expect(handlersFor('all').length).toBeGreaterThan(pendingHandlers.length);
  });

  it('reports an unhandled API request in all mode, and lets pages and assets through', () => {
    const report = (mode: 'all' | 'pending', url: string): boolean => {
      let reported = false;
      unhandledStrategy(mode)(new Request(url), {
        error: () => {
          reported = true;
        },
      });
      return reported;
    };
    expect(report('all', 'http://localhost:3000/api/v1/billing')).toBe(true);
    expect(report('all', 'http://localhost:3000/_next/static/app.js')).toBe(false);
    expect(report('pending', 'http://localhost:3000/api/v1/me')).toBe(false);
  });
});
