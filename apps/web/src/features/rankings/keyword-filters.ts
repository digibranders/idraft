'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import type { ProjectScope } from './rankings-queries';
import type { FilterField, FilterOption } from '@/components/app/filters/types';
import { api, unwrap } from '@/lib/api/client';
import { apiQuery, type ApiResponse } from '@/lib/api/query';
import type { TermNode } from '@/lib/api/types';
import { LANGUAGE_CODES, languageName } from '@/lib/format/language';

/**
 * The filters of Rankings as chips (backend plan D15, 13-filters-search.md section 4), each under its URL
 * key of section 5: group, tag (a term of any vocabulary the project sees), device, location, language,
 * intent, funnel stage, priority at most, source, depth profile, volume at least and KD at most. Groups,
 * terms and locations come from the API; the rest are the API's own values.
 */

const GROUPS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups';
const VOCABULARIES = '/api/v1/workspaces/{workspace_id}/vocabularies';
const TERMS = '/api/v1/workspaces/{workspace_id}/vocabularies/{vocabulary_id}/terms';
/** As the taxonomy screen asks, so the two share the cache. */
const VOCABULARY_PAGE = 200;
/** The countries a keyword is tracked in; regions and cities wait for a location search in the editor. */
const COUNTRIES = { 'filter[location_type]': 'Country', 'filter[supports]': 'serp', limit: 200 } as const;
/** About 250 countries exist; the reading stops here whatever the API says. */
const MAX_COUNTRY_PAGES = 5;

const INTENTS = ['commercial', 'informational', 'navigational', 'transactional', 'local', 'unknown'] as const;
const STAGES = ['tofu', 'mofu', 'bofu', 'retention', 'unknown'] as const;
const SOURCES = ['manual', 'csv_import', 'bulk_paste', 'api', 'gsc_import', 'discovery'] as const;
const DEPTHS = ['light', 'standard', 'deep', 'full', 'weekly', 'weekly_light', 'until_own_match_100'] as const;
/** The message keys of the API's values: the catalog names keys in camel case. */
const SOURCE_KEY = {
  manual: 'manual',
  csv_import: 'csvImport',
  bulk_paste: 'bulkPaste',
  api: 'api',
  gsc_import: 'gscImport',
  discovery: 'discovery',
} as const satisfies Record<(typeof SOURCES)[number], string>;
const DEPTH_KEY = {
  light: 'light',
  standard: 'standard',
  deep: 'deep',
  full: 'full',
  weekly: 'weekly',
  weekly_light: 'weeklyLight',
  until_own_match_100: 'untilOwnMatch100',
} as const satisfies Record<(typeof DEPTHS)[number], string>;

/** Each term's place by name, "SEO / Local SEO", depth first. */
function namedPaths(nodes: readonly TermNode[], above = ''): [string, string][] {
  return nodes.flatMap((node) => {
    const path = above === '' ? node.name : `${above} / ${node.name}`;
    const entry: [string, string] = [node.term_id, path];
    return [entry, ...namedPaths(node.children, path)];
  });
}

type TermTree = ApiResponse<'get', typeof TERMS>;
type Location = ApiResponse<'get', '/api/v1/locations'>['data'][number];

/** The trees of the vocabularies, and whether any is still loading. */
const combineTrees = (
  results: readonly { data?: TermTree | undefined; isPending: boolean; isError: boolean }[],
): { trees: (TermTree | undefined)[]; pending: boolean } => ({
  trees: results.map((result) => result.data),
  pending: results.some((result) => result.isPending || result.isError),
});

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
  const locale = useLocale();
  const groups = useQuery(
    apiQuery(GROUPS, {
      params: {
        path: { workspace_id: scope.workspaceId, project_id: scope.projectId },
        query: { format: 'flat' },
      },
    }),
  );
  const vocabularies = useQuery(
    apiQuery(VOCABULARIES, {
      params: {
        path: { workspace_id: scope.workspaceId },
        query: { 'filter[project_id]': scope.projectId, limit: VOCABULARY_PAGE },
      },
    }),
  );
  const terms = useQueries({
    queries: (vocabularies.data?.data ?? []).map((vocabulary) =>
      apiQuery(TERMS, {
        params: {
          path: { workspace_id: scope.workspaceId, vocabulary_id: vocabulary.vocabulary_id },
          query: { format: 'tree' },
        },
      }),
    ),
    combine: combineTrees,
  });
  const trees = terms.trees;
  // Until every list is in, a value from a link is kept as it is; a list that failed keeps it too
  const groupsLoading = groups.isPending || groups.isError;
  const termsLoading = vocabularies.isPending || vocabularies.isError || terms.pending;
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
      (vocabularies.data?.data ?? []).flatMap((vocabulary, index) =>
        namedPaths(trees[index]?.data ?? []).map(([termId, path]) => ({
          value: termId,
          label: t('termLabel', { vocabulary: vocabulary.name, term: path }),
        })),
      ),
    [t, vocabularies.data, trees],
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
        options: options(STAGES, (value) => t(`stages.${value}`)),
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
        options: options(DEPTHS, (value) => t(`depths.${DEPTH_KEY[value]}`)),
      },
      { id: 'vol', kind: 'range', label: t('volume'), ends: 'min', bounds: { min: 0, max: 100_000_000 } },
      { id: 'kd', kind: 'range', label: t('difficulty'), ends: 'max', bounds: { min: 0, max: 100 } },
    ];
  }, [t, locale, groupOptions, termOptions, locationOptions, groupsLoading, termsLoading, locationsLoading]);
}
