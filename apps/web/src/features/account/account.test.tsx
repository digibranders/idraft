import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PreferencesScreen } from './preferences-screen';
import { ProfileScreen } from './profile-screen';
import { SecurityScreen } from './security-screen';
import { FreshSessionProvider } from '@/features/session';
import { LIVE_REGION_ID } from '@/lib/a11y/announcer';
import { LeaveGuardProvider, useGuardedPush } from '@/lib/navigation/use-leave-guard';
import { useSignOut } from '@/lib/session/sign-out';
import { meFactory } from '@/mocks/factories/identity';
import { clearPreferences, preferenceKey } from '@/lib/preferences/storage';
import { MOCK_PASSWORD, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const navigation = vi.hoisted(() => ({ push: vi.fn(), hardNavigate: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => '/digibranders/fynix/settings/profile',
}));
vi.mock('@/lib/navigation/hard-navigate', () => ({ hardNavigate: navigation.hardNavigate }));

const EDITOR = mockUser('editor');
/** A signed-in editor whose session is fresh, or not: a change of password then asks to confirm. */
function signIn({ fresh }: { fresh: boolean }): void {
  const until = fresh ? Date.now() + 10 * 60 * 1000 : 0;
  document.cookie = `${SESSION_COOKIE}=mock.active.${EDITOR.user_id}.${String(until)}; Path=/; Secure`;
}
const page = (ui: ReactNode): ReactElement => (
  <FreshSessionProvider>
    <LeaveGuardProvider>
      <Suspense fallback={null}>{ui}</Suspense>
    </LeaveGuardProvider>
  </FreshSessionProvider>
);
const SERVER_ERROR = (): HttpResponse<string> => problemOf(500, 'internal');
const politeRegion = (): HTMLElement | null => document.getElementById(LIVE_REGION_ID.polite);

/** A control that navigates without a link, as the settings section select and the project switcher do. */
function GoTo({ href }: { href: string }): ReactNode {
  const push = useGuardedPush();
  return (
    <button type="button" onClick={() => push(href as Parameters<typeof push>[0])}>
      Go
    </button>
  );
}
const problemOf = (status: number, code: string, extra: Record<string, unknown> = {}): HttpResponse<string> =>
  new HttpResponse(
    JSON.stringify({ type: 'about:blank', title: code, status, code, instance: '/', request_id: 'r', ...extra }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );

describe('Profile', () => {
  beforeEach(() => {
    signIn({ fresh: true });
    navigation.push.mockReset();
  });

  it('saves a new name through the save bar, which then goes', async () => {
    const { user } = renderWithProviders(page(<ProfileScreen />));
    const name = await screen.findByLabelText('Name');
    expect(name).toHaveValue(EDITOR.name);
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    await user.clear(name);
    await user.type(name, 'Priya N.');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull());
    expect(name).toHaveValue('Priya N.');
  });

  it('says a save in the polite live region, not in a toast', async () => {
    const { user } = renderWithProviders(page(<ProfileScreen />));
    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Priya N.');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(politeRegion()).toHaveTextContent('Name saved'));
    expect(screen.queryByRole('region', { name: 'Notifications' })?.textContent ?? '').not.toContain('Name saved');
  });

  it('puts a refused name on its field, and any other failure above the form', async () => {
    server.use(
      http.patch('*/api/v1/me', () =>
        problemOf(422, 'validation_failed', {
          errors: [{ location: 'body', path: 'name', code: 'string_too_long', message: 'too long' }],
        }),
      ),
    );
    const { user } = renderWithProviders(page(<ProfileScreen />));
    const name = await screen.findByLabelText('Name');
    await user.type(name, ' Jr');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Use at most 120 characters.')).toBeInTheDocument();
    server.use(http.patch('*/api/v1/me', SERVER_ERROR));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Your name was not saved. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('puts the saved name back on Discard, and the save bar goes', async () => {
    const { user } = renderWithProviders(page(<ProfileScreen />));
    const name = await screen.findByLabelText('Name');
    await user.type(name, ' Jr');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(name).toHaveValue(EDITOR.name);
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('asks before a navigation that is not a link, such as the section select', async () => {
    const { user } = renderWithProviders(
      page(
        <>
          <ProfileScreen />
          <GoTo href="/digibranders/fynix/settings/security" />
        </>,
      ),
    );
    const name = await screen.findByLabelText('Name');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(navigation.push).toHaveBeenCalledOnce();
    navigation.push.mockReset();
    await user.type(name, ' Jr');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    const question = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    expect(navigation.push).not.toHaveBeenCalled();
    await user.click(within(question).getByRole('button', { name: 'Discard changes' }));
    expect(navigation.push).toHaveBeenCalledWith('/digibranders/fynix/settings/security');
  });

  it('sends a verification email to an address that is not verified, and says when it could not', async () => {
    server.use(
      http.get('*/api/v1/me', () =>
        HttpResponse.json({ data: meFactory(EDITOR, { user: { email_verified: false } }) }),
      ),
    );
    const { user } = renderWithProviders(page(<ProfileScreen />));
    expect(await screen.findByText('Not verified')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send verification email' }));
    expect(await screen.findByText(`Verification email sent to ${EDITOR.email}`)).toBeInTheDocument();
    server.use(http.post('*/api/v1/auth/verify-email/request', SERVER_ERROR));
    await user.click(screen.getByRole('button', { name: 'Send verification email' }));
    // A toast's words are also in a live region
    expect(await screen.findAllByText('The email was not sent. Try again in a moment.')).not.toHaveLength(0);
  });

  it('checks the name before it sends it', async () => {
    const { user } = renderWithProviders(page(<ProfileScreen />));
    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter your name.')).toBeInTheDocument();
  });

  it('asks before leaving with an unsaved name, and leaves only on Discard', async () => {
    const { user } = renderWithProviders(
      page(
        <>
          <ProfileScreen />
          <a href="/digibranders/fynix/settings/security">Security</a>
        </>,
      ),
    );
    await user.type(await screen.findByLabelText('Name'), ' Jr');
    await user.click(screen.getByRole('link', { name: 'Security' }));
    const question = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    await user.click(within(question).getByRole('button', { name: 'Keep editing' }));
    expect(navigation.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole('link', { name: 'Security' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard changes' }));
    expect(navigation.push).toHaveBeenCalledWith('/digibranders/fynix/settings/security');
  });

  it('shows the address read-only with its state, and the workspaces with role and access', async () => {
    const { container } = renderWithProviders(page(<ProfileScreen />));
    expect(await screen.findByText(EDITOR.email)).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Digibranders/ });
    expect(within(row).getByText('Editor')).toBeInTheDocument();
    expect(within(row).getByText('All projects')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Security', () => {
  beforeEach(() => signIn({ fresh: true }));

  async function openDialog(): Promise<{ user: ReturnType<typeof renderWithProviders>['user']; dialog: HTMLElement }> {
    const { user } = renderWithProviders(page(<SecurityScreen />));
    await user.click(await screen.findByRole('button', { name: 'Change password' }));
    return { user, dialog: await screen.findByRole('dialog', { name: 'Change password' }) };
  }
  async function fill(
    user: ReturnType<typeof renderWithProviders>['user'],
    dialog: HTMLElement,
    current: string,
    next: string,
  ): Promise<void> {
    await user.type(within(dialog).getByLabelText('Current password'), current);
    await user.type(within(dialog).getByLabelText('New password'), next);
    await user.type(within(dialog).getByLabelText('Confirm new password'), next);
    await user.click(within(dialog).getByRole('button', { name: 'Change password' }));
  }

  it('changes the password and says the other devices were signed out', async () => {
    const { user, dialog } = await openDialog();
    await fill(user, dialog, MOCK_PASSWORD, 'a-new-long-passphrase');
    expect(await screen.findByText('Password changed. Other devices were signed out.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Change password' })).toBeNull());
  });

  it('puts a wrong current password and a weak new one on their fields', async () => {
    const { user, dialog } = await openDialog();
    await fill(user, dialog, 'not-the-password', 'a-new-long-passphrase');
    expect(await within(dialog).findByText('The current password is not correct.')).toBeInTheDocument();
    server.use(
      http.post('*/api/v1/auth/password/change', () => problemOf(422, 'weak_password', { reason: 'breached' })),
    );
    await user.clear(within(dialog).getByLabelText('Current password'));
    await user.type(within(dialog).getByLabelText('Current password'), MOCK_PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: 'Change password' }));
    expect(
      await within(dialog).findByText('This password appears in known data breaches. Choose another one.'),
    ).toBeInTheDocument();
  });

  it('asks the two new passwords to match before sending', async () => {
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByLabelText('Current password'), MOCK_PASSWORD);
    await user.type(within(dialog).getByLabelText('New password'), 'a-new-long-passphrase');
    await user.type(within(dialog).getByLabelText('Confirm new password'), 'something-else-entirely');
    await user.click(within(dialog).getByRole('button', { name: 'Change password' }));
    expect(await within(dialog).findByText('The two new passwords are not the same.')).toBeInTheDocument();
  });

  it('confirms it is the person first when the session is not fresh', async () => {
    signIn({ fresh: false });
    const { user, dialog } = await openDialog();
    await fill(user, dialog, MOCK_PASSWORD, 'a-new-long-passphrase');
    const reauth = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.type(within(reauth).getByLabelText('Password'), MOCK_PASSWORD);
    await user.click(within(reauth).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Password changed. Other devices were signed out.')).toBeInTheDocument();
  });

  it('lists the sessions, marks this device, and signs one out', async () => {
    const { user, container } = renderWithProviders(page(<SecurityScreen />));
    const table = await screen.findByRole('table', { name: 'Active sessions' });
    await within(table).findByText('This device');
    const rows = within(table).getAllByRole('row').slice(1);
    const before = rows.length;
    const [signOut] = within(table).getAllByRole('button', { name: /^Sign out / });
    if (!signOut) throw new Error('no other session');
    await user.click(signOut);
    await waitFor(() => expect(within(table).getAllByRole('row').slice(1)).toHaveLength(before - 1));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('signs out every other session at once', async () => {
    const { user } = renderWithProviders(page(<SecurityScreen />));
    const table = await screen.findByRole('table', { name: 'Active sessions' });
    await within(table).findByText('This device');
    await user.click(screen.getByRole('button', { name: 'Sign out other sessions' }));
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    expect(screen.queryByRole('button', { name: 'Sign out other sessions' })).toBeNull();
  });

  it('says when to try again after too many attempts, and when the change failed', async () => {
    server.use(
      http.post('*/api/v1/auth/password/change', () => problemOf(429, 'rate_limited', { retry_after_seconds: 120 })),
    );
    const { user, dialog } = await openDialog();
    await fill(user, dialog, MOCK_PASSWORD, 'a-new-long-passphrase');
    expect(await within(dialog).findByText('Too many attempts. Try again in 2 minutes.')).toBeInTheDocument();
    server.use(http.post('*/api/v1/auth/password/change', SERVER_ERROR));
    await user.click(within(dialog).getByRole('button', { name: 'Change password' }));
    expect(await within(dialog).findByText('The password was not changed. Try again in a moment.')).toBeInTheDocument();
  });

  it('keeps the dialog as it was when "Confirm it is you" is cancelled', async () => {
    signIn({ fresh: false });
    const { user, dialog } = await openDialog();
    await fill(user, dialog, MOCK_PASSWORD, 'a-new-long-passphrase');
    const reauth = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.click(within(reauth).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Confirm it is you' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Change password' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('New password')).toHaveValue('a-new-long-passphrase');
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Password changed. Other devices were signed out.')).toBeNull();
  });

  it('says the sessions could not be loaded, and loads them on Try again', async () => {
    server.use(http.get('*/api/v1/auth/sessions', SERVER_ERROR, { once: true }));
    const { user } = renderWithProviders(page(<SecurityScreen />));
    expect(await screen.findByText('Could not load your sessions')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Active sessions' })).toBeInTheDocument();
  });

  it('says when a sign-out failed, and takes a session that had already ended as signed out', async () => {
    server.use(http.delete('*/api/v1/auth/sessions/:sessionId', SERVER_ERROR, { once: true }));
    const { user } = renderWithProviders(page(<SecurityScreen />));
    const table = await screen.findByRole('table', { name: 'Active sessions' });
    await within(table).findByText('This device');
    const [first] = within(table).getAllByRole('button', { name: /^Sign out / });
    if (!first) throw new Error('no other session');
    await user.click(first);
    // A toast's words are also in a live region
    expect(await screen.findAllByText('That did not work. Try again in a moment.')).not.toHaveLength(0);
    server.use(http.delete('*/api/v1/auth/sessions/:sessionId', () => problemOf(404, 'not_found'), { once: true }));
    await user.click(first);
    // A toast's words are also in a live region
    expect(await screen.findAllByText('Session signed out')).not.toHaveLength(0);
  });

  it('keeps focus in the section when the button that was pressed goes away', async () => {
    const { user } = renderWithProviders(page(<SecurityScreen />));
    const table = await screen.findByRole('table', { name: 'Active sessions' });
    await within(table).findByText('This device');
    await user.click(screen.getByRole('button', { name: 'Sign out other sessions' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Active sessions' })).toHaveFocus());
  });

  it('shows the two-factor state only', async () => {
    renderWithProviders(page(<SecurityScreen />));
    expect(await screen.findByText('Two-factor authentication')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /two-factor/i })).toBeNull();
  });
});

describe('Preferences', () => {
  beforeEach(() => signIn({ fresh: true }));
  afterEach(() => clearPreferences());

  it('saves each change at once in this browser, under the person, and keeps it across a reload', async () => {
    const { user, unmount } = renderWithProviders(page(<PreferencesScreen />));
    await user.click(await screen.findByRole('radio', { name: 'Comfortable' }));
    await user.click(screen.getByRole('switch', { name: 'Single-key shortcuts' }));
    expect(JSON.parse(localStorage.getItem(preferenceKey(EDITOR.user_id, 'settings')) ?? '{}')).toMatchObject({
      tableDensity: 'default',
      singleKeys: false,
    });
    unmount();
    renderWithProviders(page(<PreferencesScreen />));
    expect(await screen.findByRole('radio', { name: 'Comfortable' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Single-key shortcuts' })).not.toBeChecked();
  });

  it('starts on Compact, the default, and keeps it there for a person whose older settings hold density "default"', async () => {
    const { unmount } = renderWithProviders(page(<PreferencesScreen />));
    expect(await screen.findByRole('radio', { name: 'Compact (default)' })).toBeChecked();
    unmount();
    localStorage.setItem(
      preferenceKey(EDITOR.user_id, 'settings'),
      JSON.stringify({ density: 'default', locale: 'en-GB', reduceMotion: false, singleKeys: true }),
    );
    renderWithProviders(page(<PreferencesScreen />));
    expect(await screen.findByRole('radio', { name: 'Compact (default)' })).toBeChecked();
  });

  it('shows an example of the chosen number and date format', async () => {
    localStorage.setItem(preferenceKey(EDITOR.user_id, 'settings'), JSON.stringify({ locale: 'de-DE' }));
    const { container } = renderWithProviders(page(<PreferencesScreen />));
    expect(await screen.findByText(/Example: 1\.234,5/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('forgets the preferences when the person signs out', async () => {
    localStorage.setItem(preferenceKey(EDITOR.user_id, 'settings'), JSON.stringify({ density: 'compact' }));
    function SignOut(): ReactNode {
      const { signOut } = useSignOut();
      return (
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      );
    }
    const { user } = renderWithProviders(page(<SignOut />));
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith('/login'));
    expect(localStorage.getItem(preferenceKey(EDITOR.user_id, 'settings'))).toBeNull();
  });
});
