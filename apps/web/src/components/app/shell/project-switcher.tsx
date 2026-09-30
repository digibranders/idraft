'use client';

import { ChevronDown } from 'lucide-react';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactElement } from 'react';

import { ProjectMonogram } from './project-monogram';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import { TextLink } from '@/components/ui/text-link';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface SwitcherProject {
  id: string;
  name: string;
  timeZone: string;
}

export interface ProjectSwitcherProps {
  current: SwitcherProject;
  /** The projects the member can open, the current one among them. */
  projects: readonly SwitcherProject[];
  /** Keeps the destination; the feature decides where that is in the other project. */
  onSelect: (project: SwitcherProject) => void;
  /** `sidebar`: monogram, name and chevron (the monogram alone in the rail). `topbar`: the name as a breadcrumb item. */
  presentation: 'sidebar' | 'topbar';
  /** Whether the rail is showing, for the sidebar's tooltip. */
  rail?: boolean | undefined;
  /**
   * The workspace's project list, at the foot of the list. Below 1680 px the breadcrumb has no workspace
   * item, so this is the way there at every width.
   */
  allProjects: { href: Route; label: string };
}

/**
 * Switches project (11-navigation.md section 8, 25 section 5.6): a button with the current project that
 * opens a searchable list, with the project's timezone below it. Creating a project belongs to onboarding,
 * so the list has no "Create project" yet.
 */
export function ProjectSwitcher({
  current,
  projects,
  onSelect,
  presentation,
  rail = false,
  allProjects,
}: ProjectSwitcherProps): ReactElement {
  const t = useTranslations('shell.projectSwitcher');
  const trigger =
    presentation === 'sidebar' ? (
      <button
        type="button"
        className="flex h-control w-full min-w-0 items-center gap-2 rounded-md px-2 hover:bg-surface-hover focus-visible:focus-ring rail:justify-center"
      >
        <ProjectMonogram name={current.name} />
        <span className="truncate type-subsection-title rail:hidden">{current.name}</span>
        <Icon icon={ChevronDown} size="sm" className="ml-auto shrink-0 text-foreground-tertiary rail:hidden" />
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
      emptyText={(query) => t('empty', { query })}
      placeholder={t('search')}
      clearLabel={t('clear')}
      openLabel={t('open')}
      trigger={trigger}
      triggerLabel={t('label', { project: current.name })}
      footer={
        <div className="flex flex-col gap-1 px-2 py-1.5">
          <p className="type-meta">{t('timeZone', { timeZone: current.timeZone })}</p>
          <TextLink render={<Link href={allProjects.href} />} className="type-body">
            {allProjects.label}
          </TextLink>
        </div>
      }
    />
  );
  // The rail shows the monogram alone, so the tooltip names the project
  return presentation === 'sidebar' ? (
    <Tooltip content={current.name} side="right" purpose="label" disabled={!rail}>
      <span className="block">{combobox}</span>
    </Tooltip>
  ) : (
    combobox
  );
}
