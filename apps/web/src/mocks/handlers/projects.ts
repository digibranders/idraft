import { HttpResponse, type HttpHandler } from 'msw';

import { invalid, invalidField, mock, problem, unknownMembers } from '../respond';
import { readSession, type MockSession } from '../session';
import { emptyChange } from './workspaces';
import {
  accessTo,
  changesCookie,
  projectList,
  readChanges,
  type ProjectEdit,
  type WorkspaceAccess,
  type WorkspaceChanges,
} from '../workspace-state';
import type { components } from '@/lib/api/schema';
import type { ValidationItem } from '@/lib/api/types';
import { currentTimeZoneName, isKnownTimeZone } from '@/lib/format/time-zone';
import { PERMISSION_HOLDERS } from '../factories/permissions';
import { slugProblem } from '@/lib/slugs/slug';

type Project = components['schemas']['Project'];

/**
 * Projects (19 section 3.3). A workspace or project the caller cannot see is a 404, as in the API, so a mock
 * never confirms that another tenant's object exists. Creating and changing a project is kept in the
 * workspace cookie (../workspace-state.ts), so the server's mocks list what the browser created.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_OFFSET = 100_000;
const STATUSES = ['active', 'paused', 'archived'];
const DEFAULT_STATUSES = ['active', 'paused'];
const LIST_PARAMETERS = new Set(['offset', 'limit', 'filter[status_in]']);
/** The fixture workspace's plan allows this many active and paused projects (`max_projects`). */
export const MOCK_PROJECT_LIMIT = 10;
const MAX_NAME_LENGTH = 120;
const MAX_WEEKDAY = 6;

function signedIn(cookies: Readonly<Record<string, string>>): MockSession | null {
  const session = readSession(cookies);
  return session?.state === 'active' ? session : null;
}

const canWriteProjects = (access: WorkspaceAccess): boolean =>
  PERMISSION_HOLDERS['projects:write'].includes(access.membership.role);

