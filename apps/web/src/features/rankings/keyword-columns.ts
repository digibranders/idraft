'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { col, type UnknownValue } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import type { TrackedKeywordRow } from '@/lib/api/types';
import { languageName } from '@/lib/format/language';
import type { SortKey } from '@/lib/tables/table-state';

/**
 * The columns of Rankings for step 5 part 1 (24-page-templates.md section 9.3), in the template's order
 * with the rank columns left out until rank collection: Keyword, Volume, KD, CPC, Intent, Priority, Group,
 * Tags, Added. The ids of the sortable ones are the API's sort fields, so server mode sends them as they are.
 */

/** Volume descending, the template's default. */
export const DEFAULT_SORT: readonly SortKey[] = [{ id: 'search_volume', desc: true }];

/** The API's sort fields, which are the sortable columns' ids. */
export const SORT_FIELDS: ReadonlySet<string> = new Set([
  'keyword',
  'search_volume',
  'keyword_difficulty',
  'cpc_usd',
  'priority',
  'created_at',
]);

export const rowId = (row: TrackedKeywordRow): string => row.tracked_keyword_id;
export const keywordText = (row: TrackedKeywordRow): string => row.keyword.text;

/**
 * What names a keyword's row for assistive technology ("Select seo agency, mobile, Germany"): the text, the
 * device and the location, as one keyword is tracked on both devices and in more than one place, and the
 * language when it is not the project's.
 */
export function useKeywordRowName(projectLanguage: string | null): (row: TrackedKeywordRow) => string {
  const t = useTranslations('rankings.columns');
  const locale = useLocale();
  return useMemo(
    () => (row) => {
      const parts = {
        keyword: row.keyword.text,
        device: t(row.device === 'mobile' ? 'mobile' : 'desktop').toLocaleLowerCase(locale),
        location: row.location.name,
      };
      return row.language_code === projectLanguage
        ? t('rowName', parts)
        : t('rowNameLanguage', { ...parts, language: languageName(row.language_code, locale) });
    },
    [t, locale, projectLanguage],
  );
}

export function useKeywordColumns(timeZone: string): readonly DataTableColumn<TrackedKeywordRow>[] {
  const t = useTranslations('rankings.columns');
  const common = useTranslations('common');
  const locale = useLocale();
  return useMemo(() => {
    // Before Labs answers there is nothing; after an empty answer there is no data (12-tables.md 7.3)
    const pending: UnknownValue = { label: t('pending'), tooltip: t('pendingTooltip') };
    const noData: UnknownValue = { label: t('noData'), tooltip: t('noDataTooltip') };
    const metrics = (row: TrackedKeywordRow): NonNullable<TrackedKeywordRow['metrics']> | null => row.metrics ?? null;
    const missing = (row: TrackedKeywordRow): UnknownValue => (metrics(row) === null ? pending : noData);
    return [
      col.keyword<TrackedKeywordRow>('keyword', keywordText, {
        header: t('keyword'),
        detail: (row) =>
          t('keywordDetail', {
            location: row.location.name,
            device: t(row.device === 'mobile' ? 'mobile' : 'desktop'),
            engine: t('google'),
            language: languageName(row.language_code, locale),
          }),
      }),
      col.volume<TrackedKeywordRow>('search_volume', (row) => metrics(row)?.search_volume.value ?? null, {
        header: t('volume'),
        headerTooltip: t('volumeTooltip'),
        priority: 1,
        unknown: missing,
      }),
      col.count<TrackedKeywordRow>('keyword_difficulty', (row) => metrics(row)?.keyword_difficulty ?? null, {
        header: t('difficulty'),
        headerTooltip: t('difficultyTooltip'),
        priority: 2,
        unknown: missing,
      }),
      col.currency<TrackedKeywordRow>(
        'cpc_usd',
        (row) => {
          const cpc = metrics(row)?.cpc_usd ?? null;
          return cpc === null ? null : Number(cpc);
        },
        { header: t('cpc'), headerTooltip: t('cpcTooltip'), priority: 2, unknown: missing },
      ),
      col.badge<TrackedKeywordRow>(
        'intent',
        (row) =>
          row.intent === 'unknown'
            ? null
            : {
                label: t(`intents.${row.intent}`),
                ...(row.intent_source === 'manual' ? { detail: t('manual') } : {}),
              },
        {
          header: t('intent'),
          priority: 3,
          sortable: false,
          unknown: (row) => (metrics(row) === null ? pending : { label: t('intentUnknown') }),
        },
      ),
      col.count<TrackedKeywordRow>('priority', (row) => row.priority, {
        header: t('priority'),
        headerTooltip: t('priorityTooltip'),
        priority: 3,
        width: 80,
      }),
      col.text<TrackedKeywordRow>(
        'group',
        (row) => {
          const paths = (row.groups ?? []).map((group) => group.path);
          return paths.length === 0 ? null : paths.join(', ');
        },
        { header: t('group'), priority: 3, sortable: false, unknown: () => ({ label: t('none') }) },
      ),
      col.text<TrackedKeywordRow>(
        'tags',
        (row) => {
          const names = (row.terms ?? []).map((term) => term.name);
          return names.length === 0 ? null : names.join(', ');
        },
        { header: t('tags'), priority: 4, sortable: false, unknown: () => ({ label: t('none') }) },
      ),
      col.date<TrackedKeywordRow>('created_at', (row) => row.created_at, {
        header: t('added'),
        headerTooltip: common('timesIn', { timeZone }),
        priority: 4,
        timeZone,
        secondary: true,
      }),
    ];
  }, [t, common, locale, timeZone]);
}
