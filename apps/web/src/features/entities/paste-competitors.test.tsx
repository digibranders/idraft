import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EntitiesScreen } from './entities-screen';
import type { Role } from '@/lib/api/types';
import { LeaveGuardProvider } from '@/lib/navigation/use-leave-guard';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
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
  timeZone: fynix.timezone,
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

async function openPasteMode(user: ReturnType<typeof renderWithProviders>['user']): Promise<HTMLElement> {
  await table('Competitors');
  await user.click(screen.getByRole('button', { name: 'Add competitor' }));
  const single = await screen.findByRole('dialog', { name: 'Add competitor' });
  await user.click(within(single).getByRole('button', { name: 'Add several at once' }));
  return screen.findByRole('dialog', { name: 'Add competitors' });
}

describe('Adding competitors from a pasted list', () => {
  it('reads the list as it is typed, naming the lines it will not add, and counts what it will add', async () => {
    const { user } = renderWithProviders(as('editor', <EntitiesScreen {...SCOPE} />));
    const dialog = await openPasteMode(user);
    const add = within(dialog).getByRole('button', { name: 'Add competitors' });
    expect(add).toBeDisabled();
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Competitors' }),
      'brightlead.io\nNorthbeam, northbeam.com\nnot a site\nbrightlead.io',
    );
    expect(within(dialog).getByRole('button', { name: 'Add 2 competitors' })).toBeEnabled();
    const issues = within(dialog).getByRole('list', { name: 'Lines that will not be added' });
    expect(within(issues).getAllByRole('listitem')).toHaveLength(2);
    expect(within(issues).getByText(/Line 4, brightlead.io: the site is already in the list/)).toBeInTheDocument();
  });

  it('adds every line and shows the new competitors', async () => {
    const { user } = renderWithProviders(as('editor', <EntitiesScreen {...SCOPE} />));
    const dialog = await openPasteMode(user);
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Competitors' }),
      'brightlead.io\nNorthbeam, northbeam.com',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 competitors' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    const competitors = await table('Competitors');
    expect(await within(competitors).findByRole('link', { name: 'Brightlead' })).toBeInTheDocument();
    expect(within(competitors).getByRole('link', { name: 'Northbeam' })).toBeInTheDocument();
  });

  it('says how many are tracked in SEO when the list is longer than the places left', async () => {
    const { user } = renderWithProviders(as('editor', <EntitiesScreen {...SCOPE} />));
    const dialog = await openPasteMode(user);
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Competitors' }),
      Array.from({ length: 7 }, (_, index) => `rival${String(index)}.com`).join('\n'),
    );
    expect(within(dialog).getByText(/has 5 places left/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add 7 competitors' })).toBeEnabled();
  });

  it('goes back to adding one competitor', async () => {
    const { user } = renderWithProviders(as('editor', <EntitiesScreen {...SCOPE} />));
    const dialog = await openPasteMode(user);
    await user.click(within(dialog).getByRole('button', { name: 'Add one' }));
    expect(await screen.findByRole('dialog', { name: 'Add competitor' })).toBeInTheDocument();
  });

  it('keeps going when a line fails, then offers the failed lines again', async () => {
    server.use(
      http.post(mswPath('/api/v1/workspaces/{workspace_id}/entities'), async ({ request }) => {
        const body = (await request.clone().json()) as { canonical_name: string };
        return body.canonical_name === 'Northbeam' ? problem(request, 'internal_error') : undefined;
      }),
    );
    const { user } = renderWithProviders(as('editor', <EntitiesScreen {...SCOPE} />));
    const dialog = await openPasteMode(user);
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Competitors' }),
      'brightlead.io\nNorthbeam, northbeam.com',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 competitors' }));
    const result = await screen.findByRole('dialog', { name: 'Some competitors were not added' });
    expect(within(result).getByText('1 was added and 1 was not.')).toBeInTheDocument();
    const failed = within(result).getByRole('list', { name: 'Competitors that were not added' });
    expect(within(failed).getByText(/northbeam.com/)).toBeInTheDocument();
    await user.click(within(result).getByRole('button', { name: 'Paste these again' }));
    const again = await screen.findByRole('dialog', { name: 'Add competitors' });
    expect(within(again).getByRole('textbox', { name: 'Competitors' })).toHaveValue('Northbeam, northbeam.com');
  });
});
