'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';

import { MAX_GROUP_DEPTH, MAX_GROUP_NAME } from './group-paths';
import { groupRefusal } from './group-refusals';
import { ancestorsOf, flattenGroups, moveTargets, subtreeIds, toTreeNodes, type GroupNode } from './group-tree';
import { refreshKeywords, type ProjectScope } from '../rankings-queries';
import { refreshGroups, useKeywordGroupTree } from '../taxonomy-queries';
import { InlineError } from '@/components/app/status/inline-error';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { TreeView } from '@/components/ui/tree-view';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { textLength } from '@/lib/text/length';

const CREATE = apiMutation('post', '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups');
const CHANGE = apiMutation(
  'patch',
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups/{group_id}',
);
const REMOVE = apiMutation(
  'delete',
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups/{group_id}',
);

const SKELETON_ROWS = 4;
/** The "Move under" choice for the top level: group ids are UUIDs, so this never names a group. */
const TOP_LEVEL = 'top-level';

/** What the inline form does: add a group (under a parent, or at the top), rename one, or move one. */
type GroupForm =
  { kind: 'add'; parent: GroupNode | null } | { kind: 'rename'; group: GroupNode } | { kind: 'move'; group: GroupNode };

/** The toolbar button that opened a form, to give focus back to it when the form closes. */
const openerOf = (form: GroupForm): string =>
  form.kind === 'add' ? (form.parent === null ? 'add-group' : 'add-subgroup') : form.kind;

/** The group a form is about: the one it renames or moves, or the parent a subgroup is added to. */
const formGroupId = (form: GroupForm): string | null =>
  form.kind === 'add' ? (form.parent?.group_id ?? null) : form.group.group_id;

export interface ManageGroupsDialogProps {
  scope: ProjectScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes when the dialog closes: the More actions button. */
  finalFocus: RefObject<HTMLElement | null>;
}

/**
 * Manage groups (16-drawers-dialogs-popovers.md section 4): a 560 px dialog over Rankings with the
 * project's groups as a tree and a toolbar that acts on the selected group. Add, rename and move are inline
 * forms inside the dialog, since a dialog never opens another one; only the delete confirmation stacks on
 * top. Every change is applied by its own form, so the dialog has no primary action of its own.
 */
export function ManageGroupsDialog({ scope, open, onOpenChange, finalFocus }: ManageGroupsDialogProps): ReactElement {
  const t = useTranslations('rankings.groups.manage');
  const discard = useTranslations('account.discard');
  // Whether an inline form holds a change that closing the dialog would lose
  const [dirty, setDirty] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      finalFocus={finalFocus}
      dirty={dirty}
      discard={{
        title: discard('title'),
        description: t('discardDescription'),
        keepEditingLabel: discard('keepEditing'),
        discardLabel: discard('discard'),
      }}
    >
      <ManageGroups scope={scope} onDirtyChange={setDirty} />
    </Dialog>
  );
}

