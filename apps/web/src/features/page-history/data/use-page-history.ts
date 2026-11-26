import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import { checkUrlId } from '@/lib/internal-links/queries';
import type { LinksScope } from '@/lib/internal-links/types';
import type { PageHistory } from '../model/page-history';

const HISTORY =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}/history' as const;

/** The history of one page. Throws `UrlIdError` for an id that is no url id, as `pageDetailQuery` does. */
export const pageHistoryQuery = (scope: LinksScope, urlId: string): ApiQueryOptions<typeof HISTORY> =>
  apiQuery(HISTORY, {
    params: {
      path: { workspace_id: scope.workspaceId, project_id: scope.projectId, url_id: checkUrlId(urlId) },
    },
  });

/** The history of a page for the tab and the Overview line; both read the same cache entry, so one request serves both. */
export function usePageHistory(scope: LinksScope, urlId: string): UseQueryResult<{ data: PageHistory }, Error> {
  return useQuery(pageHistoryQuery(scope, urlId));
}
