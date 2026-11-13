import { SOURCE_SKELETONS } from './parts/skeletons';
import type { CardRegistration } from '@/features/layouts';

/**
 * The cards of the sources family (WP-37): the catalog key of each card and where its code is. A card listed here
 * replaces its pending placeholder (../registry.ts); the contract is section 5 of
 * docs/superpowers/plans/2026-11-13-ai-wp-33-overview-shell.md.
 */
export const SOURCE_CARDS: Readonly<Record<string, CardRegistration>> = {
  'sources.top_domains': {
    load: () => import('./top-domains-card'),
    skeleton: SOURCE_SKELETONS['sources.top_domains'],
  },
  'sources.own_pages': {
    load: () => import('./own-pages-card'),
    skeleton: SOURCE_SKELETONS['sources.own_pages'],
  },
  'ai.citation_share_by_domain_type': {
    load: () => import('./role-share-card'),
    skeleton: SOURCE_SKELETONS['ai.citation_share_by_domain_type'],
  },
  'ai.fanout_top': {
    load: () => import('./fanout-top-card'),
    skeleton: SOURCE_SKELETONS['ai.fanout_top'],
  },
};
