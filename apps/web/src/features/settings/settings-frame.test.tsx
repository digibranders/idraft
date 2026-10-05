import { screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsFrame } from './settings-frame';
import type { Role } from '@/lib/api/types';
import { LeaveGuardProvider } from '@/lib/navigation/use-leave-guard';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { renderWithProviders } from '@/test/render';

const location = vi.hoisted(() => ({ pathname: '/digibranders/fynix/settings/members' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => location.pathname,
}));

/** The frame as a member of `role` sees it, inside a project or outside any. */
function frame(project: string | null, role: Role = 'admin'): ReactElement {
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <LeaveGuardProvider>
        <SettingsFrame workspace="digibranders" project={project}>
          <p>Section</p>
        </SettingsFrame>
      </LeaveGuardProvider>
    </PermissionProvider>
  );
}

const hrefsOf = (nav: HTMLElement): (string | null)[] =>
  within(nav)
    .getAllByRole('link')
    .map((link) => link.getAttribute('href'));

describe('SettingsFrame', () => {
  beforeEach(() => {
    location.pathname = '/digibranders/fynix/settings/members';
  });

  it('lists the groups in the order of the navigation spec, and marks the section on screen', () => {
    renderWithProviders(frame('fynix'));
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(
      within(nav)
        .getAllByText(/settings$|^Your account$/)
        .map((label) => label.textContent),
    ).toEqual(['Your account', 'Project settings', 'Workspace settings']);
    expect(hrefsOf(nav)).toEqual([
      '/digibranders/fynix/settings/profile',
      '/digibranders/fynix/settings/security',
      '/digibranders/fynix/settings/preferences',
      '/digibranders/fynix/settings/general',
      '/digibranders/fynix/settings/entities',
      '/digibranders/fynix/settings/domains',
      '/digibranders/fynix/settings/taxonomy',
      '/digibranders/fynix/settings/workspace',
      '/digibranders/fynix/settings/members',
      '/digibranders/costs',
      '/digibranders/ops/runs',
    ]);
    expect(within(nav).getByRole('link', { name: 'Members and roles' })).toHaveAttribute('aria-current', 'page');
    // Costs and Operations are pages of their own, never the section on screen
    expect(within(nav).getByRole('link', { name: 'Costs' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: 'Operations' })).not.toHaveAttribute('aria-current');
  });

  it('outside a project leaves the project group out and links to the workspace settings routes', () => {
    location.pathname = '/digibranders/settings/security';
    renderWithProviders(frame(null));
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).queryByText('Project settings')).toBeNull();
    expect(hrefsOf(nav)).toEqual([
      '/digibranders/settings/profile',
      '/digibranders/settings/security',
      '/digibranders/settings/preferences',
      '/digibranders/settings/workspace',
      '/digibranders/settings/members',
      '/digibranders/costs',
      '/digibranders/ops/runs',
    ]);
    expect(within(nav).getByRole('link', { name: 'Security' })).toHaveAttribute('aria-current', 'page');
  });

  it('lists Costs and Operations after Members and roles, Costs only for a member who may read costs', () => {
    // A viewer reads data but not costs; a billing member reads costs but not data
    for (const [role, expected] of [
      ['editor', ['Members and roles', 'Costs', 'Operations']],
      ['viewer', ['Members and roles', 'Operations']],
      ['billing', ['Members and roles', 'Costs']],
    ] as const) {
      const { unmount } = renderWithProviders(frame('fynix', role));
      const nav = screen.getByRole('navigation', { name: 'Settings sections' });
      const workspaceItems = within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent ?? '')
        .slice(-expected.length);
      expect(workspaceItems).toEqual(expected);
      unmount();
    }
  });
});
