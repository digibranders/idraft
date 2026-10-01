'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement, type RefObject } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { BulkDialog } from './bulk-dialog';
import { failureText } from './bulk-failure';
import type { ProjectScope } from '../rankings-queries';
import { useTermChoices, type TermChoice } from '../term-choices';
import { FormField } from '@/components/app/forms/form-field';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { MultiSelect } from '@/components/ui/multi-select';
import { RadioGroup } from '@/components/ui/radio-group';

export type TagMode = 'add' | 'remove';

interface TagValues {
  mode: TagMode;
  term_ids: string[];
}

const START: TagValues = { mode: 'add', term_ids: [] };

export interface TagsDialogProps {
  scope: ProjectScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  countText: string;
  /** Adds the terms to each keyword or takes them off; a rejection's message is shown in the dialog. */
  onApply: (mode: TagMode, termIds: string[]) => Promise<void>;
  finalFocus: RefObject<HTMLElement | null>;
}

/**
 * Add tags (or remove them) for the chosen keywords: terms of any vocabulary the project sees. Adding a
 * term of a single-valued vocabulary replaces the keyword's term of it, so the field keeps one of each.
 */
export function TagsDialog({
  scope,
  open,
  onOpenChange,
  countText,
  onApply,
  finalFocus,
}: TagsDialogProps): ReactElement {
  const t = useTranslations('rankings.bulk.tagsDialog');
  const bulk = useTranslations('rankings.bulk');
  const add = useTranslations('rankings.add');
  const terms = useTermChoices(scope);
  const [alert, setAlert] = useState<string | null>(null);
  const form = useForm<TagValues>({ defaultValues: START });
  const mode = useWatch({ control: form.control, name: 'mode' });
  const modeOptions = [
    { value: 'add' as const, label: t('add') },
    { value: 'remove' as const, label: t('remove') },
  ];
  const close = (): void => {
    form.reset(START);
    setAlert(null);
    onOpenChange(false);
  };
  const submit = useSubmitOnce(
    form.handleSubmit(async (values) => {
      setAlert(null);
      if (values.term_ids.length === 0) {
        form.setError('term_ids', { type: 'required', message: t('required') }, { shouldFocus: true });
        return;
      }
      // Terms picked while removing may hold two of a single-valued vocabulary, which an add cannot take
      const termIds = values.mode === 'add' ? terms.keepOnePerSingleVocabulary(values.term_ids) : values.term_ids;
      try {
        await onApply(values.mode, termIds);
        close();
      } catch (error) {
        setAlert(failureText(error, bulk('failed')));
      }
    }),
  );
  return (
    <BulkDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t('title', { count: countText })}
      description={t('description')}
      submitLabel={mode === 'add' ? t('submitAdd', { count: countText }) : t('submitRemove', { count: countText })}
      pending={form.formState.isSubmitting}
      alert={alert}
      dirty={form.formState.isDirty}
      onSubmit={submit}
      finalFocus={finalFocus}
    >
      <FormField
        control={form.control}
        name="mode"
        label={t('mode')}
        kind="group"
        render={(field) => (
          <RadioGroup<TagMode>
            legend={field.label}
            name={field.controlProps.name}
            value={field.value}
            onValueChange={field.onChange}
            options={modeOptions}
          />
        )}
      />
      <FormField
        control={form.control}
        name="term_ids"
        label={t('tags')}
        render={(field) => (
          <MultiSelect<TermChoice>
            inputRef={field.ref}
            onBlur={field.onBlur}
            value={field.value.flatMap((id) => terms.byId.get(id) ?? [])}
            onValueChange={(chosen) => {
              const ids = chosen.map((choice) => choice.id);
              // Taking terms off can name several of one vocabulary; adding keeps one of a single-valued one
              field.onChange(mode === 'add' ? terms.keepOnePerSingleVocabulary(ids) : ids);
            }}
            items={terms.choices}
            itemToString={(choice) => choice.label}
            itemKey={(choice) => choice.id}
            placeholder={add('tagsPlaceholder')}
            emptyText={(query) => add('tagsEmpty', { query })}
            chipsLabel={add('chips', { field: t('tags') })}
            removeLabel={(value) => add('remove', { value })}
            chipsHint={(count) => add('chipsHint', { count })}
            chipHint={add('chipHint')}
          />
        )}
      />
    </BulkDialog>
  );
}
