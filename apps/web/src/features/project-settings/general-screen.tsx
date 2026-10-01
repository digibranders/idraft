'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { projectQuery } from './project-query';
import { StatusSection } from './status-section';
import { DomainInput } from '@/components/app/forms/domain-input';
import { FormField } from '@/components/app/forms/form-field';
import { LocationCombobox } from '@/components/app/forms/location-combobox';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { TimeZoneCombobox } from '@/components/app/forms/time-zone-combobox';
import { Banner } from '@/components/app/status/banner';
import { DiscardChangesDialog } from '@/components/ui/alert-dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { ReadOnlyField, ReadOnlyList } from '@/components/ui/read-only-field';
import { SaveBar } from '@/components/ui/save-bar';
import { Select } from '@/components/ui/select';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import type { components } from '@/lib/api/schema';
import type { Project } from '@/lib/api/types';
import { domainMessageKey, normalizeDomain } from '@/lib/domains/normalize';
import { applyServerErrors } from '@/lib/forms';
import { LANGUAGE_CODES, languageName } from '@/lib/format/language';
import { useLocationSearch } from '@/lib/locations/use-location-search';
import { useLeaveGuard } from '@/lib/navigation/use-leave-guard';
import { useCan } from '@/lib/permissions';
import { MAX_PROJECT_NAME_LENGTH as MAX_NAME_LENGTH, NO_LANGUAGE, WEEKDAYS } from '@/lib/projects/fields';
import { projectPath } from '@/lib/routes/paths';
import { SLUG_MAX_LENGTH, slugMessageKey, slugProblem } from '@/lib/slugs/slug';

type LocationRef = components['schemas']['LocationRef'];

interface GeneralValues {
  name: string;
  slug: string;
  primary_domain: string;
  location: LocationRef | null;
  timezone: string;
  deep_check_weekday: string;
  default_language_code: string;
}

const valuesOf = (project: Project): GeneralValues => ({
  name: project.name,
  slug: project.slug,
  primary_domain: project.primary_domain?.host ?? '',
  location: project.default_location,
  timezone: project.timezone,
  deep_check_weekday: String(project.deep_check_weekday),
  default_language_code: project.default_language_code ?? NO_LANGUAGE,
});

export interface ProjectGeneralScreenProps {
  /** The project as the page's render read it; the screen keeps it fresh. */
  project: Project;
  /** The slug of the workspace, for the project's address. */
  workspaceSlug: string;
}

/**
 * Settings > Project settings > General (11-navigation.md section 5, 20 section 5.19.5): the name, the
 * address, the site, the location rank checks target, the time zone, the deep check day and the default language through the save bar, then tracking
 * and the danger zone. A member who may not change projects sees the values read-only.
 */
export function ProjectGeneralScreen({ project: initial, workspaceSlug }: ProjectGeneralScreenProps): ReactNode {
  const t = useTranslations('projectSettings.general');
  const canWrite = useCan('projects:write');
  const query = useQuery({ ...projectQuery(initial), initialData: { data: initial } });
  const project = query.data.data;
  return (
    <section aria-labelledby="project-general-title" className="flex flex-col gap-5">
      <div>
        <h2 id="project-general-title" className="type-section-title">
          {t('title')}
        </h2>
        <p className="mt-1 type-meta">{t('description')}</p>
      </div>
      {canWrite ? (
        <GeneralForm project={project} workspaceSlug={workspaceSlug} />
      ) : (
        <ReadOnlyGeneral project={project} workspaceSlug={workspaceSlug} />
      )}
      {canWrite ? <StatusSection project={project} workspaceSlug={workspaceSlug} /> : null}
    </section>
  );
}

function useWeekdayOptions(): { value: string; label: string }[] {
  const days = useTranslations('common.weekdays');
  return WEEKDAYS.map((day, index) => ({ value: String(index), label: days(day) }));
}

/** The offered languages, and the project's own when the API holds one the list does not offer. */
function useLanguageOptions(current: string | null): { value: string; label: string }[] {
  const t = useTranslations('projectSettings.general');
  return useMemo(() => {
    const codes: readonly string[] = LANGUAGE_CODES;
    const extra = current !== null && !codes.includes(current) ? [current] : [];
    return [
      { value: NO_LANGUAGE, label: t('languageNone') },
      ...[...codes, ...extra].map((code) => ({ value: code, label: languageName(code) })),
    ];
  }, [t, current]);
}

