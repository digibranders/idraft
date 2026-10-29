'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';

import { AliasDialog, PasteAliasesDialog } from './alias-dialog';
import { refreshEntities, type Alias, type EntityDetail, type ProjectScope } from './entity-queries';
import { MODE_KEY } from './labels';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';

const REMOVE = apiMutation('delete', '/api/v1/workspaces/{workspace_id}/entities/{entity_id}/aliases/{alias_id}');

export interface EntityAliasesSectionProps {
  scope: ProjectScope;
  entity: EntityDetail;
  canWrite: boolean;
}

/**
 * The names that count as the entity in answers (20 section 5.19.6): each alias with how it is matched,
 * whether case matters, whether it rules a mention out, and whether it needs a hint nearby. Names made
 * from the entity's domains are matched too, without being listed here.
 */
export function EntityAliasesSection({ scope, entity, canWrite }: EntityAliasesSectionProps): ReactNode {
  const t = useTranslations('entitySettings.aliases');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const remove = useMutation(REMOVE);
  const heading = useRef<HTMLHeadingElement>(null);
  const [editing, setEditing] = useState<Alias | 'new' | null>(null);
  const [pasting, setPasting] = useState(false);
  const [removing, setRemoving] = useState<Alias | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // Once the row is gone with its button, focus goes to the section's heading; on Cancel it goes back
  const [removed, setRemoved] = useState(false);

  const confirmRemove = async (): Promise<void> => {
    if (removing === null) return;
    setRemoveError(null);
    try {
      await remove.mutateAsync({
        params: { path: { workspace_id: scope.workspaceId, entity_id: entity.entity_id, alias_id: removing.alias_id } },
      });
    } catch (error) {
      if (!isApiProblem(error, 'not_found')) {
        setRemoveError(t('removeFailed', { alias: removing.alias }));
        throw error;
      }
    }
    setRemoved(true);
    refreshEntities(queryClient, scope);
    toast({ type: 'success', title: t('removed', { alias: removing.alias }) });
  };

  const itemsFor = (alias: Alias): MenuItemDef[] => [
    { id: 'edit', label: t('edit'), onSelect: () => setEditing(alias) },
    {
      id: 'remove',
      label: t('remove'),
      tone: 'destructive',
      onSelect: () => {
        setRemoved(false);
        setRemoving(alias);
      },
    },
  ];

  return (
    <section aria-labelledby="entity-aliases-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="entity-aliases-title" ref={heading} tabIndex={-1} className="type-subsection-title outline-none">
            {t('title')}
          </h3>
          <p className="mt-1 type-meta">{t('description')}</p>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button icon={Plus} onClick={() => setEditing('new')}>
              {t('add')}
            </Button>
            <Button variant="ghost" onClick={() => setPasting(true)}>
              {t('paste')}
            </Button>
          </div>
        ) : null}
      </div>
      {entity.aliases.length === 0 ? (
        <p className="type-body text-foreground-secondary">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full type-table" aria-labelledby="entity-aliases-title">
            <thead className="bg-surface-subtle">
              <tr>
                <th scope="col" className="h-row-header px-4 text-left type-table-header">
                  {t('columns.alias')}
                </th>
                <th scope="col" className="h-row-header px-3 text-left type-table-header">
                  {t('columns.mode')}
                </th>
                <th scope="col" className="hidden h-row-header px-3 text-left type-table-header md:table-cell">
                  {t('columns.options')}
                </th>
                {canWrite ? (
                  <th scope="col" className="h-row-header px-4 text-right">
                    <span className="sr-only">{t('columns.actions')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {entity.aliases.map((alias) => (
                <tr key={alias.alias_id} className="h-row-compact border-t border-border-subtle">
                  <th
                    scope="row"
                    className={
                      alias.match_mode === 'regex'
                        ? 'px-4 py-2 text-left font-mono font-normal'
                        : 'px-4 py-2 text-left font-normal'
                    }
                  >
                    {alias.alias}
                  </th>
                  <td className="px-3 whitespace-nowrap text-foreground-secondary">
                    {t(`modes.${MODE_KEY[alias.match_mode]}`)}
                  </td>
                  <td className="hidden px-3 md:table-cell">
                    <span className="flex flex-wrap gap-1">
                      {alias.is_negative ? <Badge tone="warning">{t('badges.negative')}</Badge> : null}
                      {alias.case_sensitive ? <Badge variant="outline">{t('badges.case')}</Badge> : null}
                      {alias.requires_context ? <Badge variant="outline">{t('badges.context')}</Badge> : null}
                    </span>
                  </td>
                  {canWrite ? (
                    <td className="px-4 text-right">
                      <Menu
                        align="end"
                        trigger={
                          <IconButton
                            icon={MoreHorizontal}
                            size="icon-sm"
                            variant="ghost"
                            label={t('actionsFor', { alias: alias.alias })}
                          />
                        }
                        items={itemsFor(alias)}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AliasDialog
        scope={scope}
        entityId={entity.entity_id}
        entityName={entity.canonical_name}
        alias={editing}
        onClose={() => setEditing(null)}
      />
      <PasteAliasesDialog
        scope={scope}
        entityId={entity.entity_id}
        entityName={entity.canonical_name}
        // Only a plain alias is the same as a pasted one: a negative, a pattern or an exact-case alias differs
        existing={entity.aliases
          .filter((alias) => alias.match_mode === 'word_boundary' && !alias.is_negative && !alias.case_sensitive)
          .map((alias) => alias.alias)}
        open={pasting}
        onClose={() => setPasting(false)}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            setRemoveError(null);
          }
        }}
        finalFocus={removed ? heading : undefined}
        title={t('removeTitle', { alias: removing?.alias ?? '' })}
        description={t('removeDescription', { name: entity.canonical_name })}
        confirmLabel={t('removeConfirm')}
        cancelLabel={common('cancel')}
        onConfirm={confirmRemove}
        error={removeError}
      />
    </section>
  );
}
