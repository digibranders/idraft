/**
 * The five facets of the Prompts filter bar (WP-17 plan section 3.2). A facet's field id is its URL key, so
 * `?intent=commercial,local` is the Intent facet with two values.
 */
export const FACET_IDS = ['intent', 'funnel', 'importance', 'lang', 'ptype'] as const;
export type FacetId = (typeof FACET_IDS)[number];

/**
 * The URL keys a view preset governs: the page's four filters, then the facets. Scope and layout (tab, sort,
 * columns, density, country, window, comparison, search, the Topics view and the inspector) are not filters.
 */
export const FILTER_URL_KEYS: readonly string[] = ['topic', 'engine', 'branded', 'detectable', ...FACET_IDS];
