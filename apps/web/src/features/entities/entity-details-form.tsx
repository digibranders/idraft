'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { entityQuery, refreshEntities, type EntityDetail, type ProjectScope } from './entity-queries';
import { FormField } from '@/components/app/forms/form-field';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { useMultiSelectHints } from '@/components/app/forms/use-multi-select-hints';
import { DiscardChangesDialog } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { ReadOnlyField, ReadOnlyList } from '@/components/ui/read-only-field';
import { SaveBar } from '@/components/ui/save-bar';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation, apiQuery } from '@/lib/api/query';
import { applyServerErrors } from '@/lib/forms';
import { useLeaveGuard } from '@/lib/navigation/use-leave-guard';

type EntityType = EntityDetail['entity_type'];
interface ParentChoice {
  entity_id: string;
  canonical_name: string;
}
const ENTITY_TYPES: readonly EntityType[] = ['brand', 'product', 'organization', 'person', 'other'];
const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
/** The counter shows from 80% of the limit (10-forms.md section 5). */
const COUNTER_FROM = MAX_DESCRIPTION_LENGTH * 0.8;

interface DetailsValues {
  canonical_name: string;
  entity_type: EntityType;
  is_ambiguous: boolean;
  disambiguation_hints: readonly string[];
  description: string;
  parent_entity_id: string | null;
}

/** The API's limits on hints (19 section 3.4, `EntityCreate`). */
const MAX_HINTS = 50;
const MAX_HINT_LENGTH = 100;
/** The most entities the parent list loads at once; a workspace with more finds the rest by typing. */
const PARENT_PAGE = 200;

const valuesOf = (entity: EntityDetail): DetailsValues => ({
  canonical_name: entity.canonical_name,
  entity_type: entity.entity_type,
  is_ambiguous: entity.is_ambiguous,
  disambiguation_hints: entity.disambiguation_hints,
  description: entity.description ?? '',
  parent_entity_id: entity.parent_entity_id,
});

export interface EntityDetailsFormProps {
  scope: ProjectScope;
  entity: EntityDetail;
  canWrite: boolean;
}

/**
 * An entity's details: its name, its type, whether its name is a common word and the words that tell it
 * apart, and a note. Saved through the save bar; read-only without `entities:write`.
 */
export function EntityDetailsForm({ scope, entity, canWrite }: EntityDetailsFormProps): ReactNode {
  const t = useTranslations('entitySettings.details');
  return (
    <section aria-labelledby="entity-details-title" className="flex flex-col gap-4">
      <h3 id="entity-details-title" className="type-subsection-title">
        {t('title')}
      </h3>
      {canWrite ? <DetailsForm scope={scope} entity={entity} /> : <ReadOnlyDetails entity={entity} />}
    </section>
  );
}

function ReadOnlyDetails({ entity }: { entity: EntityDetail }): ReactNode {
  const t = useTranslations('entitySettings.details');
  return (
    <ReadOnlyList className="max-w-90">
      <ReadOnlyField label={t('name')} value={entity.canonical_name} />
      <ReadOnlyField label={t('type')} value={t(`types.${entity.entity_type}`)} />
      <ReadOnlyField label={t('ambiguous')} value={entity.is_ambiguous ? t('yes') : t('no')} />
      <ReadOnlyField
        label={t('hints')}
        value={entity.disambiguation_hints.length === 0 ? t('none') : entity.disambiguation_hints.join(', ')}
      />
      <ReadOnlyField label={t('note')} value={entity.description ?? t('none')} />
    </ReadOnlyList>
  );
}

