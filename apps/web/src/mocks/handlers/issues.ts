import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller } from './access';
import { csv } from './internal-links';
import { enumQuery, isIssue, readRun } from './internal-links-run';
import { invalid, mock } from '../respond';
import { checkResults, gscMeta, summaryOf } from '../issue-rules';

/**
 * `GET …/issues` of the backend OpenAPI: the checks of a crawl, in catalogue order, with the totals of the strip.
 * The rules are in `issue-rules.ts`, which the internal links pages handler reads too for `filter[issue]`.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
// `_CSV_HEADER` of backend/src/idraft/api/issues/routes.py
const CSV_HEADER = ['Tab', 'Category', 'Check', 'Severity', 'Found by', 'State', 'Pages', 'Clicks'];

export const issueHandlers: HttpHandler[] = [
  mock('get', `${P}/issues`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['run', 'format'],
    });
    if (caller instanceof Response) return caller;
    const format = enumQuery(caller.url, 'format', ['json', 'csv'], 'json');
    if (isIssue(format)) return invalid(request, [format]);
    const run = readRun(request, caller.url, caller.project.project_id);
    if (run instanceof Response) return run;
    const results = checkResults(run);
    if (format === 'csv') {
      return csv(
        [
          CSV_HEADER,
          ...results.map(({ check }) => [
            check.tab,
            check.category,
            check.id,
            check.severity,
            check.found_by,
            check.state,
            check.pages ?? '',
            check.clicks ?? '',
          ]),
        ],
        'issues',
      );
    }
    return HttpResponse.json({
      data: results.map(({ check }) => check),
      summary: summaryOf(results),
      meta: {
        run_id: run.run.run_id,
        crawled_at: run.run.finished_at,
        links_available: run.run.links_available,
        gsc: gscMeta(),
      },
    });
  }),
];