function ReadOnlyGeneral({ project, workspaceSlug }: { project: Project; workspaceSlug: string }): ReactNode {
  const t = useTranslations('projectSettings.general');
  const status = useTranslations('projectSettings.status');
  const weekdays = useWeekdayOptions();
  return (
    <>
      <Banner tone="info" placement="region" lead={t('readOnlyLead')} message={t('readOnly')} />
      <ReadOnlyList className="max-w-90">
        <ReadOnlyField label={t('name')} value={project.name} />
        <ReadOnlyField label={t('slug')} value={projectPath(workspaceSlug, project.slug)} font="mono" />
        <ReadOnlyField label={t('domain')} value={project.primary_domain?.host ?? t('none')} />
        <ReadOnlyField label={t('location')} value={project.default_location?.name ?? t('none')} />
        <ReadOnlyField label={t('timezone')} value={project.timezone} />
        <ReadOnlyField
          label={t('weekday')}
          value={weekdays.find((day) => day.value === String(project.deep_check_weekday))?.label ?? ''}
        />
        <ReadOnlyField
          label={t('language')}
          value={
            project.default_language_code === null ? t('languageNone') : languageName(project.default_language_code)
          }
        />
        <ReadOnlyField
          label={status('title')}
          value={project.status === 'paused' ? status('paused') : status('active')}
        />
      </ReadOnlyList>
    </>
  );
}

