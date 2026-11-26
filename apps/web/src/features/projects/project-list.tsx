import {
  CalendarDays,
  ChevronRight,
  Clock,
  FolderOpen,
  Globe,
  ListChecks,
  MapPin,
  Plus,
  Tag,
  type LucideIcon,
} from 'lucide-react';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';

import { PageHeader } from '@/components/app/shell/page-header';
import { ProjectMark } from '@/components/app/shell/project-mark';
import { EmptyState } from '@/components/app/status/empty-state';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { LinkButton } from '@/components/ui/link-button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTableDate, timeZoneAbbreviation } from '@/lib/format/date';
import { projectPath } from '@/lib/routes/paths';
import { cn } from '@/lib/utils';

export interface ListedProject {
  id: string;
  slug: string;
  name: string;
  /** The primary domain's host, or `null` until the project has one. */
  domain: string | null;
  /** The default location's name ("India"), or `null` when none is set. */
  location: string | null;
  /** IANA name, shown as its abbreviation today ("CEST"). */
  timeZone: string;
  /** When the project was created, an ISO instant. */
  createdAt: string;
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

export const PROJECT_LIST_FRAME = 'flex w-full flex-col gap-3 px-3 pt-3 pb-8 md:px-4 lg:px-5';
const GRID = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3';
const CARD = 'rounded-lg border border-border bg-surface';

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
        <div className={cn('grid items-start gap-3', emptyReason === 'creator' && 'lg:grid-cols-3')}>
          <div
            className={cn(
              'rounded-lg border border-border bg-surface py-12',
              emptyReason === 'creator' && 'lg:col-span-2',
            )}
          >
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
          </div>
          {emptyReason === 'creator' ? <SetupSteps /> : null}
        </div>
      ) : (
        <ul role="list" className={GRID}>
          {projects.map((project) => {
            const nameId = idBase + project.id;
            return (
              <li key={project.id}>
                <Link
                  href={projectPath(workspace, project.slug)}
                  prefetch={false}
                  aria-labelledby={nameId}
                  className={cn(
                    CARD,
                    'flex h-full flex-col gap-4 p-4 hover:bg-surface-hover focus-visible:focus-ring focus-visible:-outline-offset-2',
                  )}
                >
                  <span className="flex items-center gap-3">
                    <ProjectMark name={project.name} domain={project.domain} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex min-w-0 items-center gap-2">
                        <span id={nameId} className="truncate type-body-strong text-foreground">
                          {project.name}
                        </span>
                        {project.paused ? <Badge>{t('paused')}</Badge> : null}
                      </span>
                      <span className="truncate type-meta">{project.domain ?? t('noDomain')}</span>
                    </span>
                    <Icon icon={ChevronRight} size="sm" className="shrink-0 text-foreground-muted" />
                  </span>
                  <span className="mt-auto flex flex-col gap-1.5 border-t border-border-subtle pt-3 type-meta">
                    {project.location === null ? null : <Fact icon={MapPin}>{project.location}</Fact>}
                    <Fact icon={Clock}>{t('timeZone', { timeZone: timeZoneAbbreviation(now, project.timeZone) })}</Fact>
                    <Fact icon={CalendarDays}>
                      {t('added', { date: formatTableDate(project.createdAt, project.timeZone, now) })}
                    </Fact>
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

/** One detail on a card: a small icon, then its text. */
function Fact({ icon, children }: { icon: LucideIcon; children: ReactNode }): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon icon={icon} size="sm" className="shrink-0 text-foreground-muted" />
      <span className="truncate">{children}</span>
    </span>
  );
}

const STEPS: readonly { key: 'site' | 'brand' | 'track'; icon: LucideIcon }[] = [
  { key: 'site', icon: Globe },
  { key: 'brand', icon: Tag },
  { key: 'track', icon: ListChecks },
];

/** What creating a project covers, beside the empty state: one panel, one row per part, no illustration. */
function SetupSteps(): ReactNode {
  const t = useTranslations('projects.empty.steps');
  return (
    <section aria-labelledby="project-setup-steps" className="rounded-lg border border-border bg-surface">
      <h2 id="project-setup-steps" className="px-4 pt-4 pb-2 type-subsection-title">
        {t('title')}
      </h2>
      <ol role="list" className="flex flex-col divide-y divide-border-subtle">
        {STEPS.map(({ key, icon }) => (
          <li key={key} className="flex items-start gap-3 px-4 py-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-subtle text-foreground-secondary">
              <Icon icon={icon} size="sm" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="type-body-strong text-foreground">{t(`${key}.title`)}</span>
              <span className="type-meta">{t(`${key}.body`)}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const SKELETON_ROWS = 3;

/** The list while it loads: the header with its title, and rows of the list's shape. */
export function ProjectListSkeleton(): ReactNode {
  const t = useTranslations('projects');
  return (
    <div className={PROJECT_LIST_FRAME}>
      <PageHeader title={t('title')} />
      <div aria-hidden="true" className={GRID}>
        {Array.from({ length: SKELETON_ROWS }, (_, card) => (
          <div key={card} className={cn(CARD, 'flex flex-col gap-4 p-4')}>
            <div className="flex items-center gap-3">
              <Skeleton shape="block" className="size-7 shrink-0 rounded-md" />
              <div className="flex w-60 flex-col gap-2">
                <Skeleton shape="text-14" widthPct={64} />
                <Skeleton shape="text-12" widthPct={48} />
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
              <Skeleton shape="text-12" widthPct={48} />
              <Skeleton shape="text-12" widthPct={56} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
