import { screen, waitFor, within } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectShell, type ShellProject } from './project-shell';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const navigation = vi.hoisted(() => ({
  pathname: '/digibranders/fynix/settings/profile',
  push: vi.fn(),
  hardNavigate: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
  useParams: () => ({ workspace: 'digibranders', project: 'fynix' }),
}));
vi.mock('@/lib/navigation/hard-navigate', () => ({ hardNavigate: navigation.hardNavigate }));

const FYNIX: ShellProject = { id: 'p1', slug: 'fynix', name: 'Fynix', timeZone: 'Europe/Berlin' };
const CLEANSTART: ShellProject = { id: 'p2', slug: 'cleanstart', name: 'Cleanstart', timeZone: 'America/New_York' };

/** A browser this wide, as the breakpoints of globals.css read it. */
function viewport(width: number): void {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /width >= (\d+)rem/.exec(query);
    const max = /width < (\d+)rem/.exec(query);
    const matches =
      (min === null || width >= Number(min[1]) * 16) &&
      (max === null || width < Number(max[1]) * 16) &&
      !query.includes('reduce');
    return { matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  });
}

function shell(role: Role = 'editor'): ReactElement {
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <ProjectShell
          workspace={{ slug: 'digibranders', name: 'Digibranders' }}
          project={FYNIX}
          projects={[FYNIX, CLEANSTART]}
          sidebarPreference="expanded"
        >
          <h1>Profile</h1>
        </ProjectShell>
      </Suspense>
    </PermissionProvider>
  );
}

describe('ProjectShell', () => {
  beforeEach(() => {
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.0; Path=/; Secure`;
    navigation.push.mockReset();
    navigation.hardNavigate.mockReset();
    viewport(1680);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-sidebar');
  });

  it('has the landmarks of 11 section 7: Primary navigation, the Breadcrumb in the header, and main', async () => {
    renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Profile' });
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { name: 'Profile' }));
  });

  it('starts with the skip link, which leads to the main content', async () => {
    const { user } = renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Profile' });
    await user.tab();
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute('href', `#${screen.getByRole('main').id}`);
  });

  it('marks the destination of the page, and names it in the breadcrumb', async () => {
    renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Profile' });
    const settings = within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', {
      name: 'Settings',
    });
    expect(settings).toHaveAttribute('aria-current', 'page');
    expect(settings).toHaveAttribute('href', '/digibranders/fynix/settings');
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Settings')).toHaveAttribute('aria-current', 'page');
    expect(within(crumbs).getByRole('link', { name: 'Project overview' })).toHaveAttribute(
      'href',
      '/digibranders/fynix',
    );
  });

  it('collapses to the rail with the toggle and with [, keeping the choice in a cookie', async () => {
    const { user } = renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Profile' });
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(document.documentElement.dataset.sidebar).toBe('collapsed');
    expect(document.cookie).toContain('sightline-sidebar=collapsed');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('main'));
    // `[[` types one `[` (user-event reads a single one as the start of a key name)
    await user.keyboard('[[');
    expect(document.documentElement.dataset.sidebar).toBe('expanded');
  });

  it('shows the full label of a destination in a tooltip when the sidebar is the rail', async () => {
    const { user } = renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Profile' });
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    await user.hover(
      within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Settings' }),
    );
    // The rail's tooltip repeats the link's own name, so it is not a description (purpose "label")
    await waitFor(() => expect(document.querySelector('[data-slot="tooltip"]')).toHaveTextContent('Settings'));
  });

  it('switches project on the same destination', async () => {
    const { user } = renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Profile' });
    const [sidebarSwitcher] = screen.getAllByRole('combobox', { name: 'Project: Fynix' });
    if (!sidebarSwitcher) throw new Error('no project switcher');
    await user.click(sidebarSwitcher);
    await user.click(await screen.findByRole('option', { name: 'Cleanstart' }));
    expect(navigation.push).toHaveBeenCalledWith('/digibranders/cleanstart/settings');
  });

  it('signs out from the account menu', async () => {
    const { user } = renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Profile' });
    await user.click(screen.getByRole('button', { name: `Account menu, ${mockUser('editor').name}` }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText(mockUser('editor').email)).toBeInTheDocument();
    // From 1440 px the theme switch is in the top bar, so the menu has no theme group
    expect(within(menu).queryByRole('menuitemradio')).toBeNull();
    await user.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith('/login'));
  });

  it('offers the theme in the account menu below 1440 px, where the top bar has no switch', async () => {
    viewport(1280);
    const { user } = renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Profile' });
    await user.click(screen.getByRole('button', { name: `Account menu, ${mockUser('editor').name}` }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(['System', 'Light', 'Dark']);
  });

  it('lists only what the role can open: a billing member sees Settings, as everyone does', async () => {
    renderWithProviders(shell('billing'));
    await screen.findByRole('heading', { name: 'Profile' });
    const links = within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Settings']);
  });

  it('opens the keyboard shortcuts from Help', async () => {
    const { user } = renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Profile' });
    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Keyboard shortcuts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getByText('Collapse or expand the sidebar')).toBeInTheDocument();
  });

  it.each(['light', 'dark'])('has no accessibility violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Profile' });
    expect(await axe(container)).toHaveNoViolations();
    document.documentElement.classList.remove('dark');
  });

  it('names no destination on the 404 page of a planned one', async () => {
    navigation.pathname = '/digibranders/fynix/seo/rankings';
    renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Profile' });
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).queryByText('Rankings')).toBeNull();
    navigation.pathname = '/digibranders/fynix/settings/profile';
  });

  it('opens the keyboard shortcuts with ?', async () => {
    const { user } = renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Profile' });
    await user.click(screen.getByRole('main'));
    await user.keyboard('?');
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('opens the navigation drawer below 1024 px, and closes it when a destination is followed', async () => {
    viewport(390);
    const { user } = renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Profile' });
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    await user.click(within(drawer).getByRole('link', { name: 'Settings' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull());
  });

  it('shows the theme switch named Dark theme, off in the light theme', async () => {
    renderWithProviders(shell());
    await screen.findByRole('heading', { name: 'Profile' });
    const toggle = screen.getByRole('switch', { name: 'Dark theme', hidden: true });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });
});
