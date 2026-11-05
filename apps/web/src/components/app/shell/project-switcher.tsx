'use client';

import { ChevronDown, ChevronsUpDown, Clock, LayoutGrid, Plus, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactElement } from 'react';

import { ProjectMark } from './project-mark';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface SwitcherProject {
  id: string;
  name: string;
  timeZone: string;
  /** The primary domain's host, whose icon is the project's mark; `null` or absent until the project has one. */
  domain?: string | null | undefined;
}

export interface ProjectSwitcherProps {
  current: SwitcherProject;
  /** The projects the member can open, the current one among them. */
  projects: readonly SwitcherProject[];
  /** Keeps the destination; the feature decides where that is in the other project. */
  onSelect: (project: SwitcherProject) => void;
  /** `sidebar`: mark, name and domain (the mark alone in the rail). `topbar`: the name as a breadcrumb item. */
  presentation: 'sidebar' | 'topbar';
  /** Whether the rail is showing, for the sidebar's tooltip. */
  rail?: boolean | undefined;
  /**
   * The workspace's project list, at the foot of the list. Below 1680 px the breadcrumb has no workspace
   * item, so this is the way there at every width.
   */
  allProjects: { href: Route; label: string };
  /** "Create project", for a member who may create one; absent otherwise (11-navigation.md section 8). */
  createProject?: { href: Route; label: string } | undefined;
}

const FOOTER_LINK =
  'flex h-8 items-center gap-2 rounded-md px-2 type-body text-foreground-secondary hover:bg-surface-elevated-hover hover:text-foreground focus-visible:focus-ring-inset';

function FooterLink({
  href,
  icon,
  children,
}: Readonly<{ href: Route; icon: LucideIcon; children: string }>): ReactElement {
  return (
    <Link href={href} className={FOOTER_LINK}>
      <Icon icon={icon} size="sm" className="text-foreground-tertiary" />
      <span className="truncate">{children}</span>
    </Link>
  );
}

/** A name over its domain, so two projects with one name tell apart; the name alone until there is a domain. */
function ProjectText({ project }: Readonly<{ project: SwitcherProject }>): ReactElement {
  return (
    <span className="flex min-w-0 flex-1 flex-col text-left">
      <span className="truncate type-subsection-title">{project.name}</span>
      {project.domain ? <span className="truncate type-meta">{project.domain}</span> : null}
    </span>
  );
}

/**
 * Switches project (11-navigation.md section 8, 25 section 5.6): a card with the current project's icon, name
 * and domain that opens a searchable list, where each project has its icon and domain too, then the project's
 * timezone, the workspace's project list and, for a member who may create one, "Create project".
 */
export function ProjectSwitcher({
  current,
  projects,
  onSelect,
  presentation,
  rail = false,
  allProjects,
  createProject,
}: ProjectSwitcherProps): ReactElement {
  const t = useTranslations('shell.projectSwitcher');
  const trigger =
    presentation === 'sidebar' ? (
      <button
        type="button"
        className="flex min-h-12 w-full min-w-0 items-center gap-3 rounded-lg border border-border-subtle bg-surface px-2 py-1.5 transition-colors hover:border-border hover:bg-surface-hover focus-visible:focus-ring rail:justify-center rail:border-transparent rail:bg-transparent rail:px-0 rail:hover:bg-surface-hover"
      >
        <ProjectMark name={current.name} domain={current.domain} size="md" />
        <span className="flex min-w-0 flex-1 rail:hidden">
          <ProjectText project={current} />
        </span>
        <Icon icon={ChevronsUpDown} size="sm" className="shrink-0 text-foreground-tertiary rail:hidden" />
      </button>
    ) : (
      <button
        type="button"
        className={cn(
          'flex max-w-48 min-w-0 items-center gap-2 rounded-sm type-body-strong text-foreground hover:text-foreground focus-visible:focus-ring lg:max-w-none lg:type-body lg:text-foreground-tertiary',
        )}
      >
        <span className="truncate">{current.name}</span>
        <Icon icon={ChevronDown} size="sm" className="shrink-0 text-foreground-tertiary lg:hidden" />
      </button>
    );
  const combobox = (
    <Combobox<SwitcherProject>
      value={current}
      onValueChange={(project) => {
        if (project !== null && project.id !== current.id) onSelect(project);
      }}
      items={projects}
      itemToString={(project) => project.name}
      itemKey={(project) => project.id}
      renderItem={(project) => (
        <span className="flex items-center gap-3">
          <ProjectMark name={project.name} domain={project.domain} size="sm" />
          <ProjectText project={project} />
        </span>
      )}
      emptyText={(query) => t('empty', { query })}
      placeholder={t('search')}
      clearLabel={t('clear')}
      openLabel={t('open')}
      trigger={trigger}
      triggerLabel={t('label', { project: current.name })}
      footer={
        <div className="flex flex-col gap-0.5">
          <p className="flex h-7 items-center gap-2 px-2 type-meta">
            <Icon icon={Clock} size="xs" />
            {t('timeZone', { timeZone: current.timeZone })}
          </p>
          <FooterLink href={allProjects.href} icon={LayoutGrid}>
            {allProjects.label}
          </FooterLink>
          {createProject === undefined ? null : (
            <FooterLink href={createProject.href} icon={Plus}>
              {createProject.label}
            </FooterLink>
          )}
        </div>
      }
    />
  );
  // The rail shows the mark alone, so the tooltip names the project
  return presentation === 'sidebar' ? (
    <Tooltip content={current.name} side="right" purpose="label" disabled={!rail}>
      <span className="block">{combobox}</span>
    </Tooltip>
  ) : (
    combobox
  );
}
