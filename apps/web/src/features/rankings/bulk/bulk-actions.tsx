'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, FolderInput, Gauge, Link2, Tags, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

import { BulkFailure } from './bulk-failure';
import { BULK_ARCHIVE, BULK_DELETE, BULK_UPDATE, bulkTarget, targetBatches, type BulkTarget } from './bulk-target';
import { MoveToGroupDialog } from './move-to-group-dialog';
import { PriorityDialog } from './priority-dialog';
import { TagsDialog } from './tags-dialog';
import { TargetUrlDialog } from './target-url-dialog';
import { refreshKeywords, type KeywordFilters, type ProjectScope } from '../rankings-queries';
import { refreshGroups } from '../taxonomy-queries';
import type { ActionScope, RecordAction } from '@/components/app/data-table/types';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation, type ApiInit } from '@/lib/api/query';
import type { TrackedKeywordRow } from '@/lib/api/types';
import { formatInteger } from '@/lib/format';

/** Above this many keywords, archiving asks first (24-page-templates.md section 9.3). */
const CONFIRM_ABOVE = 100;
/** The API takes this many group ids in one list. */
const GROUP_LIST = 100;

type UpdateBody = NonNullable<ApiInit<'post', typeof BULK_UPDATE>['body']>;
type Change = Omit<UpdateBody, 'ids' | 'filter'>;
type Dialog = 'tags' | 'group' | 'target' | 'priority' | 'archive' | 'delete';

interface Opened {
  dialog: Dialog;
  target: BulkTarget;
  /** How many keywords the action applies to, for its words. */
  count: number;
}

export interface BulkContext {
  scope: ProjectScope;
  /** The list's filters and search: what "every matching keyword" sends. */
  filters: KeywordFilters;
  search: string;
  /** The Archived view: Unarchive takes Archive's place. */
  archived: boolean;
  /** Every keyword the filters match, for the count when all of them are chosen. */
  matchingTotal: number | null;
  /** After a change: the selection is cleared. */
  onDone: () => void;
}

/**
 * The bulk actions of Rankings (24-page-templates.md section 9.3, backend plan D15) in the template's
 * order: Add tags, Move to group, Set target URL, Set priority, then Archive (or Unarchive) and Delete. An
 * action applies to the chosen keywords by id, or to every keyword the filters match by the filters.
 * Archive runs at once with Undo, asking first above 100 keywords; Delete always asks, with the count.
 */
