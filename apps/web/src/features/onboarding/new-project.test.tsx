import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewProjectForm } from './new-project-form';
import { LeaveGuardProvider } from '@/lib/navigation/use-leave-guard';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

function form(): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.0; Path=/; Secure`;
  return (
    <LeaveGuardProvider>
      <Suspense fallback={null}>
        <NewProjectForm workspaceId={MOCK_WORKSPACE.workspace_id} workspaceSlug="digibranders" />
      </Suspense>
    </LeaveGuardProvider>
  );
}

describe('New project', () => {
  beforeEach(() => {
    router.push.mockReset();
    router.replace.mockReset();
  });

  it('suggests the address from the name, creates the project and opens it', async () => {
    const { user, container } = renderWithProviders(form());
    await user.type(await screen.findByLabelText('Name'), 'Northwind Café');
    expect(screen.getByLabelText('Address')).toHaveValue('northwind-cafe');
    expect(screen.getByText('Used in links: /digibranders/northwind-cafe')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/digibranders/northwind-cafe'));
  });

  it('stops following the name once the address is edited', async () => {
    const { user } = renderWithProviders(form());
    const address = await screen.findByLabelText('Address');
    await user.type(address, 'nw');
    await user.type(screen.getByLabelText('Name'), 'Northwind');
    expect(address).toHaveValue('nw');
  });

  it('checks the fields before it sends them, and puts a taken address on its field', async () => {
    const { user } = renderWithProviders(form());
    await user.click(await screen.findByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Enter a name.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Fynix');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Another project in this workspace uses this address.')).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('says how many projects the plan allows when it is full', async () => {
    server.use(
      http.post(`*/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects`, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Quota exceeded',
            status: 422,
            code: 'quota_exceeded',
            request_id: 'r',
            limit: 10,
            used: 10,
            requested: 1,
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { user } = renderWithProviders(form());
    await user.type(await screen.findByLabelText('Name'), 'One more');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    const alert = await screen.findByText(
      'This workspace has 10 of 10 projects. Archive one, or ask for a larger plan.',
    );
    await waitFor(() => expect(alert.closest('[data-slot="form-alert"]')).toHaveFocus());
  });

  it('says so when the workspace is suspended', async () => {
    server.use(
      http.post(mswPath('/api/v1/workspaces/{workspace_id}/projects'), ({ request }) =>
        problem(request, 'workspace_suspended'),
      ),
    );
    const { user } = renderWithProviders(form());
    await user.type(await screen.findByLabelText('Name'), 'One more');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(
      await screen.findByText('This workspace is suspended, so no project can be created in it.'),
    ).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
