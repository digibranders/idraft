import { askedEngines, brandedAskable, type ReadScope } from '../../../data/overview-queries';
import type { SourceFilters } from '@/lib/citations/source-queries';
import type { DomainRole } from '@/lib/citations/types';

/**
 * The scope of the Overview as the filters of the source reads (WP-37 plan D1): the same rules as
 * `overviewSourcesQuery`, so a card's denominator is the strip's. The engine filter is left out when every engine
 * that is on is asked (leaving it out is what asking all of them means), the branded choice is `include_branded`,
 * and the two flags are never set: citations flagged as unresolved redirects or engine-internal links stay left out
 * (owner decision O1), as on the strip and on the Citations page.
 */

/** Domains with fewer citation units than this are not listed (design system 9.7); asked of the route, not assumed. */
export const MIN_DOMAIN_UNITS = 2;

/** Why the source reads cannot answer the scope, or `ok` when they can. */
export type SourcesAskable = 'ok' | 'no_engine' | 'branded_only';

/**
 * `no_engine`: no engine that is on is inside the engine choice. `branded_only`: the sources routes have
 * `include_branded` and no "branded only", so that choice cannot be asked of them.
 */
export function sourcesAskable(read: ReadScope): SourcesAskable {
  if (askedEngines(read).length === 0) return 'no_engine';
  return brandedAskable(read.scope) ? 'ok' : 'branded_only';
}

export const canAskSources = (read: ReadScope): boolean => sourcesAskable(read) === 'ok';

/** The filters of the scope; `roles` narrows the rows of a list and never its totals. */
export function sourceFilters({ scope, enabledEngines }: ReadScope, roles: readonly DomainRole[] = []): SourceFilters {
  const asked = askedEngines({ scope, enabledEngines });
  return {
    from: scope.range.from,
    to: scope.range.to,
    engines: asked.length === enabledEngines.length ? [] : asked,
    roles,
    includeBranded: scope.branded !== 'excluded',
    ...(scope.topic === null ? {} : { term: scope.topic }),
    ...(scope.country === null ? {} : { country: scope.country }),
  };
}
