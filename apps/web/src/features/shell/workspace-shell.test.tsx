import { screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceShell } from './workspace-shell';
import { mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

vi.mock('@/lib/navigation/hard-navigate', () => ({ hardNavigate: vi.fn() }));

const PROFILE = '/digibranders/fynix/settings/profile' as Route;

const shell = (accountSettings: Promise<Route | null>): ReactElement => (
  <Suspense fallback={null}>
    <WorkspaceShell workspace="Digibranders" accountSettings={accountSettings}>
      <h1>Projects</h1>
    </WorkspaceShell>
  </Suspense>
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
    const { container } = renderWithProviders(shell(Promise.resolve(null)));
    await screen.findByRole('heading', { name: 'Projects' });
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull();
    const crumbs = within(screen.getByRole('banner')).getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Digibranders')).toHaveAttribute('aria-current', 'page');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has Account settings in the account menu once the first project is known', async () => {
    const { user } = renderWithProviders(shell(Promise.resolve(PROFILE)));
    await screen.findByRole('heading', { name: 'Projects' });
    await user.click(screen.getByRole('button', { name: `Account menu, ${mockUser('viewer').name}` }));
    const item = await within(await screen.findByRole('menu')).findByRole('menuitem', { name: 'Account settings' });
    expect(item).toHaveAttribute('href', PROFILE);
  });

  it('leaves Account settings out when the member can open no project, or the list failed', async () => {
    const failed = Promise.reject(new Error('The list failed'));
    // Handled here too, so the rejection is not reported before the shell mounts and handles it
    failed.catch(() => undefined);
    for (const outcome of [Promise.resolve(null), failed]) {
      const { user, unmount } = renderWithProviders(shell(outcome));
      await screen.findByRole('heading', { name: 'Projects' });
      await user.click(screen.getByRole('button', { name: `Account menu, ${mockUser('viewer').name}` }));
      const menu = await screen.findByRole('menu');
      expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
      expect(within(menu).queryByRole('menuitem', { name: 'Account settings' })).toBeNull();
      unmount();
    }
  });
});
