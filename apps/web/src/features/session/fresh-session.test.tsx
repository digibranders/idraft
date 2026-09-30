import { useMutation } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FreshSessionProvider } from './fresh-session';
import { useFreshSession, withFreshSession } from '@/lib/session/fresh-session';
import { Dialog, DialogBody, DialogHeader } from '@/components/ui/dialog';
import { ApiProblem, isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { MOCK_PASSWORD, MOCK_TOTP_CODE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const fresh = (): ApiProblem =>
  new ApiProblem({
    status: 403,
    code: 'fresh_session_required',
    title: 'Confirm it is you',
    detail: null,
    requestId: 'r',
    errors: [],
    retryAfterSeconds: null,
    body: {},
  });

describe('withFreshSession', () => {
  it('sends the request again once the person confirmed it is them', async () => {
    const request = vi
      .fn<(value: string) => Promise<string>>()
      .mockRejectedValueOnce(fresh())
      .mockResolvedValue('saved');
    const confirm = vi.fn(() => Promise.resolve(true));
    await expect(withFreshSession(confirm, request)('name')).resolves.toBe('saved');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith('name');
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('rejects with the first problem when the person cancels, and sends nothing more', async () => {
    const problem = fresh();
    const request = vi.fn<() => Promise<string>>().mockRejectedValue(problem);
    await expect(withFreshSession(() => Promise.resolve(false), request)()).rejects.toBe(problem);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('passes a second fresh_session_required on instead of asking again', async () => {
    const second = fresh();
    const request = vi.fn<() => Promise<string>>().mockRejectedValueOnce(fresh()).mockRejectedValueOnce(second);
    const confirm = vi.fn(() => Promise.resolve(true));
    await expect(withFreshSession(confirm, request)()).rejects.toBe(second);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('leaves every other failure alone', async () => {
    const other = new Error('offline');
    const confirm = vi.fn(() => Promise.resolve(true));
    await expect(withFreshSession(confirm, () => Promise.reject(other))()).rejects.toBe(other);
    expect(confirm).not.toHaveBeenCalled();
  });
});

/** A session of `role` that is no longer fresh, as the mocks read it. */
function staleSession(role: 'editor' | 'owner'): void {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.0; Path=/; Secure`;
}

const CHANGE = apiMutation('post', '/api/v1/auth/password/change');
const BODY = { current_password: MOCK_PASSWORD, new_password: 'a-new-long-passphrase' };

/** Sends two password changes at once: a change that needs a fresh session (19 section 3.1). */
function ChangePassword(): ReactNode {
  const withFresh = useFreshSession();
  const { mutationFn } = CHANGE;
  if (mutationFn === undefined) throw new Error('apiMutation gave no mutationFn');
  const change = useMutation({ ...CHANGE, mutationFn: withFresh(mutationFn) });
  const [outcome, setOutcome] = useState('idle');
  const run = (): void => {
    Promise.all([change.mutateAsync({ body: BODY }), change.mutateAsync({ body: BODY })])
      .then(() => setOutcome('done'))
      .catch((error: unknown) => setOutcome(isApiProblem(error) ? error.code : 'failed'));
  };
  return (
    <>
      <button type="button" onClick={run}>
        Change password
      </button>
      <p>{outcome}</p>
    </>
  );
}

const withProvider = (ui: ReactNode): ReactElement => <FreshSessionProvider>{ui}</FreshSessionProvider>;

/** The change asked for from inside a dialog, as account settings will. */
function PasswordDialog(): ReactNode {
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen} size="md">
      <DialogHeader title="Change password" closeLabel="Close" />
      <DialogBody>
        <ChangePassword />
      </DialogBody>
    </Dialog>
  );
}

describe('FreshSessionProvider', () => {
  beforeEach(() => staleSession('editor'));

  it('asks once for the password when requests need a fresh session, then sends each again', async () => {
    const { user } = renderWithProviders(withProvider(<ChangePassword />));
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    expect(await axe(dialog)).toHaveNoViolations();
    await waitFor(() => expect(within(dialog).getByLabelText('Password')).toHaveFocus());
    await user.type(within(dialog).getByLabelText('Password'), MOCK_PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('done')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says a wrong password in an alert that takes focus, and keeps the dialog open', async () => {
    const { user } = renderWithProviders(withProvider(<ChangePassword />));
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.type(within(dialog).getByLabelText('Password'), 'not-the-password');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    const wrong = await within(dialog).findByText('The password is not correct.');
    expect(wrong.closest('[data-slot="form-alert"]')).toHaveFocus();
    expect(within(dialog).getByLabelText('Password')).toHaveValue('');
  });

  it('rejects the requests with the first problem when the person cancels', async () => {
    const { user } = renderWithProviders(withProvider(<ChangePassword />));
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('fresh_session_required')).toBeInTheDocument();
  });

  it('asks for the code instead of the password when the account has two-factor on', async () => {
    staleSession('owner');
    const { user } = renderWithProviders(withProvider(<ChangePassword />));
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await waitFor(() => expect(within(dialog).getByRole('group', { name: 'Authentication code' })).toBeInTheDocument());
    const [first] = within(dialog).getAllByRole('textbox');
    await user.click(first ?? dialog);
    await user.keyboard(MOCK_TOTP_CODE);
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('done')).toBeInTheDocument();
  });

  it('stacks above the dialog that asked, which stays open while the person confirms', async () => {
    const { user } = renderWithProviders(withProvider(<PasswordDialog />));
    const outer = screen.getByRole('dialog', { name: 'Change password' });
    await user.click(within(outer).getByRole('button', { name: 'Change password' }));
    const reauth = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    const field = within(reauth).getByLabelText('Password');
    await user.click(field);
    await user.type(field, MOCK_PASSWORD);
    expect(field).toHaveValue(MOCK_PASSWORD);
    // Under the one on top it is hidden from assistive technology, and still open
    expect(screen.getByRole('dialog', { name: 'Change password', hidden: true })).toBeInTheDocument();
    await user.click(within(reauth).getByRole('button', { name: 'Confirm' }));
    expect(
      await within(screen.getByRole('dialog', { name: 'Change password' })).findByText('done'),
    ).toBeInTheDocument();
  });
});
