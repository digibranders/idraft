import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceGeneralScreen } from './general-screen';
import { FreshSessionProvider } from '@/features/session';
import { LIVE_REGION_ID } from '@/lib/a11y/announcer';
import type { Role } from '@/lib/api/types';
import { LeaveGuardProvider } from '@/lib/navigation/use-leave-guard';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory, workspaceFactory } from '@/mocks/factories/identity';
import { mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/digibranders/fynix/settings/workspace',
}));

const WORKSPACE = workspaceFactory();

function screenAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <FreshSessionProvider>
        <LeaveGuardProvider>
          <Suspense fallback={null}>
            <WorkspaceGeneralScreen workspace={WORKSPACE} projectSlug="fynix" />
          </Suspense>
        </LeaveGuardProvider>
      </FreshSessionProvider>
    </PermissionProvider>
  );
}

describe('Workspace settings > General', () => {
  beforeEach(() => {
    router.replace.mockReset();
    router.refresh.mockReset();
  });

  it('renames the workspace, says so, and renders the shell again', async () => {
    const { user, container } = renderWithProviders(screenAs('admin'));
    const name = await screen.findByLabelText('Name');
    expect(await axe(container)).toHaveNoViolations();
    await user.clear(name);
    await user.type(name, 'Digibranders Agency');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(document.getElementById(LIVE_REGION_ID.polite)).toHaveTextContent('Workspace settings saved'),
    );
    expect(router.refresh).toHaveBeenCalled();
  });

  it('moves to the new address, and refuses a word the app uses', async () => {
    const { user } = renderWithProviders(screenAs('owner'));
    const slug = await screen.findByLabelText('Address');
    await user.clear(slug);
    await user.type(slug, 'login');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('This word is used by the app. Choose another.')).toBeInTheDocument();
    await user.clear(slug);
    await user.type(slug, 'dgb-agency');
    expect(screen.getByText('Used in links: /dgb-agency')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/dgb-agency/fynix/settings/workspace'));
  });

  it('puts a taken address on its field', async () => {
    const { user } = renderWithProviders(screenAs('owner'));
    const slug = await screen.findByLabelText('Address');
    await user.clear(slug);
    await user.type(slug, 'taken-slug');
    server.use(
      http.patch(`*/api/v1/workspaces/${WORKSPACE.workspace_id}`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Exists', status: 409, code: 'duplicate', request_id: 'r' },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('This address is taken. Choose another.')).toBeInTheDocument();
    expect(slug).toHaveFocus();
  });

  it('shows the values read-only to a member who may not change them', async () => {
    const { container } = renderWithProviders(screenAs('editor'));
    expect(await screen.findByText('Owners and admins can change workspace settings.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('/digibranders')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
