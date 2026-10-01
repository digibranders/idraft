import { screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceShell } from './workspace-shell';
import { mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

vi.mock('@/lib/navigation/hard-navigate', () => ({ hardNavigate: vi.fn() }));

const WORKSPACE = { slug: 'digibranders', name: 'Digibranders' };

const shell = (page?: string): ReactElement => (
  <WorkspaceShell workspace={WORKSPACE} page={page}>
    <h1>Projects</h1>
  </WorkspaceShell>
);

describe('WorkspaceShell', () => {
  beforeEach(() => {
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.0; Path=/; Secure`;
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('has the top bar without the sidebar, the workspace as the breadcrumb, and the page in main', async () => {
    const { container } = renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Projects' });
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull();
    const crumbs = within(screen.getByRole('banner')).getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Digibranders')).toHaveAttribute('aria-current', 'page');
    expect(within(crumbs).queryByRole('link')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('below the root, links the workspace and marks the page as current', async () => {
    const { container } = renderWithProviders(shell('Settings'));
    await screen.findByRole('heading', { name: 'Projects' });
    const crumbs = within(screen.getByRole('banner')).getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Digibranders' })).toHaveAttribute('href', '/digibranders');
    expect(within(crumbs).getByText('Settings')).toHaveAttribute('aria-current', 'page');
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has Account settings in the account menu, on the workspace's own settings route", async () => {
    const { user } = renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Projects' });
    await user.click(screen.getByRole('button', { name: `Account menu, ${mockUser('viewer').name}` }));
    const item = await within(await screen.findByRole('menu')).findByRole('menuitem', { name: 'Account settings' });
    expect(item).toHaveAttribute('href', '/digibranders/settings/profile');
  });
});