export function useBulkActions(context: BulkContext): {
  actions: RecordAction<TrackedKeywordRow>[];
  dialogs: ReactNode;
} {
  const { scope, filters, search, archived, matchingTotal, onDone } = context;
  const t = useTranslations('rankings.bulk');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const update = useMutation(apiMutation('post', BULK_UPDATE));
  const archive = useMutation(apiMutation('post', BULK_ARCHIVE));
  const remove = useMutation(apiMutation('post', BULK_DELETE));
  const [opened, setOpened] = useState<Opened | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const project = { workspace_id: scope.workspaceId, project_id: scope.projectId };
  const countText = (count: number): string => t('count', { count });

  /** The words for a change the API refused. */
  const problemText = (error: unknown): string => {
    if (isApiProblem(error, 'too_many_subjects')) {
      return t('tooMany', { limit: formatInteger(error.number('limit') ?? 20_000) });
    }
    if (isApiProblem(error, 'quota_exceeded')) {
      const limit = error.number('limit') ?? 0;
      const used = error.number('used') ?? 0;
      return t('quota', {
        room: Math.max(limit - used, 0),
        used: formatInteger(used),
        limit: formatInteger(limit),
        requested: formatInteger(error.number('requested') ?? 0),
      });
    }
    return t('failed');
  };
  // A dialog that made its change closes onto a bulk bar that has gone with the selection: focus goes to
  // the grid's cell instead (20-accessibility.md section 4.3). While nothing changed, the default applies.
  const changed = useRef(false);
  const gridFocus = useMemo(
    (): RefObject<HTMLElement | null> => ({
      get current(): HTMLElement | null {
        return changed.current ? document.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]') : null;
      },
    }),
    [],
  );
  const finish = (): void => {
    changed.current = true;
    void refreshKeywords(queryClient, scope);
    onDone();
  };
  /** A failure after some requests landed says so, so the person knows to look before trying again. */
  const failure = (error: unknown, landed: number): BulkFailure =>
    new BulkFailure(landed > 0 ? t('partial') : problemText(error));

  /**
   * A bulk update of the opened target: ids in requests of 5,000, the group lists in requests of 100. When
   * the target is a filter on a group the change takes the keywords out of, that removal goes last, or the
   * filter would match nothing for the rest.
   */
  const applyChange = async (change: Change): Promise<{ matched: number; versions: number }> => {
    if (opened === null) throw new BulkFailure(t('failed'));
    const { add_group_ids: adds = [], remove_group_ids: removing = [], ...rest } = change;
    const filterGroup = 'filter' in opened.target ? (opened.target.filter.group ?? null) : null;
    const removes = [...removing.filter((id) => id !== filterGroup), ...removing.filter((id) => id === filterGroup)];
    const changes: Change[] = [];
    for (let at = 0; at === 0 || at < removes.length; at += GROUP_LIST) {
      const part = removes.slice(at, at + GROUP_LIST);
      changes.push(
        at === 0
          ? {
              ...rest,
              ...(adds.length === 0 ? {} : { add_group_ids: adds }),
              ...(part.length === 0 ? {} : { remove_group_ids: part }),
            }
          : { remove_group_ids: part },
      );
    }
    let matched = 0;
    let versions = 0;
    let landed = 0;
    try {
      for (const target of targetBatches(opened.target)) {
        let matchedHere = 0;
        for (const body of changes) {
          const answer = await update.mutateAsync({ params: { path: project }, body: { ...target, ...body } });
          matchedHere = Math.max(matchedHere, answer.data.matched);
          versions += answer.data.config_versions_created;
          landed += 1;
        }
        matched += matchedHere;
      }
    } catch (error) {
      void refreshKeywords(queryClient, scope);
      throw failure(error, landed);
    }
    finish();
    return { matched, versions };
  };

  /**
   * Archives or unarchives `target`; an archive of chosen keywords can be undone from its toast. A press
   * while one runs is ignored. Without a dialog to say it, a failure is a toast.
   */
  const archiving = useRef(false);
  const runArchive = async (
    target: BulkTarget,
    toArchive: boolean,
    { undoable, toastFailure }: { undoable: boolean; toastFailure: boolean },
  ): Promise<void> => {
    if (archiving.current) return;
    archiving.current = true;
    let updated = 0;
    let landed = 0;
    try {
      for (const batch of targetBatches(target)) {
        const answer = await archive.mutateAsync({ params: { path: project }, body: { ...batch, archive: toArchive } });
        updated += answer.data.updated;
        landed += 1;
      }
    } catch (error) {
      void refreshKeywords(queryClient, scope);
      const failed = failure(error, landed);
      if (toastFailure) toast({ type: 'error', title: failed.message });
      throw failed;
    } finally {
      archiving.current = false;
    }
    finish();
    const done = countText(updated);
    // An archive by filter cannot be undone by the same filter: the keywords left the list it describes
    const undo = undoable && 'ids' in target;
    toast({
      type: 'success',
      title: toArchive ? t('archived', { count: done }) : t('unarchived', { count: done }),
      ...(undo
        ? {
            action: {
              label: t('undo'),
              onAction: () =>
                void runArchive(target, !toArchive, { undoable: false, toastFailure: true }).catch(() => undefined),
            },
          }
        : {}),
    });
  };

  /** Deletes `target` as the single delete does: the history stays, and adding a keyword again restores it. */
  const runDelete = async (target: BulkTarget): Promise<void> => {
    let deleted = 0;
    let landed = 0;
    try {
      for (const batch of targetBatches(target)) {
        const answer = await remove.mutateAsync({ params: { path: project }, body: batch });
        deleted += answer.data.deleted;
        landed += 1;
      }
    } catch (error) {
      void refreshKeywords(queryClient, scope);
      throw failure(error, landed);
    }
    finish();
    toast({ type: 'success', title: t('deleted', { count: countText(deleted) }) });
  };

  const open = (dialog: Dialog) => (_rows: readonly TrackedKeywordRow[], actionScope: ActionScope) => {
    const count = actionScope.allMatching ? (matchingTotal ?? actionScope.ids.size) : actionScope.ids.size;
    changed.current = false;
    setConfirmError(null);
    setOpened({ dialog, target: bulkTarget(actionScope, filters, search), count });
  };
  const close = (): void => setOpened(null);

  const actions: RecordAction<TrackedKeywordRow>[] = [
    { id: 'tags', label: t('tags'), icon: Tags, group: 'object', onSelect: open('tags') },
    { id: 'group', label: t('group'), icon: FolderInput, group: 'object', onSelect: open('group') },
    { id: 'target', label: t('targetUrl'), icon: Link2, group: 'object', onSelect: open('target') },
    { id: 'priority', label: t('priority'), icon: Gauge, group: 'object', onSelect: open('priority') },
    {
      id: 'archive',
      label: archived ? t('unarchive') : t('archive'),
      icon: archived ? ArchiveRestore : Archive,
      group: 'destructive',
      onSelect: (rows, actionScope) => {
        const count = actionScope.allMatching ? (matchingTotal ?? actionScope.ids.size) : actionScope.ids.size;
        const target = bulkTarget(actionScope, filters, search);
        // Unarchiving loses nothing, and a small archive is undone from its toast: neither asks
        if (archived || count <= CONFIRM_ABOVE) {
          void runArchive(target, !archived, { undoable: true, toastFailure: true }).catch(() => undefined);
          return;
        }
        open('archive')(rows, actionScope);
      },
    },
    {
      id: 'delete',
      label: t('delete'),
      icon: Trash2,
      group: 'destructive',
      onSelect: open('delete'),
    },
  ];

  const countOfOpened = countText(opened?.count ?? 0);
  const dialogs = (
    <>
      <TagsDialog
        scope={scope}
        open={opened?.dialog === 'tags'}
        onOpenChange={(next) => (next ? undefined : close())}
        finalFocus={gridFocus}
        countText={countOfOpened}
        onApply={async (mode, termIds) => {
          const { matched } = await applyChange(
            mode === 'add' ? { add_term_ids: termIds } : { remove_term_ids: termIds },
          );
          toast({
            type: 'success',
            title:
              mode === 'add'
                ? t('tagsDialog.added', { count: countText(matched) })
                : t('tagsDialog.removed', { count: countText(matched) }),
          });
        }}
      />
      <MoveToGroupDialog
        scope={scope}
        open={opened?.dialog === 'group'}
        onOpenChange={(next) => (next ? undefined : close())}
        finalFocus={gridFocus}
        countText={countOfOpened}
        onApply={async (groupId, others, groupName) => {
          const { matched } = await applyChange({
            ...(groupId === null ? {} : { add_group_ids: [groupId] }),
            remove_group_ids: others,
          });
          toast({
            type: 'success',
            title:
              groupId === null || groupName === null
                ? t('groupDialog.ungrouped', { count: countText(matched) })
                : t('groupDialog.moved', { count: countText(matched), group: groupName }),
          });
          void refreshGroups(queryClient, scope);
        }}
      />
      <TargetUrlDialog
        open={opened?.dialog === 'target'}
        onOpenChange={(next) => (next ? undefined : close())}
        finalFocus={gridFocus}
        countText={countOfOpened}
        onApply={async (url) => {
          const { matched, versions } = await applyChange({ set: { target_url: url } });
          toast({
            type: 'success',
            title:
              url === null
                ? t('targetDialog.cleared', { count: countText(matched) })
                : t('targetDialog.set', { count: countText(matched) }),
            ...(versions > 0 ? { description: t('targetDialog.versions', { count: versions }) } : {}),
          });
        }}
      />
      <PriorityDialog
        open={opened?.dialog === 'priority'}
        onOpenChange={(next) => (next ? undefined : close())}
        finalFocus={gridFocus}
        countText={countOfOpened}
        onApply={async (priority) => {
          const { matched } = await applyChange({ set: { priority } });
          toast({
            type: 'success',
            title: t('priorityDialog.set', { priority: String(priority), count: countText(matched) }),
          });
        }}
      />
      <ConfirmDialog
        open={opened?.dialog === 'archive'}
        onOpenChange={(next) => (next ? undefined : close())}
        finalFocus={gridFocus}
        title={t('archiveConfirm.title', { count: countOfOpened })}
        description={t('archiveConfirm.description')}
        confirmLabel={t('archiveConfirm.confirm', { count: countOfOpened })}
        cancelLabel={common('cancel')}
        tone="neutral"
        error={confirmError}
        onConfirm={async () => {
          if (opened === null) return;
          try {
            await runArchive(opened.target, true, { undoable: true, toastFailure: false });
            close();
          } catch (error) {
            setConfirmError(error instanceof BulkFailure ? error.message : t('failed'));
            throw error;
          }
        }}
      />
      <ConfirmDialog
        open={opened?.dialog === 'delete'}
        onOpenChange={(next) => (next ? undefined : close())}
        finalFocus={gridFocus}
        title={t('deleteConfirm.title', { count: countOfOpened })}
        description={t('deleteConfirm.description')}
        confirmLabel={t('deleteConfirm.confirm', { count: countOfOpened })}
        cancelLabel={common('cancel')}
        error={confirmError}
        onConfirm={async () => {
          if (opened === null) return;
          try {
            await runDelete(opened.target);
            close();
          } catch (error) {
            setConfirmError(error instanceof BulkFailure ? error.message : t('failed'));
            throw error;
          }
        }}
      />
    </>
  );
  return { actions, dialogs };
}
