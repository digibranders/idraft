'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { FUNNEL_STAGES, INTENTS, OFFERED_DEPTH_PROFILES, SOURCE_KEY, SOURCES } from './keyword-values';
import { CHANGE_CHOICES, RANK_CHOICES, STALE_CHOICES } from './rank-filters';
import type { ProjectScope } from './rankings-queries';
import { useKeywordGroups, useVocabularies } from './taxonomy-queries';
import type { FilterField, FilterOption } from '@/components/app/filters/types';
import { api, unwrap } from '@/lib/api/client';
import type { ApiResponse } from '@/lib/api/query';
import { LANGUAGE_CODES, languageName } from '@/lib/format/language';
import { useDepthLabel } from '@/lib/keywords/use-depth-label';

/**
 * The filters of Rankings as chips (backend plan D15, 13-filters-search.md section 4), each under its URL
 * key of section 5: group, tag (a term of any vocabulary the project sees), rank bucket, change, device,
 * location, language, intent, funnel stage, priority at most, source, depth profile, volume at least, KD at
 * most and stale. Groups, terms and locations come from the API; the rest are the API's own values.
 */

/** The countries a keyword is tracked in; regions and cities wait for a location search in the editor. */
const COUNTRIES = { 'filter[location_type]': 'Country', 'filter[supports]': 'serp', limit: 200 } as const;
/** About 250 countries exist; the reading stops here whatever the API says. */
const MAX_COUNTRY_PAGES = 5;

type Location = ApiResponse<'get', '/api/v1/locations'>['data'][number];

/** Every country the API lists, page after page: a link's location must be among them to be kept. */
async function readCountries(signal: AbortSignal): Promise<Location[]> {
  const found: Location[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_COUNTRY_PAGES; page += 1) {
    const answer: ApiResponse<'get', '/api/v1/locations'> = await unwrap(
      api.GET('/api/v1/locations', {
        params: { query: { ...COUNTRIES, ...(cursor === null ? {} : { cursor }) } },
        signal,
      }),
    );
    found.push(...answer.data);
    cursor = answer.page.has_more ? answer.page.next_cursor : null;
    if (cursor === null) break;
  }
  return found;
}

export function useKeywordFilterFields(scope: ProjectScope): readonly FilterField[] {
  const t = useTranslations('rankings.filters');
  const depthLabel = useDepthLabel();
  const locale = useLocale();
  const groups = useKeywordGroups(scope);
  const vocabularies = useVocabularies(scope);
  // Until every list is in, a value from a link is kept as it is; a list that failed keeps it too
  const groupsLoading = groups.isPending || groups.isError;
  const termsLoading = vocabularies.pending || vocabularies.error;
  const locations = useQuery({
    queryKey: ['locations', 'countries', 'all'],
    queryFn: ({ signal }) => readCountries(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const locationsLoading = locations.isPending || locations.isError;

  const groupOptions = useMemo(
    (): FilterOption[] =>
      (groups.data?.data ?? []).map((group) => ({
        value: group.group_id,
        label: group.path,
        count: group.keyword_count,
      })),
    [groups.data],
  );
  const termOptions = useMemo(
    (): FilterOption[] =>
      vocabularies.loaded.flatMap(({ vocabulary, terms }) =>
        terms.map((term) => ({
          value: term.termId,
          label: t('termLabel', { vocabulary: vocabulary.name, term: term.path }),
        })),
      ),
    [t, vocabularies.loaded],
  );
  const locationOptions = useMemo(
    (): FilterOption[] =>
      (locations.data ?? []).map((location) => ({ value: String(location.location_id), label: location.name })),
    [locations.data],
  );

  return useMemo((): FilterField[] => {
    const options = <T extends string>(values: readonly T[], label: (value: T) => string): FilterOption[] =>
      values.map((value) => ({ value, label: label(value) }));
    return [
      {
        id: 'grp',
        kind: 'enum',
        label: t('group'),
        multi: false,
        options: groupOptions,
        optionsLoading: groupsLoading,
      },
      { id: 'tag', kind: 'enum', label: t('tag'), multi: true, options: termOptions, optionsLoading: termsLoading },
      // One range of places and one change at a time: the API joins its rank filters with AND (rank-filters.ts)
      {
        id: 'rank',
        kind: 'enum',
        label: t('rank'),
        multi: false,
        options: options(RANK_CHOICES, (value) => t(`rankBuckets.${value}`)),
      },
      {
        id: 'chg',
        kind: 'enum',
        label: t('chg'),
        multi: false,
        options: options(CHANGE_CHOICES, (value) => t(`changes.${value}`)),
      },
      {
        id: 'dev',
        kind: 'enum',
        label: t('device'),
        multi: false,
        options: options(['desktop', 'mobile'] as const, (value) => t(`devices.${value}`)),
      },
      {
        id: 'loc',
        kind: 'enum',
        label: t('location'),
        multi: false,
        options: locationOptions,
        optionsLoading: locationsLoading,
      },
      {
        id: 'lang',
        kind: 'enum',
        label: t('language'),
        multi: false,
        options: options(LANGUAGE_CODES, (code) => languageName(code, locale)),
      },
      {
        id: 'intent',
        kind: 'enum',
        label: t('intent'),
        multi: true,
        options: options(INTENTS, (value) => t(`intents.${value}`)),
      },
      {
        id: 'stage',
        kind: 'enum',
        label: t('stage'),
        multi: true,
        options: options(FUNNEL_STAGES, (value) => t(`stages.${value}`)),
      },
      { id: 'prio', kind: 'range', label: t('priority'), ends: 'max', bounds: { min: 1, max: 5 } },
      {
        id: 'src',
        kind: 'enum',
        label: t('source'),
        multi: true,
        options: options(SOURCES, (value) => t(`sources.${SOURCE_KEY[value]}`)),
      },
      {
        id: 'depth',
        kind: 'enum',
        label: t('depth'),
        multi: true,
        options: options(OFFERED_DEPTH_PROFILES, depthLabel),
      },
      { id: 'vol', kind: 'range', label: t('volume'), ends: 'min', bounds: { min: 0, max: 100_000_000 } },
      { id: 'kd', kind: 'range', label: t('difficulty'), ends: 'max', bounds: { min: 0, max: 100 } },
      {
        id: 'stale',
        kind: 'enum',
        label: t('stale'),
        multi: false,
        options: options(STALE_CHOICES, (value) => t(`staleStates.${value}`)),
      },
    ];
  }, [
    t,
    locale,
    depthLabel,
    groupOptions,
    termOptions,
    locationOptions,
    groupsLoading,
    termsLoading,
    locationsLoading,
  ]);
}
