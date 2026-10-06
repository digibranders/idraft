'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, FolderInput, Gauge, Link2, Tags, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

import { BulkFailure } from './bulk-failure';
import {
  BULK_ARCHIVE,
  BULK_DELETE,
  BULK_UPDATE,
  batchSizeFor,
  bulkTarget,
  groupsHeldBy,
  matchCountQuery,
  targetBatches,
  type BulkTarget,
} from './bulk-target';
import { MoveToGroupDialog } from './move-to-group-dialog';
import { PriorityDialog } from './priority-dialog';
import { TagsDialog } from './tags-dialog';
import { TargetUrlDialog } from './target-url-dialog';
import { readPage, refreshKeywords, type KeywordFilters, type ProjectScope } from '../rankings-queries';
import { refreshGroups } from '../taxonomy-queries';
import { gridTabStop } from '@/components/app/data-table/grid-focus';
import type { ActionScope, RecordAction } from '@/components/app/data-table/types';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation, type ApiInit } from '@/lib/api/query';
import type { TrackedKeywordRow } from '@/lib/api/types';
import { formatInteger } from '@/lib/format';
import { quotaFacts } from '@/lib/keywords/quota';

/** Above this many keywords, archiving asks first (24-page-templates.md section 9.3). */
const CONFIRM_ABOVE = 100;
/** The API takes this many group ids in one list. */
const GROUP_LIST = 100;

type UpdateBody = NonNullable<ApiInit<'post', typeof BULK_UPDATE>['body']>;
type Change = Omit<UpdateBody, 'ids' | 'filter'>;

/** The groups and terms a change names: each counts once for every keyword it is sent for. */
const linksOf = (change: Change): number =>
  (change.add_group_ids?.length ?? 0) +
  (change.remove_group_ids?.length ?? 0) +
  (change.add_term_ids?.length ?? 0) +
  (change.remove_term_ids?.length ?? 0);
type Dialog = 'tags' | 'group' | 'target' | 'priority' | 'archive' | 'unarchive' | 'delete';

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
  /** The rows the list holds, with their groups: what a move reads to name only the groups to leave. */
  rows: readonly TrackedKeywordRow[];
  /** The rows are every keyword the filters match (client mode, read to its end). */
  rowsComplete: boolean;
  /** After a change: the selection is cleared. */
  onDone: () => void;
}

/**
 * The bulk actions of Rankings (24-page-templates.md section 9.3, backend plan D15) in the template's
 * order: Add tags, Move to group, Set target URL, Set priority, then Archive (or Unarchive) and Delete. An
 * action applies to the chosen keywords by id, or to every keyword the filters match by the filters.
 * Archive and Unarchive run at once with Undo, asking first above 100 keywords (12-tables.md section 14);
 * Delete always asks, with the count.
 */
