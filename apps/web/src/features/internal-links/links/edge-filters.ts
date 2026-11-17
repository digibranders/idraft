import { MAX_TAGS, MAX_TIERS, UNTIERED_VALUE, UUID } from '../pages/page-filters';
import type { LinksTranslate } from '../tabs';
import { searchText, type LinksState } from '../url-state';
import type { FilterField, FilterValues } from '@/components/app/filters/types';
import type { DownloadQuery } from '@/lib/api/download';
import { enumValuesOf, type FilterValue } from '@/lib/filters/filter-values';
import { edgeParams, type EdgeQuery } from '@/lib/internal-links/queries';
import { PLACEMENT_KEY, PLACEMENTS, type Placement } from '@/lib/internal-links/scopes';
import type { PageTier, StatusClass } from '@/lib/internal-links/types';

const STATUSES: readonly StatusClass[] = ['2xx', '3xx', '4xx', '5xx'];

/** The Links filter bar (spec 7.3): source and target tier, placement, target status, tag, source page contains. */
export function edgeFilterFields(
  t: LinksTranslate,
  tiers: readonly PageTier[],
  tags: readonly { termId: string; name: string }[],
  tagsLoading: boolean,
): FilterField[] {
  const tierOptions = [
    ...tiers.map((tier) => ({ value: tier.tier_id, label: tier.label })),
    { value: UNTIERED_VALUE, label: t('filters.untiered') },
  ];
  return [
    {
      id: 'stier',
      kind: 'enum',
      multi: true,
      label: t('links.sourceTier'),
      options: tierOptions,
      optionsLoading: tiers.length === 0,
    },
    {
      id: 'ttier',
      kind: 'enum',
      multi: true,
      label: t('links.targetTier'),
      options: tierOptions,
      optionsLoading: tiers.length === 0,
    },
    {
      id: 'place',
      kind: 'enum',
      multi: true,
      label: t('links.placement'),
      options: PLACEMENTS.map((value) => ({ value, label: t(`placement.${PLACEMENT_KEY[value]}`) })),
    },
    {
      id: 'tstatus',
      kind: 'enum',
      multi: true,
      label: t('links.targetStatus'),
      options: STATUSES.map((value) => ({ value, label: value })),
    },
    {
      id: 'tag',
      kind: 'enum',
      multi: true,
      label: t('filters.tag'),
      options: tags.map((tag) => ({ value: tag.termId, label: tag.name })),
      optionsLoading: tagsLoading,
    },
    { id: 'sq', kind: 'text', label: t('links.sourceContains'), operators: ['contains'] },
  ];
}

const tierIdsOf = (value: FilterValue | undefined): string[] =>
  enumValuesOf(value)
    .filter((id) => id === UNTIERED_VALUE || UUID.test(id))
    .slice(0, MAX_TIERS);

/**
 * The edges read for the address and the filter bar; `cursor` and `limit` come from the pager. An id the API would
 * refuse is left out (the filter bar keeps what the address holds while its options load). The page ids come from
 * `LinksState`, which holds only ids the API takes: a malformed one is shown as not found by the tab, never read.
 */
export function edgeQueryOf(state: LinksState, values: FilterValues, cursor: string | null, limit: number): EdgeQuery {
  const source = values.sq;
  return {
    scope: state.scope,
    sourceTierIds: tierIdsOf(values.stier),
    targetTierIds: tierIdsOf(values.ttier),
    tagIds: enumValuesOf(values.tag)
      .filter((id) => UUID.test(id))
      .slice(0, MAX_TAGS),
    placements: enumValuesOf(values.place).filter((value): value is Placement =>
      PLACEMENTS.some((placement) => placement === value),
    ),
    targetStatus: enumValuesOf(values.tstatus).filter((value): value is StatusClass =>
      STATUSES.some((status) => status === value),
    ),
    source: state.source,
    target: state.target,
    worklist: state.edgeWorklist,
    qSource: source?.kind === 'text' ? searchText(source.text) : null,
    qTarget: state.lq,
    cursor,
    limit,
  };
}

/** The tab's Export (decision W13): the server's CSV of the same filter, with no cursor and no page size. */
export function edgeExportQuery(query: EdgeQuery): DownloadQuery {
  const wanted: Record<string, DownloadQuery[string]> = {};
  for (const [key, value] of Object.entries(edgeParams({ ...query, cursor: null }))) {
    if (key !== 'limit' && value !== undefined && value !== null) wanted[key] = value;
  }
  return { ...wanted, format: 'csv' };
}
