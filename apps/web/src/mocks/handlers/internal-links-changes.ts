import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller } from './access';
import { csv } from './internal-links';
import { enumQuery, isIssue, readRun, requireLinks } from './internal-links-run';
import { queryError, offsetPaging } from './rules';
import { changeLinks, changeLinksCsv, changesSummary, movedPages } from '../internal-links-changes-world';
import { invalid, mock } from '../respond';
import type { ChangeKind, ChangeOnly, ChangeScope } from '@/lib/internal-links/types';

/**
 * The changes routes of the backend (`api/internal_links/change_routes.py`): what a crawl changed against the one
 * before it. Every route takes `run` (`latest` or a crawl id) and needs `data:read`; the link lists answer
 * `410 links_dropped` for a crawl whose links were dropped, the summary and the moved pages still answer.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const CHANGES: readonly ChangeKind[] = ['lost', 'added'];
const SCOPES: readonly ChangeScope[] = ['editorial', 'all'];
const ONLY: readonly ChangeOnly[] = ['top', 'all'];
const FORMATS = ['json', 'csv'] as const;
const MOVED_DEFAULT = 8;
const MOVED_MAX = 50;

export const internalLinkChangeHandlers: HttpHandler[] = [
  mock('get', `${P}/internal-links/changes/summary`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['run'],
    });
    if (caller instanceof Response) return caller;
    const projectId = caller.project.project_id;
    const view = readRun(request, caller.url, projectId);
    if (view instanceof Response) return view;
    return HttpResponse.json({ data: changesSummary(projectId, view) });
  }),

  mock('get', `${P}/internal-links/changes/links`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['run', 'change', 'link_scope', 'only', 'offset', 'limit', 'format'],
    });
    if (caller instanceof Response) return caller;
    const { url } = caller;
    const change = enumQuery(url, 'change', CHANGES, null);
    const linkScope = enumQuery(url, 'link_scope', SCOPES, 'editorial');
    const only = enumQuery(url, 'only', ONLY, 'all');
    const format = enumQuery(url, 'format', FORMATS, 'json');
    const paging = offsetPaging(url);
    if (isIssue(change) || isIssue(linkScope) || isIssue(only) || isIssue(format) || Array.isArray(paging)) {
      return invalid(request, [
        ...[change, linkScope, only, format].filter(isIssue),
        ...(Array.isArray(paging) ? paging : []),
      ]);
    }
    const projectId = caller.project.project_id;
    const view = readRun(request, url, projectId);
    if (view instanceof Response) return view;
    const gone = requireLinks(request, view);
    if (gone !== null) return gone;
    const query = { change, linkScope, only, ...paging };
    // A CSV has every row of the change, whatever the window
    if (format === 'csv') return csv(changeLinksCsv(projectId, view, query), `internal-links-${change}`);
    return HttpResponse.json(changeLinks(projectId, view, query));
  }),

  mock('get', `${P}/internal-links/changes/pages`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['run', 'limit'],
    });
    if (caller instanceof Response) return caller;
    const raw = caller.url.searchParams.get('limit');
    const limit = raw === null ? MOVED_DEFAULT : Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MOVED_MAX) {
      return invalid(request, [
        queryError('limit', 'value_error', `Use a whole number from 1 to ${String(MOVED_MAX)}.`),
      ]);
    }
    const view = readRun(request, caller.url, caller.project.project_id);
    if (view instanceof Response) return view;
    return HttpResponse.json(movedPages(view, limit));
  }),
];
