import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsNav, type SettingsNavGroup } from './settings-nav';
import { projectPath } from '@/lib/routes/paths';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const GROUPS: SettingsNavGroup[] = [
  {
    label: 'Your account',
    items: [
      { id: 'profile', label: 'Profile', href: projectPath('digibranders', 'fynix', '/settings/profile') },
      { id: 'security', label: 'Security', href: projectPath('digibranders', 'fynix', '/settings/security') },
    ],
  },
];

describe('SettingsNav', () => {
  it('lists the sections under their group and marks the one on screen', async () => {
    const { container } = renderWithProviders(
      <SettingsNav
        label="Settings sections"
        selectLabel="Section"
        groups={GROUPS}
        current="security"
        onSelect={vi.fn()}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByText('Your account')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Security' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Profile' })).not.toHaveAttribute('aria-current');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('is a select below 1024 px that opens the chosen section', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithProviders(
      <SettingsNav
        label="Settings sections"
        selectLabel="Section"
        groups={GROUPS}
        current="profile"
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Section' }));
    await user.click(await screen.findByRole('option', { name: 'Security' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'security' }));
  });
});
