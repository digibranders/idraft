import { screen } from '@testing-library/react';
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

describe('ProjectSwitcher footer', () => {
  it('ends with the time zone, the link to all projects and no group of workspace pages: Costs and Runs are in the sidebar', async () => {
    const { user } = switcher();
    await user.click(screen.getByRole('combobox', { name: 'Project: Fynix' }));
    expect(await screen.findByText('Times in Europe/Berlin')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All projects in Digibranders' })).toHaveAttribute('href', '/digibranders');
    expect(screen.queryByRole('group', { name: 'Workspace' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Costs' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Runs' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Create project' })).toBeNull();
  });

  it('offers Create project after the link to all projects, for a member who may create one', async () => {
    const { user } = switcher({
      createProject: { href: '/digibranders/onboarding' as Route, label: 'Create project' },
    });
    await user.click(screen.getByRole('combobox', { name: 'Project: Fynix' }));
    const all = await screen.findByRole('link', { name: 'All projects in Digibranders' });
    const create = screen.getByRole('link', { name: 'Create project' });
    expect(create).toHaveAttribute('href', '/digibranders/onboarding');
    expect(all.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
