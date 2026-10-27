import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResetPasswordScreen } from './reset-password-screen';
import { MOCK_TOKENS } from '@/mocks/fixtures';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const navigation = vi.hoisted(() => ({ hardNavigate: vi.fn() }));
vi.mock('@/lib/navigation/hard-navigate', () => ({ hardNavigate: navigation.hardNavigate }));

const at = (url: string): void => window.history.replaceState(null, '', url);

describe('ResetPasswordScreen', () => {
  beforeEach(() => navigation.hardNavigate.mockReset());
  afterEach(() => at('/'));

  it('asks for the address, then says the same thing whether or not it has an account', async () => {
    at('/reset-password');
    const { user, container } = renderWithProviders(<ResetPasswordScreen />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Reset your password' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await user.type(screen.getByLabelText('Email'), 'nobody@example.test');
    await user.click(screen.getByRole('button', { name: 'Send link' }));
    // The panel has no field any more, so focus moves to its heading and the change is read
    expect(await screen.findByRole('heading', { level: 1, name: 'Check your email' })).toHaveFocus();
    expect(screen.getByText(/If an account uses nobody@example.test/)).toBeInTheDocument();
    expect(document.title).toBe('Check your email · idraft.ai');
  });

  it('says how long to wait when too many links were asked for', async () => {
    server.use(
      http.post(
        '*/api/v1/auth/password-reset/request',
        () =>
          new HttpResponse(
            JSON.stringify({
              type: 'about:blank',
              title: 'Too many requests',
              status: 429,
              code: 'rate_limited',
              instance: '/',
              request_id: 'r',
              retry_after_seconds: 1800,
            }),
            { status: 429, headers: { 'content-type': 'application/problem+json' } },
          ),
      ),
    );
    at('/reset-password');
    const { user } = renderWithProviders(<ResetPasswordScreen />);
    await user.type(await screen.findByLabelText('Email'), 'mei@digibranders.test');
    await user.click(screen.getByRole('button', { name: 'Send link' }));
    expect(
      await screen.findByText('Too many emails were requested for this address. Try again in 30 minutes.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('mei@digibranders.test');
  });

  it('chooses a new password with the token of the link, then sends the person to sign in', async () => {
    at(`/reset-password#token=${MOCK_TOKENS.reset}`);
    const { user } = renderWithProviders(<ResetPasswordScreen />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose a new password' })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    await user.type(screen.getByLabelText('New password'), 'a-long-enough-passphrase');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith('/login?notice=passwordReset'));
  });

  it('checks the length when the field is left', async () => {
    at(`/reset-password#token=${MOCK_TOKENS.reset}`);
    const { user } = renderWithProviders(<ResetPasswordScreen />);
    const field = await screen.findByLabelText('New password');
    await user.type(field, 'short');
    await user.tab();
    expect(await screen.findByText('Use at least 12 characters.')).toBeInTheDocument();
  });

  it('shows the reason the API refuses a password on the field, keeping what was typed', async () => {
    server.use(
      http.post(
        '*/api/v1/auth/password-reset/confirm',
        () =>
          new HttpResponse(
            JSON.stringify({
              type: 'about:blank',
              title: 'Weak password',
              status: 422,
              code: 'weak_password',
              instance: '/',
              request_id: 'r',
              reason: 'breached',
            }),
            { status: 422, headers: { 'content-type': 'application/problem+json' } },
          ),
      ),
    );
    at(`/reset-password#token=${MOCK_TOKENS.reset}`);
    const { user } = renderWithProviders(<ResetPasswordScreen />);
    const field = await screen.findByLabelText('New password');
    await user.type(field, 'password1234567');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    expect(
      await screen.findByText('This password appears in known data breaches. Choose another one.'),
    ).toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(navigation.hardNavigate).not.toHaveBeenCalled();
  });

  it('offers a new link when the token does not work, keeping the person on the page', async () => {
    at('/reset-password#token=used-already');
    const { user } = renderWithProviders(<ResetPasswordScreen />);
    await user.type(await screen.findByLabelText('New password'), 'a-long-enough-passphrase');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'This link does not work' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send new link' })).toBeInTheDocument();
  });
});
