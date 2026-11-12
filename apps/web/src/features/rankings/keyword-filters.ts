'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { useKeywordCountries } from './keyword-countries';
import { FUNNEL_STAGES, INTENTS, OFFERED_DEPTH_PROFILES, SOURCE_KEY, SOURCES } from './keyword-values';
import {
  CHANGE_CHOICES,
  RANK_CHOICES,
  STALE_CHOICES,
  AIO_CHOICES,
  AIO_MESSAGE_KEYS,
  TARGET_CHOICES,
} from './rank-filters';
import type { ProjectScope } from './rankings-queries';
import { useKeywordGroups, useVocabularies } from './taxonomy-queries';
import type { FilterField, FilterOption } from '@/components/app/filters/types';
import { LANGUAGE_CODES, languageName } from '@/lib/format/language';
import { FEATURE_TYPES, OWNABLE_FEATURE_TYPES, FEATURE_MESSAGE_KEYS } from '@/lib/keywords/serp-features';
import { useDepthLabel } from '@/lib/keywords/use-depth-label';

// The country list moved to lib, where the AI prompt screens read it too; Rankings keeps its names
export { readCountries, type Country } from '@/lib/locations/countries';

/**
 * The filters of Rankings as chips (backend plan D15, 13-filters-search.md section 4), each under its URL
 * key of section 5: group, country (of those the project has keywords in), tag (a term of any vocabulary the project sees), rank bucket, change, device,
 * location, language, intent, funnel stage, priority at most, source, depth profile, volume at least, KD at
 * most and stale. Groups, terms and locations come from the API; the rest are the API's own values.
 */

export function useKeywordFilterFields(scope: ProjectScope, depth?: number | undefined): readonly FilterField[] {
  const t = useTranslations('rankings.filters');
  const targetT = useTranslations('rankings.target');
  const featureNames = useTranslations('rankings.features.names');
  const aioStates = useTranslations('rankings.aio.states');
  const depthLabel = useDepthLabel();
  const locale = useLocale();
  const groups = useKeywordGroups(scope);
  const vocabularies = useVocabularies(scope);
  // Until every list is in, a value from a link is kept as it is; a list that failed keeps it too
  const groupsLoading = groups.isPending || groups.isError;
  const termsLoading = vocabularies.pending || vocabularies.error;
  const groupOptions = useMemo(
    (): FilterOption[] =>
      (groups.data?.data ?? []).map((group) => ({
        value: group.group_id,
        label: group.path,
        count: group.keyword_count,
      })),
    [groups.data],
  );
  const inUse = useKeywordCountries(scope);
  const countriesLoading = inUse.loading || inUse.failed;
  const countryOptions = useMemo(
    (): FilterOption[] =>
      inUse.countries.map(({ locationId, name, keywordCount }) => ({
        value: String(locationId),
        label: name,
        count: keywordCount,
      })),
    [inUse.countries],
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
      {
        id: 'country',
        kind: 'enum',
        label: t('country'),
        multi: true,
        options: countryOptions,
        // A list that failed keeps a value from a link, as the groups and tags do
        optionsLoading: countriesLoading,
      },
      { id: 'tag', kind: 'enum', label: t('tag'), multi: true, options: termOptions, optionsLoading: termsLoading },
      // One range of places and one change at a time: the API joins its rank filters with AND (rank-filters.ts)
      {
        id: 'rank',
        kind: 'enum',
        label: t('rank'),
        multi: false,
        options: options(RANK_CHOICES, (value) =>
          value === 'beyond' && depth === 100 ? t('rankBuckets.over100') : t(`rankBuckets.${value}`),
        ),
      },
      {
        id: 'chg',
        kind: 'enum',
        label: t('chg'),
        multi: false,
        options: options(CHANGE_CHOICES, (value) => t(`changes.${value}`)),
      },
      {
        id: 'feat',
        kind: 'enum',
        label: t('feature'),
        multi: false,
        options: options(FEATURE_TYPES, (value) => featureNames(FEATURE_MESSAGE_KEYS[value])),
      },
      {
        id: 'featown',
        kind: 'enum',
        label: t('featureOwned'),
        multi: false,
        options: options(OWNABLE_FEATURE_TYPES, (value) => featureNames(FEATURE_MESSAGE_KEYS[value])),
      },
      {
        id: 'aio',
        kind: 'enum',
        label: t('aio'),
        multi: true,
        options: options(AIO_CHOICES, (value) => aioStates(AIO_MESSAGE_KEYS[value])),
      },
      {
        id: 'tmatch',
        kind: 'enum',
        label: t('target'),
        multi: false,
        options: options(TARGET_CHOICES, (value) => (value === 'match' ? targetT('match') : targetT('mismatchChoice'))),
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
    depth,
    t,
    targetT,
    featureNames,
    aioStates,
    locale,
    depthLabel,
    groupOptions,
    countryOptions,
    termOptions,
    groupsLoading,
    countriesLoading,
    termsLoading,
  ]);
}
