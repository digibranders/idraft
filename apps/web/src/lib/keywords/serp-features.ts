/**
 * The SERP features the backend records (`seo.serp_feature_types`, migration 0013, docs/06 section 5.4), in
 * its order, which is also the order of a cell's fixed slots (12-tables.md section 6, `SERPFeatureList`). No
 * route lists them, so the list is mirrored here; a code the API adds later is still shown, after these.
 */

export const FEATURE_TYPES = [
  'ai_overview',
  'featured_snippet',
  'people_also_ask',
  'local_pack',
  'knowledge_graph',
  'top_stories',
  'video',
  'images',
  'discussions_and_forums',
  'perspectives',
  'shopping',
  'related_searches',
  'social_posts',
  'answer_box',
  'ads',
  'sitelinks',
] as const;

export type FeatureType = (typeof FEATURE_TYPES)[number];

/** A domain cannot own these: they have no source URLs (`ownable` false in the migration). */
const NOT_OWNABLE: ReadonlySet<string> = new Set<FeatureType>(['related_searches']);

export const OWNABLE_FEATURE_TYPES: readonly FeatureType[] = FEATURE_TYPES.filter((type) => !NOT_OWNABLE.has(type));

/** A cell shows this many feature icons, then a `+N` count (12-tables.md section 6). */
export const FEATURE_SLOTS = 5;

export const isFeatureType = (value: string): value is FeatureType =>
  (FEATURE_TYPES as readonly string[]).includes(value);

export const FEATURE_MESSAGE_KEYS = {
  ai_overview: 'aiOverview',
  featured_snippet: 'featuredSnippet',
  people_also_ask: 'peopleAlsoAsk',
  local_pack: 'localPack',
  knowledge_graph: 'knowledgeGraph',
  top_stories: 'topStories',
  video: 'video',
  images: 'images',
  discussions_and_forums: 'discussionsAndForums',
  perspectives: 'perspectives',
  shopping: 'shopping',
  related_searches: 'relatedSearches',
  social_posts: 'socialPosts',
  answer_box: 'answerBox',
  ads: 'ads',
  sitelinks: 'sitelinks',
} as const satisfies Record<FeatureType, string>;

export type FeatureMessageKey = (typeof FEATURE_MESSAGE_KEYS)[FeatureType];

export interface FeatureSlot {
  type: string;
  owned: boolean;
}

export interface FeatureListDisplay {
  /** The first `FEATURE_SLOTS`, in the fixed order. */
  shown: FeatureSlot[];
  /** How many more there are. */
  overflow: number;
  /** Every feature, for the tooltip and the accessible name. */
  all: FeatureSlot[];
}

const orderOf = (type: string): number => {
  const index = (FEATURE_TYPES as readonly string[]).indexOf(type);
  return index === -1 ? FEATURE_TYPES.length : index;
};

/** What a SERP features cell shows for the codes present and the codes the project owns. */
export function featureListDisplay(
  present: readonly string[],
  owned: readonly string[],
  slots: number = FEATURE_SLOTS,
): FeatureListDisplay {
  const ownedSet = new Set(owned);
  const all = [...new Set(present)]
    .sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b))
    .map((type) => ({ type, owned: ownedSet.has(type) }));
  return { shown: all.slice(0, slots), overflow: Math.max(0, all.length - slots), all };
}
