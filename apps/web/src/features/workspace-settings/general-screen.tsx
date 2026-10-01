'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { workspaceQuery } from './workspace-queries';
import { FormField } from '@/components/app/forms/form-field';
import { TimeZoneCombobox } from '@/components/app/forms/time-zone-combobox';
import { Banner } from '@/components/app/status/banner';
import { DiscardChangesDialog } from '@/components/ui/alert-dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { ReadOnlyField, ReadOnlyList } from '@/components/ui/read-only-field';
import { SaveBar } from '@/components/ui/save-bar';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import type { Workspace } from '@/lib/api/types';
import { applyServerErrors } from '@/lib/forms';
import { useLeaveGuard } from '@/lib/navigation/use-leave-guard';
import { useCan } from '@/lib/permissions';
import { projectPath, workspacePath } from '@/lib/routes/paths';
import { SLUG_MAX_LENGTH, slugProblem } from '@/lib/slugs/slug';

/** The API's limit on a workspace name (19 section 3.2, `WorkspaceCreate`). */
const MAX_NAME_LENGTH = 120;
const WORKSPACE_PATH = '/api/v1/workspaces/{workspace_id}';

interface WorkspaceValues {
  name: string;
  slug: string;
  timezone: string;
}

const valuesOf = (workspace: Workspace): WorkspaceValues => ({
  name: workspace.name,
  slug: workspace.slug,
  timezone: workspace.timezone,
});

export interface WorkspaceGeneralScreenProps {
  /** The workspace as the page's render read it; the screen keeps it fresh. */
  workspace: Workspace;
  /** The slug of the project the settings are open in, to stay on this page after a new address. */
  projectSlug: string;
}

/**
 * Settings > Workspace settings > General (11-navigation.md section 5, 20 section 5.19.1): the name, the
 * address and the time zone new projects start with, through the save bar. A member who may not change the
 * workspace sees the values read-only. The logo waits for an upload route; deletion is deferred.
 */
export function WorkspaceGeneralScreen({ workspace: initial, projectSlug }: WorkspaceGeneralScreenProps): ReactNode {
  const t = useTranslations('workspaceSettings.general');
  const canUpdate = useCan('workspace:update');
  const query = useQuery({ ...workspaceQuery(initial.workspace_id), initialData: { data: initial } });
  const workspace = query.data.data;
  return (
    <section aria-labelledby="workspace-general-title" className="flex flex-col gap-5">
      <div>
        <h2 id="workspace-general-title" className="type-section-title">
          {t('title')}
        </h2>
        <p className="mt-1 type-meta">{t('description')}</p>
      </div>
      {canUpdate ? (
        <GeneralForm workspace={workspace} projectSlug={projectSlug} />
      ) : (
        <>
          <Banner tone="info" placement="region" lead={t('readOnlyLead')} message={t('readOnly')} />
          <ReadOnlyList className="max-w-90">
            <ReadOnlyField label={t('name')} value={workspace.name} />
            <ReadOnlyField label={t('slug')} value={workspacePath(workspace.slug)} font="mono" />
            <ReadOnlyField label={t('timezone')} value={workspace.timezone} />
          </ReadOnlyList>
        </>
      )}
    </section>
  );
}

