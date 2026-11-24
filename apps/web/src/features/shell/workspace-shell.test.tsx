import { screen, within } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceShell } from './workspace-shell';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const navigation = vi.hoisted(() => ({ pathname: '/digibranders' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ workspace: 'digibranders' }),
}));
vi.mock('@/lib/navigation/hard-navigate', () => ({ hardNavigate: vi.fn() }));

const WORKSPACE = { slug: 'digibranders', name: 'Digibranders' };

const shell = (page?: string, role: Role = 'editor'): ReactElement => (
  <PermissionProvider membership={membershipFactory(role)}>
    <Suspense fallback={null}>
      <WorkspaceShell workspace={WORKSPACE} page={page}>
        <h1>Projects</h1>
      </WorkspaceShell>
    </Suspense>
  </PermissionProvider>
);

const sidebar = (): HTMLElement => screen.getAllByRole('navigation', { name: 'Primary' })[0] as HTMLElement;

describe('WorkspaceShell', () => {
  beforeEach(() => {
    navigation.pathname = '/digibranders';
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.0; Path=/; Secure`;
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('has the sidebar, the workspace as the breadcrumb, and the page in main', async () => {
    const { container } = renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Projects' });
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
    const crumbs = within(screen.getByRole('banner')).getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Digibranders')).toHaveAttribute('aria-current', 'page');
    expect(within(crumbs).queryByRole('link')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('lists the workspace destinations and marks the page that is open', async () => {
    renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Projects' });
    const links = within(sidebar());
    expect(links.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
    expect(links.getByRole('link', { name: 'New project' })).toHaveAttribute('href', '/digibranders/onboarding');
    expect(links.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/digibranders/settings/profile');
  });

  it('marks New project on its own page, and leaves it out for a member who cannot create one', async () => {
    navigation.pathname = '/digibranders/onboarding';
    const { unmount } = renderWithProviders(shell('New project'));
    await screen.findByRole('heading', { name: 'Projects' });
    expect(within(sidebar()).getByRole('link', { name: 'New project' })).toHaveAttribute('aria-current', 'page');
    expect(within(sidebar()).getByRole('link', { name: 'Projects' })).not.toHaveAttribute('aria-current');
    unmount();
    renderWithProviders(shell(undefined, 'viewer'));
    await screen.findByRole('heading', { name: 'Projects' });
    expect(within(sidebar()).queryByRole('link', { name: 'New project' })).toBeNull();
  });

  it('below the root, links the workspace and marks the page as current', async () => {
    navigation.pathname = '/digibranders/settings/profile';
    const { container } = renderWithProviders(shell('Settings'));
    await screen.findByRole('heading', { name: 'Projects' });
    const crumbs = within(screen.getByRole('banner')).getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Digibranders' })).toHaveAttribute('href', '/digibranders');
    expect(within(crumbs).getByText('Settings')).toHaveAttribute('aria-current', 'page');
    expect(within(sidebar()).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
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