function ManageGroups({
  scope,
  onDirtyChange,
}: {
  scope: ProjectScope;
  onDirtyChange: (dirty: boolean) => void;
}): ReactElement {
  const t = useTranslations('rankings.groups.manage');
  const refusals = useTranslations('rankings.groups.refusals');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const groups = useKeywordGroupTree(scope);
  const remove = useMutation(REMOVE);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // A group to bring into view when the refreshed tree contains it
  const [reveal, setReveal] = useState<string | null>(null);
  const [form, setForm] = useState<GroupForm | null>(null);
  const [deleting, setDeleting] = useState<GroupNode | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const firstButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const tree = groups.data?.data ?? [];
  const all = flattenGroups(tree);
  const group = all.find((candidate) => candidate.group_id === selected) ?? null;
  // Opens the branch a new or moved group sits in, once the refreshed tree shows it there
  if (reveal !== null && all.some((candidate) => candidate.group_id === reveal)) {
    const above = ancestorsOf(tree, reveal);
    setReveal(null);
    if (above.some((id) => !expanded.has(id))) setExpanded(new Set([...expanded, ...above]));
  }
  // A form is closed when its group is gone, such as a group a teammate deleted meanwhile
  if (form !== null && groups.data !== undefined) {
    const formGroup = formGroupId(form);
    if (formGroup !== null && !all.some((candidate) => candidate.group_id === formGroup)) setForm(null);
  }
  const atDepthLimit = group !== null && ancestorsOf(tree, group.group_id).length + 1 >= MAX_GROUP_DEPTH;

  /** Closes the form and gives focus back to the toolbar button that opened it. */
  const closeForm = (): void => {
    const opener = form === null ? null : openerOf(form);
    setForm(null);
    if (opener !== null) toolbar.current?.querySelector<HTMLElement>(`[data-opener="${opener}"]`)?.focus();
  };

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync({
        params: {
          path: { workspace_id: scope.workspaceId, project_id: scope.projectId, group_id: deleting.group_id },
        },
      });
    } catch (error) {
      // A group deleted meanwhile is gone, which is what was asked
      if (!isApiProblem(error, 'not_found')) {
        setDeleteError(groupRefusal(error, refusals).message);
        throw error;
      }
    }
    // A form for the deleted group, or one under it, has nothing left to change
    const formGroup = form === null ? null : formGroupId(form);
    if (formGroup !== null && subtreeIds(deleting).has(formGroup)) setForm(null);
    await refreshGroups(queryClient, scope);
    // The keyword list shows each keyword's groups, and a delete or a move changes them
    void refreshKeywords(queryClient, scope);
    setSelected(deleting.parent_id);
    toast({ type: 'success', title: t('deleted', { name: deleting.name }) });
  };

  // A read that fails after the tree was shown keeps the tree: what it shows is old, not gone
  if (groups.isError && groups.data === undefined) {
    return (
      <>
        <DialogHeader title={t('title')} description={t('description')} closeLabel={common('close')} />
        <DialogBody>
          <InlineError
            title={t('loadFailed')}
            reason={refusals('failed')}
            errorId={null}
            onRetry={() => void groups.refetch()}
            retrying={groups.isFetching}
            retryLabel={common('retry')}
          />
        </DialogBody>
        <DialogFooter primary={<CloseButton label={t('close')} />} />
      </>
    );
  }

  const subgroups = deleting === null ? 0 : subtreeIds(deleting).size - 1;
  return (
    <>
      <DialogHeader title={t('title')} description={t('description')} closeLabel={common('close')} />
      <DialogBody>
        <div ref={toolbar} role="group" aria-label={t('toolbar')} className="flex flex-wrap gap-2">
          <Button
            ref={firstButton}
            data-opener="add-group"
            icon={Plus}
            size="sm"
            onClick={() => setForm({ kind: 'add', parent: null })}
          >
            {t('addGroup')}
          </Button>
          <ToolbarButton
            data-opener="add-subgroup"
            reason={
              group === null ? t('selectGroupFirst') : atDepthLimit ? t('depthLimit', { max: MAX_GROUP_DEPTH }) : null
            }
            onPress={() => {
              if (group !== null) setForm({ kind: 'add', parent: group });
            }}
          >
            {group === null ? t('addSubgroup') : t('addSubgroupOf', { name: group.name })}
          </ToolbarButton>
          <ToolbarButton
            data-opener="rename"
            reason={group === null ? t('selectGroupFirst') : null}
            onPress={() => {
              if (group !== null) setForm({ kind: 'rename', group });
            }}
          >
            {t('rename')}
          </ToolbarButton>
          <ToolbarButton
            data-opener="move"
            reason={group === null ? t('selectGroupFirst') : null}
            onPress={() => {
              if (group !== null) setForm({ kind: 'move', group });
            }}
          >
            {t('moveTo')}
          </ToolbarButton>
          <ToolbarButton
            ref={deleteButton}
            variant="destructive"
            reason={group === null ? t('selectGroupFirst') : null}
            onPress={() => {
              if (group !== null) setDeleting(group);
            }}
          >
            {t('delete')}
          </ToolbarButton>
        </div>
        {form === null ? null : (
          <GroupFormRow
            key={`${form.kind}:${form.kind === 'add' ? (form.parent?.group_id ?? '') : form.group.group_id}`}
            scope={scope}
            form={form}
            groups={all}
            onDirtyChange={onDirtyChange}
            onCancel={closeForm}
            onDone={(changed) => {
              setSelected(changed);
              setReveal(changed);
              announce(t('selectedAfterChange'));
              closeForm();
            }}
          />
        )}
        <div className="rounded-lg border border-border bg-surface p-1">
          {groups.isPending ? (
            <div className="flex flex-col gap-2 p-2" aria-busy="true">
              {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <Skeleton key={index} shape="text-14" widthPct={index % 2 === 0 ? 48 : 64} />
              ))}
            </div>
          ) : tree.length === 0 ? (
            <p className="p-3 type-body text-foreground-secondary">{t('empty')}</p>
          ) : (
            <TreeView
              label={t('treeLabel')}
              nodes={toTreeNodes(tree, (count) => t('count', { count }))}
              selected={selected}
              onSelect={(id) => {
                // A rename or move form belongs to the group it was opened for
                if (form !== null && form.kind !== 'add' && form.group.group_id !== id) setForm(null);
                setSelected(id);
              }}
              expanded={expanded}
              onExpandedChange={setExpanded}
            />
          )}
        </div>
      </DialogBody>
      <DialogFooter primary={<CloseButton label={t('close')} />} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDeleting(null);
            setDeleteError(null);
          }
        }}
        // Back to Delete, which opened the question; once a group is deleted none is selected, and Delete
        // stays focusable with its reason
        finalFocus={deleteButton}
        title={t('deleteTitle', { name: deleting?.name ?? '' })}
        description={subgroups > 0 ? t('deleteDescriptionWithSubgroups', { count: subgroups }) : t('deleteDescription')}
        confirmLabel={subgroups > 0 ? t('deleteConfirmWithSubgroups') : t('deleteConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={confirmDelete}
        error={deleteError}
      />
    </>
  );
}

