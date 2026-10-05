'use client';

import { useTranslations } from 'next-intl';
import { useId, type ReactElement, type ReactNode } from 'react';

import { FIELD_KEYS, IMPORT_FIELDS, type ImportField, type MappingRowProblem } from './import-model';
import type { VocabularyProblems } from './import-state';
import { VocabularyField, type VocabularyListState } from './vocabulary-field';
import type { Vocabulary } from '../taxonomy-queries';
import { GroupError } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { Select, type SelectOption } from '@/components/ui/select';
import { Truncate } from '@/components/ui/truncate';

const IGNORE = 'ignore';
type Choice = ImportField | typeof IGNORE;
/** The vocabulary a mapped column names terms of: tags in any, a topic in a hierarchical one. */
type VocabularyKind = 'tags' | 'topic';

export interface MappingStepProps {
  /** Every header of the file, as the file has them. */
  headers: readonly string[];
  /** The first rows of the file, one list of cells per row, in the order of the headers. */
  samples: readonly (readonly string[])[];
  mapping: Readonly<Record<string, ImportField>>;
  onMappingChange: (header: string, field: ImportField | null) => void;
  tagsVocabulary: string | null;
  topicVocabulary: string | null;
  onVocabularyChange: (kind: VocabularyKind, vocabularyId: string) => void;
  /** The vocabularies the member may name. */
  vocabularies: readonly Vocabulary[];
  /** Whether the vocabularies have arrived, and a way to ask again when they did not. */
  vocabularyList: { state: VocabularyListState; onRetry: () => void };
  problems: {
    form: 'keyword_missing' | null;
    rows: Readonly<Record<string, MappingRowProblem>>;
    /** What the API said of the vocabularies chosen. */
    vocabulary: VocabularyProblems;
  };
  /** A message of the server that belongs to no row. */
  alert: string | null;
  /** While the file is read again after a change. */
  busy: boolean;
}

/** The first values of a column, for the Sample cell. */
const sampleOf = (samples: readonly (readonly string[])[], index: number): string =>
  samples
    .map((row) => row[index]?.trim() ?? '')
    .filter((cell) => cell !== '')
    .join(', ');

interface RowProps {
  header: string;
  sample: string;
  value: Choice;
  onChange: (field: ImportField | null) => void;
  options: readonly SelectOption<Choice>[];
  error: string | null;
  busy: boolean;
  /** Under the choice: the vocabulary of a column that names terms. */
  extra: ReactNode;
}

/** One column of the file: its header, what it maps to and what it holds. */
function MappingRow({ header, sample, value, onChange, options, error, busy, extra }: RowProps): ReactElement {
  const id = useId();
  const errorId = useId();
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-3 sm:items-start">
      <label htmlFor={id} className="min-w-0 type-label break-words sm:pt-2">
        {header}
      </label>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Select<Choice>
          id={id}
          value={value}
          onValueChange={(choice) => onChange(choice === IGNORE ? null : choice)}
          placeholder={header}
          options={options}
          disabled={busy}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : errorId}
        />
        {error === null ? null : <GroupError id={errorId} message={error} />}
        {extra}
      </div>
      <p className="flex min-w-0 type-meta sm:pt-2">
        {sample === '' ? null : <Truncate text={sample} className="min-w-0" />}
      </p>
    </div>
  );
}

/**
 * Step 2 of a file's import: what each column of the file holds. The headers come from the browser's own
 * read of the file's first bytes, since the API reports only the headers that map. A column mapped to tags
 * or to a topic asks for the vocabulary its terms belong to, right under it.
 */
export function MappingStep({
  headers,
  samples,
  mapping,
  onMappingChange,
  tagsVocabulary,
  topicVocabulary,
  onVocabularyChange,
  vocabularies,
  vocabularyList,
  problems,
  alert,
  busy,
}: MappingStepProps): ReactElement {
  const t = useTranslations('rankings.import');
  const options: SelectOption<Choice>[] = [
    { value: IGNORE, label: t('ignore') },
    ...IMPORT_FIELDS.map((field): SelectOption<Choice> => ({ value: field, label: t(`fields.${FIELD_KEYS[field]}`) })),
  ];
  const vocabularyOptions = (kind: VocabularyKind): SelectOption<string>[] =>
    vocabularies
      .filter((vocabulary) => kind === 'tags' || vocabulary.is_hierarchical)
      .map((vocabulary) => ({ value: vocabulary.vocabulary_id, label: vocabulary.name }));
  // The first column mapped to a field owns its vocabulary choice; a second one is an error of its own
  const firstOf = (field: ImportField): string | undefined => headers.find((header) => mapping[header] === field);
  const rowError = (header: string): string | null =>
    problems.rows[header] === 'mapped_twice'
      ? t('mappedTwice')
      : problems.rows[header] === 'header_repeated'
        ? t('headerRepeated')
        : null;

  const vocabularyField = (kind: VocabularyKind, header: string, field: ImportField): ReactElement | null => {
    if (firstOf(field) !== header) return null;
    return (
      <VocabularyField
        label={kind === 'tags' ? t('tagsVocabulary') : t('topicVocabulary')}
        value={kind === 'tags' ? tagsVocabulary : topicVocabulary}
        onChange={(id) => onVocabularyChange(kind, id)}
        options={vocabularyOptions(kind)}
        list={vocabularyList}
        problem={problems.rows[header] === 'vocabulary_missing' ? 'missing' : problems.vocabulary[kind]}
        disabled={busy}
      />
    );
  };

  return (
    <>
      {problems.form === null ? null : <FormAlert message={t('keywordMissing')} />}
      {alert === null ? null : <FormAlert message={alert} />}
      <p className="type-body text-foreground-secondary">{t('mapIntro')}</p>
      <div className="hidden grid-cols-3 gap-x-4 type-meta sm:grid" aria-hidden="true">
        <span>{t('mapColumn')}</span>
        <span>{t('mapTo')}</span>
        <span>{t('mapSample')}</span>
      </div>
      <div className="flex flex-col gap-4">
        {headers.map((header, index) => {
          const field = mapping[header];
          return (
            <MappingRow
              key={header}
              header={header}
              sample={sampleOf(samples, index)}
              value={field ?? IGNORE}
              onChange={(next) => onMappingChange(header, next)}
              options={options}
              error={rowError(header)}
              busy={busy}
              extra={
                field === 'tags'
                  ? vocabularyField('tags', header, 'tags')
                  : field === 'topic'
                    ? vocabularyField('topic', header, 'topic')
                    : null
              }
            />
          );
        })}
      </div>
    </>
  );
}
