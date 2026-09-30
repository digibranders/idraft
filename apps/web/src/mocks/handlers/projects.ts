import { HttpResponse, type HttpHandler } from 'msw';

import { workspaceFactory } from '../factories/identity';
import { projectFactory } from '../factories/project';
import { MOCK_PROJECTS, MOCK_WORKSPACE, type MockProjectSeed } from '../fixtures';
import { invalid, mock, problem } from '../respond';
import { readSession, type MockSession } from '../session';
import type { ValidationItem } from '@/lib/api/types';

/**
 * Workspaces and projects (19 sections 3.2 and 3.3). A workspace or project the caller cannot see is a 404,
 * as in the API, so a mock never confirms that another tenant's object exists.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_OFFSET = 100_000;
const STATUSES = ['active', 'paused', 'archived'];
const DEFAULT_STATUSES = ['active', 'paused'];
const LIST_PARAMETERS = new Set(['offset', 'limit', 'filter[status_in]']);

function signedIn(cookies: Readonly<Record<string, string>>): MockSession | null {
  const session = readSession(cookies);
  return session?.state === 'active' ? session : null;
}

const isMember = (workspaceId: string | readonly string[] | undefined): boolean =>
  workspaceId === MOCK_WORKSPACE.workspace_id;

/** The projects the member may open: all of them, or the ones their membership lists; by name, as the API sorts. */
function visibleProjects(session: MockSession): MockProjectSeed[] {
  const allowed = session.user.project_ids;
  return MOCK_PROJECTS.filter((project) => allowed === null || allowed.includes(project.project_id)).sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
}

const queryError = (path: string, code: string, message: string): ValidationItem => ({
  location: 'query',
  path,
  code,
  message,
});

/** The list parameters, or the errors the API would answer for them (it refuses any it does not declare). */
function listParameters(url: URL): { offset: number; limit: number; statuses: string[] } | ValidationItem[] {
  const errors: ValidationItem[] = [];
  for (const name of new Set(url.searchParams.keys())) {
    if (!LIST_PARAMETERS.has(name)) errors.push(queryError(name, 'extra_forbidden', 'Extra inputs are not permitted'));
  }
  const whole = (name: string, fallback: number, min: number, max: number): number => {
    const raw = url.searchParams.get(name);
    if (raw === null) return fallback;
    const number = Number(raw);
    if (!Number.isInteger(number) || number < min || number > max) {
      errors.push(queryError(name, 'value_error', `Use a whole number from ${String(min)} to ${String(max)}.`));
    }
    return number;
  };
  const offset = whole('offset', 0, 0, MAX_OFFSET);
  const limit = whole('limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
  const given = url.searchParams.getAll('filter[status_in]').flatMap((value) => value.split(','));
  if (given.some((status) => !STATUSES.includes(status))) {
    errors.push(queryError('filter[status_in]', 'enum', `Allowed: ${STATUSES.join(', ')}.`));
  }
  return errors.length > 0 ? errors : { offset, limit, statuses: given.length > 0 ? given : DEFAULT_STATUSES };
}

export const projectHandlers: HttpHandler[] = [
  mock('get', '/api/v1/workspaces', ({ request, cookies }) =>
    signedIn(cookies) ? HttpResponse.json({ data: [workspaceFactory()] }) : problem(request, 'unauthenticated'),
  ),

  mock('get', '/api/v1/workspaces/{workspace_id}', ({ request, cookies, params }) => {
    if (!signedIn(cookies)) return problem(request, 'unauthenticated');
    return isMember(params.workspace_id)
      ? HttpResponse.json({ data: workspaceFactory() })
      : problem(request, 'not_found');
  }),

  mock('get', '/api/v1/workspaces/{workspace_id}/projects', ({ request, cookies, params }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    if (!isMember(params.workspace_id)) return problem(request, 'not_found');
    const parameters = listParameters(new URL(request.url));
    if (Array.isArray(parameters)) return invalid(request, parameters);
    const { offset, limit, statuses } = parameters;
    const projects = visibleProjects(session)
      .map((seed) => projectFactory(seed))
      .filter((project) => statuses.includes(project.status));
    return HttpResponse.json({
      data: projects.slice(offset, offset + limit),
      page: { offset, limit, total: projects.length },
    });
  }),

  mock('get', '/api/v1/workspaces/{workspace_id}/projects/{project_id}', ({ request, cookies, params }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    const seed = visibleProjects(session).find((project) => project.project_id === params.project_id);
    return isMember(params.workspace_id) && seed
      ? HttpResponse.json({ data: projectFactory(seed) })
      : problem(request, 'not_found');
  }),
];
