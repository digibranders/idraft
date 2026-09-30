import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TwoFactorForm } from './two-factor-form';
import { MOCK_RECOVERY_CODE, MOCK_TOKENS, MOCK_TOTP_CODE, mockUser } from '@/mocks/fixtures';
import { PENDING_MS, SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const navigation = vi.hoisted(() => ({ hardNavigate: vi.fn() }));
vi.mock('@/lib/navigation/hard-navigate', () => ({ hardNavigate: navigation.hardNavigate }));

/** The pending session that the password step leaves, as the mocks read it. */
function pendingSession(): void {
  document.cookie = `${SESSION_COOKIE}=mock.totp.${mockUser('owner').user_id}.${String(Date.now() + PENDING_MS)}; Path=/; Secure`;
}
function noSession(): void {
  document.cookie = `${SESSION_COOKIE}=; Path=/; Secure; Max-Age=0`;
}
const formAlert = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="form-alert"]');
const problemOf = (status: number, code: string, extra: Record<string, unknown> = {}): HttpResponse<string> =>
  new HttpResponse(
    JSON.stringify({ type: 'about:blank', title: code, status, code, instance: '/', request_id: 'r', ...extra }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );

describe('TwoFactorForm', () => {
  beforeEach(() => {
    navigation.hardNavigate.mockReset();
    pendingSession();
  });
  afterEach(() => window.history.replaceState(null, '', '/'));

  async function enterCode(code: string, next: string | null = null): Promise<void> {
    const { user } = renderWithProviders(<TwoFactorForm next={next} />);
    await user.click(screen.getAllByRole('textbox')[0] ?? document.body);
    await user.keyboard(code);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
  }

  it('accepts a pasted code with a space in it, and loads the page the person was going to', async () => {
    const { user } = renderWithProviders(<TwoFactorForm next="/digibranders" />);
    const [firstCell] = screen.getAllByRole('textbox');
    if (!firstCell) throw new Error('the code field has no cells');
    await user.click(firstCell);
    await user.paste(`${MOCK_TOTP_CODE.slice(0, 3)} ${MOCK_TOTP_CODE.slice(3)}`);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith('/digibranders'));
  });

  it('says a wrong code is wrong and clears it for the next try', async () => {
    const { user } = renderWithProviders(<TwoFactorForm next={null} />);
    await user.click(screen.getAllByRole('textbox')[0] ?? document.body);
    await user.keyboard('000000');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/The code is not correct/)).toBeInTheDocument();
    expect(formAlert()).toHaveFocus();
    expect(
      screen
        .getAllByRole('textbox')
        .map((cell) => (cell as HTMLInputElement).value)
        .join(''),
    ).toBe('');
  });

  it('asks for all six digits before it sends anything', async () => {
    const { user } = renderWithProviders(<TwoFactorForm next={null} />);
    await user.click(screen.getAllByRole('textbox')[0] ?? document.body);
    await user.keyboard('246');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Enter all 6 digits of the code.')).toBeInTheDocument();
  });

  it('takes a recovery code instead', async () => {
    const { user } = renderWithProviders(<TwoFactorForm next="/digibranders" />);
    await user.click(screen.getByRole('button', { name: 'Use a recovery code' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Enter a recovery code' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Recovery code'), MOCK_RECOVERY_CODE);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith('/digibranders'));
  });

  it('starts again at sign-in, saying why, when there is no pending session', async () => {
    noSession();
    await enterCode(MOCK_TOTP_CODE, '/digibranders');
    await waitFor(() =>
      expect(navigation.hardNavigate).toHaveBeenCalledWith('/login?notice=sessionExpired&next=%2Fdigibranders'),
    );
  });

  it('starts again at sign-in when the pending session has expired, keeping the invitation', async () => {
    document.cookie = `${SESSION_COOKIE}=mock.totp.${mockUser('owner').user_id}.${String(Date.now() - 1)}; Path=/; Secure`;
    window.history.replaceState(null, '', `/two-factor#invitation=${MOCK_TOKENS.invitation}`);
    await enterCode(MOCK_TOTP_CODE);
    await waitFor(() =>
      expect(navigation.hardNavigate).toHaveBeenCalledWith(
        `/login?notice=sessionExpired#invitation=${MOCK_TOKENS.invitation}`,
      ),
    );
  });

  it('never follows a next that leaves the app', async () => {
    await enterCode(MOCK_TOTP_CODE, '//evil.example');
    await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith('/'));
  });

  it('accepts the invitation it carries once the code is right', async () => {
    server.use(
      http.post('*/api/v1/invitations/accept', () =>
        HttpResponse.json({
          data: {
            workspace: { workspace_id: 'w', name: 'Digibranders', slug: 'digibranders' },
            member: {
              user: { user_id: 'u', name: 'Ana Brandt', email: 'ana@digibranders.test' },
              role: 'owner',
              project_ids: null,
              joined_at: '2026-06-01T09:00:00Z',
              last_active_at: null,
              two_factor_enabled: true,
            },
          },
        }),
      ),
    );
    window.history.replaceState(null, '', `/two-factor#invitation=${MOCK_TOKENS.invitation}`);
    await enterCode(MOCK_TOTP_CODE, '/elsewhere');
    await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith('/digibranders'));
  });

  it('gives the wait of a lock in minutes', async () => {
    server.use(
      http.post('*/api/v1/auth/totp/verify', () => problemOf(429, 'rate_limited', { retry_after_seconds: 120 })),
    );
    await enterCode(MOCK_TOTP_CODE);
    expect(await screen.findByText('Too many attempts. Try again in 2 minutes.')).toBeInTheDocument();
  });

  it('names each cell of the code by its position', () => {
    renderWithProviders(<TwoFactorForm next={null} />);
    expect(screen.getAllByRole('textbox')[1]).toHaveAccessibleName('Digit 2 of 6');
  });

  it('has no accessibility violation', async () => {
    const { container } = renderWithProviders(<TwoFactorForm next={null} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
