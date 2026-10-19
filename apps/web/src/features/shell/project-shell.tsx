'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useRef, useState, type ReactNode } from 'react';

import { TopBarControls } from './top-bar-controls';
import { useSidebar } from './use-sidebar';
import { Breadcrumb } from '@/components/app/shell/breadcrumb';
import { ProjectSwitcher, type SwitcherProject } from '@/components/app/shell/project-switcher';
import { SidebarNav, type SidebarSectionProps } from '@/components/app/shell/sidebar';
import { SkipLink } from '@/components/app/shell/skip-link';
import { TopBar } from '@/components/app/shell/top-bar';
import { Drawer } from '@/components/ui/drawer';
import { MEDIA, useMediaQuery } from '@/lib/dom/use-media-query';
import {
  destinationOf,
  LIVE_NAVIGATION,
  NAVIGATION,
  navHref,
  switchHref,
  visibleNavigation,
} from '@/lib/navigation/registry';
import type { SidebarPreference } from '@/lib/navigation/sidebar-state';
import { canCreateProjects, useMembership } from '@/lib/permissions';
import { onboardingPath, projectPath, workspacePath } from '@/lib/routes/paths';
import { useGuardedPush } from '@/lib/navigation/use-leave-guard';

export interface ShellProject extends SwitcherProject {
  slug: string;
}

export interface ProjectShellProps {
  workspace: { slug: string; name: string };
  project: ShellProject;
  /** The projects the member can open, for the switcher. */
  projects: readonly ShellProject[];
  sidebarPreference: SidebarPreference;
  children: ReactNode;
}

const MAIN_ID = 'main-content';
const SIDEBAR_ID = 'primary-navigation';
const SIDEBAR_SHORTCUT = 'sidebar';

/**
 * Every page of a project inside the application shell (11-navigation.md, 24-page-templates.md section
 * 9.1): the skip link, the primary navigation (expanded, rail or drawer), the top bar and the page. It
 * reads the membership and `/me` the workspace layout provided, so it asks the API for nothing.
 */
export function ProjectShell({
  workspace,
  project,
  projects,
  sidebarPreference,
  children,
}: ProjectShellProps): ReactNode {
  const t = useTranslations('shell');
  const nav = useTranslations('navigation');
  const pathname = usePathname();
  const push = useGuardedPush();
  const membership = useMembership();
  const { permissions } = membership;
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

  // Only a live destination is a page: a planned one's path is the 404 page, which names no destination
  const current = destinationOf(LIVE_NAVIGATION, pathname, workspace.slug, project.slug);
  const pageLabel = current === null ? null : nav(`items.${current.key}`);
  const sections = useMemo<SidebarSectionProps[]>(
    () =>
      visibleNavigation(NAVIGATION, permissions).map((section) => ({
        id: section.id,
        groups: section.groups.map(({ group, items }) => ({
          label: group === null ? null : nav(`groups.${group}`),
          items: items.map((item) => {
            const label = nav(`items.${item.key}`);
            return {
              id: item.key,
              href: navHref(item, workspace.slug, project.slug),
              label,
              fullLabel: group === null ? label : nav('inGroup', { group: nav(`groups.${group}`), item: label }),
              icon: item.icon,
              current: item.key === current?.key,
            };
          }),
        })),
      })),
    [permissions, nav, workspace.slug, project.slug, current?.key],
  );

  // Another project opens on the same destination, or on its root when this page has none. The query is read
  // from the address when the choice is made, not subscribed to: the shell would render on every filter change
  const switchTo = (next: SwitcherProject): void => {
    const target = projects.find((candidate) => candidate.id === next.id);
    if (!target) return;
    push(
      current === null
        ? projectPath(workspace.slug, target.slug)
        : switchHref(current, workspace.slug, target.slug, window.location.search),
    );
  };
  const allProjects = {
    href: workspacePath(workspace.slug),
    label: t('projectSwitcher.allProjects', { workspace: workspace.name }),
  };
  // A member limited to some projects cannot create one (19 section 3.3)
  const createProject = canCreateProjects(membership)
    ? { href: onboardingPath(workspace.slug), label: t('projectSwitcher.create') }
    : undefined;

  const sidebar = (mode: 'page' | 'drawer'): ReactNode => (
    <SidebarNav
      mode={mode}
      rail={mode === 'page' && rail}
      sections={sections}
      projectSwitcher={
        <ProjectSwitcher
          current={project}
          projects={projects}
          onSelect={switchTo}
          presentation="sidebar"
          rail={mode === 'page' && rail}
          allProjects={allProjects}
          createProject={createProject}
        />
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
        {/* Expanded at 1280 px and up, the 56 px rail at 1024 to 1279 px (expanded over the page on request),
            and the drawer below 1024 px. Fixed, so the rail's overlay never moves the page. */}
        <nav
          ref={sidebarRef}
          id={SIDEBAR_ID}
          aria-label={t('primary')}
          className="hidden w-sidebar flex-col border-r border-border-subtle bg-sidebar lg:fixed lg:inset-y-0 lg:left-0 lg:z-(--z-sidebar) lg:flex rail:w-14 peek:shadow-dialog"
        >
          {sidebar('page')}
        </nav>
        {/* Holds the sidebar's width in the layout: 208 px expanded, 56 px for the rail */}
        <div aria-hidden="true" className="hidden w-sidebar shrink-0 lg:block narrow:w-14" />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            navigation={{ label: t('openNavigation'), open: drawerOpen, onOpen: () => setDrawerOpen(true) }}
            breadcrumb={
              <Breadcrumb
                label={t('breadcrumb')}
                projectRoot={{ href: projectPath(workspace.slug, project.slug), label: t('projectOverview') }}
                workspace={{ href: workspacePath(workspace.slug), label: workspace.name }}
                project={
                  <ProjectSwitcher
                    current={project}
                    projects={projects}
                    onSelect={switchTo}
                    presentation="topbar"
                    allProjects={allProjects}
                    createProject={createProject}
                  />
                }
                page={pageLabel}
              />
            }
            controls={
              <TopBarControls
                accountSettings={<Link href={projectPath(workspace.slug, project.slug, '/settings/profile')} />}
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
