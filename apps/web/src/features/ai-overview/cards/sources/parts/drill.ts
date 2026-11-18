'use client';

import type { Route } from 'next';
import { useCallback } from 'react';

import { useCardDrill } from '../../engines/use-card-seams';
import { formatInspectTarget } from '@/lib/inspector/placement';
import type { DomainRole } from '@/lib/citations/types';
import { withQuery } from '@/lib/routes/paths';

/**
 * The links of the sources cards into the Citations page (WP-77). `drillHref('citations', ...)` carries the scope the
 * page reads (one platform, the group) and is `null` where the page cannot show it (a country, branded prompts); this
 * adds what is the page's own: the tab (a route), the Cited pages owner and the page drawer
 * (`inspect=cited-page:<url_id>`).
 */

export interface CitationsTarget {
  tab: 'pages' | 'gaps';
  /** The card's role, as the Cited pages owner filter. */
  owner?: DomainRole | undefined;
  /** Opens this cited page (its `url_id`) in the page drawer. */
  page?: number | undefined;
}

/** The address value of each role (`owner` of `features/citations/board-state.ts`); own is the default and is not written. */
const OWNER: Readonly<Record<DomainRole, string | null>> = {
  own: null,
  competitor: 'competitor',
  third_party: 'third',
};

/** `base` (the Citations link of the scope) with `target` added; `null` stays `null`, so the number is plain text. */
export function citationsLink(base: Route | null, target: CitationsTarget): Route | null {
  if (base === null) return null;
  const [path = '', current = ''] = base.split('?');
  const query = new URLSearchParams(current);
  const owner = target.owner === undefined ? null : OWNER[target.owner];
  if (owner !== null) query.set('owner', owner);
  if (target.page !== undefined)
    query.set('inspect', formatInspectTarget({ type: 'cited-page', id: String(target.page) }));
  return withQuery((target.tab === 'gaps' ? `${path}/gaps` : path) as Route, query.toString());
}

/** The link of a target of the Citations page for the scope of the card, or `null` where it cannot be shown. */
export function useCitationsDrill(): (target: CitationsTarget) => Route | null {
  const drill = useCardDrill();
  return useCallback((target) => citationsLink(drill('citations'), target), [drill]);
}
