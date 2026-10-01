import { HttpResponse, type HttpHandler } from 'msw';

import { visibleProjects } from './access';
import { at, bodyError, canonicalHost, domainTextError, isRecord, queryError } from './rules';
import { emptyChange } from './workspaces';
import { entityWorld, readEntityChanges, workspaceOfRow } from '../entities-state';
import { isPublicSuffix, registrableDomain } from '../factories/domain';
import { mockLocation } from '../factories/location';
import { PERMISSION_HOLDERS } from '../factories/permissions';
import { invalid, invalidField, mock, problem, unknownMembers } from '../respond';
import { readSession, type MockSession } from '../session';
import {
  accessTo,
  changesCookie,
  projectList,
  readChanges,
  type CreatedOwnEntity,
  type CreatedProject,
  type ProjectEdit,
  type WorkspaceAccess,
  type WorkspaceChanges,
} from '../workspace-state';
import type { components } from '@/lib/api/schema';
import type { ValidationItem } from '@/lib/api/types';
import { currentTimeZoneName, isKnownTimeZone } from '@/lib/format/time-zone';
import { slugProblem } from '@/lib/slugs/slug';
import { textLength } from '@/lib/text/length';

type Project = components['schemas']['Project'];

/**
 * Projects (19 section 3.3). A workspace or project the caller cannot see is a 404, as in the API, so a mock
 * never confirms that another tenant's object exists. Creating and changing a project is kept in the
 * workspace cookie (../workspace-state.ts), so the server's mocks list what the browser created. Step 4 adds
 * the primary domain, the default location and the own entity a project is created with (19 section 3.4,
 * as built); the own entity is kept with the project, since one answer sets one cookie.
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
const MAX_ENTITY_NAME = 200;
const MAX_ALIAS = 200;
const MAX_OWN_DOMAINS = 20;
const MAX_OWN_ALIASES = 50;
const CREATE_FIELDS = [
  'name',
  'slug',
  'timezone',
  'deep_check_weekday',
  'default_language_code',
  'primary_domain',
  'default_location_id',
  'own_entity',
];
const CHANGE_FIELDS = [
  'name',
  'slug',
  'timezone',
  'deep_check_weekday',
  'default_language_code',
  'status',
  'primary_domain',
  'default_location_id',
];

function signedIn(cookies: Readonly<Record<string, string>>): MockSession | null {
  const session = readSession(cookies);
  return session?.state === 'active' ? session : null;
}

const canWriteProjects = (access: WorkspaceAccess): boolean =>
  PERMISSION_HOLDERS['projects:write'].includes(access.membership.role);

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

/** The field errors of the project fields in `body`, as the API's models give them. A null is checked apart. */
function projectFieldErrors(body: Readonly<Record<string, unknown>>): ValidationItem[] {
  const errors: ValidationItem[] = [];
  if ('name' in body && body.name !== null) {
    const name = typeof body.name === 'string' ? body.name.trim() : null;
    if (name === null || name === '') errors.push(bodyError('name', 'string_too_short', 'Enter a name.'));
    else if (textLength(name) > MAX_NAME_LENGTH)
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
  // A primary domain is a host or URL whose host is kept; a default location is one of `GET /api/v1/locations`
  if ('primary_domain' in body && body.primary_domain !== null) {
    errors.push(...domainTextError(body.primary_domain, 'primary_domain'));
  }
  if ('default_location_id' in body && body.default_location_id !== null) {
    const id = body.default_location_id;
    if (typeof id !== 'number' || !Number.isInteger(id)) {
      errors.push(bodyError('default_location_id', 'int_type', 'Input should be a valid integer'));
    } else if (!mockLocation(id)) {
      errors.push(bodyError('default_location_id', 'location_unknown', 'No location has this id.'));
    }
  }
  return errors;
}

/** The own entity to create, as `own_entity` gives it (OwnEntityInput), or its errors. */
function ownEntityInput(value: unknown): Omit<CreatedOwnEntity, 'entity_id'> | ValidationItem[] {
  const path = 'own_entity';
  if (!isRecord(value)) return [bodyError(path, 'model_attributes_type', 'Input should be an object')];
  const errors: ValidationItem[] = [
    ...unknownMembers(value, ['canonical_name', 'domains', 'aliases']).map((error) => ({
      ...error,
      path: at(path, error.path),
    })),
  ];
  const name = typeof value.canonical_name === 'string' ? value.canonical_name.trim() : null;
  if (value.canonical_name === undefined)
    errors.push(bodyError(at(path, 'canonical_name'), 'missing', 'Field required'));
  else if (name === null)
    errors.push(bodyError(at(path, 'canonical_name'), 'string_type', 'Input should be a valid string'));
  else if (name === '') errors.push(bodyError(at(path, 'canonical_name'), 'string_too_short', 'Enter a name.'));
  else if (textLength(name) > MAX_ENTITY_NAME) {
    errors.push(bodyError(at(path, 'canonical_name'), 'string_too_long', 'At most 200 characters.'));
  }
  const list = (member: 'domains' | 'aliases', max: number): unknown[] => {
    const items = value[member] ?? [];
    if (!Array.isArray(items)) {
      errors.push(bodyError(at(path, member), 'list_type', 'Input should be a valid list'));
      return [];
    }
    if (items.length > max) errors.push(bodyError(at(path, member), 'too_long', `At most ${String(max)} items.`));
    return items;
  };
  const domains = list('domains', MAX_OWN_DOMAINS);
  const aliases = list('aliases', MAX_OWN_ALIASES);
  const hosts: string[] = [];
  for (const [index, domain] of domains.entries()) {
    const where = at(at(path, 'domains'), index);
    const shape = domainTextError(domain, where);
    errors.push(...shape);
    const host = shape.length === 0 && typeof domain === 'string' ? canonicalHost(domain) : null;
    // The own entity's domains are registrable rules, which a public suffix cannot be
    if (host !== null && isPublicSuffix(host)) {
      errors.push(
        bodyError(where, 'domain_is_public_suffix', 'A public suffix is shared by many sites; name a host under it.'),
      );
    } else if (host !== null && !hosts.includes(registrableDomain(host))) {
      // A registrable rule is stored against the registrable domain (`blog.acme.com` is `acme.com`)
      hosts.push(registrableDomain(host));
    }
  }
  const texts: string[] = [];
  for (const [index, alias] of aliases.entries()) {
    const where = at(at(path, 'aliases'), index);
    const text = typeof alias === 'string' ? alias.trim() : null;
    if (text === null) errors.push(bodyError(where, 'string_type', 'Input should be a valid string'));
    else if (text === '') errors.push(bodyError(where, 'string_too_short', 'An alias has at least one character.'));
    else if (textLength(text) > MAX_ALIAS) errors.push(bodyError(where, 'string_too_long', 'At most 200 characters.'));
    // Word aliases that ignore case: one spelling of each is enough
    else if (!texts.some((other) => other.toLowerCase() === text.toLowerCase())) texts.push(text);
  }
  if (errors.length > 0 || name === null) return errors;
  return {
    canonical_name: name,
    aliases: texts.map((alias) => ({ alias_id: crypto.randomUUID(), alias })),
    domains: hosts.map((host) => ({ entity_domain_id: crypto.randomUUID(), host })),
  };
}

/** Members that refuse null are plain optional: null on one of them is a 422 on that field. */
const nullErrors = (body: Readonly<Record<string, unknown>>, names: readonly string[]): ValidationItem[] =>
  names
    .filter((name) => name in body && body[name] === null)
    .map((name) => bodyError(name, 'null_not_allowed', 'This field cannot be null.'));

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

/** The canonical host of a `primary_domain` member that passed its checks, `null` to clear it, or `undefined`. */
function primaryHost(body: Readonly<Record<string, unknown>>): string | null | undefined {
  if (!('primary_domain' in body)) return undefined;
  return typeof body.primary_domain === 'string' ? canonicalHost(body.primary_domain) : null;
}

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
    const projects = visibleProjects(access, changes, readEntityChanges(cookies)).filter((project) =>
      statuses.includes(project.status),
    );
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
    const extra = unknownMembers(body, CREATE_FIELDS);
    const missing = ['name', 'slug']
      .filter((name) => !(name in body))
      .map((name) => bodyError(name, 'missing', 'Field required'));
    const own = 'own_entity' in body && body.own_entity !== null ? ownEntityInput(body.own_entity) : null;
    const errors = [
      ...extra,
      ...missing,
      ...nullErrors(body, ['name', 'slug', 'deep_check_weekday']),
      ...projectFieldErrors(body),
      ...(Array.isArray(own) ? own : []),
    ];
    if (errors.length > 0 || Array.isArray(own)) return invalid(request, errors);
    const all = projectList(changes, access.workspace.workspace_id);
    const slug = typeof body.slug === 'string' ? body.slug : '';
    // The API takes a slot of the plan first, then checks the slug
    const full = quotaProblem(request, all);
    if (full) return full;
    if (slugTaken(all, slug)) return problem(request, 'duplicate', { detail: 'A project already uses this slug.' });
    const workspaceId = access.workspace.workspace_id;
    if (own !== null) {
      // The own entity is a brand of the workspace like any other, so the name must be free for that type
      const taken = entityWorld(readEntityChanges(cookies), changes).entities.some(
        (entity) =>
          workspaceOfRow(entity) === workspaceId &&
          entity.entity_type === 'brand' &&
          entity.canonical_name.toLowerCase() === own.canonical_name.toLowerCase(),
      );
      // As built (backend 0c833e1): a field error on the name, and nothing is created, the project included
      if (taken) {
        return invalid(request, [
          bodyError('own_entity.canonical_name', 'entity_exists', 'The workspace has a brand with this name.'),
        ]);
      }
    }
    const now = new Date().toISOString();
    const host = primaryHost(body);
    const created: CreatedProject = {
      project_id: crypto.randomUUID(),
      workspace_id: workspaceId,
      name: typeof body.name === 'string' ? body.name.trim() : '',
      slug,
      timezone: typeof body.timezone === 'string' ? currentTimeZoneName(body.timezone) : access.workspace.timezone,
      deep_check_weekday: typeof body.deep_check_weekday === 'number' ? body.deep_check_weekday : 1,
      default_language_code: typeof body.default_language_code === 'string' ? body.default_language_code : null,
      ...(host === undefined || host === null ? {} : { primary_domain: host }),
      ...(typeof body.default_location_id === 'number' ? { default_location_id: body.default_location_id } : {}),
      // Created with the role own, primary, colour 1, in the same request (19 section 3.3)
      ...(own === null ? {} : { own_entity: { entity_id: crypto.randomUUID(), ...own } }),
      created_at: now,
    };
    const next: WorkspaceChanges = { ...changes, created: [...(changes.created ?? []), created] };
    const project = projectList(next, workspaceId).find((candidate) => candidate.project_id === created.project_id);
    if (!project) throw new Error('The created project is missing from the list');
    return HttpResponse.json({ data: project }, { status: 201, headers: { 'set-cookie': changesCookie(next) } });
  }),

  mock('get', '/api/v1/workspaces/{workspace_id}/projects/{project_id}', ({ request, cookies, params }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    const changes = readChanges(cookies);
    const access = accessTo(params.workspace_id, session.user, changes, cookies);
    const project = access
      ? visibleProjects(access, changes, readEntityChanges(cookies)).find(
          (candidate) => candidate.project_id === params.project_id,
        )
      : undefined;
    return project ? HttpResponse.json({ data: project }) : problem(request, 'not_found');
  }),

  mock('patch', '/api/v1/workspaces/{workspace_id}/projects/{project_id}', async ({ request, cookies, params }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    const changes = readChanges(cookies);
    const entityChanges = readEntityChanges(cookies);
    const access = accessTo(params.workspace_id, session.user, changes, cookies);
    const project = access
      ? visibleProjects(access, changes, entityChanges).find((candidate) => candidate.project_id === params.project_id)
      : undefined;
    if (!access || !project) return problem(request, 'not_found');
    if (!canWriteProjects(access)) return problem(request, 'forbidden');
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalidField(request, '', 'model_attributes_type', 'Input should be an object');
    const empty = emptyChange(request, body);
    if (empty) return empty;
    const nulls = nullErrors(body, ['name', 'slug', 'timezone', 'deep_check_weekday', 'status']);
    const errors = [...unknownMembers(body, CHANGE_FIELDS), ...nulls, ...projectFieldErrors(body)];
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
    const host = primaryHost(body);
    if (host !== undefined) edit.primary_domain = host;
    if ('default_location_id' in body) {
      edit.default_location_id = typeof body.default_location_id === 'number' ? body.default_location_id : null;
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
    const changed = visibleProjects(access, next, entityChanges).find(
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
