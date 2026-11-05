import { HttpResponse, type HttpHandler } from 'msw';

import { activeTrackedCount, keywordWorkspaceCaller, MAX_TRACKED_KEYWORDS } from './keyword-rules';
import { mock } from '../respond';

/**
 * The workspace's tracked keyword limit and use (19 section 3.5): the figures `quota_exceeded` carries. Open to
 * every member of the workspace, a billing member included.
 */
export const keywordQuotaHandlers: HttpHandler[] = [
  mock('get', '/api/v1/workspaces/{workspace_id}/tracked-keyword-quota', ({ request, cookies, params }) => {
    const caller = keywordWorkspaceCaller(request, cookies, params.workspace_id, { permission: null });
    if (caller instanceof Response) return caller;
    return HttpResponse.json({ data: { limit: MAX_TRACKED_KEYWORDS, used: activeTrackedCount(caller) } });
  }),
];