interface ToolbarButtonProps {
  children: ReactNode;
  /** Why the action waits, or `null` when it is available. It stays focusable and says why (08 section 1). */
  reason: string | null;
  onPress: () => void;
  variant?: 'ghost' | 'destructive';
  ref?: Ref<HTMLButtonElement>;
  'data-opener'?: string;
}

/** A button of the groups toolbar: a ghost button, or a destructive one, that is described rather than lost while it waits. */
function ToolbarButton({
  children,
  reason,
  onPress,
  variant = 'ghost',
  ref,
  ...rest
}: ToolbarButtonProps): ReactElement {
  const button = (
    <Button
      {...rest}
      ref={ref}
      size="sm"
      variant={variant}
      disabled={reason !== null}
      focusableWhenDisabled
      onClick={onPress}
    >
      {children}
    </Button>
  );
  return reason === null ? button : <Tooltip content={reason}>{button}</Tooltip>;
}

function CloseButton({ label }: { label: string }): ReactElement {
  return (
    <DialogClose>
      <Button type="button" variant="secondary">
        {label}
      </Button>
    </DialogClose>
  );
}

interface GroupFormRowProps {
  scope: ProjectScope;
  form: GroupForm;
  /** Every group, depth first. */
  groups: readonly GroupNode[];
  /** Whether the form holds a change that differs from where it started. */
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  /** The group the change leaves selected. */
  onDone: (groupId: string) => void;
}

/**
 * The inline compact form of one change (10-forms.md section 16): a name for add and rename, a new parent
 * for move. Enter applies, Escape cancels, and errors show after Apply, not while typing.
 */
