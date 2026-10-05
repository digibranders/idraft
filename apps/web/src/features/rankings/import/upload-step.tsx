'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useRef, type ReactElement } from 'react';

import { FileDropzone } from './file-dropzone';
import type { CsvHeadOk, Device, FileProblem, UploadErrors, UploadValues } from './import-state';
import type { Vocabulary } from '../taxonomy-queries';
import { LocationCombobox } from '@/components/app/forms/location-combobox';
import { Field, FieldDescription, FieldError, FieldLabel, Fieldset } from '@/components/ui/field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select, type SelectOption } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { readCsvHead } from '@/lib/csv/csv-head';
import { formatBytes } from '@/lib/format';
import { LANGUAGE_CODES, languageName } from '@/lib/format/language';
import { useLocationSearch } from '@/lib/locations/use-location-search';

/** The API takes files of 50 MB at most. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ACCEPT = '.csv,text/csv';
const CSV_NAME = /\.csv$/i;
const CSV_TYPE = 'text/csv';

type DeviceChoice = Device | 'default';
type Source = UploadValues['source'];

/** What reading a chosen file came to: the file with its head, or why it is not taken. */
export type FileChecked = { file: File; head: CsvHeadOk } | { problem: FileProblem };

/**
 * Whether a file can be imported, as far as the browser can tell before the upload: a CSV, within the size
 * the API takes, UTF-8 and with a header line. The file's head is read here, so the Map step lists every
 * header and a few sample rows without waiting for the API.
 */
export async function checkCsvFile(file: File): Promise<FileChecked> {
  if (!CSV_NAME.test(file.name) && file.type !== CSV_TYPE) return { problem: 'not_csv' };
  if (file.size > MAX_UPLOAD_BYTES) return { problem: 'too_large' };
  const head = await readCsvHead(file);
  if (head.kind === 'not_utf8') return { problem: 'not_utf8' };
  if (head.kind === 'empty') return { problem: 'empty' };
  return { file, head };
}

export interface UploadStepProps {
  values: UploadValues;
  onChange: (patch: Partial<UploadValues>) => void;
  /** A chosen file after the checks of `checkCsvFile`. */
  onFileChecked: (checked: FileChecked) => void;
  errors: UploadErrors;
  /** 0 to 100 while the file uploads or is read; `null` when nothing is. */
  progress: number | null;
  /** The bar's value as words: "42% uploaded", "300 of 1,000 rows read". */
  progressText: string | null;
  /** The file is going up or being read: the step holds still. */
  busy: boolean;
  /** The vocabularies the project sees, for the tags of a paste. */
  vocabularies: readonly Vocabulary[];
}

/**
 * Step 1 of the import: a CSV file or a paste, and the defaults for rows that leave something out. Both
 * sources keep what was entered when the person switches, and again on Back.
 */
export function UploadStep({
  values,
  onChange,
  onFileChecked,
  errors,
  progress,
  progressText,
  busy,
  vocabularies,
}: UploadStepProps): ReactElement {
  const t = useTranslations('rankings.import');
  const locale = useLocale();
  const locations = useLocationSearch();
  // A file chosen after another, before the first was read, wins: the first one's answer is dropped
  const reading = useRef(0);

  const choose = async (file: File): Promise<void> => {
    reading.current += 1;
    const turn = reading.current;
    const checked = await checkCsvFile(file);
    if (turn === reading.current) onFileChecked(checked);
  };
  const remove = (): void => {
    reading.current += 1;
    onChange({ file: null, head: null });
  };

  const languageOptions = useMemo(
    (): SelectOption<string>[] => LANGUAGE_CODES.map((code) => ({ value: code, label: languageName(code, locale) })),
    [locale],
  );
  const deviceOptions: SelectOption<DeviceChoice>[] = [
    { value: 'default', label: t('deviceDefault') },
    { value: 'desktop', label: t('deviceDesktop') },
    { value: 'mobile', label: t('deviceMobile') },
    { value: 'both', label: t('deviceBoth') },
  ];
  const vocabularyOptions = vocabularies.map((vocabulary): SelectOption<string> => ({
    value: vocabulary.vocabulary_id,
    label: vocabulary.name,
  }));
  const fileError: Record<FileProblem, string> = {
    not_csv: t('fileNotCsv'),
    too_large: t('fileTooLarge'),
    not_utf8: t('fileNotUtf8'),
    empty: t('fileEmpty'),
    required: t('fileRequired'),
  };
  const file = values.file;
  const hasTabs = values.paste.includes('\t');

  return (
    <>
      <SegmentedControl<Source>
        semantics="radio"
        label={t('source')}
        value={values.source}
        onValueChange={(source) => onChange({ source })}
        disabled={busy}
        items={[
          { value: 'upload', label: t('sourceFile') },
          { value: 'paste', label: t('sourcePaste') },
        ]}
      />
      {values.source === 'upload' ? (
        <FileDropzone
          accept={ACCEPT}
          constraints={t('constraints')}
          file={file === null ? null : { name: file.name, sizeText: formatBytes(file.size) }}
          onFile={(next) => void choose(next)}
          onRemove={remove}
          error={errors.file === null ? null : fileError[errors.file]}
          progress={progress}
          progressText={progressText}
          disabled={busy}
        />
      ) : (
        <>
          <Field invalid={errors.paste !== null} disabled={busy}>
            <FieldLabel>{t('pasteLabel')}</FieldLabel>
            <Textarea
              value={values.paste}
              onChange={(event) => onChange({ paste: event.target.value })}
              spellCheck={false}
            />
            {errors.paste === null ? (
              <FieldDescription>{t('pasteHint')}</FieldDescription>
            ) : (
              <FieldError message={t('pasteRequired')} />
            )}
          </Field>
          {hasTabs ? (
            <Field invalid={errors.tagsVocabulary} disabled={busy}>
              <FieldLabel>{t('tagsVocabulary')}</FieldLabel>
              <Select<string>
                value={values.tagsVocabulary}
                onValueChange={(tagsVocabulary) => onChange({ tagsVocabulary })}
                placeholder={t('vocabularyPlaceholder')}
                options={vocabularyOptions}
                aria-invalid={errors.tagsVocabulary ? true : undefined}
              />
              {errors.tagsVocabulary ? <FieldError message={t('vocabularyMissing')} /> : null}
            </Field>
          ) : null}
          {busy && progress !== null ? (
            <p role="status" className="type-meta">
              {progressText}
            </p>
          ) : null}
        </>
      )}
      <Fieldset legend={t('options')} disabled={busy}>
        <div className="flex flex-col gap-4">
          <Field disabled={busy}>
            <FieldLabel>{t('location')}</FieldLabel>
            <LocationCombobox
              value={values.location}
              onValueChange={(location) => onChange({ location })}
              items={locations.items}
              loading={locations.loading}
              onQueryChange={locations.onQueryChange}
            />
          </Field>
          <Field disabled={busy}>
            <FieldLabel>{t('language')}</FieldLabel>
            <Select<string>
              value={values.languageCode}
              onValueChange={(languageCode) => onChange({ languageCode })}
              placeholder={t('language')}
              options={languageOptions}
            />
          </Field>
          <Field disabled={busy}>
            <FieldLabel>{t('device')}</FieldLabel>
            <Select<DeviceChoice>
              value={values.device ?? 'default'}
              onValueChange={(choice) => onChange({ device: choice === 'default' ? null : choice })}
              placeholder={t('device')}
              options={deviceOptions}
            />
          </Field>
        </div>
      </Fieldset>
    </>
  );
}
