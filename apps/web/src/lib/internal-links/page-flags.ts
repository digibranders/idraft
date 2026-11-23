import type { LinkScope } from './scopes';
import { tierPosition, type TierCodeLike } from './tiers';

/** What a page row carries that flags read (the API's `PageRow` satisfies it). */
export interface FlaggedPage {
  flags: readonly string[];
  broken_outlinks: number;
  redirect_outlinks: number;
  /** Linking pages in the scope in view. */
  linking_pages: number;
  is_indexable: boolean;
  status_code: number | null;
  tier: TierCodeLike | null;
}

export type FlagKey =
  | 'errorPage'
  | 'blocked'
  | 'redirect'
  | 'nonIndexable'
  | 'orphan'
  | 'editorialOrphan'
  | 'deepOnlyThroughAuto'
  | 'placementUnknown'
  | 'brokenOutlinks'
  | 'redirectOutlinks'
  | 'fewEditorialLinks'
  | 'genericAnchors';

export interface DisplayFlag {
  key: FlagKey;
  tone: 'negative' | 'warning' | 'neutral';
}

/** The API's row flags, in the mock's order, with their key and tone. */
const ROW_FLAGS: readonly (readonly [string, DisplayFlag])[] = [
  ['broken', { key: 'errorPage', tone: 'negative' }],
  ['blocked', { key: 'blocked', tone: 'neutral' }],
  ['redirect', { key: 'redirect', tone: 'warning' }],
  ['non_indexable', { key: 'nonIndexable', tone: 'warning' }],
  ['orphan', { key: 'orphan', tone: 'negative' }],
  ['editorial_orphan', { key: 'editorialOrphan', tone: 'warning' }],
  ['deep_only_through_auto', { key: 'deepOnlyThroughAuto', tone: 'warning' }],
  ['placement_unknown', { key: 'placementUnknown', tone: 'neutral' }],
  ['generic_anchors', { key: 'genericAnchors', tone: 'warning' }],
];

/** Fewer editorial linking pages than this makes a T1 page under-linked (spec 7.2). */
export const FEW_EDITORIAL_LINKS = 3;

/**
 * The flags a page shows (spec 7.2, mock `il-model.js` `flags`): the row's own flags, then two read from its
 * outlink counts, then "Few editorial links" for a live, indexable T1 page while the editorial scope is in view.
 */
export function pageFlags(page: FlaggedPage, scope: LinkScope): DisplayFlag[] {
  const flags = ROW_FLAGS.filter(([name]) => page.flags.includes(name)).map(([, flag]) => flag);
  if (page.broken_outlinks > 0) flags.push({ key: 'brokenOutlinks', tone: 'negative' });
  if (page.redirect_outlinks > 0) flags.push({ key: 'redirectOutlinks', tone: 'warning' });
  const liveT1 = page.status_code === 200 && page.is_indexable && page.tier !== null && tierPosition(page.tier) === 1;
  if (scope === 'editorial' && liveT1 && page.linking_pages < FEW_EDITORIAL_LINKS) {
    flags.push({ key: 'fewEditorialLinks', tone: 'warning' });
  }
  return flags;
}
