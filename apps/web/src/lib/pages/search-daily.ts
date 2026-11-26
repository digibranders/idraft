import { useQuery } from '@tanstack/react-query';

import type { Seam } from './issue-source';
import { pageSearchQuery } from '@/lib/internal-links/queries';
import type { LinksScope, PageSearchDaily } from '@/lib/internal-links/types';

/** The days of one page in Search Console (spec 9.5). The hook is the contract, not the route. */
export function usePageSearchDaily(scope: LinksScope, run: string | null, urlId: string): Seam<PageSearchDaily> {
  const query = useQuery(pageSearchQuery(scope, urlId, run));
  if (query.isError) {
    return {
      state: 'error',
      retry: () => {
        void query.refetch();
      },
    };
  }
  return query.data === undefined ? { state: 'loading' } : { state: 'ready', data: query.data.data };
}
