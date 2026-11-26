import type { FilterField, FilterValues } from '@/components/app/filters/types';
import type { DownloadQuery } from '@/lib/api/download';
import { enumValuesOf } from '@/lib/filters/filter-values';
import { searchPathOf } from '@/lib/internal-links/pasted-url';
import { pageParams, type PageQuery } from '@/lib/internal-links/queries';
import type { PageFlagFilter, PageTier, StatusClass } from '@/lib/internal-links/types';
import type { LinksTranslate } from '../tabs';
import type { PagesState } from '@/lib/pages/url-state';

/** The tier filter's value for pages with no tier (`filter[tier]=none`, `PageFilter.tier_ids`). */
export const UNTIERED_VALUE = 'none';
/** The Pages tab narrowed to the pages without a tier: the summary strip's Tiered link and the Tier filter agree on it. */
export const UNTIERED_QUERY = `tier=${UNTIERED_VALUE}`;

/** The most ids the API takes for each list filter (a workspace has 8 tiers and Untiered, so the tier cap cannot bite). */
export const MAX_TIERS = 9;
export const MAX_TAGS = 50;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUSES: readonly StatusClass[] = ['2xx', '3xx', '4xx', '5xx', 'blocked'];
const FLAGS: readonly (readonly [
  PageFlagFilter,
  (
    | 'orphan'
    | 'editorialOrphan'
    | 'deepOnlyThroughAuto'
    | 'placementUnknown'
    | 'hasBrokenOutlinks'
    | 'genericAnchors'
    | 'variant'
  ),
])[] = [
  ['orphan', 'orphan'],
  ['editorial_orphan', 'editorialOrphan'],
  ['deep_only_through_auto', 'deepOnlyThroughAuto'],
  ['placement_unknown', 'placementUnknown'],
  ['has_broken_outlinks', 'hasBrokenOutlinks'],
  ['generic_anchors', 'genericAnchors'],
  ['variant', 'variant'],
];

/** The Pages filter bar (spec 7.2): tier, tag, status, indexable and flags. URL keys `tier`, `tag`, `status`, `idx`, `flag`. */
export function pageFilterFields(
  t: LinksTranslate,
  tiers: readonly PageTier[],
  tags: readonly { termId: string; name: string }[],
  tagsLoading: boolean,
): FilterField[] {
  return [
    {
      id: 'tier',
      kind: 'enum',
      multi: true,
      label: t('filters.tier'),
      options: [
        ...tiers.map((tier) => ({ value: tier.tier_id, label: tier.label })),
        { value: UNTIERED_VALUE, label: t('filters.untiered') },
      ],
      optionsLoading: tiers.length === 0,
    },
    {
      id: 'tag',
      kind: 'enum',
      multi: true,
      label: t('filters.tag'),
      options: tags.map((tag) => ({ value: tag.termId, label: tag.name })),
      optionsLoading: tagsLoading,
    },
    {
      id: 'status',
      kind: 'enum',
      multi: true,
      label: t('filters.status'),
      options: STATUSES.map((value) => ({ value, label: value === 'blocked' ? t('filters.blocked') : value })),
    },
    {
      id: 'idx',
      kind: 'enum',
      multi: false,
      label: t('filters.indexable'),
      options: [
        { value: 'yes', label: t('filters.yes') },
        { value: 'no', label: t('filters.no') },
      ],
    },
    {
      id: 'flag',
      kind: 'enum',
      multi: true,
      label: t('filters.flag'),
      options: FLAGS.map(([value, key]) => ({ value, label: t(`flags.${key}`) })),
    },
  ];
}

/**
 * The pages read for the address and the filter bar; `cursor` and `limit` come from the table's pager. A tier or tag
 * id that is not one the API takes is left out (the filter bar keeps an id from the address while its options load),
 * so a hand-edited address never makes the request a 422.
 */
export function pageQueryOf(
  state: Pick<PagesState, 'scope' | 'view' | 'worklist' | 'sort' | 'q' | 'depth' | 'variants'>,
  values: FilterValues,
  cursor: string | null,
  limit: number,
  host = '',
): PageQuery {
  const idx = enumValuesOf(values.idx)[0];
  return {
    scope: state.scope,
    tierIds: enumValuesOf(values.tier)
      .filter((id) => id === UNTIERED_VALUE || UUID.test(id))
      .slice(0, MAX_TIERS),
    tagIds: enumValuesOf(values.tag)
      .filter((id) => UUID.test(id))
      .slice(0, MAX_TAGS),
    status: enumValuesOf(values.status).filter((value): value is StatusClass =>
      STATUSES.some((status) => status === value),
    ),
    indexable: idx === 'yes' ? true : idx === 'no' ? false : null,
    flags: enumValuesOf(values.flag).filter((value): value is PageFlagFilter => FLAGS.some(([flag]) => flag === value)),
    worklist: state.worklist,
    view: state.view,
    folder: null,
    depth: state.depth,
    includeVariants: state.variants,
    q: searchPathOf(state.q, host),
    sort: state.sort,
    include: [],
    cursor,
    limit,
  };
}

/**
 * The filter values with the tag filter cut to the most the API takes, or `null` when it is within it. The filter bar
 * lets a 51st tag be chosen; the tab writes the cut values back, so the chips always say what the request asks for.
 */
export function capTags(values: FilterValues): FilterValues | null {
  const tags = enumValuesOf(values.tag);
  return tags.length <= MAX_TAGS ? null : { ...values, tag: { kind: 'enum', values: tags.slice(0, MAX_TAGS) } };
}

/**
 * The tab's Export (decision W13): the server's CSV of the same filter, scope and sort. It takes no cursor and no
 * page size, because the server exports every matching page. The server's CSV has no equity column, and the sort
 * is never `equity_share` (`PageSort` leaves it out).
 */
export function pageExportQuery(query: PageQuery): DownloadQuery {
  const wanted: Record<string, DownloadQuery[string]> = {};
  for (const [key, value] of Object.entries(pageParams({ ...query, include: [], cursor: null }))) {
    if (key !== 'limit' && value !== undefined && value !== null) wanted[key] = value;
  }
  return { ...wanted, format: 'csv' };
}
