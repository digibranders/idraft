import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InviteScreen } from './invite-screen';
import { MOCK_TOKENS } from '@/mocks/fixtures';
import { MOCK_INVITATION } from '@/mocks/handlers/pending';
import { INVITEE_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const navigation = vi.hoisted(() => ({ hardNavigate: vi.fn() }));
vi.mock('@/lib/navigation/hard-navigate', () => ({ hardNavigate: navigation.hardNavigate }));

const at = (url: string): void => window.history.replaceState(null, '', url);
const formAlert = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="form-alert"]');
const PASSPHRASE = 'a-long-enough-passphrase';
const problemOf = (status: number, code: string, extra: Record<string, unknown> = {}): HttpResponse<string> =>
  new HttpResponse(
    JSON.stringify({ type: 'about:blank', title: code, status, code, instance: '/', request_id: 'r', ...extra }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );

async function openInvitation(
  heading = `Join ${MOCK_INVITATION.workspace.name}`,
): Promise<ReturnType<typeof renderWithProviders>> {
  at(`/invite#token=${MOCK_TOKENS.invitation}`);
  const rendered = renderWithProviders(<InviteScreen />);
  await screen.findByRole('heading', { level: 1, name: heading });
  return rendered;
}

async function register({ user }: ReturnType<typeof renderWithProviders>, password = PASSPHRASE): Promise<void> {
  await user.type(screen.getByLabelText('Your name'), 'Lena Vogel');
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('InviteScreen', () => {
  beforeEach(() => navigation.hardNavigate.mockReset());
  afterEach(() => at('/'));

  it('says who invited the person to what, and shows the invited address it cannot change', async () => {
    const { container } = await openInvitation();
    expect(
      screen.getByText(`${MOCK_INVITATION.inviter.name} invited you as an editor. Create your account to accept.`),
    ).toBeInTheDocument();
    const email = screen.getByLabelText('Email');
    expect(email).toHaveValue(MOCK_INVITATION.email);
    expect(email).toHaveAttribute('readonly');
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('creates the account, then sends the person to sign in with the token, which joins them', async () => {
    const rendered = await openInvitation();
    await register(rendered);
    await waitFor(() =>
      expect(navigation.hardNavigate).toHaveBeenCalledWith(
        `/login?notice=accountCreated#invitation=${MOCK_TOKENS.invitation}`,
      ),
    );
    // The page is loading the next one: the form cannot be sent again
    expect(screen.getByRole('button', { name: 'Create account' })).toHaveAttribute('aria-busy', 'true');
  });

  it('works without the description of the invitation, asking for the address', async () => {
    server.use(http.post('*/api/v1/invitations/preview', () => problemOf(404, 'not_found')));
    const rendered = await openInvitation('Create your account');
    const email = screen.getByLabelText('Email');
    expect(email).not.toHaveAttribute('readonly');
    await rendered.user.type(email, MOCK_INVITATION.email);
    await register(rendered);
    await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledTimes(1));
  });

  it('puts the reason the API refuses a password on the password field, keeping the name', async () => {
    const rendered = await openInvitation();
    await register(rendered, 'lena-2026-password');
    expect(await screen.findByText('Do not use your email address in the password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toHaveValue('Lena Vogel');
  });

  it('offers to sign in and accept when the address has an account already', async () => {
    document.cookie = `${INVITEE_COOKIE}=${PASSPHRASE}; Path=/; Secure`;
    const rendered = await openInvitation();
    await register(rendered);
    expect(
      await screen.findByText('An account already uses this email address. Sign in to accept the invitation.'),
    ).toBeInTheDocument();
    expect(formAlert()).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Sign in to accept' })).toHaveAttribute(
      'href',
      `/login#invitation=${MOCK_TOKENS.invitation}`,
    );
  });

  it('says an invitation that can no longer be used cannot be used', async () => {
    server.use(http.post('*/api/v1/auth/register', () => problemOf(403, 'registration_closed')));
    const rendered = await openInvitation();
    await register(rendered);
    expect(
      await screen.findByText('This invitation cannot be used. Ask the person who invited you for a new one.'),
    ).toBeInTheDocument();
  });

  it('puts field errors of the API on their fields in the words of the app', async () => {
    server.use(
      http.post('*/api/v1/auth/register', () =>
        problemOf(422, 'validation_failed', {
          errors: [{ location: 'body', path: 'name', code: 'string_too_long', message: 'String should have at most' }],
        }),
      ),
    );
    const rendered = await openInvitation();
    await register(rendered);
    expect(await screen.findByText('Use at most 120 characters.')).toBeInTheDocument();
    expect(formAlert()).toBeNull();
  });

  it('explains a link without a token, and one whose token does not work', async () => {
    at('/invite');
    const { unmount } = renderWithProviders(<InviteScreen />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This invitation link is not complete' }),
    ).toBeInTheDocument();
    unmount();
    at('/invite#token=withdrawn');
    renderWithProviders(<InviteScreen />);
    expect(await screen.findByRole('heading', { level: 1, name: 'This link does not work' })).toBeInTheDocument();
  });
});
