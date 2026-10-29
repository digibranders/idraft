'use client';

import { ArrowUpRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { col, type UnknownValue } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { Icon } from '@/components/ui/icon';
import { Tooltip } from '@/components/ui/tooltip';
import type { EntityRef, TrackedKeywordRow } from '@/lib/api/types';
import { languageName } from '@/lib/format/language';
import { TargetMismatchMarker } from './feature-cells';
import { useCompetitorColumns, useRankColumns } from './rank-columns';
import type { SortKey } from '@/lib/tables/table-state';

/**
 * The columns of Rankings (24-page-templates.md section 9.3), in the template's order: Keyword, Rank, Change,
 * Ranking URL, Volume, KD, CPC, Intent, SERP features, AI Overview, Priority, Group, Tags, Best rank (in the column chooser only),
 * Updated (the last successful check) and Added. The rank, SERP feature and AI Overview columns are built in `rank-columns.tsx`.
 * Waiting for their own plans are the template's sparkline and competitor columns. The ids of
 * the sortable columns are the API's sort fields, so server mode sends them as they are.
 */

/** Volume descending, the template's default. */
export const DEFAULT_SORT: readonly SortKey[] = [{ id: 'search_volume', desc: true }];

/** The API's sort fields, which are the sortable columns' ids. */
export const SORT_FIELDS: ReadonlySet<string> = new Set([
  'keyword',
  'current_rank',
  'rank_change',
  'best_rank',
  'last_observed_at',
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

export function useKeywordColumns(
  timeZone: string,
  competitors: readonly EntityRef[] = [],
): readonly DataTableColumn<TrackedKeywordRow>[] {
  const t = useTranslations('rankings.columns');
  const common = useTranslations('common');
  const targetT = useTranslations('rankings.target');
  const locale = useLocale();
  const ranks = useRankColumns(timeZone);
  const competitorColumns = useCompetitorColumns(competitors, timeZone);
  return useMemo(() => {
    // Before Labs answers there is nothing; after an empty answer there is no data (12-tables.md 7.3)
    const pending: UnknownValue = { label: t('pending'), tooltip: t('pendingTooltip') };
    const noData: UnknownValue = { label: t('noData'), tooltip: t('noDataTooltip') };
    const metrics = (row: TrackedKeywordRow): NonNullable<TrackedKeywordRow['metrics']> | null => row.metrics ?? null;
    const missing = (row: TrackedKeywordRow): UnknownValue => (metrics(row) === null ? pending : noData);
    return [
      col.keyword<TrackedKeywordRow>('keyword', keywordText, {
        header: t('keyword'),
        detail: (row) => {
          const keywordDetail = t('keywordDetail', {
            location: row.location.name,
            device: t(row.device === 'mobile' ? 'mobile' : 'desktop'),
            engine: t('google'),
            language: languageName(row.language_code, locale),
          });
          if (row.state.target_url_match === false) {
            const mismatchSentence = targetT('mismatch', {
              ranking: row.state.current.url?.path ?? '',
              target: row.target_url?.path ?? '',
            });
            return [keywordDetail, mismatchSentence].join(' ');
          }
          return keywordDetail;
        },
        marker: (row) => (row.state.target_url_match === false ? <TargetMismatchMarker /> : null),
        trailing: (row) => {
          const url = row.state.current.url;
          if (!url || row.state.current.state !== 'ranked') return null;
          const hostPath = `${url.host}${url.path}`;
          const extra = Math.max(0, (row.state.ranking_url_count ?? 1) - 1);
          const more = extra > 0 ? ` (+${extra} more ranking pages)` : '';
          const tip = `${hostPath}${more}`;
          const ariaLabel = `Open the ranking page of ${row.keyword.text}: ${url.canonical_url}`;
          return (
            <Tooltip purpose="label" content={tip}>
              <a
                href={url.canonical_url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={ariaLabel}
                onClick={(e) => e.stopPropagation()}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-hover hover:text-foreground"
              >
                <Icon icon={ArrowUpRight} size="default" />
              </a>
            </Tooltip>
          );
        },
      }),
      ranks.rank,
      ranks.url,
      col.volume<TrackedKeywordRow>('search_volume', (row) => metrics(row)?.search_volume.value ?? null, {
        header: t('volume'),
        headerTooltip: t('volumeTooltip'),
        priority: 2,
        width: 96,
        unknown: missing,
      }),
      col.count<TrackedKeywordRow>('keyword_difficulty', (row) => metrics(row)?.keyword_difficulty ?? null, {
        header: t('difficulty'),
        headerTooltip: t('difficultyTooltip'),
        priority: 2,
        width: 72,
        unknown: missing,
      }),
      col.currency<TrackedKeywordRow>(
        'cpc_usd',
        (row) => {
          const cpc = metrics(row)?.cpc_usd ?? null;
          return cpc === null ? null : Number(cpc);
        },
        { header: t('cpc'), headerTooltip: t('cpcTooltip'), priority: 2, width: 112, unknown: missing },
      ),
      col.text<TrackedKeywordRow>('intent', (row) => (row.intent === 'unknown' ? null : t(`intents.${row.intent}`)), {
        header: t('intent'),
        priority: 3,
        width: 96,
        sortable: false,
        unknown: (row) => (metrics(row) === null ? pending : { label: t('intentUnknown') }),
      }),
      ranks.features,
      ranks.aio,
      ...competitorColumns,
      ranks.trend,
      col.count<TrackedKeywordRow>('priority', (row) => row.priority, {
        header: t('priority'),
        headerTooltip: t('priorityTooltip'),
        priority: 3,
        // "PRIORITY" with its sort arrow needs 100 px, which is more than a count column holds
        width: 100,
        minWidth: 100,
        defaultVisible: false,
      }),
      col.text<TrackedKeywordRow>(
        'group',
        (row) => {
          const paths = (row.groups ?? []).map((group) => group.path);
          return paths.length === 0 ? null : paths.join(', ');
        },
        { header: t('group'), priority: 3, width: 104, sortable: false, unknown: () => ({ label: t('none') }) },
      ),
      col.text<TrackedKeywordRow>(
        'tags',
        (row) => {
          const names = (row.terms ?? []).map((term) => term.name);
          return names.length === 0 ? null : names.join(', ');
        },
        { header: t('tags'), priority: 4, width: 104, sortable: false, unknown: () => ({ label: t('none') }) },
      ),
      ranks.best,
      ranks.updated,
      col.date<TrackedKeywordRow>('created_at', (row) => row.created_at, {
        header: t('added'),
        headerTooltip: common('timesIn', { timeZone }),
        priority: 4,
        width: 112,
        timeZone,
        secondary: true,
      }),
    ];
  }, [t, targetT, common, locale, timeZone, ranks, competitorColumns]);
}
