'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { projectsQuery, refreshPeople, ROLES, type AccessChoice } from './workspace-queries';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { RadioGroup } from '@/components/ui/radio-group';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import type { Member, Role } from '@/lib/api/types';
import { useFreshSession } from '@/lib/session/fresh-session';
import { useMe } from '@/lib/session/use-me';

const CHANGE = apiMutation('patch', '/api/v1/workspaces/{workspace_id}/members/{user_id}');
/** Roles that always see every project: the API refuses a project list for them. */
const UNSCOPED: readonly Role[] = ['owner', 'admin'];

export interface MemberDialogProps {
  workspaceId: string;
  /** The member being changed; the dialog is closed while it is `null`. */
  member: Member | null;
  /** Whether the person changing is an owner: only an owner grants `owner`. */
  callerIsOwner: boolean;
  onClose: () => void;
}

/**
 * "Change role and access" (20 section 5.19.2): the member's role, each with what it may do, and the
 * projects they can open. A change of role or access needs a fresh session, so it may ask "Confirm it is
 * you" first.
 */
export function MemberDialog({ workspaceId, member, callerIsOwner, onClose }: MemberDialogProps): ReactNode {
  return member === null ? null : (
    <MemberForm
      // A new member starts the form again
      key={member.user.user_id}
      workspaceId={workspaceId}
      member={member}
      callerIsOwner={callerIsOwner}
      onClose={onClose}
    />
  );
}

function MemberForm({
  workspaceId,
  member,
  callerIsOwner,
  onClose,
}: {
  workspaceId: string;
  member: Member;
  callerIsOwner: boolean;
  onClose: () => void;
}): ReactNode {
  const t = useTranslations('workspaceSettings.members');
  const roles = useTranslations('common.roles');
  const common = useTranslations('common');
  const discard = useTranslations('account.discard');
  const queryClient = useQueryClient();
  const router = useRouter();
  const { user } = useMe();
  const withFresh = useFreshSession();
  const { mutationFn } = CHANGE;
  if (mutationFn === undefined) throw new Error('apiMutation gave no mutationFn');
  const change = useMutation({ ...CHANGE, mutationFn: withFresh(mutationFn) });
  const projects = useQuery(projectsQuery(workspaceId));
  const [role, setRole] = useState<Role>(member.role);
  const [access, setAccess] = useState<AccessChoice>(member.project_ids === null ? 'all' : 'some');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(member.project_ids ?? []));
  const [showErrors, setShowErrors] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  const scoped = !UNSCOPED.includes(role) && access === 'some';
  const projectIds = scoped ? [...chosen].sort() : null;
  const before = member.project_ids === null ? null : [...member.project_ids].sort();
  const roleChanged = role !== member.role;
  const accessChanged = JSON.stringify(projectIds) !== JSON.stringify(before);
  const dirty = roleChanged || accessChanged;
  // A list is checked only when it is sent: a member kept at no projects can still get a new role
  const noneChosen = scoped && accessChanged && chosen.size === 0;

  const roleOptions = ROLES.filter((option) => callerIsOwner || option !== 'owner').map((option) => ({
    value: option,
    label: roles(option),
    description: t(`roleDescriptions.${option}`),
  }));

  const submit = async (): Promise<void> => {
    setShowErrors(true);
    if (noneChosen || change.isPending) return;
    setAlert(null);
    try {
      // Only what changed is sent: an unchanged project list is kept as it is, not judged again
      await change.mutateAsync({
        params: { path: { workspace_id: workspaceId, user_id: member.user.user_id } },
        body: { ...(roleChanged ? { role } : {}), ...(accessChanged ? { project_ids: projectIds } : {}) },
      });
      refreshPeople(queryClient, workspaceId);
      toast({
        type: 'success',
        title: roleChanged
          ? t('dialog.saved', { name: member.user.name, role: roles(role) })
          : t('dialog.savedAccess', { name: member.user.name }),
      });
      onClose();
      // A change to one's own role changes what this page may show: the server renders it again
      if (member.user.user_id === user.user_id) router.refresh();
    } catch (error) {
      // The person cancelled "Confirm it is you": nothing was sent, the dialog stays as it was
      if (isApiProblem(error, 'fresh_session_required')) return;
      if (isApiProblem(error, 'not_found')) {
        // Removed meanwhile, by someone else: there is nothing left to change
        toast({ type: 'info', title: t('dialog.gone', { name: member.user.name }) });
        refreshPeople(queryClient, workspaceId);
        onClose();
        return;
      }
      if (isApiProblem(error, 'last_owner')) setAlert(t('dialog.lastOwner'));
      else if (isApiProblem(error, 'forbidden')) setAlert(t('dialog.forbidden'));
      else if (isApiProblem(error, 'validation_failed')) setAlert(t('dialog.projectUnknown'));
      else setAlert(t('dialog.failed'));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !change.isPending) onClose();
      }}
      size="md"
      dirty={dirty}
      discard={{
        title: discard('title'),
        description: t('dialog.discardDescription'),
        keepEditingLabel: discard('keepEditing'),
        discardLabel: discard('discard'),
      }}
    >
      <form
        noValidate
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <DialogHeader
          title={t('dialog.title')}
          description={t('dialog.description', { name: member.user.name, email: member.user.email })}
          closeLabel={common('close')}
        />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          <RadioGroup<Role> legend={t('dialog.role')} value={role} onValueChange={setRole} options={roleOptions} />
          {UNSCOPED.includes(role) ? (
            <p className="type-meta">{t('dialog.accessAlways')}</p>
          ) : (
            <RadioGroup<AccessChoice>
              legend={t('dialog.access')}
              value={access}
              onValueChange={setAccess}
              options={[
                { value: 'all', label: t('dialog.accessAll'), description: t('dialog.accessAllHint') },
                { value: 'some', label: t('dialog.accessSome'), description: t('dialog.accessSomeHint') },
              ]}
            />
          )}
          {scoped ? (
            <ProjectChecklist
              workspaceId={workspaceId}
              chosen={chosen}
              onChange={setChosen}
              error={showErrors && noneChosen ? t('dialog.projectsRequired') : null}
              loadFailed={projects.isError}
            />
          ) : null}
        </DialogBody>
        <DialogFooter
          secondary={
            <DialogClose>
              <Button type="button" variant="secondary">
                {common('cancel')}
              </Button>
            </DialogClose>
          }
          primary={
            <Button type="submit" variant="primary" loading={change.isPending} disabled={!dirty}>
              {t('dialog.save')}
            </Button>
          }
        />
      </form>
    </Dialog>
  );
}

