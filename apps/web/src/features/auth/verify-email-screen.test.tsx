import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { VerifyEmailScreen } from './verify-email-screen';
import { MOCK_TOKENS } from '@/mocks/fixtures';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const at = (url: string): void => window.history.replaceState(null, '', url);
const problemOf = (status: number, code: string, extra: Record<string, unknown> = {}): HttpResponse<string> =>
  new HttpResponse(
    JSON.stringify({ type: 'about:blank', title: code, status, code, instance: '/', request_id: 'r', ...extra }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );

describe('VerifyEmailScreen', () => {
  afterEach(() => at('/'));

  it('verifies the address as soon as it has the token, once, even when mounted twice', async () => {
    let calls = 0;
    server.use(
      http.post('*/api/v1/auth/verify-email', () => {
        calls += 1;
        return HttpResponse.json({ status: 'ok' });
      }),
    );
    at(`/verify-email#token=${MOCK_TOKENS.verifyEmail}`);
    const { container } = renderWithProviders(
      <StrictMode>
        <VerifyEmailScreen />
      </StrictMode>,
    );
    const heading = await screen.findByRole('heading', { level: 1, name: 'Your email address is verified' });
    // The outcome replaced the waiting panel, so focus moves to its heading and it is read
    expect(heading).toHaveFocus();
    expect(document.title).toBe('Your email address is verified · Sightline');
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/');
    expect(calls).toBe(1);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('offers a new link for a token that does not work, and confirms the request', async () => {
    at('/verify-email#token=expired');
    const { user } = renderWithProviders(<VerifyEmailScreen />);
    expect(await screen.findByRole('heading', { level: 1, name: 'This link does not work' })).toBeInTheDocument();
    expect(
      screen.getByText('It was used already, or it has expired. Enter your email address to get a new link.'),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'mei@digibranders.test');
    await user.click(screen.getByRole('button', { name: 'Send new link' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Check your email' })).toHaveFocus();
  });

  it('offers to try again, with the same token, when the check failed for another reason', async () => {
    let calls = 0;
    server.use(
      http.post('*/api/v1/auth/verify-email', () => {
        calls += 1;
        return calls === 1 ? problemOf(503, 'service_unavailable') : HttpResponse.json({ status: 'ok' });
      }),
    );
    at(`/verify-email#token=${MOCK_TOKENS.verifyEmail}`);
    const { user } = renderWithProviders(<VerifyEmailScreen />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your link could not be checked' }),
    ).toBeInTheDocument();
    expect(screen.getByText('This is not available right now. Try again in a minute.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your email address is verified' }),
    ).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('says how long to wait when too many new links were asked for', async () => {
    server.use(
      http.post('*/api/v1/auth/verify-email/request', () =>
        problemOf(429, 'rate_limited', { retry_after_seconds: 3600 }),
      ),
    );
    at('/verify-email');
    const { user } = renderWithProviders(<VerifyEmailScreen />);
    await user.type(await screen.findByLabelText('Email'), 'mei@digibranders.test');
    await user.click(screen.getByRole('button', { name: 'Send new link' }));
    expect(
      await screen.findByText('Too many emails were requested for this address. Try again in 60 minutes.'),
    ).toBeInTheDocument();
  });

  it('says the link is not complete when it had no token, and asks for the address', async () => {
    at('/verify-email');
    renderWithProviders(<VerifyEmailScreen />);
    expect(await screen.findByRole('heading', { level: 1, name: 'This link is not complete' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Email')).toHaveFocus());
  });
});
