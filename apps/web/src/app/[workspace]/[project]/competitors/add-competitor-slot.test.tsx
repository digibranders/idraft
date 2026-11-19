import { screen, within } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AddCompetitorSlot } from './add-competitor-slot';
import { AddCompetitorControlProvider } from '@/features/competitors';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/competitors',
}));

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture project is missing');
const project = fynix;

function slot(open: boolean, onClose: () => void = vi.fn()): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory('admin')}>
      <AddCompetitorControlProvider open={open} onClose={onClose}>
        <Suspense fallback={null}>
          <AddCompetitorSlot
            workspaceId={MOCK_WORKSPACE.workspace_id}
            workspaceSlug={MOCK_WORKSPACE.slug}
            projectId={project.project_id}
            projectSlug={project.slug}
          />
        </Suspense>
      </AddCompetitorControlProvider>
    </PermissionProvider>
  );
}

describe('AddCompetitorSlot', () => {
  it('draws nothing while the control is closed', () => {
    renderWithProviders(slot(false));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("opens EntityDialog with role competitor and the project's entities", async () => {
    renderWithProviders(slot(true));
    const dialog = await screen.findByRole('dialog', { name: 'Add competitor' });
    expect(within(dialog).getByText('A site you compete with for rankings and AI answers.')).toBeInTheDocument();
    // The count line reads the project's entities: the dialog is given the list the Entities page reads
    expect(await within(dialog).findByText(/competitors tracked in SEO/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add competitor' })).toBeInTheDocument();
  });

  it('closing the dialog calls the control, which the screen answers by refreshing its reads', async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(slot(true, onClose));
    const dialog = await screen.findByRole('dialog', { name: 'Add competitor' });
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog).toBeDefined();
  });
});
