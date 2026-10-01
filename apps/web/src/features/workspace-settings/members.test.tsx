import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MembersPage } from './members-page';
import { FreshSessionProvider } from '@/features/session';
import type { Role } from '@/lib/api/types';
import { LeaveGuardProvider } from '@/lib/navigation/use-leave-guard';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PASSWORD, MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/digibranders/fynix/settings/members',
}));

const W = `*/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;

function pageAs(role: Role, { fresh = true }: { fresh?: boolean } = {}): ReactElement {
  const until = fresh ? Date.now() + 600_000 : 0;
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(until)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <FreshSessionProvider>
        <LeaveGuardProvider>
          <Suspense fallback={null}>
            <MembersPage />
          </Suspense>
        </LeaveGuardProvider>
      </FreshSessionProvider>
    </PermissionProvider>
  );
}

const rowOf = async (name: string): Promise<HTMLElement> => {
  const table = await screen.findByRole('table', { name: 'Members' });
  return (await within(table).findByText(name)).closest('tr') ?? table;
};

const openMenu = async (user: ReturnType<typeof renderWithProviders>['user'], name: string): Promise<HTMLElement> => {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  return screen.findByRole('menu');
};

describe('Members and roles', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists every member with role and access, and has no accessibility violations', async () => {
    const { container } = renderWithProviders(pageAs('admin'));
    const row = await rowOf('Jonas Lindqvist');
    expect(within(row).getByText('Analyst')).toBeInTheDocument();
    expect(within(row).getByText('2 projects')).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Pending invitations' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the table without actions or invitations to a member who does not manage members', async () => {
    renderWithProviders(pageAs('editor'));
    await rowOf('Ana Brandt');
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invite people' })).toBeNull();
    expect(screen.getByText('Owners and admins can manage members.')).toBeInTheDocument();
  });

  it('changes a role and limits the projects', async () => {
    const { user } = renderWithProviders(pageAs('admin'));
    await rowOf('Mei Chen');
    const menu = await openMenu(user, 'Mei Chen');
    await user.click(within(menu).getByRole('menuitem', { name: 'Change role and access' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change role and access' });
    expect(within(dialog).queryByRole('radio', { name: /Owner/ })).toBeNull();
    await user.click(within(dialog).getByRole('radio', { name: /Analyst/ }));
    await user.click(within(dialog).getByRole('radio', { name: /Some projects/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText('Choose at least one project.')).toBeInTheDocument();
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Fynix' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findAllByText('Mei Chen is now Analyst')).not.toHaveLength(0);
    await waitFor(async () => expect(within(await rowOf('Mei Chen')).getByText('1 project')).toBeInTheDocument());
  });

  it('confirms it is the person first when the session is not fresh', async () => {
    const { user } = renderWithProviders(pageAs('admin', { fresh: false }));
    await rowOf('Mei Chen');
    await user.click(
      within(await openMenu(user, 'Mei Chen')).getByRole('menuitem', { name: 'Change role and access' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Change role and access' });
    await user.click(within(dialog).getByRole('radio', { name: /Editor/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    const reauth = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.type(within(reauth).getByLabelText('Password'), MOCK_PASSWORD);
    await user.click(within(reauth).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findAllByText('Mei Chen is now Editor')).not.toHaveLength(0);
  });

  it('says the workspace needs an owner when the last one would go', async () => {
    const { user } = renderWithProviders(pageAs('owner'));
    await rowOf('Ana Brandt');
    await user.click(
      within(await openMenu(user, 'Ana Brandt')).getByRole('menuitem', { name: 'Change role and access' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Change role and access' });
    await user.click(within(dialog).getByRole('radio', { name: /Admin/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(
      await within(dialog).findByText('The workspace needs an owner. Make someone else an owner first.'),
    ).toBeInTheDocument();
  });

  it("does not let an admin change an owner, and offers no removal of one's own row", async () => {
    const { user } = renderWithProviders(pageAs('admin'));
    await rowOf('Ana Brandt');
    const menu = await openMenu(user, 'Ana Brandt');
    expect(within(menu).getByRole('menuitem', { name: /Change role and access/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.keyboard('{Escape}');
    const own = await openMenu(user, 'Tomás Rivera');
    expect(within(own).queryByRole('menuitem', { name: 'Remove from workspace' })).toBeNull();
  });

  it('removes a member after asking', async () => {
    const { user } = renderWithProviders(pageAs('admin'));
    await rowOf('Mei Chen');
    await user.click(within(await openMenu(user, 'Mei Chen')).getByRole('menuitem', { name: 'Remove from workspace' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Mei Chen?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove from workspace' }));
    expect(await screen.findAllByText('Mei Chen removed from the workspace')).not.toHaveLength(0);
    await waitFor(() => expect(screen.queryByText('mei@digibranders.test')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Members and roles' })).toHaveFocus();
  });

  it("renders the page again after a change to one's own role", async () => {
    const { user } = renderWithProviders(pageAs('owner'));
    await rowOf('Tomás Rivera');
    // An owner makes the admin an owner, then changes their own access by making themself an admin
    await user.click(
      within(await openMenu(user, 'Tomás Rivera')).getByRole('menuitem', { name: 'Change role and access' }),
    );
    let dialog = await screen.findByRole('dialog', { name: 'Change role and access' });
    await user.click(within(dialog).getByRole('radio', { name: /Owner/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Change role and access' })).toBeNull());
    expect(router.refresh).not.toHaveBeenCalled();
    await user.click(
      within(await openMenu(user, 'Ana Brandt')).getByRole('menuitem', { name: 'Change role and access' }),
    );
    dialog = await screen.findByRole('dialog', { name: 'Change role and access' });
    await user.click(within(dialog).getByRole('radio', { name: /Admin/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('keeps the dialog as it was when "Confirm it is you" is cancelled', async () => {
    const { user } = renderWithProviders(pageAs('admin', { fresh: false }));
    await rowOf('Mei Chen');
    await user.click(
      within(await openMenu(user, 'Mei Chen')).getByRole('menuitem', { name: 'Change role and access' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Change role and access' });
    await user.click(within(dialog).getByRole('radio', { name: /Editor/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    const reauth = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.click(within(reauth).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Confirm it is you' })).toBeNull());
    expect(within(dialog).getByRole('radio', { name: /Editor/ })).toBeChecked();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    // Nothing was sent: the table behind the dialog still says Viewer
    const table = screen.getByRole('table', { name: 'Members', hidden: true });
    expect(within(within(table).getByText('Mei Chen').closest('tr') ?? table).getByText('Viewer')).toBeInTheDocument();
  });

  it('withdraws the invitations of an admin who is removed', async () => {
    const { user } = renderWithProviders(pageAs('owner'));
    const invitations = await screen.findByRole('table', { name: 'Pending invitations' });
    expect(await within(invitations).findByText('sam@clientco.test')).toBeInTheDocument();
    await rowOf('Tomás Rivera');
    await user.click(
      within(await openMenu(user, 'Tomás Rivera')).getByRole('menuitem', { name: 'Remove from workspace' }),
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Tomás Rivera?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove from workspace' }));
    await waitFor(() => expect(within(invitations).queryByText('sam@clientco.test')).toBeNull());
  });

  it('says the members could not be loaded, and loads them on Try again', async () => {
    server.use(
      http.get(
        `${W}/members`,
        () =>
          HttpResponse.json(
            { type: 'about:blank', title: 'Error', status: 500, code: 'internal', request_id: 'r' },
            { status: 500, headers: { 'content-type': 'application/problem+json' } },
          ),
        { once: true },
      ),
    );
    const { user } = renderWithProviders(pageAs('admin'));
    expect(await screen.findByText('Could not load the members')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Try again' })[0] ?? document.body);
    expect(await screen.findByRole('table', { name: 'Members' })).toBeInTheDocument();
  });
});

describe('Invitations', () => {
  it('invites someone with access to some projects', async () => {
    const { user } = renderWithProviders(pageAs('admin'));
    await user.click(await screen.findByRole('button', { name: 'Invite people' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite people' });
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(await within(dialog).findByText('Enter an email address.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Email'), 'new@client.test');
    await user.click(within(dialog).getByRole('radio', { name: /Some projects/ }));
    await user.click(await within(dialog).findByRole('checkbox', { name: MOCK_PROJECTS[1]?.name ?? '' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findAllByText('Invitation sent to new@client.test')).not.toHaveLength(0);
    const table = await screen.findByRole('table', { name: 'Pending invitations' });
    expect(await within(table).findByText('new@client.test')).toBeInTheDocument();
  });

  it('puts an address that is a member already on the email field', async () => {
    const { user } = renderWithProviders(pageAs('admin'));
    await user.click(await screen.findByRole('button', { name: 'Invite people' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite people' });
    await user.type(within(dialog).getByLabelText('Email'), mockUser('editor').email);
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(
      await within(dialog).findByText('This person is already a member or has an invitation waiting.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Email')).toHaveFocus();
  });

  it('says when to try again after too many invitations', async () => {
    server.use(
      http.post(`${W}/invitations`, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Too many',
            status: 429,
            code: 'rate_limited',
            request_id: 'r',
            retry_after_seconds: 1800,
          },
          { status: 429, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { user } = renderWithProviders(pageAs('admin'));
    await user.click(await screen.findByRole('button', { name: 'Invite people' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite people' });
    await user.type(within(dialog).getByLabelText('Email'), 'a@b.test');
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(
      await within(dialog).findByText('Too many invitations in the last hour. Try again in 30 minutes.'),
    ).toBeInTheDocument();
  });

  it('offers an admin no owner role, and asks them to confirm before inviting an admin', async () => {
    const { user } = renderWithProviders(pageAs('admin', { fresh: false }));
    await user.click(await screen.findByRole('button', { name: 'Invite people' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite people' });
    expect(within(dialog).queryByRole('radio', { name: /^Owner/ })).toBeNull();
    await user.type(within(dialog).getByLabelText('Email'), 'lead@client.test');
    await user.click(within(dialog).getByRole('radio', { name: /^Admin/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    const reauth = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.type(within(reauth).getByLabelText('Password'), MOCK_PASSWORD);
    await user.click(within(reauth).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findAllByText('Invitation sent to lead@client.test')).not.toHaveLength(0);
  });

  it('says an invitation was already used, and takes it off the list', async () => {
    server.use(
      http.delete(`${W}/invitations/:invitationId`, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Not possible',
            status: 409,
            code: 'invalid_state_transition',
            request_id: 'r',
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { user } = renderWithProviders(pageAs('admin'));
    const table = await screen.findByRole('table', { name: 'Pending invitations' });
    await user.click(
      await within(table).findByRole('button', { name: 'Withdraw the invitation for sam@clientco.test' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw invitation' }));
    expect(await screen.findAllByText('This invitation was already used, withdrawn or has expired.')).not.toHaveLength(
      0,
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('withdraws an invitation after asking', async () => {
    const { user } = renderWithProviders(pageAs('admin'));
    const table = await screen.findByRole('table', { name: 'Pending invitations' });
    await user.click(
      await within(table).findByRole('button', { name: 'Withdraw the invitation for sam@clientco.test' }),
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'Withdraw the invitation for sam@clientco.test?' });
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw invitation' }));
    await waitFor(() => expect(within(table).queryByText('sam@clientco.test')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Invitations' })).toHaveFocus();
  });
});
