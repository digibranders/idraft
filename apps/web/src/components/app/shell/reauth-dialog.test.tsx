import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReauthDialog, type ReauthOutcome } from './reauth-dialog';
import { ApiProblem } from '@/lib/api/problem';
import { renderWithProviders } from '@/test/render';

const dialog = (): HTMLElement => screen.getByRole('dialog', { name: 'Confirm it is you' });

describe('ReauthDialog', () => {
  it('asks for the password, and checks it is there before sending', async () => {
    const onSubmit = vi.fn(() => Promise.resolve<ReauthOutcome>('ok'));
    const { user } = renderWithProviders(
      <ReauthDialog open method="password" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    expect(within(dialog()).getByText('Enter your password to continue.')).toBeInTheDocument();
    const field = within(dialog()).getByLabelText('Password');
    expect(field).toHaveAttribute('autocomplete', 'current-password');
    await user.click(within(dialog()).getByRole('button', { name: 'Confirm' }));
    expect(within(dialog()).getByText('Enter your password.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    await user.type(field, 'secret-enough');
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('password', 'secret-enough');
  });

  it('switches to the code when the account turns out to have two-factor on', async () => {
    const onSubmit = vi
      .fn<(method: string, secret: string) => Promise<ReauthOutcome>>()
      .mockResolvedValueOnce('second-factor-required')
      .mockResolvedValue('ok');
    const { user } = renderWithProviders(
      <ReauthDialog open method="password" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    await user.type(within(dialog()).getByLabelText('Password'), 'secret-enough');
    await user.click(within(dialog()).getByRole('button', { name: 'Confirm' }));
    expect(
      await within(dialog()).findByText('Your account uses two-factor authentication, so confirm with a code instead.'),
    ).toBeInTheDocument();
    expect(within(dialog()).getByRole('group', { name: 'Authentication code' })).toBeInTheDocument();
    expect(within(dialog()).getAllByRole('textbox')[5]).toHaveAccessibleName('Digit 6 of 6');
    await user.click(within(dialog()).getAllByRole('textbox')[0] ?? dialog());
    await user.keyboard('123456');
    await user.click(within(dialog()).getByRole('button', { name: 'Confirm' }));
    expect(onSubmit).toHaveBeenLastCalledWith('totp', '123456');
  });

  it('gives the wait of a lock, and a plain message for anything else', async () => {
    const locked = new ApiProblem({
      status: 429,
      code: 'rate_limited',
      title: 'Too many requests',
      detail: null,
      requestId: 'r',
      errors: [],
      retryAfterSeconds: 300,
      body: {},
    });
    const onSubmit = vi
      .fn<(method: string, secret: string) => Promise<ReauthOutcome>>()
      .mockRejectedValueOnce(locked)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { user } = renderWithProviders(
      <ReauthDialog open method="password" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    await user.type(within(dialog()).getByLabelText('Password'), 'secret-enough');
    await user.click(within(dialog()).getByRole('button', { name: 'Confirm' }));
    const alert = await within(dialog()).findByText('Too many attempts. Try again in 5 minutes.');
    expect(alert.closest('[data-slot="form-alert"]')).toHaveFocus();
    await user.click(within(dialog()).getByRole('button', { name: 'Confirm' }));
    expect(
      await within(dialog()).findByText(
        'The request did not go through. Try again, and contact support if it keeps happening.',
      ),
    ).toBeInTheDocument();
  });

  it('cancels with Cancel and with Escape, and starts clean when it opens again', async () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn(() => Promise.resolve<ReauthOutcome>('invalid'));
    const { user, rerender } = renderWithProviders(
      <ReauthDialog open method="password" onSubmit={onSubmit} onCancel={onCancel} />,
    );
    await user.type(within(dialog()).getByLabelText('Password'), 'wrong-one');
    await user.keyboard('{Enter}');
    const wrong = await within(dialog()).findByText('The password is not correct.');
    // Sent with Enter, the field had focus already: the message is read because the alert takes focus
    expect(wrong.closest('[data-slot="form-alert"]')).toHaveFocus();
    expect(within(dialog()).getByLabelText('Password')).toHaveValue('');
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(<ReauthDialog open={false} method="password" onSubmit={onSubmit} onCancel={onCancel} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    rerender(<ReauthDialog open method="password" onSubmit={onSubmit} onCancel={onCancel} />);
    expect(within(dialog()).queryByText('The password is not correct.')).toBeNull();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
