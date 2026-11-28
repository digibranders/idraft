import { useQuery } from '@tanstack/react-query';

import type { Seam } from './issue-source';
import { pageAiQuery } from '@/lib/internal-links/queries';
import type { LinksScope, PageAi } from '@/lib/internal-links/types';

/** The AI citations of one page: prompts, daily trend and pages cited alongside. The hook is the contract. */
export function usePageAi(scope: LinksScope, run: string | null, urlId: string): Seam<PageAi> {
  const query = useQuery(pageAiQuery(scope, urlId, run));
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
