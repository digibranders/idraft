import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DomainsScreen } from './domains-screen';
import { EntitiesScreen } from './entities-screen';
import type { Role } from '@/lib/api/types';
import { LeaveGuardProvider } from '@/lib/navigation/use-leave-guard';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/settings/entities',
}));

const [fynix] = MOCK_PROJECTS;
if (!fynix) throw new Error('no fixture project');
const SCOPE = {
  workspaceId: MOCK_WORKSPACE.workspace_id,
  projectId: fynix.project_id,
  workspaceSlug: 'digibranders',
  projectSlug: fynix.slug,
};

function as(role: Role, page: ReactElement): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <LeaveGuardProvider>
        <Suspense fallback={null}>{page}</Suspense>
      </LeaveGuardProvider>
    </PermissionProvider>
  );
}

/** A table of the screen once its rows have loaded (its body stops being busy). */
const table = async (name: string): Promise<HTMLElement> => {
  const found = await screen.findByRole('table', { name });
  await waitFor(() => expect(found.querySelector('tbody')).toHaveAttribute('aria-busy', 'false'));
  return found;
};

describe('Entities and aliases', () => {
  it('lists the own brand, the competitors with their count, and the watched entities', async () => {
    const { container } = renderWithProviders(as('editor', <EntitiesScreen {...SCOPE} />));
    const own = await table('Own brand');
    expect(within(own).getByRole('link', { name: 'Fynix' })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/digibranders\/fynix\/settings\/entities\/[0-9a-f-]{36}$/),
    );
    expect(within(own).getByText('Primary')).toBeInTheDocument();
    const competitors = await table('Competitors');
    expect(within(competitors).getAllByRole('row')).toHaveLength(6);
    expect(screen.getByText('5 of 10 in SEO')).toBeInTheDocument();
    expect(within(await table('Watched')).getByText('SEO Weekly')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('adds a competitor: the name follows the domain, and the new row appears', async () => {
    const { user } = renderWithProviders(as('editor', <EntitiesScreen {...SCOPE} />));
    await table('Competitors');
    await user.click(screen.getByRole('button', { name: 'Add competitor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add competitor' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Domain' }), 'https://www.hubspot.com/products/crm');
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('Hubspot');
    expect(within(dialog).getByText('5 of 10 competitors tracked in SEO')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add competitor' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(await within(await table('Competitors')).findByRole('link', { name: 'Hubspot' })).toBeInTheDocument();
  });

  it('checks the dialog before sending it: a domain, a name, something to track', async () => {
    const { user } = renderWithProviders(as('editor', <EntitiesScreen {...SCOPE} />));
    await table('Competitors');
    await user.click(screen.getByRole('button', { name: 'Add competitor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add competitor' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'SEO rankings' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'AI visibility' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add competitor' }));
    expect(within(dialog).getByText('Enter a domain, for example example.com')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Domain' })).toHaveFocus();
    expect(within(dialog).getByText('Select at least one')).toBeInTheDocument();
  });

  it('keeps the created entity when giving it the role fails, and only gives the role on the next try', async () => {
    let creates = 0;
    server.use(
      http.post(mswPath('/api/v1/workspaces/{workspace_id}/entities'), () => {
        creates += 1;
        return undefined;
      }),
      http.post(
        mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities'),
        ({ request }) => problem(request, 'competitor_limit'),
        { once: true },
      ),
    );
    const { user } = renderWithProviders(as('editor', <EntitiesScreen {...SCOPE} />));
    await table('Competitors');
    await user.click(screen.getByRole('button', { name: 'Add competitor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add competitor' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Domain' }), 'pipedrive.com');
    await user.click(within(dialog).getByRole('button', { name: 'Add competitor' }));
    expect(
      await within(dialog).findByText(
        'This project tracks 10 competitors in SEO, the most it can. Add this one for AI visibility only, or turn SEO off for another.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Domain' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Add competitor' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(creates).toBe(1);
  });

  it('removes a competitor after asking, and says its history stays', async () => {
    const { user } = renderWithProviders(as('editor', <EntitiesScreen {...SCOPE} />));
    await table('Competitors');
    await user.click(screen.getByRole('button', { name: 'Actions for Rankforge' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove from project' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove Rankforge from this project?' });
    expect(within(confirm).getByText(/Its history stays/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Rankforge' })).toBeNull());
  });

  it('offers no removal of the primary own brand', async () => {
    const { user } = renderWithProviders(as('editor', <EntitiesScreen {...SCOPE} />));
    await table('Own brand');
    await user.click(screen.getByRole('button', { name: 'Actions for Fynix' }));
    expect(await screen.findByRole('menuitem', { name: 'Change tracking' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Remove from project' })).toBeNull();
  });

  it('changes what an entity counts in', async () => {
    const { user } = renderWithProviders(as('editor', <EntitiesScreen {...SCOPE} />));
    await table('Competitors');
    await user.click(screen.getByRole('button', { name: 'Actions for Meridian Growth' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Change tracking' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tracking for Meridian Growth' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'AI visibility' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    const row = (await within(await table('Competitors')).findByText('Meridian Growth')).closest('tr');
    if (row === null) throw new Error('no row');
    await waitFor(() => expect(within(row).queryByText('AI')).toBeNull());
  });

  it('shows a member without entities:write the lists read-only', async () => {
    renderWithProviders(as('analyst', <EntitiesScreen {...SCOPE} />));
    await table('Competitors');
    expect(screen.getByText('Owners, admins and editors can change the entities of a project.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add competitor' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
  });
});

describe('Domains', () => {
  it('lists the domains by role, with how much each counts and a link to its entity', async () => {
    const { container } = renderWithProviders(as('analyst', <DomainsScreen {...SCOPE} />));
    const watched = await table('Watched');
    expect(within(watched).getByText('medium.com/seo-weekly')).toBeInTheDocument();
    expect(within(watched).getByText('Pages under a path')).toBeInTheDocument();
    expect(within(await table('Own brand')).getByRole('link', { name: 'Fynix' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