/** The projects the member may open: all of them, or the ones their membership lists; by name. */
function visibleProjects(access: WorkspaceAccess, changes: WorkspaceChanges): Project[] {
  const allowed = access.membership.project_ids;
  return projectList(changes, access.workspace.workspace_id).filter(
    (project) => allowed === null || allowed.includes(project.project_id),
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

const bodyError = (path: string, code: string, message: string): ValidationItem => ({
  location: 'body',
  path,
  code,
  message,
});

/** The field errors of the project fields in `body`, as the API's models give them. A null is checked apart. */
function projectFieldErrors(body: Readonly<Record<string, unknown>>): ValidationItem[] {
  const errors: ValidationItem[] = [];
  if ('name' in body && body.name !== null) {
    const name = typeof body.name === 'string' ? body.name.trim() : null;
    if (name === null || name === '') errors.push(bodyError('name', 'string_too_short', 'Enter a name.'));
    else if (name.length > MAX_NAME_LENGTH)
      errors.push(bodyError('name', 'string_too_long', 'At most 120 characters.'));
  }
  if ('slug' in body && body.slug !== null) {
    const reason = typeof body.slug === 'string' ? slugProblem(body.slug, 'project') : 'string_pattern_mismatch';
    if (reason !== null) errors.push(bodyError('slug', reason, 'This address cannot be used.'));
  }
  if ('timezone' in body && body.timezone !== null) {
    if (typeof body.timezone !== 'string' || !isKnownTimeZone(currentTimeZoneName(body.timezone))) {
      errors.push(bodyError('timezone', 'timezone_unknown', 'Unknown time zone.'));
    }
  }
  if ('deep_check_weekday' in body && body.deep_check_weekday !== null) {
    const day = body.deep_check_weekday;
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > MAX_WEEKDAY) {
      errors.push(bodyError('deep_check_weekday', 'less_than_equal', 'A day from 0 (Sunday) to 6 (Saturday).'));
    }
  }
  if ('default_language_code' in body && body.default_language_code !== null) {
    if (typeof body.default_language_code !== 'string' || !/^[a-z]{2}$/.test(body.default_language_code)) {
      errors.push(bodyError('default_language_code', 'string_pattern_mismatch', 'A language code such as en.'));
    }
  }
  if (
    'status' in body &&
    body.status !== null &&
    !(typeof body.status === 'string' && STATUSES.includes(body.status))
  ) {
    errors.push(bodyError('status', 'enum', `Allowed: ${STATUSES.join(', ')}.`));
  }
  return errors;
}

/** Members that refuse null are plain optional: null on one of them is a 422 on that field. */
const nullErrors = (body: Readonly<Record<string, unknown>>, names: readonly string[]): ValidationItem[] =>
  names
    .filter((name) => name in body && body[name] === null)
    .map((name) => bodyError(name, 'null_not_allowed', 'This field cannot be null.'));

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `422 quota_exceeded` when the plan's active and paused projects are all taken, or `null`. */
function quotaProblem(request: Request, projects: readonly Project[]): ReturnType<typeof problem> | null {
  const used = projects.filter((project) => project.status !== 'archived').length;
  return used >= MOCK_PROJECT_LIMIT
    ? problem(request, 'quota_exceeded', { limit: MOCK_PROJECT_LIMIT, used, requested: 1 })
    : null;
}

/** Another project of the workspace already has `slug` (the API keeps a slug taken even when archived). */
const slugTaken = (projects: readonly Project[], slug: string, except?: string): boolean =>
  projects.some((project) => project.slug === slug && project.project_id !== except);

export const projectHandlers: HttpHandler[] = [
  mock('get', '/api/v1/workspaces/{workspace_id}/projects', ({ request, cookies, params }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    const changes = readChanges(cookies);
    const access = accessTo(params.workspace_id, session.user, changes, cookies);
    if (!access) return problem(request, 'not_found');
    const parameters = listParameters(new URL(request.url));
    if (Array.isArray(parameters)) return invalid(request, parameters);
    const { offset, limit, statuses } = parameters;
    const projects = visibleProjects(access, changes).filter((project) => statuses.includes(project.status));
    return HttpResponse.json({
      data: projects.slice(offset, offset + limit),
      page: { offset, limit, total: projects.length },
    });
  }),

  mock('post', '/api/v1/workspaces/{workspace_id}/projects', async ({ request, cookies, params }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    const changes = readChanges(cookies);
    const access = accessTo(params.workspace_id, session.user, changes, cookies);
    if (!access) return problem(request, 'not_found');
    // A member limited to some projects cannot create one, whatever the body says (19 section 3.3)
    if (!canWriteProjects(access) || access.membership.project_ids !== null) return problem(request, 'forbidden');
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalidField(request, '', 'model_attributes_type', 'Input should be an object');
    const extra = unknownMembers(body, ['name', 'slug', 'timezone', 'deep_check_weekday', 'default_language_code']);
    const missing = ['name', 'slug']
      .filter((name) => !(name in body))
      .map((name) => bodyError(name, 'missing', 'Field required'));
    const errors = [
      ...extra,
      ...missing,
      ...nullErrors(body, ['name', 'slug', 'deep_check_weekday']),
      ...projectFieldErrors(body),
    ];
    if (errors.length > 0) return invalid(request, errors);
    const all = projectList(changes, access.workspace.workspace_id);
    const slug = typeof body.slug === 'string' ? body.slug : '';
    // The API takes a slot of the plan first, then checks the slug
    const full = quotaProblem(request, all);
    if (full) return full;
    if (slugTaken(all, slug)) return problem(request, 'duplicate', { detail: 'A project already uses this slug.' });
    const now = new Date().toISOString();
    const created = {
      project_id: crypto.randomUUID(),
      workspace_id: access.workspace.workspace_id,
      name: typeof body.name === 'string' ? body.name.trim() : '',
      slug,
      timezone: typeof body.timezone === 'string' ? currentTimeZoneName(body.timezone) : access.workspace.timezone,
      deep_check_weekday: typeof body.deep_check_weekday === 'number' ? body.deep_check_weekday : 1,
      default_language_code: typeof body.default_language_code === 'string' ? body.default_language_code : null,
      created_at: now,
    };
    const next: WorkspaceChanges = { ...changes, created: [...(changes.created ?? []), created] };
    const project = projectList(next, access.workspace.workspace_id).find(
      (candidate) => candidate.project_id === created.project_id,
    );
    if (!project) throw new Error('The created project is missing from the list');
    return HttpResponse.json({ data: project }, { status: 201, headers: { 'set-cookie': changesCookie(next) } });
  }),

  mock('get', '/api/v1/workspaces/{workspace_id}/projects/{project_id}', ({ request, cookies, params }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    const changes = readChanges(cookies);
    const access = accessTo(params.workspace_id, session.user, changes, cookies);
    const project = access
      ? visibleProjects(access, changes).find((candidate) => candidate.project_id === params.project_id)
      : undefined;
    return project ? HttpResponse.json({ data: project }) : problem(request, 'not_found');
  }),

  mock('patch', '/api/v1/workspaces/{workspace_id}/projects/{project_id}', async ({ request, cookies, params }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    const changes = readChanges(cookies);
    const access = accessTo(params.workspace_id, session.user, changes, cookies);
    const project = access
      ? visibleProjects(access, changes).find((candidate) => candidate.project_id === params.project_id)
      : undefined;
    if (!access || !project) return problem(request, 'not_found');
    if (!canWriteProjects(access)) return problem(request, 'forbidden');
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalidField(request, '', 'model_attributes_type', 'Input should be an object');
    const empty = emptyChange(request, body);
    if (empty) return empty;
    const fields = ['name', 'slug', 'timezone', 'deep_check_weekday', 'default_language_code', 'status'];
    const nulls = nullErrors(body, ['name', 'slug', 'timezone', 'deep_check_weekday', 'status']);
    const errors = [...unknownMembers(body, fields), ...nulls, ...projectFieldErrors(body)];
    if (errors.length > 0) return invalid(request, errors);
    const edit: ProjectEdit = { ...changes.edited?.[project.project_id] };
    if (typeof body.name === 'string') edit.name = body.name.trim();
    if (typeof body.slug === 'string') {
      if (slugTaken(projectList(changes, access.workspace.workspace_id), body.slug, project.project_id)) {
        return problem(request, 'duplicate', { detail: 'A project already uses this slug.' });
      }
      edit.slug = body.slug;
    }
    if (typeof body.timezone === 'string') edit.timezone = currentTimeZoneName(body.timezone);
    if (typeof body.deep_check_weekday === 'number') edit.deep_check_weekday = body.deep_check_weekday;
    if ('default_language_code' in body) {
      edit.default_language_code = typeof body.default_language_code === 'string' ? body.default_language_code : null;
    }
    if (body.status === 'active' || body.status === 'paused' || body.status === 'archived') {
      // Bringing a project back from the archive needs a free slot of the plan again
      if (project.status === 'archived' && body.status !== 'archived') {
        const full = quotaProblem(request, projectList(changes, access.workspace.workspace_id));
        if (full) return full;
      }
      edit.status = body.status;
    }
    const next: WorkspaceChanges = { ...changes, edited: { ...changes.edited, [project.project_id]: edit } };
    const changed = projectList(next, access.workspace.workspace_id).find(
      (candidate) => candidate.project_id === project.project_id,
    );
    if (!changed) throw new Error('The changed project is missing from the list');
    const warnings: 'timezone_change_applies_forward'[] =
      changed.timezone === project.timezone ? [] : ['timezone_change_applies_forward'];
    return HttpResponse.json(
      { data: { ...changed, updated_at: new Date().toISOString() }, meta: { warnings } },
      { headers: { 'set-cookie': changesCookie(next) } },
    );
  }),
];