function GeneralForm({ workspace, projectSlug }: { workspace: Workspace; projectSlug: string }): ReactNode {
  const t = useTranslations('workspaceSettings.general');
  const common = useTranslations('common');
  const account = useTranslations('account');
  const router = useRouter();
  const queryClient = useQueryClient();
  const formId = useId();
  const saving = useRef(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, { error: t('nameRequired') })
          .max(MAX_NAME_LENGTH, { error: t('nameTooLong', { max: MAX_NAME_LENGTH }) }),
        slug: z
          .string()
          .trim()
          .superRefine((slug, context) => {
            const problem = slugProblem(slug, 'workspace');
            if (problem === null) return;
            const message =
              problem === 'slug_reserved'
                ? t('slugReserved')
                : problem === 'slug_is_id'
                  ? t('slugIsId')
                  : t('slugInvalid');
            context.addIssue({ code: 'custom', message });
          }),
        timezone: z.string().min(1, { error: t('timezoneUnknown') }),
      }),
    [t],
  );
  const form = useForm<WorkspaceValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: valuesOf(workspace),
  });
  const update = useMutation(apiMutation('patch', WORKSPACE_PATH));
  const { isDirty, dirtyFields } = form.formState;
  const guard = useLeaveGuard(isDirty);
  // A change saved elsewhere is the new baseline, unless the person is editing
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(valuesOf(workspace));
  }, [workspace, form]);

  const submit = form.handleSubmit(async (values) => {
    const body = {
      ...(dirtyFields.name === true ? { name: values.name.trim() } : {}),
      ...(dirtyFields.slug === true ? { slug: values.slug.trim() } : {}),
      ...(dirtyFields.timezone === true ? { timezone: values.timezone } : {}),
    };
    try {
      const saved = await update.mutateAsync({ params: { path: { workspace_id: workspace.workspace_id } }, body });
      queryClient.setQueryData(workspaceQuery(workspace.workspace_id).queryKey, { data: saved.data });
      form.reset(valuesOf(saved.data));
      announce(t('saved'));
      // The shell shows the name, and a new address moves every page of the workspace
      if (saved.data.slug === workspace.slug) router.refresh();
      else router.replace(projectPath(saved.data.slug, projectSlug, '/settings/workspace'));
    } catch (error) {
      if (isApiProblem(error, 'duplicate')) {
        form.setError('slug', { type: 'server', message: t('slugTaken') }, { shouldFocus: true });
        return;
      }
      if (isApiProblem(error, 'validation_failed')) {
        const rest = applyServerErrors(form, error.errors, {
          fields: ['name', 'slug', 'timezone'],
          messages: {
            string_too_short: t('nameRequired'),
            string_too_long: t('nameTooLong', { max: MAX_NAME_LENGTH }),
            string_pattern_mismatch: t('slugInvalid'),
            slug_reserved: t('slugReserved'),
            slug_is_id: t('slugIsId'),
            timezone_unknown: t('timezoneUnknown'),
          },
        });
        if (rest.length === 0) return;
      }
      form.setError('root', { type: 'server', message: t('saveFailed') });
    }
  });

  const rootError = form.formState.errors.root?.message;
  // A failure of the whole form takes focus, which reads it (10-forms.md section 13.2)
  useEffect(() => {
    if (rootError !== undefined) alertRef.current?.focus();
  }, [rootError]);
  const slug = useWatch({ control: form.control, name: 'slug' });
  const changed = Object.values(dirtyFields).filter(Boolean).length;
  return (
    <>
      <form
        id={formId}
        noValidate
        className="flex max-w-90 flex-col gap-4"
        onSubmit={(event) => {
          // Two quick presses of Enter would both start a save: the mutation's state updates on the next render
          if (saving.current) {
            event.preventDefault();
            return;
          }
          saving.current = true;
          void submit(event).finally(() => {
            saving.current = false;
          });
        }}
      >
        {rootError === undefined ? null : <FormAlert ref={alertRef} tabIndex={-1} live={false} message={rootError} />}
        <FormField
          control={form.control}
          name="name"
          label={t('name')}
          render={(field) => (
            <Input
              {...field.controlProps}
              autoComplete="organization"
              value={field.value}
              onValueChange={field.onChange}
            />
          )}
        />
        <FormField
          control={form.control}
          name="slug"
          label={t('slug')}
          description={t('slugHint', { path: workspacePath(slug === '' ? workspace.slug : slug) })}
          render={(field) => (
            <Input
              {...field.controlProps}
              className="type-mono"
              autoComplete="off"
              spellCheck={false}
              maxLength={SLUG_MAX_LENGTH}
              value={field.value}
              onValueChange={(value) => field.onChange(value.toLowerCase())}
            />
          )}
        />
        <FormField
          control={form.control}
          name="timezone"
          label={t('timezone')}
          description={t('timezoneHint')}
          render={(field) => (
            <TimeZoneCombobox
              name={field.controlProps.name}
              inputRef={field.controlProps.ref}
              onBlur={field.controlProps.onBlur}
              disabled={field.controlProps.disabled}
              aria-required={field.controlProps['aria-required']}
              value={field.value}
              onValueChange={field.onChange}
              labels={{
                placeholder: common('timeZone.search'),
                empty: (query) => common('timeZone.empty', { query }),
                clear: common('clear'),
                open: common('timeZone.open'),
              }}
            />
          )}
        />
      </form>
      <SaveBar
        visible={isDirty}
        form={formId}
        summary={account('saveBar.summary', { count: changed })}
        saving={update.isPending}
        onDiscard={() => form.reset(valuesOf(workspace))}
        discardLabel={account('saveBar.discard')}
        saveLabel={account('saveBar.save')}
      />
      <DiscardChangesDialog
        open={guard.pending !== null}
        title={account('discard.title')}
        description={t('discardDescription')}
        keepEditingLabel={account('discard.keepEditing')}
        discardLabel={account('discard.discard')}
        onKeepEditing={guard.stay}
        onDiscard={() => {
          form.reset(valuesOf(workspace));
          guard.leave();
        }}
      />
    </>
  );
}
