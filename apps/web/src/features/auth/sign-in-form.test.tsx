import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SignInForm } from './sign-in-form';
import { MOCK_INVITED_USER, MOCK_PASSWORD, MOCK_TOKENS, mockUser } from '@/mocks/fixtures';
import { INVITEE_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const navigation = vi.hoisted(() => ({ hardNavigate: vi.fn() }));
vi.mock('@/lib/navigation/hard-navigate', () => ({ hardNavigate: navigation.hardNavigate }));

/** The form's alert. The live regions of the providers also have the alert and status roles. */
const formAlert = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="form-alert"]');

const INVITEE_PASSWORD = 'a-long-enough-passphrase';
const problemOf = (status: number, code: string, extra: Record<string, unknown> = {}): HttpResponse<string> =>
  new HttpResponse(
    JSON.stringify({ type: 'about:blank', title: code, status, code, instance: '/', request_id: 'r', ...extra }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );

async function signIn(email: string, password: string, next: string | null = null): Promise<void> {
  const { user } = renderWithProviders(<SignInForm next={next} notice={null} />);
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('SignInForm', () => {
  beforeEach(() => navigation.hardNavigate.mockReset());
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('signs in and loads the page the person was going to', async () => {
    await signIn(mockUser('editor').email, MOCK_PASSWORD, '/digibranders/fynix?loc=2840');
    await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith('/digibranders/fynix?loc=2840'));
  });

  it('never follows a next that leaves the app', async () => {
    await signIn(mockUser('editor').email, MOCK_PASSWORD, '//evil.example');
    await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith('/'));
  });

  it('asks for the second factor on a new page load, keeping next', async () => {
    await signIn(mockUser('owner').email, MOCK_PASSWORD, '/digibranders');
    await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith('/two-factor?next=%2Fdigibranders'));
  });

  it('accepts the invitation it carries once signed in, then opens the workspace', async () => {
    document.cookie = `${INVITEE_COOKIE}=${INVITEE_PASSWORD}; Path=/; Secure`;
    window.history.replaceState(null, '', `/login#invitation=${MOCK_TOKENS.invitation}`);
    await signIn(MOCK_INVITED_USER.email, INVITEE_PASSWORD);
    await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith('/digibranders'));
    // The token left the address bar when the page read it
    expect(window.location.hash).toBe('');
  });

  it('carries the invitation to the second factor in the fragment', async () => {
    window.history.replaceState(null, '', `/login#invitation=${MOCK_TOKENS.invitation}`);
    await signIn(mockUser('owner').email, MOCK_PASSWORD);
    await waitFor(() =>
      expect(navigation.hardNavigate).toHaveBeenCalledWith(`/two-factor#invitation=${MOCK_TOKENS.invitation}`),
    );
  });

  it('opens the home page with the reason when the invitation cannot be accepted', async () => {
    server.use(http.post('*/api/v1/invitations/accept', () => problemOf(410, 'invitation_expired')));
    window.history.replaceState(null, '', `/login#invitation=${MOCK_TOKENS.invitation}`);
    await signIn(mockUser('editor').email, MOCK_PASSWORD);
    await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith('/?invitation=expired'));
  });

  it('cannot be sent twice while the next page loads', async () => {
    const answered = vi.fn();
    server.events.on('response:mocked', ({ request }) => {
      if (new URL(request.url).pathname === '/api/v1/auth/sign-in') answered();
    });
    const { user } = renderWithProviders(<SignInForm next={null} notice={null} />);
    await user.type(screen.getByLabelText('Email'), mockUser('editor').email);
    await user.type(screen.getByLabelText('Password'), MOCK_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.keyboard('{Enter}');
    expect(answered).toHaveBeenCalledTimes(1);
    expect(navigation.hardNavigate).toHaveBeenCalledTimes(1);
    server.events.removeAllListeners();
  });

  it('says a wrong password in one message, keeps the values and moves focus to the message', async () => {
    await signIn(mockUser('editor').email, 'not-the-password');
    await screen.findByText('The email or password is not correct.');
    const alert = formAlert();
    // It takes focus, which has it read; a live region as well would read it twice
    expect(alert).not.toHaveAttribute('role');
    expect(alert).toHaveFocus();
    expect(screen.getByLabelText('Email')).toHaveValue(mockUser('editor').email);
    expect(screen.getByLabelText('Password')).toHaveValue('not-the-password');
  });

  it('gives the wait of a lock in minutes', async () => {
    server.use(http.post('*/api/v1/auth/sign-in', () => problemOf(429, 'rate_limited', { retry_after_seconds: 900 })));
    await signIn(mockUser('editor').email, MOCK_PASSWORD);
    expect(await screen.findByText('Too many attempts. Try again in 15 minutes.')).toBeInTheDocument();
  });

  it('puts a field error of the API on its field, in the words of the app', async () => {
    server.use(
      http.post('*/api/v1/auth/sign-in', () =>
        problemOf(422, 'validation_failed', {
          errors: [
            { location: 'body', path: 'email', code: 'value_error', message: 'Value error, not an email address' },
          ],
        }),
      ),
    );
    await signIn('ana@digibranders.test', MOCK_PASSWORD);
    expect(await screen.findByText('Enter an email address, like name@example.com.')).toBeInTheDocument();
    expect(screen.queryByText(/Value error/)).toBeNull();
    expect(formAlert()).toBeNull();
  });

  it('checks the fields before it sends anything', async () => {
    const { user } = renderWithProviders(<SignInForm next={null} notice={null} />);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(navigation.hardNavigate).not.toHaveBeenCalled();
  });

  it('shows the notice of the step before until the person submits, and has no accessibility violation', async () => {
    const { container, user } = renderWithProviders(<SignInForm next={null} notice="passwordReset" />);
    expect(formAlert()).toHaveTextContent('Your password was changed. Sign in with the new one.');
    expect(formAlert()).toHaveAttribute('role', 'status');
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Enter your email address.');
    expect(formAlert()).toBeNull();
  });

  it('has no accessibility violation while it shows an error', async () => {
    await signIn(mockUser('editor').email, 'not-the-password');
    await screen.findByText('The email or password is not correct.');
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
