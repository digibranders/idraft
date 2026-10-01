'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';

import { EntityDialog } from './entity-dialog';
import {
  COMPETITOR_LIMIT,
  projectEntitiesQuery,
  refreshEntities,
  seoCompetitors,
  type ProjectEntity,
  type ProjectRole,
  type ProjectScope,
} from './entity-queries';
import { TrackingDialog } from './tracking-dialog';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { Banner } from '@/components/app/status/banner';
import { InlineError } from '@/components/app/status/inline-error';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { canWriteEntities, useMembership } from '@/lib/permissions';
import { projectPath } from '@/lib/routes/paths';

const REMOVE = apiMutation('delete', '/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities/{entity_id}');
const SKELETON_ROWS = 2;
const ROLE_ORDER: readonly ProjectRole[] = ['own', 'competitor', 'watch'];
/** The domains a row shows before "+2". */
const SHOWN_DOMAINS = 2;

export interface EntitiesScreenProps extends ProjectScope {
  workspaceSlug: string;
  projectSlug: string;
}

/**
 * Settings > Project settings > Entities and aliases (20 section 5.19.6): the own brand, up to 10
 * competitors and the entities watched in answers, each with its domains, alias count and tracking. With
 * `entities:write`, competitors and watched entities are added here and every row opens its editor; a
 * removed role keeps its history (19 section 3.4).
 */
export function EntitiesScreen({ workspaceId, projectId, workspaceSlug, projectSlug }: EntitiesScreenProps): ReactNode {
  const t = useTranslations('entitySettings');
  const common = useTranslations('common');
  const scope: ProjectScope = { workspaceId, projectId };
  // A member limited to some projects cannot change workspace entities, whatever their role
  const canWrite = canWriteEntities(useMembership());
  const queryClient = useQueryClient();
  const entities = useQuery(projectEntitiesQuery(scope));
  const remove = useMutation(REMOVE);
  const [adding, setAdding] = useState<Exclude<ProjectRole, 'own'> | null>(null);
  const [tracking, setTracking] = useState<ProjectEntity | null>(null);
  const [removing, setRemoving] = useState<ProjectEntity | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // Once a row is gone with its menu button, the dialog hands focus to the section's heading
  const [rowGone, setRowGone] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const rows = entities.data?.data ?? [];
  const competitors = seoCompetitors(rows);
  const editorHref = (row: ProjectEntity): ReturnType<typeof projectPath> =>
    projectPath(workspaceSlug, projectSlug, `/settings/entities/${row.entity.entity_id}`);

  const confirmRemove = async (): Promise<void> => {
    if (removing === null) return;
    setRemoveError(null);
    const name = removing.entity.canonical_name;
    try {
      await remove.mutateAsync({
        params: { path: { workspace_id: workspaceId, project_id: projectId, entity_id: removing.entity.entity_id } },
      });
    } catch (error) {
      if (isApiProblem(error, 'not_found')) {
        toast({ type: 'info', title: t('removeDialog.gone', { name }) });
        setRowGone(true);
        refreshEntities(queryClient, scope);
        return;
      }
      setRemoveError(
        isApiProblem(error, 'cannot_remove_primary_own')
          ? t('removeDialog.primaryOwn')
          : t('removeDialog.failed', { name }),
      );
      throw error;
    }
    toast({ type: 'success', title: t('removeDialog.removed', { name }) });
    setRowGone(true);
    refreshEntities(queryClient, scope);
  };

  const itemsFor = (row: ProjectEntity): MenuItemDef[] => [
    { kind: 'link', id: 'edit', label: t('menu.edit'), link: <Link href={editorHref(row)} /> },
    { id: 'tracking', label: t('menu.tracking'), onSelect: () => setTracking(row) },
    // The primary own brand stays: a project is always judged against its own brand
    ...(row.role === 'own' && row.is_primary
      ? []
      : [
          {
            id: 'remove',
            label: t('menu.remove'),
            tone: 'destructive' as const,
            onSelect: () => {
              setRowGone(false);
              setRemoving(row);
            },
          },
        ]),
  ];

  return (
    <section aria-labelledby="entities-title" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="entities-title" ref={heading} tabIndex={-1} className="type-section-title outline-none">
            {t('title')}
          </h2>
          <p className="mt-1 type-meta">{t('description')}</p>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button icon={Plus} onClick={() => setAdding('competitor')} disabled={entities.isPending}>
              {t('addCompetitor')}
            </Button>
            <Button variant="ghost" onClick={() => setAdding('watch')} disabled={entities.isPending}>
              {t('addWatched')}
            </Button>
          </div>
        ) : null}
      </div>
      {canWrite ? null : <Banner tone="info" placement="region" lead={t('readOnlyLead')} message={t('readOnly')} />}
      {entities.isError ? (
        <InlineError
          title={t('loadFailed')}
          reason={t('loadFailedReason')}
          errorId={null}
          onRetry={() => void entities.refetch()}
          retrying={entities.isFetching}
          retryLabel={common('retry')}
        />
      ) : (
        ROLE_ORDER.map((role) => (
          <RoleTable
            key={role}
            role={role}
            rows={rows.filter((row) => row.role === role)}
            loading={entities.isPending}
            count={role === 'competitor' ? t('competitorCount', { count: competitors, limit: COMPETITOR_LIMIT }) : null}
            canWrite={canWrite}
            editorHref={editorHref}
            itemsFor={itemsFor}
          />
        ))
      )}
      <EntityDialog
        scope={scope}
        role={adding}
        entities={rows}
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        onClose={() => setAdding(null)}
      />
      <TrackingDialog scope={scope} entity={tracking} onClose={() => setTracking(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            setRemoveError(null);
          }
        }}
        finalFocus={rowGone ? heading : undefined}
        title={t('removeDialog.title', { name: removing?.entity.canonical_name ?? '' })}
        description={t('removeDialog.description')}
        confirmLabel={t('removeDialog.confirm')}
        cancelLabel={common('cancel')}
        onConfirm={confirmRemove}
        error={removeError}
      />
    </section>
  );
}

