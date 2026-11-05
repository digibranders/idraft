'use client';

import { useQueryClient } from '@tanstack/react-query';
import { PanelRightOpen, Pencil, Plus, RefreshCw, Trash2, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactElement, type ReactNode } from 'react';

import { NOT_GROUPED, type GroupedRow } from './grouped-rows';
import type { CheckNowResult } from '../check-now/use-check-now';
import type { GroupChoice } from '../groups/group-choices';
import { useChangeGroup, useDeleteGroup, useGroupNameCheck } from '../groups/group-mutations';
import { groupRefusal } from '../groups/group-refusals';
import { refreshKeywords, type ProjectScope } from '../rankings-queries';
import { refreshGroups, useKeywordGroups } from '../taxonomy-queries';
import type { RecordAction } from '@/components/app/data-table/types';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import type { MenuItemDef } from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import type { KeywordGroup } from '@/lib/api/types';

/** A group an action reaches: its id ("Not grouped" is `NOT_GROUPED`), its label, and its keywords' tracked ids. */
export interface GroupTarget {
  groupId: string;
  label: string;
  /** Both devices of every keyword of the group in view. */
  memberIds: readonly string[];
}

export interface GroupActionsOptions {
  scope: ProjectScope;
  /** `keywords:write`: Add keywords, Rename and Delete. */
  canWrite: boolean;
  checkNow: Pick<CheckNowResult, 'enabled' | 'reasonFor' | 'check' | 'checking'>;
  onOpen: (groupId: string) => void;
  /** Opens Add keywords with the group chosen. */
  onAddKeywords: (group: GroupChoice) => void;
  /** After the group was deleted. */
  onDeleted: (groupId: string) => void;
}

export interface GroupActions {
  /** The menu of a group row. */
  rowActions: (target: GroupTarget) => RecordAction<GroupedRow>[];
  /** The drawer's frequent command, Check now; `null` when the person may not trigger runs. */
  checkNowButton: (target: GroupTarget) => ReactNode;
  /** The drawer's More menu: Add keywords, Rename group, Delete group. */
  moreItems: (target: GroupTarget) => MenuItemDef[];
  /** The rename dialog and the delete question. */
  dialogs: ReactNode;
}

interface GroupItem {
  id: string;
  label: string;
  icon: LucideIcon;
  group: RecordAction<GroupedRow>['group'];
  disabledReason: string | null;
  run: () => void;
}

/** The groups under a group, at any depth, in the flat list. */
function subgroupCount(groups: readonly KeywordGroup[], groupId: string): number {
  const under = new Set([groupId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const group of groups) {
      if (group.parent_id !== null && under.has(group.parent_id) && !under.has(group.group_id)) {
        under.add(group.group_id);
        grew = true;
      }
    }
  }
  return under.size - 1;
}

/**
 * What can be done to a group of the By group view, from its row's menu and from its drawer (the mock's group
 * menu): open it, check its keywords now, add keywords to it, rename it and delete it. "Not grouped" is no
 * group, so it can only be opened and checked. The writes are those of Manage groups.
 */