/** The workspace's projects as checkboxes, for a member limited to some of them. */
export function ProjectChecklist({
  workspaceId,
  chosen,
  onChange,
  error,
  loadFailed,
}: {
  workspaceId: string;
  chosen: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
  error: string | null;
  loadFailed: boolean;
}): ReactNode {
  const t = useTranslations('workspaceSettings.members');
  const projects = useQuery(projectsQuery(workspaceId));
  if (loadFailed) return <FormAlert message={t('dialog.projectsLoadFailed')} />;
  // Projects the member keeps that the list no longer shows (archived or deleted) still count
  const listed = new Set((projects.data?.data ?? []).map((project) => project.project_id));
  const hidden = projects.isPending ? 0 : [...chosen].filter((id) => !listed.has(id)).length;
  return (
    <fieldset className="flex flex-col gap-2" aria-busy={projects.isPending}>
      <legend className="mb-2 type-label">{t('dialog.projects')}</legend>
      {(projects.data?.data ?? []).map((project) => (
        <Checkbox
          key={project.project_id}
          label={project.name}
          checked={chosen.has(project.project_id)}
          onCheckedChange={(checked) => {
            const next = new Set(chosen);
            if (checked) next.add(project.project_id);
            else next.delete(project.project_id);
            onChange(next);
          }}
        />
      ))}
      {hidden === 0 ? null : <p className="type-meta">{t('dialog.archivedProjects', { count: hidden })}</p>}
      {error === null ? null : (
        <p role="alert" className="type-meta text-negative-text">
          {error}
        </p>
      )}
    </fieldset>
  );
}