interface RoleTableProps {
  role: ProjectRole;
  rows: readonly ProjectEntity[];
  loading: boolean;
  /** "4 of 10", for competitors. */
  count: string | null;
  canWrite: boolean;
  editorHref: (row: ProjectEntity) => ReturnType<typeof projectPath>;
  itemsFor: (row: ProjectEntity) => MenuItemDef[];
}

/** One role's entities: a heading, then a table, or a sentence when there are none. */
function RoleTable({ role, rows, loading, count, canWrite, editorHref, itemsFor }: RoleTableProps): ReactNode {
  const t = useTranslations('entitySettings');
  const titleId = `entities-${role}`;
  const columns = canWrite ? 5 : 4;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 id={titleId} className="type-subsection-title">
          {t(`roles.${role}`)}
        </h3>
        {count === null ? null : <span className="num type-meta">{count}</span>}
      </div>
      {!loading && rows.length === 0 ? (
        <p className="type-meta">{t(`empty.${role}`)}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full" aria-labelledby={titleId}>
            <thead className="bg-surface-subtle">
              <tr>
                <th scope="col" className="h-row-header px-4 text-left type-label">
                  {t('columns.entity')}
                </th>
                <th scope="col" className="hidden h-row-header px-3 text-left type-label md:table-cell">
                  {t('columns.domains')}
                </th>
                <th scope="col" className="h-row-header px-3 text-right type-label">
                  {t('columns.aliases')}
                </th>
                <th scope="col" className="hidden h-row-header px-3 text-left type-label sm:table-cell">
                  {t('columns.tracking')}
                </th>
                {canWrite ? (
                  <th scope="col" className="h-row-header px-4">
                    <span className="sr-only">{t('columns.actions')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody aria-busy={loading}>
              {loading
                ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
                    <tr key={index} className="h-row border-t border-border-subtle">
                      <td colSpan={columns} className="px-4">
                        <Skeleton shape="text-14" widthPct={48} />
                      </td>
                    </tr>
                  ))
                : rows.map((row) => (
                    <EntityRow
                      key={row.entity.entity_id}
                      row={row}
                      canWrite={canWrite}
                      editorHref={editorHref(row)}
                      items={itemsFor(row)}
                    />
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EntityRow({
  row,
  canWrite,
  editorHref,
  items,
}: {
  row: ProjectEntity;
  canWrite: boolean;
  editorHref: ReturnType<typeof projectPath>;
  items: MenuItemDef[];
}): ReactNode {
  const t = useTranslations('entitySettings');
  const name = row.entity.canonical_name;
  const hosts = row.domains.map((domain) =>
    domain.path_prefix === null ? domain.domain.host : `${domain.domain.host}${domain.path_prefix}`,
  );
  const more = hosts.length - SHOWN_DOMAINS;
  return (
    <tr className="h-row border-t border-border-subtle">
      <th scope="row" className="px-4 py-2 text-left font-normal">
        <span className="flex items-center gap-2">
          <EntitySwatch colorIndex={row.color_index} own={row.role === 'own'} />
          <TextLink render={<Link href={editorHref} />} className="type-body">
            {name}
          </TextLink>
          {row.role === 'own' && row.is_primary ? <Badge>{t('primary')}</Badge> : null}
        </span>
      </th>
      <td className="hidden px-3 type-body text-foreground-secondary md:table-cell">
        {hosts.length === 0
          ? t('noDomains')
          : more > 0
            ? t('domainsMore', { domains: hosts.slice(0, SHOWN_DOMAINS).join(', '), count: more })
            : hosts.join(', ')}
      </td>
      <td className="px-3 text-right num type-body text-foreground-secondary">{row.alias_count}</td>
      <td className="hidden px-3 sm:table-cell">
        <span className="flex gap-1">
          {row.track_seo ? <Badge variant="outline">{t('trackSeo')}</Badge> : null}
          {row.track_ai ? <Badge variant="outline">{t('trackAi')}</Badge> : null}
          {row.track_seo || row.track_ai ? null : (
            <span className="type-body text-foreground-tertiary">{t('trackNone')}</span>
          )}
        </span>
      </td>
      {canWrite ? (
        <td className="px-4 text-right">
          <Menu
            align="end"
            trigger={
              <IconButton icon={MoreHorizontal} size="icon-sm" variant="ghost" label={t('actionsFor', { name })} />
            }
            items={items}
          />
        </td>
      ) : null}
    </tr>
  );
}
