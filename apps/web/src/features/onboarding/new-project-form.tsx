'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { DomainInput } from '@/components/app/forms/domain-input';
import { FormField } from '@/components/app/forms/form-field';
import { LocationCombobox } from '@/components/app/forms/location-combobox';
import { useBrowserTimeZoneDefault, useSlugSuggestion, useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { TimeZoneCombobox } from '@/components/app/forms/time-zone-combobox';
import { DiscardChangesDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { Select } from '@/components/ui/select';
import { TextLink } from '@/components/ui/text-link';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import type { components } from '@/lib/api/schema';
import { domainMessageKey, normalizeDomain } from '@/lib/domains/normalize';
import { MAX_ALIAS_LENGTH, MAX_OWN_ALIASES, otherNames } from '@/lib/entities/aliases';
import { applyServerErrors } from '@/lib/forms';
import { LANGUAGE_CODES, languageName } from '@/lib/format/language';
import { useLocationSearch } from '@/lib/locations/use-location-search';
import { useLeaveGuard } from '@/lib/navigation/use-leave-guard';
import { DEFAULT_DEEP_CHECK_WEEKDAY, MAX_PROJECT_NAME_LENGTH, NO_LANGUAGE, WEEKDAYS } from '@/lib/projects/fields';
import { projectPath, workspacePath } from '@/lib/routes/paths';
import { SLUG_MAX_LENGTH, slugMessageKey, slugProblem } from '@/lib/slugs/slug';
import { textLength } from '@/lib/text/length';

type LocationRef = components['schemas']['LocationRef'];

interface NewProjectValues {
  name: string;
  slug: string;
  primary_domain: string;
  location: LocationRef | null;
  timezone: string;
  deep_check_weekday: string;
  default_language_code: string;
  brand: string;
  aliases: readonly string[];
}

/** The API's limit on an entity's name. */
const MAX_BRAND_LENGTH = 200;

export interface NewProjectFormProps {
  workspaceId: string;
  workspaceSlug: string;
}

/**
 * New project, step 1 of the wizard of 20 section 5.1 (Basics), with the own brand of step 2: the name,
 * an address suggested from it until the person edits it, the site, the location rank checks target, the
 * time zone (the browser's), the deep check day, the default language, and the brand with the other names
 * answers use for it. The brand is created with the project, as its primary own entity, and owns the site.
 * Creating the project opens it.
 */
export function NewProjectForm({ workspaceId, workspaceSlug }: NewProjectFormProps): ReactNode {
  const t = useTranslations('onboarding');
  const days = useTranslations('common.weekdays');
  const domainCopy = useTranslations('common.domain');
  const locations = useLocationSearch();
  const router = useRouter();
  const create = useMutation(apiMutation('post', '/api/v1/workspaces/{workspace_id}/projects'));
  const [created, setCreated] = useState<string | null>(null);
  // Set when the person chose to leave while the project was being created: it is not opened then
  const [left, setLeft] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const schema = useMemo(
    () =>
      z
        .object({
          name: z
            .string()
            .trim()
            .min(1, { error: t('nameRequired') })
            .max(MAX_PROJECT_NAME_LENGTH, { error: t('nameTooLong', { max: MAX_PROJECT_NAME_LENGTH }) }),
          slug: z
            .string()
            .trim()
            .superRefine((slug, context) => {
              const problem = slugProblem(slug, 'project');
              if (problem !== null) context.addIssue({ code: 'custom', message: t(slugMessageKey(problem)) });
            }),
          primary_domain: z.string().superRefine((domain, context) => {
            const preview = normalizeDomain(domain);
            if (!preview.ok) context.addIssue({ code: 'custom', message: domainCopy(domainMessageKey(preview.code)) });
          }),
          location: z.custom<LocationRef | null>(),
          timezone: z.string().min(1, { error: t('timezoneUnknown') }),
          deep_check_weekday: z.string(),
          default_language_code: z.string(),
          brand: z
            .string()
            .trim()
            .min(1, { error: t('brandRequired') })
            .max(MAX_BRAND_LENGTH, { error: t('nameTooLong', { max: MAX_BRAND_LENGTH }) }),
          aliases: z
            .array(z.string())
            .readonly()
            .refine((aliases) => aliases.every((alias) => textLength(alias.trim()) <= MAX_ALIAS_LENGTH), {
              error: t('aliasTooLong', { max: MAX_ALIAS_LENGTH }),
            }),
        })
        .refine((values) => otherNames(values.brand, values.aliases).length <= MAX_OWN_ALIASES, {
          path: ['aliases'],
          error: t('aliasesTooMany', { max: MAX_OWN_ALIASES }),
          // Checked while other fields are still wrong too, so the person hears of it at once
          when: ({ value }) =>
            typeof value === 'object' &&
            value !== null &&
            'brand' in value &&
            typeof value.brand === 'string' &&
            'aliases' in value &&
            Array.isArray(value.aliases),
        }),
    [t, domainCopy],
  );
  const form = useForm<NewProjectValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: {
      name: '',
      slug: '',
      primary_domain: '',
      location: null,
      timezone: 'UTC',
      deep_check_weekday: String(DEFAULT_DEEP_CHECK_WEEKDAY),
      default_language_code: NO_LANGUAGE,
      brand: '',
      aliases: [],
    },
  });
  // Leaving a started form asks first; once the project exists, opening it is not leaving
  const guard = useLeaveGuard(form.formState.isDirty && created === null);
  // The new project replaces this page in the history: Back does not return to an emptied form
  useEffect(() => {
    if (created !== null && !left) router.replace(projectPath(workspaceSlug, created));
  }, [created, left, router, workspaceSlug]);
  const slug = useWatch({ control: form.control, name: 'slug' });
  const onSlugChange = useSlugSuggestion(form, 'name', 'slug');
  useBrowserTimeZoneDefault(form, 'timezone');
  // The brand is named like the project until the person names it (most projects are one brand's)
  const name = useWatch({ control: form.control, name: 'name' });
  const [brandEdited, setBrandEdited] = useState(false);
  useEffect(() => {
    if (!brandEdited) form.setValue('brand', name.trim(), { shouldValidate: form.getFieldState('brand').invalid });
  }, [name, brandEdited, form]);

  const rootError = form.formState.errors.root?.message;
  useEffect(() => {
    if (rootError !== undefined) alertRef.current?.focus();
  }, [rootError]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const saved = await create.mutateAsync({
        params: { path: { workspace_id: workspaceId } },
        body: {
          name: values.name.trim(),
          slug: values.slug.trim(),
          timezone: values.timezone,
          deep_check_weekday: Number(values.deep_check_weekday),
          default_language_code: values.default_language_code === NO_LANGUAGE ? null : values.default_language_code,
          primary_domain: values.primary_domain.trim(),
          default_location_id: values.location?.location_id ?? null,
          own_entity: {
            canonical_name: values.brand.trim(),
            domains: [values.primary_domain.trim()],
            // The matcher finds the brand's own name itself; these are its other names
            aliases: otherNames(values.brand, values.aliases),
          },
        },
      });
      setCreated(saved.data.slug);
    } catch (error) {
      if (isApiProblem(error, 'duplicate')) {
        form.setError('slug', { type: 'server', message: t('slugTaken') }, { shouldFocus: true });
        return;
      }
      if (isApiProblem(error, 'quota_exceeded')) {
        const limit = error.number('limit');
        const used = error.number('used');
        form.setError('root', {
          type: 'server',
          message: limit !== null && used !== null ? t('quota', { limit, used }) : t('failed'),
        });
        return;
      }
      if (isApiProblem(error, 'forbidden')) {
        form.setError('root', { type: 'server', message: t('forbidden') });
        return;
      }
      if (isApiProblem(error, 'workspace_suspended')) {
        form.setError('root', { type: 'server', message: t('suspended') });
        return;
      }
      if (isApiProblem(error, 'validation_failed')) {
        // The brand's fields are nested in the request; they are shown on the fields that hold them here
        const items = error.errors
          .filter((item) => !item.path.startsWith('own_entity.aliases'))
          .map((item) =>
            item.path === 'own_entity.canonical_name'
              ? { ...item, path: 'brand' }
              : item.path.startsWith('own_entity.domains')
                ? { ...item, path: 'primary_domain' }
                : item.path === 'default_location_id'
                  ? { ...item, path: 'location' }
                  : item,
          );
        // An other name's error names its index; the field holds them all, so the first one is shown there
        const alias = error.errors.find((item) => item.path.startsWith('own_entity.aliases'));
        if (alias !== undefined) {
          form.setError(
            'aliases',
            {
              type: 'server',
              message:
                alias.code === 'string_too_long'
                  ? t('aliasTooLong', { max: MAX_ALIAS_LENGTH })
                  : alias.code === 'too_long'
                    ? t('aliasesTooMany', { max: MAX_OWN_ALIASES })
                    : t('aliasInvalid'),
            },
            { shouldFocus: !items.some((item) => item.location === 'body') },
          );
        }
        const rest = applyServerErrors(form, items, {
          fields: [
            'name',
            'slug',
            'primary_domain',
            'location',
            'timezone',
            'deep_check_weekday',
            'default_language_code',
            'brand',
          ],
          messages: {
            invalid_domain: domainCopy('invalid'),
            domain_is_public_suffix: domainCopy('publicSuffix'),
            location_unknown: t('locationUnknown'),
            entity_exists: t('brandTaken'),
            string_too_short: t('nameRequired'),
            string_too_long: t('nameTooLong', { max: MAX_PROJECT_NAME_LENGTH }),
            string_pattern_mismatch: t('slugInvalid'),
            slug_reserved: t('slugReserved'),
            slug_is_id: t('slugIsId'),
            timezone_unknown: t('timezoneUnknown'),
          },
        });
        if (rest.length === 0) return;
      }
      form.setError('root', { type: 'server', message: t('failed') });
    }
  });

  const onSubmit = useSubmitOnce(submit);
  const weekdays = WEEKDAYS.map((day, index) => ({ value: String(index), label: days(day) }));
  const languages = [
    { value: NO_LANGUAGE, label: t('languageNone') },
    ...LANGUAGE_CODES.map((code) => ({ value: code, label: languageName(code) })),
  ];
  return (
    <>
      <form noValidate className="flex flex-col gap-4" onSubmit={onSubmit}>
        {rootError === undefined ? null : <FormAlert ref={alertRef} tabIndex={-1} live={false} message={rootError} />}
        <FormField
          control={form.control}
          name="name"
          label={t('name')}
          render={(field) => (
            <Input
              {...field.controlProps}
              autoComplete="off"
              size="lg"
              placeholder={t('namePlaceholder')}
              value={field.value}
              onValueChange={field.onChange}
            />
          )}
        />
        <FormField
          control={form.control}
          name="slug"
          label={t('slug')}
          description={t('slugHint', { path: projectPath(workspaceSlug, slug === '' ? t('slugExample') : slug) })}
          render={(field) => (
            <Input
              {...field.controlProps}
              className="type-mono"
              autoComplete="off"
              spellCheck={false}
              maxLength={SLUG_MAX_LENGTH}
              value={field.value}
              size="lg"
              onValueChange={onSlugChange}
            />
          )}
        />
        <FormField
          control={form.control}
          name="primary_domain"
          label={t('domain')}
          render={(field) => (
            <DomainInput
              name={field.controlProps.name}
              inputRef={field.controlProps.ref}
              onBlur={field.controlProps.onBlur}
              disabled={field.controlProps.disabled}
              aria-required={field.controlProps['aria-required']}
              invalid={field.invalid}
              description={t('domainHint')}
              size="lg"
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
              size="lg"
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
              size="lg"
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
              size="lg"
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
              size="lg"
              placeholder={t('language')}
              options={languages}
            />
          )}
        />
        <div role="group" aria-labelledby="new-project-brand" className="flex min-w-0 flex-col gap-4 pt-2">
          <div>
            <h2 id="new-project-brand" className="type-subsection-title">
              {t('brandTitle')}
            </h2>
            <p className="mt-1 type-meta">{t('brandDescription')}</p>
          </div>
          <FormField
            control={form.control}
            name="brand"
            label={t('brand')}
            render={(field) => (
              <Input
                {...field.controlProps}
                autoComplete="off"
                size="lg"
                value={field.value}
                onValueChange={(value) => {
                  setBrandEdited(true);
                  field.onChange(value);
                }}
              />
            )}
          />
          <FormField
            control={form.control}
            name="aliases"
            label={t('aliases')}
            optional
            description={t('aliasesHint')}
            render={(field) => (
              <MultiSelect
                inputRef={field.ref}
                onBlur={field.onBlur}
                value={field.value}
                onValueChange={field.onChange}
                items={[]}
                itemToString={(alias) => alias}
                itemKey={(alias) => alias.toLocaleLowerCase()}
                creatable={{ label: (query) => t('addAlias', { alias: query }), onCreate: (query) => query }}
                placeholder={t('aliasPlaceholder')}
                emptyText={() => t('aliasHelp')}
                chipsLabel={t('aliases')}
                removeLabel={(alias) => t('removeAlias', { alias })}
                chipsHint={(count) => t('aliasesChips', { count })}
                chipHint={t('aliasChip')}
                className="min-h-control-lg"
              />
            )}
          />
        </div>
        <div className="flex flex-wrap items-center gap-4 pt-2">
          <Button type="submit" variant="primary" size="lg" loading={create.isPending || created !== null}>
            {t('create')}
          </Button>
          <TextLink render={<Link href={workspacePath(workspaceSlug)} />} className="type-body">
            {t('cancel')}
          </TextLink>
        </div>
      </form>
      <DiscardQuestion guard={guard} onLeave={() => setLeft(true)} />
    </>
  );
}

function DiscardQuestion({
  guard,
  onLeave,
}: {
  guard: ReturnType<typeof useLeaveGuard>;
  onLeave: () => void;
}): ReactNode {
  const discard = useTranslations('account.discard');
  const t = useTranslations('onboarding');
  return (
    <DiscardChangesDialog
      open={guard.pending !== null}
      title={discard('title')}
      description={t('discardDescription')}
      keepEditingLabel={discard('keepEditing')}
      discardLabel={discard('discard')}
      onKeepEditing={guard.stay}
      onDiscard={() => {
        onLeave();
        guard.leave();
      }}
    />
  );
}