function DetailsForm({ scope, entity }: { scope: ProjectScope; entity: EntityDetail }): ReactNode {
  const t = useTranslations('entitySettings.details');
  const multiSelectHints = useMultiSelectHints();
  const account = useTranslations('account');
  const queryClient = useQueryClient();
  const formId = useId();
  const alertRef = useRef<HTMLDivElement>(null);
  const schema = useMemo(
    () =>
      z.object({
        canonical_name: z
          .string()
          .trim()
          .min(1, { error: t('nameRequired') })
          .max(MAX_NAME_LENGTH, { error: t('nameTooLong', { max: MAX_NAME_LENGTH }) }),
        entity_type: z.enum(ENTITY_TYPES),
        is_ambiguous: z.boolean(),
        disambiguation_hints: z
          .array(z.string().max(MAX_HINT_LENGTH, { error: t('hintTooLong', { max: MAX_HINT_LENGTH }) }))
          .max(MAX_HINTS, { error: t('tooManyHints', { max: MAX_HINTS }) })
          .readonly(),
        parent_entity_id: z.string().nullable(),
        description: z
          .string()
          .max(MAX_DESCRIPTION_LENGTH, { error: t('noteTooLong', { max: MAX_DESCRIPTION_LENGTH }) }),
      }),
    [t],
  );
  const form = useForm<DetailsValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: valuesOf(entity),
  });
  const update = useMutation(apiMutation('patch', '/api/v1/workspaces/{workspace_id}/entities/{entity_id}'));
  const workspaceEntities = useQuery(
    apiQuery('/api/v1/workspaces/{workspace_id}/entities', {
      params: { path: { workspace_id: scope.workspaceId }, query: { limit: PARENT_PAGE } },
    }),
  );
  const { isDirty, dirtyFields } = form.formState;
  const guard = useLeaveGuard(isDirty);
  // A change saved elsewhere is the new baseline, unless the person is editing
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(valuesOf(entity));
  }, [entity, form]);

  const submit = form.handleSubmit(async (values) => {
    const note = values.description.trim();
    const body = {
      ...(dirtyFields.canonical_name === true ? { canonical_name: values.canonical_name.trim() } : {}),
      ...(dirtyFields.entity_type === true ? { entity_type: values.entity_type } : {}),
      ...(dirtyFields.is_ambiguous === true ? { is_ambiguous: values.is_ambiguous } : {}),
      ...(dirtyFields.disambiguation_hints !== undefined
        ? { disambiguation_hints: [...values.disambiguation_hints] }
        : {}),
      ...(dirtyFields.description === true ? { description: note === '' ? null : note } : {}),
      ...(dirtyFields.parent_entity_id === true ? { parent_entity_id: values.parent_entity_id } : {}),
    };
    try {
      await update.mutateAsync({
        params: { path: { workspace_id: scope.workspaceId, entity_id: entity.entity_id } },
        body,
      });
      await queryClient.invalidateQueries({ queryKey: entityQuery(scope.workspaceId, entity.entity_id).queryKey });
      refreshEntities(queryClient, scope);
      form.reset(values);
      announce(t('saved'));
    } catch (error) {
      if (isApiProblem(error, 'duplicate')) {
        form.setError('canonical_name', { type: 'server', message: t('nameTaken') }, { shouldFocus: true });
        return;
      }
      // A parent under this entity would make a loop: a problem of its own, shown on the parent field
      if (isApiProblem(error, 'cycle_detected')) {
        form.setError('parent_entity_id', { type: 'server', message: t('parentCycle') }, { shouldFocus: true });
        return;
      }
      if (isApiProblem(error, 'validation_failed')) {
        const rest = applyServerErrors(form, error.errors, {
          fields: ['canonical_name', 'entity_type', 'description', 'disambiguation_hints', 'parent_entity_id'],
          messages: {
            string_too_short: t('nameRequired'),
            string_too_long: t('nameTooLong', { max: MAX_NAME_LENGTH }),
            too_long: t('tooManyHints', { max: MAX_HINTS }),
            parent_unknown: t('parentGone'),
          },
        });
        if (rest.length === 0) return;
      }
      form.setError('root', { type: 'server', message: t('saveFailed') });
    }
  });
  const onSubmit = useSubmitOnce(submit);
  const rootError = form.formState.errors.root?.message;
  useEffect(() => {
    if (rootError !== undefined) alertRef.current?.focus();
  }, [rootError]);
  const changed = Object.values(dirtyFields).filter(Boolean).length;
  // An entity cannot be its own parent; the API refuses longer cycles (`cycle_detected`)
  const parents: ParentChoice[] = (workspaceEntities.data?.data ?? [])
    .filter((candidate) => candidate.entity_id !== entity.entity_id)
    .map((candidate) => ({ entity_id: candidate.entity_id, canonical_name: candidate.canonical_name }));
  const typeOptions = ENTITY_TYPES.map((type) => ({ value: type, label: t(`types.${type}`) }));

  return (
    <>
      <form id={formId} noValidate className="flex max-w-90 flex-col gap-4" onSubmit={onSubmit}>
        {rootError === undefined ? null : <FormAlert ref={alertRef} tabIndex={-1} live={false} message={rootError} />}
        <FormField
          control={form.control}
          name="canonical_name"
          label={t('name')}
          render={(field) => (
            <Input {...field.controlProps} autoComplete="off" value={field.value} onValueChange={field.onChange} />
          )}
        />
        <FormField
          control={form.control}
          name="entity_type"
          label={t('type')}
          width="medium"
          render={(field) => (
            <Select
              {...field.controlProps}
              value={field.value}
              onValueChange={field.onChange}
              placeholder={t('type')}
              options={typeOptions}
            />
          )}
        />
        <FormField
          control={form.control}
          name="parent_entity_id"
          label={t('parent')}
          optional
          description={t('parentHint')}
          render={(field) => (
            <Combobox<ParentChoice>
              inputRef={field.ref}
              onBlur={field.onBlur}
              value={parents.find((parent) => parent.entity_id === field.value) ?? null}
              onValueChange={(next) => field.onChange(next?.entity_id ?? null)}
              items={parents}
              itemToString={(parent) => parent.canonical_name}
              itemKey={(parent) => parent.entity_id}
              emptyText={(query) => t('parentEmpty', { query })}
              placeholder={t('parentPlaceholder')}
              clearLabel={t('parentClear')}
              openLabel={t('parentOpen')}
            />
          )}
        />
        <FormField
          control={form.control}
          name="is_ambiguous"
          label={t('ambiguous')}
          kind="group"
          render={(field) => (
            <Checkbox
              ref={field.ref}
              checked={field.value}
              onCheckedChange={field.onChange}
              label={t('ambiguousLabel')}
              description={t('ambiguousHint')}
            />
          )}
        />
        <FormField
          control={form.control}
          name="disambiguation_hints"
          label={t('hints')}
          optional
          description={t('hintsHint')}
          render={(field) => (
            <MultiSelect
              inputRef={field.ref}
              onBlur={field.onBlur}
              value={field.value}
              onValueChange={field.onChange}
              items={[]}
              itemToString={(hint) => hint}
              itemKey={(hint) => hint.toLocaleLowerCase()}
              creatable={{ label: (query) => t('addHint', { hint: query }), onCreate: (query) => query }}
              placeholder={t('hintsPlaceholder')}
              emptyText={() => t('hintsHelp')}
              chipsLabel={t('hints')}
              removeLabel={(hint) => t('removeHint', { hint })}
              {...multiSelectHints}
            />
          )}
        />
        <FormField
          control={form.control}
          name="description"
          label={t('note')}
          optional
          render={(field) => (
            <Textarea
              ref={field.ref}
              name={field.name}
              onBlur={field.onBlur}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              counter={
                field.value.length >= COUNTER_FROM
                  ? t('noteCounter', { count: field.value.length, max: MAX_DESCRIPTION_LENGTH })
                  : null
              }
              counterOver={field.value.length > MAX_DESCRIPTION_LENGTH}
            />
          )}
        />
      </form>
      <SaveBar
        visible={isDirty}
        form={formId}
        summary={account('saveBar.summary', { count: changed })}
        saving={update.isPending}
        onDiscard={() => form.reset(valuesOf(entity))}
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
          form.reset(valuesOf(entity));
          guard.leave();
        }}
      />
    </>
  );
}
