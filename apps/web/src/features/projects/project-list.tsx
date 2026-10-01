import { FolderOpen, Plus } from 'lucide-react';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';

import { PageHeader } from '@/components/app/shell/page-header';
import { ProjectMonogram } from '@/components/app/shell/project-monogram';
import { EmptyState } from '@/components/app/status/empty-state';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/link-button';
import { Skeleton } from '@/components/ui/skeleton';
import { timeZoneAbbreviation } from '@/lib/format/date';
import { projectPath } from '@/lib/routes/paths';

export interface ListedProject {
  id: string;
  slug: string;
  name: string;
  /** The primary domain's host, or `null` until the project has one. */
  domain: string | null;
  /** IANA name, shown as its abbreviation today ("CEST"). */
  timeZone: string;
  /** Paused: open as usual, but no checks run until someone resumes it. */
  paused: boolean;
}

/** Why the list is empty, for the reason sentence: who can change it. */
export type EmptyReason = 'creator' | 'viewer' | 'restricted';

export interface ProjectListProps {
  workspace: string;
  projects: readonly ListedProject[];
  emptyReason: EmptyReason;
  /** The new-project page, for a member who may create a project; `null` hides the button. */
  createHref?: Route | null | undefined;
  /** The time the abbreviations are for (summer or winter time); the render's time outside tests. */
  now?: Date | undefined;
}

export const PROJECT_LIST_FRAME = 'flex w-full flex-col gap-4 px-3 pt-5 pb-8 md:px-4 lg:px-5';
const LIST = 'flex flex-col divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface';

/**
 * The workspace root: the projects the member can open, each a link to its project, under the page
 * header with "New project" for a member who may create one (absent, not disabled, for anyone else). With
 * none, the empty state says who can create one, and offers it to whoever can.
 */
export function ProjectList({
  workspace,
  projects,
  emptyReason,
  createHref = null,
  now = new Date(),
}: ProjectListProps): ReactNode {
  const t = useTranslations('projects');
  // Each link is named by its project's name alone; the domain and time zone are what it shows besides
  const idBase = useId();
  return (
    <div className={PROJECT_LIST_FRAME}>
      <PageHeader
        title={t('title')}
        meta={projects.length === 0 ? undefined : t('count', { count: projects.length })}
        actions={
          createHref === null || projects.length === 0 ? undefined : (
            <LinkButton render={<Link href={createHref} />} variant="primary" icon={Plus}>
              {t('new')}
            </LinkButton>
          )
        }
      />
      {projects.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          headingLevel={2}
          title={t('empty.title')}
          reason={t(`empty.${emptyReason}`)}
          primaryAction={
            createHref === null ? undefined : (
              <LinkButton render={<Link href={createHref} />} variant="primary" icon={Plus}>
                {t('new')}
              </LinkButton>
            )
          }
        />
      ) : (
        <ul role="list" className={LIST}>
          {projects.map((project) => {
            const nameId = idBase + project.id;
            return (
              <li key={project.id}>
                <Link
                  href={projectPath(workspace, project.slug)}
                  prefetch={false}
                  aria-labelledby={nameId}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover focus-visible:focus-ring focus-visible:-outline-offset-2"
                >
                  <ProjectMonogram name={project.name} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                      <span id={nameId} className="truncate type-body-strong text-foreground">
                        {project.name}
                      </span>
                      {project.paused ? <Badge>{t('paused')}</Badge> : null}
                    </span>
                    <span className="truncate type-meta">{project.domain ?? t('noDomain')}</span>
                  </span>
                  <span className="hidden shrink-0 type-meta sm:block">
                    {t('timeZone', { timeZone: timeZoneAbbreviation(now, project.timeZone) })}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const SKELETON_ROWS = 3;

/** The list while it loads: the header with its title, and rows of the list's shape. */
export function ProjectListSkeleton(): ReactNode {
  const t = useTranslations('projects');
  return (
    <div className={PROJECT_LIST_FRAME}>
      <PageHeader title={t('title')} />
      <div aria-hidden="true" className={LIST}>
        {Array.from({ length: SKELETON_ROWS }, (_, row) => (
          <div key={row} className="flex items-center gap-3 px-4 py-3">
            <Skeleton shape="block" className="size-7 shrink-0 rounded-md" />
            <div className="flex w-60 flex-col gap-2">
              <Skeleton shape="text-14" widthPct={64} />
              <Skeleton shape="text-12" widthPct={48} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
