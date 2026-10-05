'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { VocabularyProblem } from './import-state';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Select, type SelectOption } from '@/components/ui/select';

/** Whether the list of vocabularies to choose from has arrived. */
export type VocabularyListState = 'loading' | 'error' | 'ready';

export interface VocabularyFieldProps {
  label: string;
  value: string | null;
  onChange: (vocabularyId: string) => void;
  options: readonly SelectOption<string>[];
  list: { state: VocabularyListState; onRetry: () => void };
  /** What is wrong with the choice: none made (`missing`), or the API's word on the one made. */
  problem: VocabularyProblem | 'missing' | null;
  disabled: boolean;
}

/**
 * The choice of the vocabulary a column's or a paste's terms belong to. While the list loads it says so, and
 * when it could not be loaded it says that and offers Retry, so an empty list is never left unexplained.
 */
export function VocabularyField({
  label,
  value,
  onChange,
  options,
  list,
  problem,
  disabled,
}: VocabularyFieldProps): ReactElement {
  const t = useTranslations('rankings.import');
  const common = useTranslations('common');
  const message =
    problem === 'missing'
      ? t('vocabularyMissing')
      : problem === 'not_allowed'
        ? t('vocabularyNotAllowed')
        : problem === 'unknown'
          ? t('vocabularyUnknown')
          : null;
  return (
    <Field invalid={problem !== null} disabled={disabled}>
      <FieldLabel>{label}</FieldLabel>
      <Select<string>
        value={value}
        onValueChange={onChange}
        placeholder={t('vocabularyPlaceholder')}
        options={options}
        aria-invalid={problem === null ? undefined : true}
      />
      {list.state === 'loading' ? <FieldDescription>{t('vocabulariesLoading')}</FieldDescription> : null}
      {list.state === 'error' ? (
        <div className="flex items-center gap-3">
          <p className="type-meta">{t('vocabulariesFailed')}</p>
          <Button variant="secondary" size="sm" onClick={list.onRetry}>
            {common('retry')}
          </Button>
        </div>
      ) : null}
      {message === null ? null : <FieldError message={message} />}
    </Field>
  );
}
