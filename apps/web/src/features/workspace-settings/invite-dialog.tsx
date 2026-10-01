'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';

import { ProjectChecklist } from './member-dialog';
import { invitationsQuery, projectsQuery, ROLES, type AccessChoice } from './workspace-queries';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { toast } from '@/components/ui/toast';
import { isApiProblem, retryMinutes } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import type { Role } from '@/lib/api/types';
import { useFreshSession } from '@/lib/session/fresh-session';

const INVITE = apiMutation('post', '/api/v1/workspaces/{workspace_id}/invitations');
const UNSCOPED: readonly Role[] = ['owner', 'admin'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_ROLE: Role = 'viewer';

export interface InviteDialogProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether the person inviting is an owner: only an owner invites an owner. */
  callerIsOwner: boolean;
}

/**
 * "Invite people" (20 section 5.19.2): an address, a role and the projects they will open. The API emails
 * the link; the dialog never shows it. Inviting an owner or an admin needs a fresh session.
 */
export function InviteDialog({ workspaceId, open, onOpenChange, callerIsOwner }: InviteDialogProps): ReactNode {
  return open ? (
    <InviteForm workspaceId={workspaceId} callerIsOwner={callerIsOwner} onClose={() => onOpenChange(false)} />
  ) : null;
}

function InviteForm({
  workspaceId,
  callerIsOwner,
  onClose,
}: {
  workspaceId: string;
  callerIsOwner: boolean;
  onClose: () => void;
}): ReactNode {
  const t = useTranslations('workspaceSettings.invitations');
  const members = useTranslations('workspaceSettings.members');
  const roles = useTranslations('common.roles');
  const common = useTranslations('common');
  const discard = useTranslations('account.discard');
  const queryClient = useQueryClient();
  const withFresh = useFreshSession();
  const { mutationFn } = INVITE;
  if (mutationFn === undefined) throw new Error('apiMutation gave no mutationFn');
  const invite = useMutation({ ...INVITE, mutationFn: withFresh(mutationFn) });
  const projects = useQuery(projectsQuery(workspaceId));
  const emailId = useId();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(DEFAULT_ROLE);
  const [access, setAccess] = useState<AccessChoice>('all');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);

  const scoped = !UNSCOPED.includes(role) && access === 'some';
  const noneChosen = scoped && chosen.size === 0;
  const trimmed = email.trim();
  const localEmailError =
    trimmed === '' ? t('dialog.emailRequired') : EMAIL.test(trimmed) ? null : t('dialog.emailInvalid');
  const shownEmailError = emailError ?? (submitted ? localEmailError : null);
  const dirty = trimmed !== '' || role !== DEFAULT_ROLE || access !== 'all' || chosen.size > 0;

  const roleOptions = ROLES.filter((option) => callerIsOwner || option !== 'owner').map((option) => ({
    value: option,
    label: roles(option),
    description: members(`roleDescriptions.${option}`),
  }));

  const submit = async (): Promise<void> => {
    setSubmitted(true);
    setEmailError(null);
    if (localEmailError !== null) {
      document.getElementById(emailId)?.focus();
      return;
    }
    if (noneChosen || invite.isPending) return;
    setAlert(null);
    try {
      await invite.mutateAsync({
        params: { path: { workspace_id: workspaceId } },
        body: { email: trimmed, role, project_ids: scoped ? [...chosen].sort() : null },
      });
      void queryClient.invalidateQueries({ queryKey: invitationsQuery(workspaceId).queryKey });
      toast({ type: 'success', title: t('dialog.sent', { email: trimmed }) });
      onClose();
    } catch (error) {
      if (isApiProblem(error, 'fresh_session_required')) return;
      if (isApiProblem(error, 'duplicate')) {
        setEmailError(t('dialog.duplicate'));
        document.getElementById(emailId)?.focus();
      } else if (isApiProblem(error, 'validation_failed') && error.errors.some((item) => item.path === 'email')) {
        setEmailError(t('dialog.emailInvalid'));
        document.getElementById(emailId)?.focus();
      } else if (isApiProblem(error, 'rate_limited')) {
        setAlert(t('dialog.rateLimited', { minutes: retryMinutes(error) }));
      } else if (isApiProblem(error, 'forbidden')) {
        setAlert(t('dialog.forbidden'));
      } else if (isApiProblem(error, 'validation_failed')) {
        setAlert(members('dialog.projectUnknown'));
      } else {
        setAlert(t('dialog.failed'));
      }
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !invite.isPending) onClose();
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
        <DialogHeader title={t('dialog.title')} description={t('dialog.description')} closeLabel={common('close')} />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          <Field invalid={shownEmailError !== null}>
            <FieldLabel>{t('dialog.email')}</FieldLabel>
            <Input
              id={emailId}
              type="email"
              autoComplete="off"
              spellCheck={false}
              aria-required
              value={email}
              onValueChange={(value) => {
                setEmail(value);
                setEmailError(null);
              }}
            />
            {shownEmailError === null ? null : <FieldError message={shownEmailError} />}
          </Field>
          <RadioGroup<Role>
            legend={members('dialog.role')}
            value={role}
            onValueChange={setRole}
            options={roleOptions}
          />
          {UNSCOPED.includes(role) ? (
            <p className="type-meta">{members('dialog.accessAlways')}</p>
          ) : (
            <RadioGroup<AccessChoice>
              legend={members('dialog.access')}
              value={access}
              onValueChange={setAccess}
              options={[
                { value: 'all', label: members('dialog.accessAll'), description: members('dialog.accessAllHint') },
                { value: 'some', label: members('dialog.accessSome'), description: members('dialog.accessSomeHint') },
              ]}
            />
          )}
          {scoped ? (
            <ProjectChecklist
              workspaceId={workspaceId}
              chosen={chosen}
              onChange={setChosen}
              error={submitted && noneChosen ? members('dialog.projectsRequired') : null}
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
            <Button type="submit" variant="primary" loading={invite.isPending}>
              {t('dialog.send')}
            </Button>
          }
        />
      </form>
    </Dialog>
  );
}
