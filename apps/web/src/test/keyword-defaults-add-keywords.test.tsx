import { screen, waitFor, within } from '@testing-library/react';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectGeneralScreen } from '@/features/project-settings/general-screen';
import { FreshSessionProvider } from '@/features/session';
import { LIVE_REGION_ID } from '@/lib/a11y/announcer';
import { LeaveGuardProvider } from '@/lib/navigation/use-leave-guard';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { projectFactory } from '@/mocks/factories/project';
import { fynix, loadedGrid, rankingsAs, restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

/**
 * Keyword defaults of Project settings and Add keywords of Rankings are two features that read one request,
 * the project's settings. Neither imports the other, so the pair is tried here, in one tree and one cache.
 */

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/settings/general',
}));

beforeEach(stubWideScreen);
afterEach(restoreWideScreen);

describe('Keyword defaults and Add keywords', () => {
  it('opens Add keywords on the device that was saved as the default', async () => {
    const rankings = rankingsAs('editor');
    const { user } = renderWithProviders(
      <PermissionProvider membership={membershipFactory('editor')}>
        <FreshSessionProvider>
          <LeaveGuardProvider>
            <Suspense fallback={null}>
              <ProjectGeneralScreen project={projectFactory(fynix)} workspaceSlug="digibranders" />
            </Suspense>
          </LeaveGuardProvider>
        </FreshSessionProvider>
        {rankings}
      </PermissionProvider>,
    );
    await loadedGrid();
    const section = (await screen.findByRole('heading', { name: 'Keyword defaults' })).closest('section');
    if (section === null) throw new Error('The keyword defaults have no section');

    // Before the change the project's default is the desktop
    await user.click(screen.getByRole('button', { name: 'Add keywords' }));
    let dialog = await screen.findByRole('dialog', { name: 'Add keywords' });
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'Desktop' })).toBeChecked());
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add keywords' })).toBeNull());

    await user.click(await within(section).findByRole('combobox', { name: 'Default device' }));
    await user.click(await screen.findByRole('option', { name: 'Desktop and mobile' }));
    await user.click(within(section).getByRole('button', { name: 'Save defaults' }));
    await waitFor(() =>
      expect(document.getElementById(LIVE_REGION_ID.polite)).toHaveTextContent('Keyword defaults saved'),
    );

    await user.click(screen.getByRole('button', { name: 'Add keywords' }));
    dialog = await screen.findByRole('dialog', { name: 'Add keywords' });
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'Desktop and mobile' })).toBeChecked());
  }, 20_000);
});