export function useGroupActions({
  scope,
  canWrite,
  checkNow,
  onOpen,
  onAddKeywords,
  onDeleted,
}: GroupActionsOptions): GroupActions {
  const t = useTranslations('rankings.grouped');
  const checkT = useTranslations('rankings.checkNow');
  const manage = useTranslations('rankings.groups.manage');
  const refusals = useTranslations('rankings.groups.refusals');
  const groups = useKeywordGroups(scope).data?.data ?? [];
  const deleteGroup = useDeleteGroup(scope);
  const [renaming, setRenaming] = useState<KeywordGroup | null>(null);
  const [deleting, setDeleting] = useState<KeywordGroup | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const stored = (groupId: string): KeywordGroup | null => groups.find((group) => group.group_id === groupId) ?? null;
  const checkReason = (target: GroupTarget): string | null =>
    target.memberIds.length === 0 ? t('noKeywordsToCheck') : checkNow.reasonFor(new Set(target.memberIds));
  const itemsOf = (target: GroupTarget): GroupItem[] => {
    const group = target.groupId === NOT_GROUPED ? null : stored(target.groupId);
    const items: GroupItem[] = [
      {
        id: 'open-group',
        label: t('openGroup'),
        icon: PanelRightOpen,
        group: 'open',
        disabledReason: null,
        run: () => onOpen(target.groupId),
      },
    ];
    if (checkNow.enabled) {
      items.push({
        id: 'check-now',
        label: checkT('action'),
        icon: RefreshCw,
        group: 'object',
        disabledReason: checkReason(target),
        run: () => checkNow.check(new Set(target.memberIds)),
      });
    }
    if (canWrite && group !== null) {
      items.push(
        {
          id: 'add-keywords',
          label: t('addKeywords'),
          icon: Plus,
          group: 'object',
          disabledReason: null,
          run: () =>
            onAddKeywords({
              kind: 'existing',
              key: group.group_id,
              groupId: group.group_id,
              path: group.path,
              count: group.keyword_count,
            }),
        },
        {
          id: 'rename-group',
          label: t('renameGroup'),
          icon: Pencil,
          group: 'object',
          disabledReason: null,
          run: () => setRenaming(group),
        },
        {
          id: 'delete-group',
          label: t('deleteGroup'),
          icon: Trash2,
          group: 'destructive',
          disabledReason: null,
          run: () => setDeleting(group),
        },
      );
    }
    return items;
  };

  const rowActions = (target: GroupTarget): RecordAction<GroupedRow>[] =>
    itemsOf(target).map((item) => ({
      id: item.id,
      label: item.label,
      icon: item.icon,
      group: item.group,
      disabledReason: item.disabledReason,
      onSelect: item.run,
    }));
  const moreItems = (target: GroupTarget): MenuItemDef[] =>
    itemsOf(target)
      .filter((item) => item.id !== 'open-group' && item.id !== 'check-now')
      .map((item) => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        ...(item.group === 'destructive' ? { tone: 'destructive' as const } : {}),
        onSelect: item.run,
      }));
  const checkNowButton = (target: GroupTarget): ReactNode => {
    if (!checkNow.enabled) return null;
    const reason = checkReason(target);
    return (
      <Tooltip content={reason ?? ''} disabled={reason === null}>
        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          disabled={reason !== null}
          focusableWhenDisabled
          loading={checkNow.checking}
          onClick={() => checkNow.check(new Set(target.memberIds))}
        >
          {checkT('action')}
        </Button>
      </Tooltip>
    );
  };

  const subgroups = deleting === null ? 0 : subgroupCount(groups, deleting.group_id);
  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    setDeleteError(null);
    try {
      await deleteGroup(deleting.group_id);
    } catch (error) {
      setDeleteError(groupRefusal(error, refusals).message);
      throw error;
    }
    toast({ type: 'success', title: manage('deleted', { name: deleting.name }) });
    onDeleted(deleting.group_id);
  };
  const dialogs = canWrite ? (
    <>
      {renaming === null ? null : (
        <RenameGroupDialog key={renaming.group_id} scope={scope} group={renaming} onClose={() => setRenaming(null)} />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDeleting(null);
            setDeleteError(null);
          }
        }}
        title={manage('deleteTitle', { name: deleting?.name ?? '' })}
        description={
          subgroups > 0 ? manage('deleteDescriptionWithSubgroups', { count: subgroups }) : manage('deleteDescription')
        }
        confirmLabel={subgroups > 0 ? manage('deleteConfirmWithSubgroups') : manage('deleteConfirm')}
        cancelLabel={manage('cancel')}
        onConfirm={confirmDelete}
        error={deleteError}
      />
    </>
  ) : null;

  return { rowActions, checkNowButton, moreItems, dialogs };
}

/** Renames one group: its name, not its path, in the words of Manage groups. */
function RenameGroupDialog({
  scope,
  group,
  onClose,
}: {
  scope: ProjectScope;
  group: KeywordGroup;
  onClose: () => void;
}): ReactElement {
  const manage = useTranslations('rankings.groups.manage');
  const refusals = useTranslations('rankings.groups.refusals');
  const common = useTranslations('common');
  const discard = useTranslations('account.discard');
  const queryClient = useQueryClient();
  const { change, pending } = useChangeGroup(scope);
  const nameProblem = useGroupNameCheck();
  const [name, setName] = useState(group.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setNameError(null);
    setAlert(null);
    const trimmed = name.trim();
    const problem = nameProblem(trimmed);
    if (problem !== null) {
      setNameError(problem);
      return;
    }
    if (trimmed === group.name) {
      onClose();
      return;
    }
    try {
      await change(group.group_id, { name: trimmed });
    } catch (error) {
      void refreshGroups(queryClient, scope);
      const refusal = groupRefusal(error, refusals);
      if (refusal.field === 'name') setNameError(refusal.message);
      else setAlert(refusal.message);
      return;
    }
    await refreshGroups(queryClient, scope);
    // Each keyword lists the paths of its groups, and the group's label is its path
    void refreshKeywords(queryClient, scope);
    toast({ type: 'success', title: manage('renamed', { name: trimmed }) });
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="sm"
      dirty={name.trim() !== group.name}
      discard={{
        title: discard('title'),
        description: manage('discardDescription'),
        keepEditingLabel: discard('keepEditing'),
        discardLabel: discard('discard'),
      }}
    >
      <form noValidate className="contents" onSubmit={(event) => void submit(event)}>
        <DialogHeader title={manage('renameOf', { name: group.name })} closeLabel={common('close')} />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          <Field invalid={nameError !== null}>
            <FieldLabel>{manage('name')}</FieldLabel>
            <Input
              aria-required
              autoComplete="off"
              value={name}
              onValueChange={(value) => {
                setName(value);
                setNameError(null);
              }}
            />
            {nameError === null ? null : <FieldError message={nameError} />}
          </Field>
        </DialogBody>
        <DialogFooter
          secondary={
            // Through the dialog, so a changed name is asked about first
            <DialogClose>
              <Button type="button" variant="secondary" disabled={pending}>
                {manage('cancel')}
              </Button>
            </DialogClose>
          }
          primary={
            <Button type="submit" variant="primary" loading={pending}>
              {manage('rename')}
            </Button>
          }
        />
      </form>
    </Dialog>
  );
}