function GeneralForm({ project, workspaceSlug }: { project: Project; workspaceSlug: string }): ReactNode {
  const t = useTranslations('projectSettings.general');
  const account = useTranslations('account');
  const router = useRouter();
  const queryClient = useQueryClient();
  const formId = useId();
  const alertRef = useRef<HTMLDivElement>(null);
  const domainCopy = useTranslations('common.domain');
  const locations = useLocationSearch();
  const weekdays = useWeekdayOptions();
  const languages = useLanguageOptions(project.default_language_code);
  const [forward, setForward] = useState<string | null>(null);
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
            const problem = slugProblem(slug, 'project');
            if (problem !== null) context.addIssue({ code: 'custom', message: t(slugMessageKey(problem)) });
          }),
        // A project may have no site yet; one that is given has to read as a domain
        primary_domain: z.string().superRefine((domain, context) => {
          if (domain.trim() === '') return;
          const preview = normalizeDomain(domain);
          if (!preview.ok) context.addIssue({ code: 'custom', message: domainCopy(domainMessageKey(preview.code)) });
        }),
        location: z.custom<LocationRef | null>(),
        timezone: z.string().min(1, { error: t('timezoneUnknown') }),
        deep_check_weekday: z.string(),
        default_language_code: z.string(),
      }),
    [t, domainCopy],
  );
  const form = useForm<GeneralValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: valuesOf(project),
  });
  const update = useMutation(apiMutation('patch', '/api/v1/workspaces/{workspace_id}/projects/{project_id}'));
  const { isDirty, dirtyFields } = form.formState;
  const guard = useLeaveGuard(isDirty);
  // A change saved elsewhere is the new baseline, unless the person is editing
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(valuesOf(project));
  }, [project, form]);

  const submit = form.handleSubmit(async (values) => {
    const body = {
      ...(dirtyFields.name === true ? { name: values.name.trim() } : {}),
      ...(dirtyFields.slug === true ? { slug: values.slug.trim() } : {}),
      ...(dirtyFields.primary_domain === true
        ? { primary_domain: values.primary_domain.trim() === '' ? null : values.primary_domain.trim() }
        : {}),
      ...(dirtyFields.location !== undefined ? { default_location_id: values.location?.location_id ?? null } : {}),
      ...(dirtyFields.timezone === true ? { timezone: values.timezone } : {}),
      ...(dirtyFields.deep_check_weekday === true ? { deep_check_weekday: Number(values.deep_check_weekday) } : {}),
      ...(dirtyFields.default_language_code === true
        ? {
            default_language_code: values.default_language_code === NO_LANGUAGE ? null : values.default_language_code,
          }
        : {}),
    };
    try {
      const saved = await update.mutateAsync({
        params: { path: { workspace_id: project.workspace_id, project_id: project.project_id } },
        body,
      });
      queryClient.setQueryData(projectQuery(project).queryKey, { data: saved.data });
      form.reset(valuesOf(saved.data));
      const forwardZone = saved.meta.warnings.includes('timezone_change_applies_forward') ? saved.data.timezone : null;
      // The warning is said with the save: a banner that appears with its text is not always read, and a new
      // address replaces this page before the banner could be seen
      announce(forwardZone === null ? t('saved') : `${t('saved')}. ${t('timezoneForward', { timezone: forwardZone })}`);
      setForward(forwardZone);
      // The shell shows the name, and a new address moves the page; both come from the server's render
      if (saved.data.slug === project.slug) router.refresh();
      else router.replace(projectPath(workspaceSlug, saved.data.slug, '/settings/general'));
    } catch (error) {
      if (isApiProblem(error, 'duplicate')) {
        form.setError('slug', { type: 'server', message: t('slugTaken') }, { shouldFocus: true });
        return;
      }
      if (isApiProblem(error, 'validation_failed')) {
        const items = error.errors.map((item) =>
          item.path === 'default_location_id' ? { ...item, path: 'location' } : item,
        );
        const rest = applyServerErrors(form, items, {
          fields: [
            'name',
            'slug',
            'primary_domain',
            'location',
            'timezone',
            'deep_check_weekday',
            'default_language_code',
          ],
          messages: {
            invalid_domain: domainCopy('invalid'),
            domain_is_public_suffix: domainCopy('publicSuffix'),
            location_unknown: t('locationUnknown'),
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
  const onSubmit = useSubmitOnce(submit);

  const rootError = form.formState.errors.root?.message;
  // A failure of the whole form takes focus, which reads it (10-forms.md section 13.2)
  useEffect(() => {
    if (rootError !== undefined) alertRef.current?.focus();
  }, [rootError]);
  const slug = useWatch({ control: form.control, name: 'slug' });
  const changed = Object.values(dirtyFields).filter(Boolean).length;
  return (
    <>
      {forward === null ? null : (
        <Banner tone="info" placement="region" message={t('timezoneForward', { timezone: forward })} />
      )}
      <form id={formId} noValidate className="flex max-w-90 flex-col gap-4" onSubmit={onSubmit}>
        {rootError === undefined ? null : <FormAlert ref={alertRef} tabIndex={-1} live={false} message={rootError} />}
        <FormField
          control={form.control}
          name="name"
          label={t('name')}
          render={(field) => <Input {...field.controlProps} value={field.value} onValueChange={field.onChange} />}
        />
        <FormField
          control={form.control}
          name="slug"
          label={t('slug')}
          description={t('slugHint', { path: projectPath(workspaceSlug, slug === '' ? project.slug : slug) })}
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
          name="primary_domain"
          label={t('domain')}
          optional
          render={(field) => (
            <DomainInput
              name={field.controlProps.name}
              inputRef={field.controlProps.ref}
              onBlur={field.controlProps.onBlur}
              disabled={field.controlProps.disabled}
              invalid={field.invalid}
              description={t('domainHint')}
              value={field.value}
              onValueChange={field.onChange}
            />
          )}
        />
        <FormField
          control={form.control}
          name="location"
          label={t('location')}
          optional
          description={t('locationHint')}
          render={(field) => (
            <LocationCombobox
              name={field.controlProps.name}
              inputRef={field.controlProps.ref}
              onBlur={field.controlProps.onBlur}
              disabled={field.controlProps.disabled}
              value={field.value}
              onValueChange={field.onChange}
              items={locations.items}
              loading={locations.loading}
              onQueryChange={locations.onQueryChange}
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
            />
          )}
        />
        <FormField
          control={form.control}
          name="deep_check_weekday"
          label={t('weekday')}
          description={t('weekdayHint')}
          width="medium"
          render={(field) => (
            <Select
              {...field.controlProps}
              value={field.value}
              onValueChange={field.onChange}
              placeholder={t('weekday')}
              options={weekdays}
            />
          )}
        />
        <FormField
          control={form.control}
          name="default_language_code"
          label={t('language')}
          width="medium"
          render={(field) => (
            <Select
              {...field.controlProps}
              value={field.value}
              onValueChange={field.onChange}
              placeholder={t('language')}
              options={languages}
            />
          )}
        />
      </form>
      <SaveBar
        visible={isDirty}
        form={formId}
        summary={account('saveBar.summary', { count: changed })}
        saving={update.isPending}
        onDiscard={() => form.reset(valuesOf(project))}
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
          form.reset(valuesOf(project));
          guard.leave();
        }}
      />
    </>
  );
}
