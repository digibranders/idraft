'use client';

import type { Route } from 'next';
import { useCallback } from 'react';

import { useCardDrill } from '../../engines/use-card-seams';
import { formatInspectTarget } from '@/lib/inspector/placement';
import type { DomainRole } from '@/lib/citations/types';
import { withQuery } from '@/lib/routes/paths';

/**
 * The links of the sources cards into the Citations page (WP-37 plan D6). `drillHref('citations', ...)` carries the
 * scope (window, engines, branded, comparison) and is `null` where the page cannot show it (a country, branded only,
 * a window over 91 days); this adds what is the page's own: the tab, the role, the New and lost list, and the domain
 * inspector (`inspect=domain:<registrable domain>`). The parity test feeds the result to the page's own parser.
 */

export interface CitationsTarget {
  tab: 'domains' | 'pages' | 'new-lost';
  /** Narrows the list to one role, as the card did. */
  role?: DomainRole | undefined;
  /** The list of the New and lost tab. */
  kind?: 'new' | 'lost' | undefined;
  /** Opens this domain in the inspector. */
  domain?: string | undefined;
  /** Opens this cited page (its `url_id`) in the source inspector. */
  source?: number | undefined;
}

/** `base` (the Citations link of the scope) with `target` added; `null` stays `null`, so the number is plain text. */
export function citationsLink(base: Route | null, target: CitationsTarget): Route | null {
  if (base === null) return null;
  const [path = '', current = ''] = base.split('?');
  const query = new URLSearchParams(current);
  query.set('tab', target.tab);
  if (target.role !== undefined) query.set('role', target.role);
  if (target.kind !== undefined) query.set('kind', target.kind);
  if (target.domain !== undefined) query.set('inspect', formatInspectTarget({ type: 'domain', id: target.domain }));
  if (target.source !== undefined)
    query.set('inspect', formatInspectTarget({ type: 'source', id: String(target.source) }));
  return withQuery(path as Route, query.toString());
}

/** The link of a target of the Citations page for the scope of the card, or `null` where it cannot be shown. */
export function useCitationsDrill(): (target: CitationsTarget) => Route | null {
  const drill = useCardDrill();
  return useCallback((target) => citationsLink(drill('citations'), target), [drill]);
}
