'use client';

import { ArrowUpRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { col, type UnknownValue } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { Icon } from '@/components/ui/icon';
import type { EntityRef, TrackedKeywordRow } from '@/lib/api/types';
import { languageName } from '@/lib/format/language';
import { TargetMismatchMarker } from './feature-cells';
import { GSC_CLICKS, GSC_IMPRESSIONS, gscCount, gscStateOf } from './gsc-counts';
import type { Device, PairedRow } from './keyword-pairs';
import type { KeywordCountry } from './keyword-countries';
import { useCountries } from './keyword-scope';
import { RankingPagesCard, rankingPages } from './ranking-pages';
import { useCompetitorColumns, useRankColumns } from './rank-columns';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';
import type { SortKey } from '@/lib/tables/table-state';

/**
 * The columns of Rankings (24-page-templates.md section 9.3), in the template's order: Keyword, Country (only while more than one country is in view), Rank (with its Change, of the device shown),
 * Ranking URL, Volume, Clicks and Impressions (Search Console, 28 days), KD, Intent, SERP features, AI Overview, CPC, Priority, Group, Tags, Best rank (in the column chooser only),
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
  GSC_CLICKS,
  GSC_IMPRESSIONS,
  'keyword_difficulty',
  'cpc_usd',
  'priority',
  'created_at',
]);

/** The id of the Country column, which the table shows only while more than one country is in view. */
export const COUNTRY_COLUMN = 'country';

export const rowId = (row: TrackedKeywordRow): string => row.tracked_keyword_id;
export const keywordText = (row: TrackedKeywordRow): string => row.keyword.text;

/**
 * What names a keyword's row for assistive technology ("Select seo agency, Germany"): the text and the
 * location, as one keyword is tracked in more than one place, and the language when it is not the project's.
 * The row holds both devices, so the device is not part of the name.
 */
export function useKeywordRowName(projectLanguage: string | null): (row: TrackedKeywordRow) => string {
  const t = useTranslations('rankings.columns');
  const locale = useLocale();
  return useMemo(
    () => (row) => {
      const parts = { keyword: row.keyword.text, location: row.location.name };
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
  device: Device = 'desktop',
  /** The countries the project has keywords in, which name a row's country before the list of every country is in. */
  inUse: readonly KeywordCountry[] = [],
): readonly DataTableColumn<PairedRow>[] {
  const t = useTranslations('rankings.columns');
  const common = useTranslations('common');
  const targetT = useTranslations('rankings.target');
  const ranks = useRankColumns(timeZone);
  const competitorColumns = useCompetitorColumns(competitors);
  const countries = useCountries();
  // The countries in use come last, so their names win; a row's own location name is the last resort
  const countryNames = useMemo(
    (): ReadonlyMap<string, string> =>
      new Map([
        ...countries.map((country): [string, string] => [country.country_iso, country.name]),
        ...inUse.map((country): [string, string] => [country.countryIso, country.name]),
      ]),
    [countries, inUse],
  );
  return useMemo(() => {
    // Before Labs answers there is nothing; after an empty answer there is no data (12-tables.md 7.3)
    const pending: UnknownValue = { label: t('pending'), tooltip: t('pendingTooltip') };
    const noData: UnknownValue = { label: t('noData'), tooltip: t('noDataTooltip') };
    const metrics = (row: TrackedKeywordRow): NonNullable<TrackedKeywordRow['metrics']> | null => row.metrics ?? null;
    const missing = (row: TrackedKeywordRow): UnknownValue => (metrics(row) === null ? pending : noData);
    // No Search Console count is either the wait for the first pull or no connection, never an estimate
    const gscUnknown = (row: TrackedKeywordRow): UnknownValue =>
      gscStateOf(row) === 'not_connected'
        ? { label: t('gscNotConnected'), tooltip: t('gscNotConnectedTooltip') }
        : { label: t('pending'), tooltip: t('gscPendingTooltip') };
    const columns: DataTableColumn<PairedRow>[] = [
      col.keyword<TrackedKeywordRow>('keyword', keywordText, {
        header: t('keyword'),
        // Only a warning is worth a tooltip here: the ranking page is not the target page
        detail: (row) =>
          row.state.target_url_match === false
            ? targetT('mismatch', {
                ranking: row.state.current.url?.path ?? '',
                target: row.target_url?.path ?? '',
              })
            : undefined,
        marker: (row) => (row.state.target_url_match === false ? <TargetMismatchMarker /> : null),
        trailing: (row) => {
          const url = row.state.current.url;
          if (!url || row.state.current.state !== 'ranked') return null;
          const pages = rankingPages(row, device);
          const count = pages.length > 0 ? pages.length : Math.max(1, row.state.ranking_url_count ?? 1);
          const parts = { keyword: row.keyword.text, url: url.canonical_url, count };
          const link = (
            <a
              {...CELL_CONTROL}
              href={url.canonical_url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={count > 1 ? t('openRankingPageMany', parts) : t('openRankingPage', parts)}
              onClick={(e) => e.stopPropagation()}
              className="flex h-7 min-w-7 shrink-0 items-center justify-center gap-0.5 rounded-md px-1 text-foreground-muted hover:bg-surface-hover hover:text-foreground"
            >
              <Icon icon={ArrowUpRight} size="default" />
              {count > 1 ? <span className="num type-micro text-warning-text">{count}</span> : null}
            </a>
          );
          return pages.length === 0 ? (
            link
          ) : (
            <RankingPagesCard trigger={link} pages={pages} checkedAt={row.state.last_observed_at} timeZone={timeZone} />
          );
        },
      }),
      // The name by ISO code, as a keyword's location may be a city of the country
      col.text<TrackedKeywordRow>(
        COUNTRY_COLUMN,
        (row) => countryNames.get(row.location.country_iso) ?? row.location.name,
        { header: t('country'), priority: 2, width: 120, sortable: false },
      ),
      ranks.rank,
      ranks.url,
      col.volume<TrackedKeywordRow>('search_volume', (row) => metrics(row)?.search_volume.value ?? null, {
        header: t('volume'),
        priority: 2,
        width: 96,
        unknown: missing,
      }),
      col.volume<TrackedKeywordRow>(GSC_CLICKS, (row) => gscCount(row, 'clicks'), {
        header: t('clicks'),
        headerTooltip: t('gscTooltip'),
        priority: 2,
        width: 96,
        unknown: gscUnknown,
      }),
      col.volume<TrackedKeywordRow>(GSC_IMPRESSIONS, (row) => gscCount(row, 'impressions'), {
        header: t('impressions'),
        headerTooltip: t('gscTooltip'),
        priority: 2,
        width: 112,
        unknown: gscUnknown,
      }),
      col.count<TrackedKeywordRow>('keyword_difficulty', (row) => metrics(row)?.keyword_difficulty ?? null, {
        header: t('difficulty'),
        headerTooltip: t('difficultyTooltip'),
        priority: 2,
        width: 72,
        unknown: missing,
      }),
      col.text<TrackedKeywordRow>('intent', (row) => (row.intent === 'unknown' ? null : t(`intents.${row.intent}`)), {
        header: t('intent'),
        priority: 3,
        width: 96,
        sortable: false,
        unknown: (row) => (metrics(row) === null ? pending : { label: t('intentUnknown') }),
      }),
      ranks.features,
      ranks.aio,
      col.currency<TrackedKeywordRow>(
        'cpc_usd',
        (row) => {
          const cpc = metrics(row)?.cpc_usd ?? null;
          return cpc === null ? null : Number(cpc);
        },
        { header: t('cpc'), priority: 2, width: 112, unknown: missing },
      ),
      ...competitorColumns,
      ranks.trend,
      col.count<TrackedKeywordRow>('priority', (row) => row.priority, {
        header: t('priority'),
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
    return columns;
  }, [t, targetT, common, timeZone, ranks, competitorColumns, device, countryNames]);
}
