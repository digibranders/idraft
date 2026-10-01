import { act, screen, waitFor, within } from '@testing-library/react';
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
    await user.type(screen.getByRole('textbox', { name: 'Site' }), 'northwind.example');
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
    await user.type(screen.getByRole('textbox', { name: 'Site' }), 'northwind.example');
    expect(address).toHaveValue('nw');
  });

  it('sends the site, the location and the brand with its other names', async () => {
    let sent: unknown = null;
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/projects')) {
        void request
          .clone()
          .json()
          .then((body: unknown) => {
            sent = body;
          });
      }
    });
    const { user } = renderWithProviders(form());
    await user.type(await screen.findByLabelText('Name'), 'Acme Studio');
    await user.type(screen.getByRole('textbox', { name: 'Site' }), 'https://www.acme-studio.example/about');
    expect(await screen.findByText('acme-studio.example')).toHaveClass('text-foreground');
    await user.type(screen.getByRole('combobox', { name: /^Location/ }), 'Ger');
    await user.click(await screen.findByRole('option', { name: /^Germany/ }));
    expect(screen.getByRole('textbox', { name: 'Brand name' })).toHaveValue('Acme Studio');
    await user.type(screen.getByRole('combobox', { name: /^Other names/ }), 'Acme{Enter}{Escape}');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/digibranders/acme-studio'));
    expect(sent).toMatchObject({
      primary_domain: 'https://www.acme-studio.example/about',
      default_location_id: 2276,
      own_entity: {
        canonical_name: 'Acme Studio',
        domains: ['https://www.acme-studio.example/about'],
        aliases: ['Acme'],
      },
    });
    server.events.removeAllListeners('request:start');
  });

  it('puts a brand name the workspace has on the brand field', async () => {
    const { user } = renderWithProviders(form());
    await user.type(await screen.findByLabelText('Name'), 'Rankforge');
    await user.type(screen.getByRole('textbox', { name: 'Site' }), 'rankforge.example');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText(/^Another brand in this workspace has this name/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Brand name' })).toHaveAttribute('aria-invalid', 'true');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('hands the address back to the name when it is emptied', async () => {
    const { user } = renderWithProviders(form());
    const address = await screen.findByLabelText('Address');
    await user.type(address, 'nw');
    await user.type(screen.getByLabelText('Name'), 'Northwind');
    await user.type(screen.getByRole('textbox', { name: 'Site' }), 'northwind.example');
    await user.clear(address);
    expect(address).toHaveValue('northwind');
  });

  it('does not open the project when the person discarded it while it was being created', async () => {
    let onCreated: (() => void) | undefined;
    const created = new Promise<void>((resolve) => {
      onCreated = resolve;
    });
    const onMocked = ({ request, response }: { request: Request; response: Response }): void => {
      if (request.method === 'POST' && response.status === 201) onCreated?.();
    };
    server.events.on('response:mocked', onMocked);
    let answer: (() => void) | undefined;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    server.use(
      // Holds the create until the person has left, then lets the mock create the project
      http.post(mswPath('/api/v1/workspaces/{workspace_id}/projects'), async (): Promise<undefined> => {
        await answered;
        return undefined;
      }),
    );
    const { user } = renderWithProviders(form());
    await user.type(await screen.findByLabelText('Name'), 'Northwind');
    await user.type(screen.getByRole('textbox', { name: 'Site' }), 'northwind.example');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    await user.click(screen.getByRole('link', { name: 'Back to projects' }));
    const question = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    await user.click(within(question).getByRole('button', { name: 'Discard changes' }));
    expect(router.push).toHaveBeenCalledWith('/digibranders');
    answer?.();
    await created;
    // Lets the mutation settle and the page render with the new project before looking
    await act(async () => {
      await Promise.resolve();
    });
    expect(router.replace).not.toHaveBeenCalled();
    server.events.removeListener('response:mocked', onMocked);
  });

  it('checks the fields before it sends them, and puts a taken address on its field', async () => {
    const { user } = renderWithProviders(form());
    await user.click(await screen.findByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Enter a name.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Fynix');
    await user.type(screen.getByRole('textbox', { name: 'Site' }), 'northwind.example');
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
    await user.type(screen.getByRole('textbox', { name: 'Site' }), 'northwind.example');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    const alert = await screen.findByText(
      'This workspace has 10 of 10 projects. Archive one, or ask for a larger plan.',
    );
    await waitFor(() => expect(alert.closest('[data-slot="form-alert"]')).toHaveFocus());
  });

  it('checks the other names, and puts the API’s error for one of them on their field', async () => {
    const { user } = renderWithProviders(form());
    await user.type(await screen.findByLabelText('Name'), 'Acme Studio');
    await user.type(screen.getByRole('textbox', { name: 'Site' }), 'acme-studio.example');
    const others = screen.getByRole('combobox', { name: /^Other names/ });
    // Pasted, as typing 201 characters one by one is slow
    await user.click(others);
    await user.paste('A'.repeat(201));
    await user.keyboard('{Enter}{Escape}');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Each other name has at most 200 characters.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Remove ${'A'.repeat(201)}` }));

    server.use(
      http.post(mswPath('/api/v1/workspaces/{workspace_id}/projects'), ({ request }) =>
        problem(request, 'validation_failed', {
          errors: [{ location: 'body', path: 'own_entity.aliases.0', code: 'string_too_short', message: 'Too short' }],
        }),
      ),
    );
    await user.type(others, 'Acme{Enter}{Escape}');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(
      await screen.findByText('One of the other names cannot be saved. Check it and try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('The project was not created. Try again in a moment.')).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('says so when the workspace is suspended', async () => {
    server.use(
      http.post(mswPath('/api/v1/workspaces/{workspace_id}/projects'), ({ request }) =>
        problem(request, 'workspace_suspended'),
      ),
    );
    const { user } = renderWithProviders(form());
    await user.type(await screen.findByLabelText('Name'), 'One more');
    await user.type(screen.getByRole('textbox', { name: 'Site' }), 'northwind.example');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(
      await screen.findByText('This workspace is suspended, so no project can be created in it.'),
    ).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
