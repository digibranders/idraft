'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { FormField } from '@/components/app/forms/form-field';
import { useBrowserTimeZoneDefault, useSlugSuggestion, useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { TimeZoneCombobox } from '@/components/app/forms/time-zone-combobox';
import { AuthCard } from '@/components/app/shell/auth-card';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { TextLink } from '@/components/ui/text-link';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { applyServerErrors } from '@/lib/forms';
import { workspacePath } from '@/lib/routes/paths';
import { SLUG_MAX_LENGTH, slugMessageKey, slugProblem } from '@/lib/slugs/slug';
import { MAX_WORKSPACE_NAME_LENGTH } from '@/lib/workspaces/fields';

interface NewWorkspaceValues {
  name: string;
  slug: string;
  timezone: string;
}

/**
 * Create a workspace (19 section 3.2, `POST /workspaces`), for a platform operator while sign-up is by
 * invitation: the name, an address suggested from it, and the time zone of its workspace pages. The
 * operator becomes its owner and lands on it.
 */
export function NewWorkspaceScreen(): ReactNode {
  const t = useTranslations('onboarding.workspace');
  const app = useTranslations('app');
  const router = useRouter();
  const create = useMutation(apiMutation('post', '/api/v1/workspaces'));
  const alertRef = useRef<HTMLDivElement>(null);
  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, { error: t('nameRequired') })
          .max(MAX_WORKSPACE_NAME_LENGTH, { error: t('nameTooLong', { max: MAX_WORKSPACE_NAME_LENGTH }) }),
        slug: z
          .string()
          .trim()
          .superRefine((slug, context) => {
            const problem = slugProblem(slug, 'workspace');
            if (problem !== null) context.addIssue({ code: 'custom', message: t(slugMessageKey(problem)) });
          }),
        timezone: z.string().min(1, { error: t('timezoneUnknown') }),
      }),
    [t],
  );
  const form = useForm<NewWorkspaceValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { name: '', slug: '', timezone: 'UTC' },
  });
  const slug = useWatch({ control: form.control, name: 'slug' });
  const onSlugChange = useSlugSuggestion(form, 'name', 'slug');
  useBrowserTimeZoneDefault(form, 'timezone');

  const rootError = form.formState.errors.root?.message;
  useEffect(() => {
    if (rootError !== undefined) alertRef.current?.focus();
  }, [rootError]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const saved = await create.mutateAsync({
        body: { name: values.name.trim(), slug: values.slug.trim(), timezone: values.timezone },
      });
      // The new workspace replaces this page in the history: Back does not return to an emptied form
      router.replace(workspacePath(saved.data.slug));
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
            string_too_long: t('nameTooLong', { max: MAX_WORKSPACE_NAME_LENGTH }),
            string_pattern_mismatch: t('slugInvalid'),
            slug_reserved: t('slugReserved'),
            slug_is_id: t('slugIsId'),
            timezone_unknown: t('timezoneUnknown'),
          },
        });
        if (rest.length === 0) return;
      }
      const message = isApiProblem(error, 'rate_limited')
        ? t('rateLimited')
        : isApiProblem(error, 'email_not_verified')
          ? t('notVerified')
          : isApiProblem(error, 'forbidden')
            ? t('forbidden')
            : t('failed');
      form.setError('root', { type: 'server', message });
    }
  });
  const onSubmit = useSubmitOnce(submit);

  return (
    <AuthCard productName={app('name')} title={t('title')} description={t('description')}>
      <form noValidate className="flex flex-col gap-4" onSubmit={onSubmit}>
        {rootError === undefined ? null : <FormAlert ref={alertRef} tabIndex={-1} live={false} message={rootError} />}
        <FormField
          control={form.control}
          name="name"
          label={t('name')}
          render={(field) => (
            <Input
              {...field.controlProps}
              size="lg"
              autoComplete="organization"
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
          description={t('slugHint', { path: workspacePath(slug === '' ? t('slugExample') : slug) })}
          render={(field) => (
            <Input
              {...field.controlProps}
              size="lg"
              className="type-mono"
              autoComplete="off"
              spellCheck={false}
              maxLength={SLUG_MAX_LENGTH}
              value={field.value}
              onValueChange={onSlugChange}
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
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          loading={create.isPending || create.isSuccess}
        >
          {t('create')}
        </Button>
        <TextLink render={<Link href="/" />} className="self-center type-body">
          {t('back')}
        </TextLink>
      </form>
    </AuthCard>
  );
}
