'use client';

import { useQuery } from '@tanstack/react-query';

import { isOpportunityPage, changesSummaryQuery, opportunitiesQuery } from '@/lib/internal-links/queries';
import { changesBadge, opportunitiesBadge } from '@/lib/internal-links/tab-badges';
import type { LinksScope } from '@/lib/internal-links/types';

export interface TabBadgeCounts {
  changes: number | null;
  opportunities: number | null;
}

const COUNT_ONLY = { status: null, tier: null, q: null, offset: 0, limit: 1 } as const;

/**
 * The counts on the Changes and Opportunities tabs. A count is read only for a tab that is registered, and the
 * opportunities (a link level read) only for a crawl that still holds its links. The summary is the read the context
 * line makes too, so it is one request.
 */
export function useTabBadges(
  scope: LinksScope,
  run: string | null,
  registered: { changes: boolean; opportunities: boolean },
  linksAvailable: boolean,
): TabBadgeCounts {
  const summary = useQuery({ ...changesSummaryQuery(scope, run), enabled: registered.changes });
  const opportunities = useQuery({
    ...opportunitiesQuery(scope, COUNT_ONLY, run),
    enabled: registered.opportunities && linksAvailable,
  });
  return {
    changes: registered.changes ? changesBadge(summary.data?.data) : null,
    opportunities:
      registered.opportunities && isOpportunityPage(opportunities.data)
        ? opportunitiesBadge(opportunities.data.meta.counts.open)
        : null,
  };
}
