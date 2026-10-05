import { screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it, vi } from 'vitest';

import { ProjectSwitcher, type ProjectSwitcherProps } from './project-switcher';
import { renderWithProviders } from '@/test/render';

const FYNIX = { id: 'p1', name: 'Fynix', timeZone: 'Europe/Berlin' };
const CLEANSTART = { id: 'p2', name: 'Cleanstart', timeZone: 'America/New_York' };

function switcher(extra: Partial<ProjectSwitcherProps> = {}): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <ProjectSwitcher
      current={FYNIX}
      projects={[FYNIX, CLEANSTART]}
      onSelect={vi.fn()}
      presentation="sidebar"
      allProjects={{ href: '/digibranders' as Route, label: 'All projects in Digibranders' }}
      {...extra}
    />,
  );
}

describe('ProjectSwitcher workspace links', () => {
  it('lists a Workspace group of links after the projects, before the links to all projects', async () => {
    const { user } = switcher({
      workspaceLabel: 'Workspace',
      workspaceLinks: [
        { href: '/digibranders/costs' as Route, label: 'Costs' },
        { href: '/digibranders/ops/runs' as Route, label: 'Runs' },
      ],
    });
    await user.click(screen.getByRole('combobox', { name: 'Project: Fynix' }));
    const group = await screen.findByRole('group', { name: 'Workspace' });
    expect(within(group).getByRole('link', { name: 'Costs' })).toHaveAttribute('href', '/digibranders/costs');
    expect(within(group).getByRole('link', { name: 'Runs' })).toHaveAttribute('href', '/digibranders/ops/runs');
    const all = screen.getByRole('link', { name: 'All projects in Digibranders' });
    expect(group.compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no such group without links, or when none is given', async () => {
    const first = switcher();
    await first.user.click(screen.getByRole('combobox', { name: 'Project: Fynix' }));
    await screen.findByRole('link', { name: 'All projects in Digibranders' });
    expect(screen.queryByRole('group', { name: 'Workspace' })).toBeNull();
    first.unmount();

    const second = switcher({ workspaceLabel: 'Workspace', workspaceLinks: [] });
    await second.user.click(screen.getByRole('combobox', { name: 'Project: Fynix' }));
    await screen.findByRole('link', { name: 'All projects in Digibranders' });
    expect(screen.queryByRole('group', { name: 'Workspace' })).toBeNull();
  });
});
