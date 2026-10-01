import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsFrame } from './settings-frame';
import { LeaveGuardProvider } from '@/lib/navigation/use-leave-guard';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/digibranders/fynix/settings/members',
}));

describe('SettingsFrame', () => {
  it('lists the groups in the order of the navigation spec, and marks the section on screen', () => {
    renderWithProviders(
      <LeaveGuardProvider>
        <SettingsFrame workspace="digibranders" project="fynix">
          <p>Section</p>
        </SettingsFrame>
      </LeaveGuardProvider>,
    );
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(
      within(nav)
        .getAllByText(/settings$|^Your account$/)
        .map((label) => label.textContent),
    ).toEqual(['Your account', 'Project settings', 'Workspace settings']);
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/digibranders/fynix/settings/profile',
      '/digibranders/fynix/settings/security',
      '/digibranders/fynix/settings/preferences',
      '/digibranders/fynix/settings/general',
      '/digibranders/fynix/settings/entities',
      '/digibranders/fynix/settings/domains',
      '/digibranders/fynix/settings/taxonomy',
      '/digibranders/fynix/settings/workspace',
      '/digibranders/fynix/settings/members',
    ]);
    expect(within(nav).getByRole('link', { name: 'Members and roles' })).toHaveAttribute('aria-current', 'page');
  });

  it('outside a project leaves the project group out and links to the workspace settings routes', () => {
    renderWithProviders(
      <LeaveGuardProvider>
        <SettingsFrame workspace="digibranders">
          <p>Section</p>
        </SettingsFrame>
      </LeaveGuardProvider>,
    );
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).queryByText('Project settings')).toBeNull();
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/digibranders/settings/profile',
      '/digibranders/settings/security',
      '/digibranders/settings/preferences',
      '/digibranders/settings/workspace',
      '/digibranders/settings/members',
    ]);
  });
});
