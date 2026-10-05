'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';

import {
  DEFAULT_DEPTHS,
  DEFAULT_DEVICES,
  DEFAULT_FREQUENCIES,
  DEPTH_KEYS,
  valuesOfSeo,
  type DefaultDepth,
  type DefaultDevice,
  type DefaultFrequency,
  type DefaultsValues,
} from './keyword-defaults-values';
import { projectSettingsQuery } from './project-query';
import { FormField } from '@/components/app/forms/form-field';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { InlineError } from '@/components/app/status/inline-error';
import { DiscardChangesDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { ReadOnlyField, ReadOnlyList } from '@/components/ui/read-only-field';
import { Select, type SelectOption } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import type { components } from '@/lib/api/schema';
import type { Project } from '@/lib/api/types';
import { applyServerErrors } from '@/lib/forms';
import { useLeaveGuard } from '@/lib/navigation/use-leave-guard';
import { useCan } from '@/lib/permissions';

type SeoSettingsPatch = components['schemas']['SeoSettingsPatch'];

const UPDATE = apiMutation('patch', '/api/v1/workspaces/{workspace_id}/projects/{project_id}/settings');
const FIELDS = ['default_device', 'default_depth_profile', 'default_frequency'] as const;

/**
 * Keyword defaults of Project settings > General (20 section 5.19.5): the device, the depth profile and the
 * check frequency a keyword gets when it is added without its own choice. They apply to keywords added
 * afterwards. The section saves on its own, apart from the project's details: a different request, and a
 * different thing to be sure about. The API tracks Google only, so there is no search engine to choose.
 * A member who may not change the project sees the values.
 */
export function KeywordDefaultsSection({ project }: { project: Project }): ReactNode {
  const t = useTranslations('projectSettings.keywordDefaults');
  const common = useTranslations('common');
  const canWrite = useCan('projects:write');
  const settings = useQuery(projectSettingsQuery(project));
  const seo = settings.data?.data.seo;
  const values = useMemo(() => valuesOfSeo(seo), [seo]);
  // A role that reads no project data (billing) has no defaults to see: the section is left out, not failed
  if (settings.isError && isApiProblem(settings.error, 'forbidden')) return null;
  return (
    <section
      aria-labelledby="keyword-defaults-title"
      className="flex flex-col gap-3 border-t border-border-subtle pt-5"
    >
      <h3 id="keyword-defaults-title" className="type-subsection-title">
        {t('title')}
      </h3>
      <p className="type-meta">{t('description')}</p>
      {settings.isError ? (
        <InlineError
          title={t('loadFailed')}
          reason={t('loadFailedReason')}
          errorId={null}
          onRetry={() => void settings.refetch()}
          retrying={settings.isFetching}
          retryLabel={common('retry')}
        />
      ) : settings.isPending ? (
        <Skeleton shape="text-14" widthPct={48} />
      ) : canWrite ? (
        <DefaultsForm project={project} values={values} />
      ) : (
        <ReadOnlyDefaults values={values} />
      )}
    </section>
  );
}

function ReadOnlyDefaults({ values }: { values: DefaultsValues }): ReactNode {
  const t = useTranslations('projectSettings.keywordDefaults');
  return (
    <ReadOnlyList className="max-w-90">
      <ReadOnlyField label={t('device')} value={t(`devices.${values.default_device}`)} />
      <ReadOnlyField label={t('depth')} value={t(`depths.${DEPTH_KEYS[values.default_depth_profile]}`)} />
      <ReadOnlyField label={t('frequency')} value={t(`frequencies.${values.default_frequency}`)} />
    </ReadOnlyList>
  );
}

function DefaultsForm({ project, values }: { project: Project; values: DefaultsValues }): ReactNode {
  const t = useTranslations('projectSettings.keywordDefaults');
  const account = useTranslations('account');
  const queryClient = useQueryClient();
  const formId = useId();
  const form = useForm<DefaultsValues>({ mode: 'onTouched', defaultValues: values });
  const update = useMutation(UPDATE);
  const { isDirty, dirtyFields } = form.formState;
  const guard = useLeaveGuard(isDirty);
  // A change saved elsewhere is the new baseline, unless the person is editing
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(values);
  }, [values, form]);

  const depthOptions = useMemo((): SelectOption<DefaultDepth>[] => {
    const offered = DEFAULT_DEPTHS.map((value): SelectOption<DefaultDepth> => ({
      value,
      label: t(`depths.${DEPTH_KEYS[value]}`),
      description: t(`depthHints.${DEPTH_KEYS[value]}`),
    }));
    // A profile the project already holds that is not offered any more stays visible, and cannot be picked again
    const held = values.default_depth_profile;
    const listed = offered.some((option) => option.value === held);
    return listed ? offered : [...offered, { value: held, label: t(`depths.${DEPTH_KEYS[held]}`), disabled: true }];
  }, [t, values.default_depth_profile]);

  const submit = form.handleSubmit(async (changed) => {
    const seo: SeoSettingsPatch = {
      ...(dirtyFields.default_device === true ? { default_device: changed.default_device } : {}),
      ...(dirtyFields.default_depth_profile === true ? { default_depth_profile: changed.default_depth_profile } : {}),
      ...(dirtyFields.default_frequency === true ? { default_frequency: changed.default_frequency } : {}),
    };
    if (Object.keys(seo).length === 0) return;
    try {
      const saved = await update.mutateAsync({
        params: { path: { workspace_id: project.workspace_id, project_id: project.project_id } },
        body: { seo },
      });
      const key = projectSettingsQuery(project).queryKey;
      queryClient.setQueryData(key, saved);
      // Add keywords and every other reader of the settings take the new defaults
      void queryClient.invalidateQueries({ queryKey: key });
      form.reset(valuesOfSeo(saved.data.seo));
      announce(t('saved'));
    } catch (error) {
      if (isApiProblem(error, 'validation_failed')) {
        const items = error.errors.map((item) => ({ ...item, path: item.path.replace(/^seo\./, '') }));
        const rest = applyServerErrors(form, items, {
          fields: FIELDS,
          messages: { depth_profile_not_available: t('depthNotAvailable') },
        });
        if (rest.length === 0) return;
      }
      form.setError('root', { type: 'server', message: t('saveFailed') });
    }
  });
  const onSubmit = useSubmitOnce(submit);
  const rootError = form.formState.errors.root?.message;
  const reset = (): void => form.reset(values);

  return (
    <>
      <form id={formId} noValidate className="flex max-w-90 flex-col gap-4" onSubmit={onSubmit}>
        {rootError === undefined ? null : <FormAlert message={rootError} />}
        <FormField
          control={form.control}
          name="default_device"
          label={t('device')}
          description={t('deviceHint')}
          width="medium"
          render={(field) => (
            <Select<DefaultDevice>
              {...field.controlProps}
              value={field.value}
              onValueChange={field.onChange}
              placeholder={t('device')}
              options={DEFAULT_DEVICES.map((value) => ({ value, label: t(`devices.${value}`) }))}
            />
          )}
        />
        <FormField
          control={form.control}
          name="default_depth_profile"
          label={t('depth')}
          description={t('depthHint')}
          width="long"
          render={(field) => (
            <Select<DefaultDepth>
              {...field.controlProps}
              value={field.value}
              onValueChange={field.onChange}
              placeholder={t('depth')}
              options={depthOptions}
            />
          )}
        />
        <FormField
          control={form.control}
          name="default_frequency"
          label={t('frequency')}
          description={t('frequencyHint')}
          width="medium"
          render={(field) => (
            <Select<DefaultFrequency>
              {...field.controlProps}
              value={field.value}
              onValueChange={field.onChange}
              placeholder={t('frequency')}
              options={DEFAULT_FREQUENCIES.map((value) => ({ value, label: t(`frequencies.${value}`) }))}
            />
          )}
        />
        {/* The height is kept while the buttons are away, so the sections below do not move */}
        <div className="flex min-h-control items-center gap-2">
          {isDirty ? (
            <>
              <Button type="submit" variant="secondary" loading={update.isPending}>
                {t('save')}
              </Button>
              <Button variant="ghost" disabled={update.isPending} onClick={reset}>
                {t('discard')}
              </Button>
            </>
          ) : null}
        </div>
      </form>
      <DiscardChangesDialog
        open={guard.pending !== null}
        title={account('discard.title')}
        description={t('discardDescription')}
        keepEditingLabel={account('discard.keepEditing')}
        discardLabel={account('discard.discard')}
        onKeepEditing={guard.stay}
        onDiscard={() => {
          reset();
          guard.leave();
        }}
      />
    </>
  );
}