function GroupFormRow({ scope, form, groups, onDirtyChange, onCancel, onDone }: GroupFormRowProps): ReactElement {
  const t = useTranslations('rankings.groups.manage');
  const pickers = useTranslations('rankings.groups');
  const refusals = useTranslations('rankings.groups.refusals');
  const queryClient = useQueryClient();
  const create = useMutation(CREATE);
  const change = useMutation(CHANGE);
  const formElement = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(form.kind === 'rename' ? form.group.name : '');
  const [parent, setParent] = useState<string>(form.kind === 'move' ? (form.group.parent_id ?? TOP_LEVEL) : TOP_LEVEL);
  const [nameError, setNameError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const busy = create.isPending || change.isPending;
  const project = { workspace_id: scope.workspaceId, project_id: scope.projectId };

  const dirty =
    form.kind === 'move'
      ? parent !== (form.group.parent_id ?? TOP_LEVEL)
      : name.trim() !== (form.kind === 'rename' ? form.group.name : '');
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  // A form that closes holds nothing any more
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  // The field takes focus when the form opens
  useEffect(() => {
    formElement.current?.querySelector<HTMLElement>('input, [role="combobox"]')?.focus();
  }, []);

  // Escape cancels the form, not the dialog around it. A list open in the form takes its own Escape first;
  // a popup in a portal sits outside the form, so its keys never reach it.
  const latestCancel = useRef(onCancel);
  useEffect(() => {
    latestCancel.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    const element = formElement.current;
    if (element === null) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (event.target instanceof Element && event.target.closest('[aria-expanded="true"]') !== null) return;
      event.preventDefault();
      event.stopPropagation();
      latestCancel.current();
    };
    element.addEventListener('keydown', onKeyDown);
    return () => element.removeEventListener('keydown', onKeyDown);
  }, []);

  const nameProblem = (text: string): string | null => {
    if (text === '') return t('nameRequired');
    if (textLength(text) > MAX_GROUP_NAME) return pickers('pathTooLong');
    return text.includes('/') ? refusals('slash') : null;
  };

  /** What the form sends and the group it leaves selected, or `null` when nothing changes. */
  const send = async (): Promise<string | null> => {
    if (form.kind === 'add') {
      const trimmed = name.trim();
      const added = await create.mutateAsync({
        params: { path: project },
        body: { name: trimmed, parent_id: form.parent?.group_id ?? null },
      });
      toast({ type: 'success', title: t('added', { name: trimmed }) });
      return added.data.group_id;
    }
    if (form.kind === 'rename') {
      const trimmed = name.trim();
      if (trimmed === form.group.name) return null;
      await change.mutateAsync({
        params: { path: { ...project, group_id: form.group.group_id } },
        body: { name: trimmed },
      });
      toast({ type: 'success', title: t('renamed', { name: trimmed }) });
      return form.group.group_id;
    }
    if (parent === (form.group.parent_id ?? TOP_LEVEL)) return null;
    await change.mutateAsync({
      params: { path: { ...project, group_id: form.group.group_id } },
      body: { parent_id: parent === TOP_LEVEL ? null : parent },
    });
    toast({ type: 'success', title: t('moved', { name: form.group.name }) });
    return form.group.group_id;
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setNameError(null);
    setAlert(null);
    if (form.kind !== 'move') {
      const problem = nameProblem(name.trim());
      if (problem !== null) {
        setNameError(problem);
        formElement.current?.querySelector<HTMLElement>('input')?.focus();
        return;
      }
    }
    let changed: string | null;
    try {
      changed = await send();
    } catch (error) {
      // Whatever was refused, the list may have moved on: show the groups as they are
      void refreshGroups(queryClient, scope);
      const refusal = groupRefusal(error, refusals);
      if (refusal.field === 'name') {
        setNameError(refusal.message);
        formElement.current?.querySelector<HTMLElement>('input')?.focus();
      } else {
        setAlert(refusal.message);
      }
      return;
    }
    if (changed === null) {
      onCancel();
      return;
    }
    await refreshGroups(queryClient, scope);
    // The keyword list shows each keyword's groups, and a delete or a move changes them
    void refreshKeywords(queryClient, scope);
    onDone(changed);
  };

  const parentOptions = (): { value: string; label: string }[] => {
    if (form.kind !== 'move') return [];
    // Not the group or its subgroups, and not a group so deep that the subtree would pass 10 levels
    return [
      { value: TOP_LEVEL, label: t('topLevel') },
      ...moveTargets(groups, form.group).map((candidate) => ({ value: candidate.group_id, label: candidate.path })),
    ];
  };

  const label =
    form.kind === 'add'
      ? form.parent === null
        ? t('addGroup')
        : t('addSubgroupOf', { name: form.parent.name })
      : form.kind === 'rename'
        ? t('renameOf', { name: form.group.name })
        : t('moveUnderOf', { name: form.group.name });
  return (
    <form
      ref={formElement}
      noValidate
      aria-label={label}
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-2"
    >
      {alert === null ? null : <FormAlert message={alert} />}
      <div className="flex flex-wrap items-start gap-1.5">
        <div className="min-w-48 flex-1">
          {form.kind === 'move' ? (
            <Field>
              <FieldLabel display="visually-hidden">{label}</FieldLabel>
              <Select<string>
                size="sm"
                value={parent}
                onValueChange={setParent}
                placeholder={t('newParent')}
                options={parentOptions()}
              />
            </Field>
          ) : (
            <Field invalid={nameError !== null}>
              <FieldLabel display="visually-hidden">{form.kind === 'rename' ? label : t('name')}</FieldLabel>
              <Input
                size="sm"
                aria-required
                autoComplete="off"
                placeholder={t('name')}
                value={name}
                onValueChange={(value) => {
                  setName(value);
                  setNameError(null);
                }}
              />
              {nameError === null ? null : <FieldError message={nameError} />}
            </Field>
          )}
        </div>
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          {t('apply')}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
