import type { ReactElement } from 'react';

import type { LinksScope } from '@/lib/internal-links/types';

/**
 * The seam of the Search Console session (spec 10.3), drawn in the drawer's Search tab between the daily chart
 * and the tracked keywords. Owner: the Search Console session. Replace the body, keep the signature.
 */

export interface PageSearchDetailProps {
  scope: LinksScope;
  urlId: string;
  url: string;
  timeZone: string;
}

/** The queries, countries and devices of one page. Renders nothing on this branch. */
export const PageSearchDetailSlot: (props: PageSearchDetailProps) => ReactElement | null = () => null;
