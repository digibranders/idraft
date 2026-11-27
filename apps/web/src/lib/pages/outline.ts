import { useQuery } from '@tanstack/react-query';

import { ApiProblem } from '@/lib/api/problem';
import { pageOutlineQuery } from '@/lib/internal-links/queries';
import type { LinksScope, PageOutline } from '@/lib/internal-links/types';

export type OutlineRead =
  | { state: 'loading' }
  | { state: 'error'; notFound: boolean; retry: () => void }
  | { state: 'ready'; data: PageOutline };

/** The outline of one page, of the latest crawl (spec 9.6). Asked only while `enabled` (the tab is open). */
export function usePageOutline(scope: LinksScope, urlId: string, enabled: boolean): OutlineRead {
  const query = useQuery({ ...pageOutlineQuery(scope, urlId), enabled });
  if (query.isError) {
    return {
      state: 'error',
      notFound: query.error instanceof ApiProblem && query.error.status === 404,
      retry: () => {
        void query.refetch();
      },
    };
  }
  return query.data === undefined ? { state: 'loading' } : { state: 'ready', data: query.data.data };
}