export function useBulkActions(context: BulkContext): {
  actions: RecordAction<TrackedKeywordRow>[];
  dialogs: ReactNode;
} {
  const { scope, filters, search, archived, matchingTotal, rows, rowsComplete, onDone } = context;
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
    if (isApiProblem(error, 'quota_exceeded')) return common('quota', { ...quotaFacts(error, 0) });
    return t('failed');
  };
  // A dialog that made its change closes onto a bulk bar that has gone with the selection: focus goes to
  // the grid's cell instead (20-accessibility.md section 4.3). While nothing changed, the default applies.
  const changed = useRef(false);
  const gridFocus = useMemo(
    (): RefObject<HTMLElement | null> => ({
      get current(): HTMLElement | null {
        return changed.current ? gridTabStop() : null;
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
   * Before an action on every keyword the filters match: how many match now, against the count the person
   * chose. The API reads the filter again when the action arrives, and a rank filter follows the daily
   * check, so the set can have moved since; then nothing is sent, the list is read again to show what
   * matches now, and the person chooses again. A count that cannot be read stops the action as well. An
   * action on chosen ids needs none of this: the ids are what is sent.
   */
  const confirmMatch = async (target: BulkTarget, chosen: number | null): Promise<void> => {
    if (!('filter' in target) || chosen === null) return;
    let now: number;
    try {
      now = (await readPage(scope, matchCountQuery(filters, search), new AbortController().signal)).page.total;
    } catch (error) {
      throw failure(error, 0);
    }
    if (now === chosen) return;
    void refreshKeywords(queryClient, scope);
    throw new BulkFailure(t('changed', { count: formatInteger(now) }));
  };

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
    // Nothing to change (a move out of groups the keywords are not in): no request, and no refusal for an empty one
    if (changes.every((body) => Object.keys(body).length === 0)) {
      finish();
      return { matched: opened.count, versions: 0 };
    }
    await confirmMatch(opened.target, opened.count);
    // The API limits the groups and terms one change gains or loses in all, ids times links: the ids go in
    // batches small enough for the request that names the most
    const batchSize = batchSizeFor(Math.max(...changes.map(linksOf)));
    let matched = 0;
    let versions = 0;
    let landed = 0;
    try {
      for (const target of targetBatches(opened.target, batchSize)) {
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
    { undoable, toastFailure, chosen }: { undoable: boolean; toastFailure: boolean; chosen: number | null },
  ): Promise<void> => {
    if (archiving.current) return;
    archiving.current = true;
    let updated = 0;
    let landed = 0;
    try {
      await confirmMatch(target, chosen);
      for (const batch of targetBatches(target)) {
        const answer = await archive.mutateAsync({ params: { path: project }, body: { ...batch, archive: toArchive } });
        updated += answer.data.updated;
        landed += 1;
      }
    } catch (error) {
      void refreshKeywords(queryClient, scope);
      // The words of a stopped action are already the person's to read; an API error gets its own
      const failed = error instanceof BulkFailure ? error : failure(error, landed);
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
                void runArchive(target, !toArchive, { undoable: false, toastFailure: true, chosen: null }).catch(
                  () => undefined,
                ),
            },
          }
        : {}),
    });
  };

  /** Deletes `target` as the single delete does: the history stays, and adding a keyword again restores it. */
  const runDelete = async (target: BulkTarget, chosen: number | null): Promise<void> => {
    let deleted = 0;
    let landed = 0;
    try {
      await confirmMatch(target, chosen);
      for (const batch of targetBatches(target)) {
        const answer = await remove.mutateAsync({ params: { path: project }, body: batch });
        deleted += answer.data.deleted;
        landed += 1;
      }
    } catch (error) {
      void refreshKeywords(queryClient, scope);
      throw error instanceof BulkFailure ? error : failure(error, landed);
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
      // Last in the bar, but neutral: it loses nothing, and its toast has Undo
      group: 'destructive',
      tone: 'default',
      onSelect: (rows, actionScope) => {
        const count = actionScope.allMatching ? (matchingTotal ?? actionScope.ids.size) : actionScope.ids.size;
        const target = bulkTarget(actionScope, filters, search);
        // A small change runs at once, with Undo; one above 100 keywords asks first, with the count
        if (count <= CONFIRM_ABOVE) {
          void runArchive(target, !archived, { undoable: true, toastFailure: true, chosen: count }).catch(
            () => undefined,
          );
          return;
        }
        open(archived ? 'unarchive' : 'archive')(rows, actionScope);
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
  // The one question of Archive and Unarchive: it keeps its words while it closes
  const unarchiving = opened?.dialog === 'unarchive' || (opened === null && archived);
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
          // A group the chosen keywords are not in need not be named: each name counts for every keyword
          // (the API limits ids times names), so only the groups they hold are left, when those are known
          const held = opened === null ? null : groupsHeldBy(opened.target, rows, rowsComplete);
          const leaving = held === null ? others : others.filter((id) => held.has(id));
          const { matched } = await applyChange({
            ...(groupId === null ? {} : { add_group_ids: [groupId] }),
            ...(leaving.length === 0 ? {} : { remove_group_ids: leaving }),
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
        open={opened?.dialog === 'archive' || opened?.dialog === 'unarchive'}
        onOpenChange={(next) => (next ? undefined : close())}
        finalFocus={gridFocus}
        title={
          unarchiving
            ? t('unarchiveConfirm.title', { count: countOfOpened })
            : t('archiveConfirm.title', { count: countOfOpened })
        }
        description={unarchiving ? t('unarchiveConfirm.description') : t('archiveConfirm.description')}
        confirmLabel={
          unarchiving
            ? t('unarchiveConfirm.confirm', { count: countOfOpened })
            : t('archiveConfirm.confirm', { count: countOfOpened })
        }
        cancelLabel={common('cancel')}
        tone="neutral"
        error={confirmError}
        onConfirm={async () => {
          if (opened === null) return;
          try {
            await runArchive(opened.target, !unarchiving, {
              undoable: true,
              toastFailure: false,
              chosen: opened.count,
            });
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
            await runDelete(opened.target, opened.count);
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
