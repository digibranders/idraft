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

export function useKeywordColumns(timeZone: string): readonly DataTableColumn<TrackedKeywordRow>[] {
  const t = useTranslations('rankings.columns');
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
        priority: 4,
        timeZone,
        secondary: true,
      }),
    ];
  }, [t, locale, timeZone]);
}
