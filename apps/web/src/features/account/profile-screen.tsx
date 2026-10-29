'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormField } from '@/components/app/forms/form-field';
import { DiscardChangesDialog } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { SaveBar } from '@/components/ui/save-bar';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import type { MeMembership } from '@/lib/api/types';
import { applyServerErrors } from '@/lib/forms';
import { useLeaveGuard } from '@/lib/navigation/use-leave-guard';
import { meQuery } from '@/lib/session/me-query';
import { useMe } from '@/lib/session/use-me';

/** The API's limit on a name (19 section 3.2, `ProfileUpdate`). */
const MAX_NAME_LENGTH = 120;

interface ProfileValues {
  name: string;
}

/**
 * Settings > Profile (11-navigation.md section 5): the name through the save bar (`PATCH /me`), the email
 * read-only with its verification state, and the workspaces the person belongs to. Leaving with an
 * unsaved name asks first.
 */
export function ProfileScreen(): ReactNode {
  const t = useTranslations('account');
  const { user, memberships } = useMe();
  return (
    <section aria-labelledby="profile-title" className="flex flex-col gap-5">
      <div>
        <h2 id="profile-title" className="type-section-title">
          {t('profile.title')}
        </h2>
        <p className="mt-1 type-meta">{t('profile.description')}</p>
      </div>
      <NameForm name={user.name} />
      <EmailField email={user.email} verified={user.email_verified} />
      <Workspaces memberships={memberships} />
    </section>
  );
}

function NameForm({ name }: { name: string }): ReactNode {
  const t = useTranslations('account');
  const queryClient = useQueryClient();
  const formId = useId();
  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, { error: t('profile.nameRequired') })
          .max(MAX_NAME_LENGTH, { error: t('profile.nameTooLong', { max: MAX_NAME_LENGTH }) }),
      }),
    [t],
  );
  const form = useForm<ProfileValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { name },
  });
  const update = useMutation(apiMutation('patch', '/api/v1/me'));
  const dirty = form.formState.isDirty;
  const guard = useLeaveGuard(dirty);
  // A name saved elsewhere (another tab) is the new baseline, unless the person is typing one
  useEffect(() => {
    if (!form.formState.isDirty) form.reset({ name });
  }, [name, form]);

  const submit = form.handleSubmit(async (values) => {
    if (update.isPending) return;
    try {
      const saved = await update.mutateAsync({ body: { name: values.name.trim() } });
      queryClient.setQueryData(meQuery().queryKey, saved);
      form.reset({ name: saved.data.user.name });
      // A save says so in a polite live region, not a toast (10-forms.md section 13.2)
      announce(t('profile.saved'));
    } catch (error) {
      if (isApiProblem(error, 'validation_failed')) {
        const rest = applyServerErrors(form, error.errors, {
          fields: ['name'],
          messages: {
            string_too_short: t('profile.nameRequired'),
            string_too_long: t('profile.nameTooLong', { max: MAX_NAME_LENGTH }),
          },
        });
        if (rest.length === 0) return;
      }
      form.setError('root', { type: 'server', message: t('profile.saveFailed') });
    }
  });

  const rootError = form.formState.errors.root?.message;
  return (
    <>
      <form id={formId} noValidate className="flex max-w-90 flex-col gap-4" onSubmit={(event) => void submit(event)}>
        {rootError === undefined ? null : <FormAlert message={rootError} />}
        <FormField
          control={form.control}
          name="name"
          label={t('profile.name')}
          render={(field) => (
            <Input {...field.controlProps} autoComplete="name" value={field.value} onValueChange={field.onChange} />
          )}
        />
      </form>
      <SaveBar
        visible={dirty}
        form={formId}
        summary={t('saveBar.summary', { count: 1 })}
        saving={update.isPending}
        onDiscard={() => form.reset({ name })}
        discardLabel={t('saveBar.discard')}
        saveLabel={t('saveBar.save')}
      />
      <DiscardChangesDialog
        open={guard.pending !== null}
        title={t('discard.title')}
        description={t('discard.description')}
        keepEditingLabel={t('discard.keepEditing')}
        discardLabel={t('discard.discard')}
        onKeepEditing={guard.stay}
        onDiscard={() => {
          form.reset({ name });
          guard.leave();
        }}
      />
    </>
  );
}

function EmailField({ email, verified }: { email: string; verified: boolean }): ReactNode {
  const t = useTranslations('account.profile');
  const request = useMutation(apiMutation('post', '/api/v1/auth/verify-email/request'));
  const send = (): void => {
    request
      .mutateAsync({ body: { email } })
      .then(() => toast({ type: 'success', title: t('verificationSent', { email }) }))
      .catch(() => toast({ type: 'error', title: t('verificationFailed') }));
  };
  return (
    <div className="flex max-w-90 flex-col gap-1.5">
      {/* A read-only fact, so a term and its value (10-forms.md section 13.1), not a disabled field */}
      <dl className="flex flex-col gap-1.5">
        <dt className="type-label">{t('email')}</dt>
        <dd className="flex min-h-control items-center gap-2 rounded-md bg-surface-subtle px-3 type-body text-foreground">
          <span className="truncate">{email}</span>
          <span className="ml-auto">
            {verified ? (
              <Badge tone="positive">{t('verified')}</Badge>
            ) : (
              <Badge tone="warning">{t('notVerified')}</Badge>
            )}
          </span>
        </dd>
      </dl>
      <p className="type-meta">{t('emailHint')}</p>
      {verified ? null : (
        <Button variant="secondary" size="sm" className="self-start" loading={request.isPending} onClick={send}>
          {t('sendVerification')}
        </Button>
      )}
    </div>
  );
}

function Workspaces({ memberships }: { memberships: readonly MeMembership[] }): ReactNode {
  const t = useTranslations('account.profile');
  const roles = useTranslations('common.roles');
  const open = memberships.filter((membership) => membership.workspace.status !== 'deleting');
  return (
    <div className="pt-2">
      <h3 className="type-subsection-title">{t('workspaces')}</h3>
      <p className="mt-1 mb-3 type-meta">{t('workspacesDescription')}</p>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full type-table">
          <thead className="bg-surface-subtle">
            <tr>
              <th scope="col" className="h-row-header px-4 text-left type-table-header">
                {t('workspace')}
              </th>
              <th scope="col" className="h-row-header px-3 text-left type-table-header">
                {t('role')}
              </th>
              <th scope="col" className="h-row-header px-4 text-left type-table-header">
                {t('access')}
              </th>
            </tr>
          </thead>
          <tbody>
            {open.map((membership) => (
              <tr key={membership.workspace.workspace_id} className="h-row-compact border-t border-border-subtle">
                <th scope="row" className="px-4 text-left font-normal whitespace-nowrap text-foreground">
                  {membership.workspace.name}
                </th>
                <td className="px-3">
                  <Badge>{roles(membership.role)}</Badge>
                </td>
                <td className="px-4 text-foreground-secondary">
                  {membership.project_ids === null
                    ? t('allProjects')
                    : t('someProjects', { count: membership.project_ids.length })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
