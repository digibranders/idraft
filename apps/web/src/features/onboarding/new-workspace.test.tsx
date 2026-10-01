import { screen, waitFor } from '@testing-library/react';
import { http } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewWorkspaceScreen } from './new-workspace-screen';
import type { Role } from '@/lib/api/types';
import { mockUser } from '@/mocks/fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

function screenAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.0; Path=/; Secure`;
  return (
    <Suspense fallback={null}>
      <NewWorkspaceScreen />
    </Suspense>
  );
}

describe('Create a workspace', () => {
  beforeEach(() => router.replace.mockReset());

  it('creates the workspace for an operator and opens it', async () => {
    // The owner fixture is a platform operator
    const { user, container } = renderWithProviders(screenAs('owner'));
    await user.type(await screen.findByLabelText('Name'), 'Second Agency');
    expect(screen.getByLabelText('Address')).toHaveValue('second-agency');
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/second-agency'));
  });

  it('puts a taken or reserved address on its field', async () => {
    const { user } = renderWithProviders(screenAs('owner'));
    const address = await screen.findByLabelText('Address');
    await user.type(address, 'login');
    await user.type(screen.getByLabelText('Name'), 'Agency');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(await screen.findByText('This word is used by the app. Choose another.')).toBeInTheDocument();
    // Typing over the selection: clearing the field would hand the address back to the name
    await user.tripleClick(address);
    await user.keyboard('digibranders');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(await screen.findByText('This address is taken. Choose another.')).toBeInTheDocument();
  });

  it('says why the API refused: no longer an operator, or the limit of a day reached', async () => {
    server.use(http.post(mswPath('/api/v1/workspaces'), ({ request }) => problem(request, 'forbidden')));
    const { user } = renderWithProviders(screenAs('owner'));
    await user.type(await screen.findByLabelText('Name'), 'Agency');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(
      await screen.findByText('Only platform operators can create a workspace while sign-up is by invitation.'),
    ).toBeInTheDocument();
    server.use(
      http.post(mswPath('/api/v1/workspaces'), ({ request }) =>
        problem(request, 'rate_limited', { headers: { 'retry-after': '3600' } }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(
      await screen.findByText('You created the most workspaces allowed in a day. Try again tomorrow.'),
    ).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
