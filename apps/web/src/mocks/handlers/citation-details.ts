import { HttpResponse, type HttpHandler } from 'msw';

import { domainDetailOf } from './citation-detail-model';
import { FLAGS, readOf, SCOPE } from './citations';
import { metaOf } from './citations-model';
import { mock } from '../respond';

/**
 * WP-22: `ai/sources/domains/{registrable_domain}` (contracts/sources-additions.md; backend `api/ai/sources.py`
 * `domain_detail`): one cited domain with its rows, weekly units per engine, pages, prompts and the entities named
 * with it. The arithmetic is ./citation-detail-model.ts and the request checks are ./citations.ts's `readOf`. The
 * series, lost and cited-with reads the header of this file once promised are served by ./citations.ts, which
 * already has them.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';

export const citationDetailHandlers: HttpHandler[] = [
  mock('get', `${P}/ai/sources/domains/{registrable_domain}`, ({ request, cookies, params }) => {
    // The route has the shared scope and the two flags, with no role filter, no sort and no page
    const read = readOf(request, cookies, params, [...SCOPE, ...FLAGS], { roles: false, flags: true }, () => null);
    if (read instanceof Response) return read;
    const { scope, answers } = read;
    return HttpResponse.json({
      // The API reads the name in lower case
      data: domainDetailOf(answers, scope, String(params.registrable_domain).toLowerCase()),
      meta: metaOf(answers, scope),
    });
  }),
];
