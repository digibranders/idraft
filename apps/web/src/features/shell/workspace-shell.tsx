'use client';

import { ChevronRight, LayoutGrid, Plus, Settings } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useRef, useState, type ReactNode } from 'react';

import { TopBarControls } from './top-bar-controls';
import { useSidebar } from './use-sidebar';
import { ProjectMark } from '@/components/app/shell/project-mark';
import { SidebarNav, type SidebarSectionProps } from '@/components/app/shell/sidebar';
import { SkipLink } from '@/components/app/shell/skip-link';
import { TopBar } from '@/components/app/shell/top-bar';
import { Drawer } from '@/components/ui/drawer';
import { Icon } from '@/components/ui/icon';
import { MEDIA, useMediaQuery } from '@/lib/dom/use-media-query';
import type { SidebarPreference } from '@/lib/navigation/sidebar-state';
import { canCreateProjects, useMembership } from '@/lib/permissions';
import { onboardingPath, workspacePath, workspaceSettingsPath } from '@/lib/routes/paths';

const MAIN_ID = 'main-content';
const SIDEBAR_ID = 'primary-navigation';
const SIDEBAR_SHORTCUT = 'sidebar';

export interface WorkspaceShellProps {
  workspace: { slug: string; name: string };
  /**
   * The page below the workspace root (Settings), as the breadcrumb's current item; the workspace is then a
   * link to its root. Omitted on the root itself, where the workspace is the current item.
   */
  page?: string | undefined;
  sidebarPreference?: SidebarPreference | undefined;
  children: ReactNode;
}

/**
 * The pages of a workspace outside any project (the root, New project, the workspace's own settings): the
 * same shell as a project's, with the workspace's own destinations in the sidebar (Projects, New project,
 * Settings) in place of a project's. The account menu's Account settings opens the workspace's Settings >
 * Profile, which every member can reach whatever projects they can open.
 */
export function WorkspaceShell({
  workspace,
  page,
  sidebarPreference = 'expanded',
  children,
}: Readonly<WorkspaceShellProps>): ReactNode {
  const t = useTranslations('shell');
  const nav = useTranslations('navigation');
  const projects = useTranslations('projects');
  const pathname = usePathname();
  const membership = useMembership();
  const sidebarRef = useRef<HTMLElement | null>(null);
  const { rail, toggle, closePeek } = useSidebar(sidebarPreference, sidebarRef);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // From 1024 px the sidebar is on the page: a drawer left open (a tablet turned) closes
  const onPage = useMediaQuery(MEDIA.lg);
  const [wasOnPage, setWasOnPage] = useState(onPage);
  if (wasOnPage !== onPage) {
    setWasOnPage(onPage);
    if (onPage) setDrawerOpen(false);
  }

  const root = workspacePath(workspace.slug);
  const create = canCreateProjects(membership) ? onboardingPath(workspace.slug) : null;
  const settings = workspaceSettingsPath(workspace.slug, 'profile');
  const sections = useMemo<SidebarSectionProps[]>(() => {
    const here = (path: string): boolean => pathname === path || pathname.startsWith(`${path}/`);
    const item = (
      id: string,
      href: typeof root,
      label: string,
      icon: typeof LayoutGrid,
      current: boolean,
    ): SidebarSectionProps['groups'][number]['items'][number] => ({
      id,
      href,
      label,
      fullLabel: label,
      icon,
      current,
    });
    return [
      {
        id: 1,
        groups: [
          {
            label: null,
            items: [
              // Every page under the root that is not New project or Settings is the root's own (the list)
              item('projects', root, projects('title'), LayoutGrid, pathname === root),
              ...(create === null ? [] : [item('new', create, projects('new'), Plus, here(create))]),
            ],
          },
          {
            label: null,
            items: [item('settings', settings, nav('items.settings'), Settings, here(`${root}/settings`))],
          },
        ],
      },
    ];
  }, [pathname, root, create, settings, projects, nav]);

  const sidebar = (mode: 'page' | 'drawer'): ReactNode => (
    <SidebarNav
      mode={mode}
      rail={mode === 'page' && rail}
      sections={sections}
      projectSwitcher={
        <Link
          href={root}
          title={workspace.name}
          className="flex h-10 min-w-0 items-center gap-2 rounded-md px-1 hover:bg-surface-hover focus-visible:focus-ring rail:justify-center"
        >
          <ProjectMark name={workspace.name} size="md" />
          <span className="min-w-0 flex-1 truncate type-body-strong text-foreground rail:sr-only">
            {workspace.name}
          </span>
        </Link>
      }
      toggle={
        mode === 'page'
          ? {
              label: rail ? t('expandSidebar') : t('collapseSidebar'),
              visibleLabel: rail ? t('expand') : t('collapse'),
              onToggle: toggle,
              controls: SIDEBAR_ID,
            }
          : null
      }
      close={mode === 'drawer' ? { label: t('closeNavigation'), onClose: () => setDrawerOpen(false) } : null}
      onNavigate={mode === 'drawer' ? () => setDrawerOpen(false) : closePeek}
    />
  );

  return (
    <>
      <SkipLink label={t('skipToMain')} targetId={MAIN_ID} />
      <div className="flex min-h-dvh">
        {/* The project shell's sidebar, with the workspace's destinations: expanded, the rail, or the drawer */}
        <nav
          ref={sidebarRef}
          id={SIDEBAR_ID}
          aria-label={t('primary')}
          className="hidden w-sidebar flex-col border-r border-border-subtle bg-sidebar lg:fixed lg:inset-y-0 lg:left-0 lg:z-(--z-sidebar) lg:flex rail:w-14 peek:shadow-dialog"
        >
          {sidebar('page')}
        </nav>
        <div aria-hidden="true" className="hidden w-sidebar shrink-0 lg:block narrow:w-14" />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            navigation={{ label: t('openNavigation'), open: drawerOpen, onOpen: () => setDrawerOpen(true) }}
            breadcrumb={
              <nav aria-label={t('breadcrumb')} className="min-w-0">
                <ol className="flex min-w-0 items-center gap-2 type-body">
                  <li className="min-w-0">
                    {page === undefined ? (
                      <span aria-current="page" className="block truncate type-body-strong text-foreground">
                        {workspace.name}
                      </span>
                    ) : (
                      <Link
                        href={root}
                        className="block truncate rounded-sm text-foreground-tertiary hover:text-foreground focus-visible:focus-ring"
                      >
                        {workspace.name}
                      </Link>
                    )}
                  </li>
                  {page === undefined ? null : (
                    <li className="flex shrink-0 items-center gap-2">
                      <Icon icon={ChevronRight} size="sm" className="shrink-0 text-foreground-muted" />
                      <span aria-current="page" className="type-body-strong whitespace-nowrap text-foreground">
                        {page}
                      </span>
                    </li>
                  )}
                </ol>
              </nav>
            }
            controls={
              <TopBarControls
                accountSettings={<Link href={settings} />}
                shortcuts={[{ id: SIDEBAR_SHORTCUT, label: t('shortcuts.toggleSidebar'), keys: ['['] }]}
              />
            }
          />
          <main id={MAIN_ID} tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
            {children}
          </main>
        </div>
      </div>
      <Drawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={t('navigation')}
        className="border-border-subtle bg-sidebar"
      >
        <nav aria-label={t('primary')} className="flex min-h-full flex-col">
          {sidebar('drawer')}
        </nav>
      </Drawer>
    </>
  );
}
