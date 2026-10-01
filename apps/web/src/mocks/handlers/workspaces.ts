import { HttpResponse, type HttpHandler } from 'msw';

import { offsetPageOf, offsetPaging } from './rules';
import { workspaceFactory } from '../factories/identity';
import { PERMISSION_HOLDERS } from '../factories/permissions';
import { MOCK_INVITED_USER, MOCK_USERS, MOCK_WORKSPACE, type MockUserSeed } from '../fixtures';
import { freshSessionRequired, invalid, invalidField, mock, noContent, problem, unknownMembers } from '../respond';
import { hasJoined, isFresh, readSession, type MockSession } from '../session';
import {
  accessTo,
  changesCookie,
  currentWorkspace,
  invitationList,
  memberList,
  membershipOf,
  ownWorkspacesOf,
  projectList,
  readChanges,
  workspacesOf,
  type MemberEdit,
  type WorkspaceAccess,
  type WorkspaceChanges,
} from '../workspace-state';
import type { Role, ValidationItem } from '@/lib/api/types';
import { currentTimeZoneName, isKnownTimeZone } from '@/lib/format/time-zone';
import type { Permission } from '@/lib/permissions/permissions';
import { slugProblem } from '@/lib/slugs/slug';

/**
 * Workspaces, members and invitations (19 section 3.2), with the API's rules (backend `api/routes/members.py`,
 * `invitations.py`, `workspaces.py`): who may do what, the order the checks run in, which changes need a
 * fresh session, the last owner, and the limits on invitations and new workspaces. What a browser changes
 * is kept in the workspace cookie (../workspace-state.ts).
 */

const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Invitations per hour (19 section 3.2.2): per inviter, per workspace, per invited address. */
const INVITES_PER_INVITER = 20;
const INVITES_PER_WORKSPACE = 50;
const INVITES_PER_ADDRESS = 3;
/** New workspaces per user per day. */
const WORKSPACES_PER_DAY = 5;
/** Roles that always see every project: a project list is refused for them (`scope_not_allowed`). */
const UNSCOPED_ROLES: readonly Role[] = ['owner', 'admin'];
const MANAGERS: readonly Role[] = PERMISSION_HOLDERS['members:manage'];
const ROLES: readonly Role[] = ['owner', 'admin', 'editor', 'analyst', 'viewer', 'billing'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PROJECT_IDS = 500;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function signedIn(cookies: Readonly<Record<string, string>>): MockSession | null {
  const session = readSession(cookies);
  return session?.state === 'active' ? session : null;
}

const can = (access: WorkspaceAccess, permission: Permission): boolean =>
  PERMISSION_HOLDERS[permission].includes(access.membership.role);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRole = (value: unknown): value is Role => ROLES.some((role) => role === value);

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const bodyError = (path: string, code: string, message: string): ValidationItem => ({
  location: 'body',
  path,
  code,
  message,
});

/** Members that refuse null are plain optional: null on one of them is a 422 on that field. */
const nullErrors = (body: Readonly<Record<string, unknown>>, names: readonly string[]): ValidationItem[] =>
  names
    .filter((name) => name in body && body[name] === null)
    .map((name) => bodyError(name, 'null_not_allowed', 'This field cannot be null.'));

/** A change with nothing in it is refused, as the API refuses it. */
export const emptyChange = (
  request: Request,
  body: Readonly<Record<string, unknown>>,
): ReturnType<typeof invalidField> | null =>
  Object.keys(body).length === 0
    ? invalidField(request, '', 'value_error', 'Give at least one field to change.')
    : null;

/** The name, slug, time zone and logo errors of a workspace body; nulls are reported apart. */
function workspaceFieldErrors(body: Readonly<Record<string, unknown>>): ValidationItem[] {
  const errors: ValidationItem[] = [];
  if ('name' in body && body.name !== null) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name === '') errors.push(bodyError('name', 'string_too_short', 'Enter a name.'));
    else if (name.length > MAX_NAME_LENGTH)
      errors.push(bodyError('name', 'string_too_long', 'At most 120 characters.'));
  }
  if ('slug' in body && body.slug !== null) {
    const reason = typeof body.slug === 'string' ? slugProblem(body.slug, 'workspace') : 'string_pattern_mismatch';
    if (reason !== null) errors.push(bodyError('slug', reason, 'This address cannot be used.'));
  }
  if ('timezone' in body && body.timezone !== null) {
    const zone = typeof body.timezone === 'string' ? currentTimeZoneName(body.timezone) : '';
    if (!isKnownTimeZone(zone)) errors.push(bodyError('timezone', 'timezone_unknown', 'Unknown time zone.'));
  }
  if ('logo' in body && body.logo !== null && typeof body.logo !== 'string') {
    errors.push(bodyError('logo', 'string_type', 'Input should be a valid string'));
  }
  return errors;
}

/** The slugs of every workspace there is, to answer `409 duplicate` as the API does across tenants. */
const takenSlugs = (changes: WorkspaceChanges, except?: string): string[] =>
  [
    { workspace_id: MOCK_WORKSPACE.workspace_id, slug: currentWorkspace(changes).slug },
    ...(changes.ownWorkspaces ?? []),
  ]
    .filter((workspace) => workspace.workspace_id !== except)
    .map((workspace) => workspace.slug);

/** The person a member row is about, among the people of the fixture workspace. */
const personOf = (
  userId: string | readonly string[] | undefined,
  cookies: Readonly<Record<string, string>>,
): MockUserSeed | undefined =>
  [...MOCK_USERS, ...(hasJoined(cookies) ? [MOCK_INVITED_USER] : [])].find((person) => person.user_id === userId);

/** How many owners the fixture workspace has now. */
const ownerCount = (changes: WorkspaceChanges, cookies: Readonly<Record<string, string>>): number =>
  [...MOCK_USERS, MOCK_INVITED_USER].filter((person) => membershipOf(person, changes, cookies)?.role === 'owner')
    .length;

/**
 * The errors of a `project_ids` member for `role`: not a list of uuids, too long, a list where the role
 * sees everything, or a project that is not in the workspace.
 */
function scopeErrors(
  projectIds: unknown,
  role: Role,
  changes: WorkspaceChanges,
  workspaceId: string,
): ValidationItem[] {
  if (projectIds === undefined || projectIds === null) return [];
  if (!isStringList(projectIds) || projectIds.some((id) => !UUID.test(id))) {
    return [bodyError('project_ids', 'uuid_parsing', 'A list of project ids, or null for every project.')];
  }
  if (projectIds.length > MAX_PROJECT_IDS) {
    return [bodyError('project_ids', 'too_long', `At most ${String(MAX_PROJECT_IDS)} projects.`)];
  }
  if (UNSCOPED_ROLES.includes(role)) {
    return [bodyError('project_ids', 'scope_not_allowed', 'This role always sees every project.')];
  }
  const known = new Set(projectList(changes, workspaceId).map((project) => project.project_id));
  return projectIds.some((id) => !known.has(id))
    ? [bodyError('project_ids', 'project_unknown', 'A project is not in this workspace.')]
    : [];
}

/** A project list as the API stores it: each id once, sorted. */
const storedList = (projectIds: readonly string[]): string[] => [...new Set(projectIds)].sort();

/**
 * Invitations someone sent stop when they can no longer send them (backend `_withdraw_invitations`): all of
 * them when they stop managing members, the owner invitations when they stop being an owner.
 */
function withdrawSentBy(
  changes: WorkspaceChanges,
  cookies: Readonly<Record<string, string>>,
  userId: string,
  { from, to }: { from: Role; to: Role | null },
): string[] {
  const stillManages = to !== null && MANAGERS.includes(to);
  const ownerInvitesEnd = from === 'owner' && to !== 'owner';
  return invitationList(changes, cookies)
    .filter((invitation) => invitation.status === 'pending' && invitation.invited_by.user_id === userId)
    .filter((invitation) => !stillManages || (ownerInvitesEnd && invitation.role === 'owner'))
    .map((invitation) => invitation.invitation_id);
}

export const workspaceHandlers: HttpHandler[] = [
  mock('get', '/api/v1/workspaces', ({ request, cookies }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    const workspaces = workspacesOf(session.user, readChanges(cookies), cookies).map(({ workspace }) =>
      workspaceFactory(workspace),
    );
    return HttpResponse.json({ data: workspaces });
  }),

  mock('post', '/api/v1/workspaces', async ({ request, cookies }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalidField(request, '', 'model_attributes_type', 'Input should be an object');
    const missing = ['name', 'slug']
      .filter((name) => !(name in body))
      .map((name) => bodyError(name, 'missing', 'Field required'));
    const errors = [
      ...unknownMembers(body, ['name', 'slug', 'timezone']),
      ...missing,
      ...nullErrors(body, ['name', 'slug', 'timezone']),
      ...workspaceFieldErrors(body),
    ];
    if (errors.length > 0) return invalid(request, errors);
    // While registration is by invitation, only a platform operator creates a workspace
    if (!session.user.is_platform_operator) return problem(request, 'forbidden');
    const changes = readChanges(cookies);
    const slug = typeof body.slug === 'string' ? body.slug : '';
    if (takenSlugs(changes).includes(slug)) return problem(request, 'duplicate', { detail: 'This address is taken.' });
    const now = Date.now();
    const today = ownWorkspacesOf(changes, session.user.user_id).filter(
      (workspace) => now - Date.parse(workspace.created_at) < DAY_MS,
    ).length;
    if (today >= WORKSPACES_PER_DAY) {
      const wait = String(DAY_MS / 1000);
      return problem(request, 'rate_limited', { retry_after_seconds: DAY_MS / 1000, headers: { 'retry-after': wait } });
    }
    const workspace = {
      workspace_id: crypto.randomUUID(),
      name: typeof body.name === 'string' ? body.name.trim() : '',
      slug,
      timezone: typeof body.timezone === 'string' ? currentTimeZoneName(body.timezone) : 'UTC',
      owner: session.user.user_id,
      created_at: new Date(now).toISOString(),
    };
    const next: WorkspaceChanges = { ...changes, ownWorkspaces: [...(changes.ownWorkspaces ?? []), workspace] };
    return HttpResponse.json(
      { data: workspaceFactory({ ...workspace }) },
      { status: 201, headers: { 'set-cookie': changesCookie(next) } },
    );
  }),

  mock('get', '/api/v1/workspaces/{workspace_id}', ({ request, cookies, params }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    const access = accessTo(params.workspace_id, session.user, readChanges(cookies), cookies);
    return access ? HttpResponse.json({ data: workspaceFactory(access.workspace) }) : problem(request, 'not_found');
  }),

  mock('patch', '/api/v1/workspaces/{workspace_id}', async ({ request, cookies, params }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    const changes = readChanges(cookies);
    const access = accessTo(params.workspace_id, session.user, changes, cookies);
    if (!access) return problem(request, 'not_found');
    if (!can(access, 'workspace:update')) return problem(request, 'forbidden');
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalidField(request, '', 'model_attributes_type', 'Input should be an object');
    const empty = emptyChange(request, body);
    if (empty) return empty;
    const errors = [
      ...unknownMembers(body, ['name', 'slug', 'logo', 'timezone']),
      ...nullErrors(body, ['name', 'slug', 'timezone']),
      ...workspaceFieldErrors(body),
    ];
    if (errors.length > 0) return invalid(request, errors);
    const id = access.workspace.workspace_id;
    if (typeof body.slug === 'string' && takenSlugs(changes, id).includes(body.slug)) {
      return problem(request, 'duplicate', { detail: 'This address is taken.' });
    }
    const edit = {
      ...(typeof body.name === 'string' ? { name: body.name.trim() } : {}),
      ...(typeof body.slug === 'string' ? { slug: body.slug } : {}),
      ...(typeof body.timezone === 'string' ? { timezone: currentTimeZoneName(body.timezone) } : {}),
    };
    const next: WorkspaceChanges =
      id === MOCK_WORKSPACE.workspace_id
        ? { ...changes, workspace: { ...changes.workspace, ...edit } }
        : {
            ...changes,
            ownWorkspaces: (changes.ownWorkspaces ?? []).map((workspace) =>
              workspace.workspace_id === id ? { ...workspace, ...edit } : workspace,
            ),
          };
    const changed = accessTo(id, session.user, next, cookies);
    if (!changed) throw new Error('The changed workspace is missing');
    return HttpResponse.json(
      { data: workspaceFactory(changed.workspace) },
      { headers: { 'set-cookie': changesCookie(next) } },
    );
  }),

  mock('get', '/api/v1/workspaces/{workspace_id}/members', ({ request, cookies, params }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    const changes = readChanges(cookies);
    const access = accessTo(params.workspace_id, session.user, changes, cookies);
    if (!access) return problem(request, 'not_found');
    const paging = offsetPaging(new URL(request.url));
    if (Array.isArray(paging)) return invalid(request, paging);
    const viewer = { user_id: session.user.user_id, canManage: can(access, 'members:manage') };
    // A workspace an operator created here has its owner only
    const members =
      access.workspace.workspace_id === MOCK_WORKSPACE.workspace_id
        ? memberList(changes, cookies, viewer)
        : memberList({}, {}, viewer)
            .filter((member) => member.user.user_id === session.user.user_id)
            .map((member) => ({ ...member, role: 'owner' as const, project_ids: null }));
    return HttpResponse.json(offsetPageOf(members, paging));
  }),

  mock('patch', '/api/v1/workspaces/{workspace_id}/members/{user_id}', async ({ request, cookies, params }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    const changes = readChanges(cookies);
    const access = accessTo(params.workspace_id, session.user, changes, cookies);
    if (!access) return problem(request, 'not_found');
    if (!can(access, 'members:manage')) return problem(request, 'forbidden');
    if (!isFresh(session)) return freshSessionRequired(request);
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalidField(request, '', 'model_attributes_type', 'Input should be an object');
    const empty = emptyChange(request, body);
    if (empty) return empty;
    const shapeErrors = [
      ...unknownMembers(body, ['role', 'project_ids']),
      ...nullErrors(body, ['role']),
      ...('role' in body && body.role !== null && !isRole(body.role)
        ? [bodyError('role', 'enum', 'Unknown role.')]
        : []),
    ];
    if (shapeErrors.length > 0) return invalid(request, shapeErrors);
    // The members of a workspace an operator created here are its owner only, and the owner stays
    if (access.workspace.workspace_id !== MOCK_WORKSPACE.workspace_id) {
      return params.user_id === session.user.user_id ? problem(request, 'last_owner') : problem(request, 'not_found');
    }
    const person = personOf(params.user_id, cookies);
    const current = person ? membershipOf(person, changes, cookies) : null;
    if (!person || !current) return problem(request, 'not_found');
    const role = isRole(body.role) ? body.role : current.role;
    // Only an owner grants the owner role or changes an owner
    if ((role === 'owner' || current.role === 'owner') && access.membership.role !== 'owner') {
      return problem(request, 'forbidden');
    }
    if (current.role === 'owner' && role !== 'owner' && ownerCount(changes, cookies) === 1) {
      return problem(request, 'last_owner');
    }
    const scope = scopeErrors(body.project_ids, role, changes, access.workspace.workspace_id);
    if (scope.length > 0) return invalid(request, scope);
    // A role that sees every project drops its list
    const projectIds = UNSCOPED_ROLES.includes(role)
      ? null
      : isStringList(body.project_ids)
        ? storedList(body.project_ids)
        : 'project_ids' in body
          ? null
          : current.project_ids === null
            ? null
            : [...current.project_ids];
    const edit: MemberEdit = { role, project_ids: projectIds };
    const withdrawn = withdrawSentBy(changes, cookies, person.user_id, { from: current.role, to: role });
    const next: WorkspaceChanges = {
      ...changes,
      members: { ...changes.members, [person.user_id]: edit },
      ...(withdrawn.length > 0 ? { withdrawn: [...(changes.withdrawn ?? []), ...withdrawn] } : {}),
    };
    const member = memberList(next, cookies, { user_id: session.user.user_id, canManage: true }).find(
      (candidate) => candidate.user.user_id === person.user_id,
    );
    if (!member) throw new Error('The changed member is missing');
    return HttpResponse.json({ data: member }, { headers: { 'set-cookie': changesCookie(next) } });
  }),

  mock('delete', '/api/v1/workspaces/{workspace_id}/members/{user_id}', ({ request, cookies, params }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    const changes = readChanges(cookies);
    const access = accessTo(params.workspace_id, session.user, changes, cookies);
    if (!access) return problem(request, 'not_found');
    if (!can(access, 'members:manage')) return problem(request, 'forbidden');
    if (!isFresh(session)) return freshSessionRequired(request);
    if (access.workspace.workspace_id !== MOCK_WORKSPACE.workspace_id) {
      return params.user_id === session.user.user_id ? problem(request, 'last_owner') : problem(request, 'not_found');
    }
    const person = personOf(params.user_id, cookies);
    const current = person ? membershipOf(person, changes, cookies) : null;
    if (!person || !current) return problem(request, 'not_found');
    if (current.role === 'owner' && access.membership.role !== 'owner') return problem(request, 'forbidden');
    if (current.role === 'owner' && ownerCount(changes, cookies) === 1) return problem(request, 'last_owner');
    const withdrawn = withdrawSentBy(changes, cookies, person.user_id, { from: current.role, to: null });
    const next: WorkspaceChanges = {
      ...changes,
      members: { ...changes.members, [person.user_id]: { ...changes.members?.[person.user_id], removed: true } },
      ...(withdrawn.length > 0 ? { withdrawn: [...(changes.withdrawn ?? []), ...withdrawn] } : {}),
    };
    return noContent({ 'set-cookie': changesCookie(next) });
  }),

  mock('get', '/api/v1/workspaces/{workspace_id}/invitations', ({ request, cookies, params }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    const changes = readChanges(cookies);
    const access = accessTo(params.workspace_id, session.user, changes, cookies);
    if (!access) return problem(request, 'not_found');
    if (!can(access, 'members:manage')) return problem(request, 'forbidden');
    const paging = offsetPaging(new URL(request.url));
    if (Array.isArray(paging)) return invalid(request, paging);
    const invitations = invitationList(changes, cookies, access.workspace.workspace_id);
    return HttpResponse.json(offsetPageOf(invitations, paging));
  }),

  mock('post', '/api/v1/workspaces/{workspace_id}/invitations', async ({ request, cookies, params }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    const changes = readChanges(cookies);
    const access = accessTo(params.workspace_id, session.user, changes, cookies);
    if (!access) return problem(request, 'not_found');
    if (!can(access, 'members:manage')) return problem(request, 'forbidden');
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalidField(request, '', 'model_attributes_type', 'Input should be an object');
    // The address is kept as typed, trimmed and in one Unicode form; addresses are compared without case
    const email = typeof body.email === 'string' ? body.email.trim().normalize('NFC') : '';
    const errors = [
      ...unknownMembers(body, ['email', 'role', 'project_ids']),
      ...(EMAIL.test(email) && email.length <= MAX_EMAIL_LENGTH
        ? []
        : [bodyError('email', 'value_error', 'Enter an email address.')]),
      ...(isRole(body.role) ? [] : [bodyError('role', 'enum', 'Unknown role.')]),
    ];
    if (errors.length > 0 || !isRole(body.role)) return invalid(request, errors);
    const role = body.role;
    if ((role === 'owner' || role === 'admin') && !isFresh(session)) return freshSessionRequired(request);
    if (role === 'owner' && access.membership.role !== 'owner') return problem(request, 'forbidden');
    const workspaceId = access.workspace.workspace_id;
    const scope = scopeErrors(body.project_ids, role, changes, workspaceId);
    if (scope.length > 0) return invalid(request, scope);
    const now = Date.now();
    const same = (address: string): boolean => address.toLowerCase() === email.toLowerCase();
    const pending = invitationList(changes, cookies, workspaceId, now).filter(
      (invitation) => invitation.status === 'pending',
    );
    const members =
      workspaceId === MOCK_WORKSPACE.workspace_id
        ? memberList(changes, cookies, { user_id: session.user.user_id, canManage: true })
        : [];
    if (pending.some((invitation) => same(invitation.email)) || members.some((member) => same(member.user.email))) {
      return problem(request, 'duplicate', { detail: 'Already a member, or invited already.' });
    }
    const lastHour = (changes.invitations ?? []).filter((sent) => now - Date.parse(sent.created_at) < HOUR_MS);
    if (
      lastHour.filter((sent) => sent.invited_by === session.user.user_id).length >= INVITES_PER_INVITER ||
      lastHour.filter((sent) => sent.workspace_id === workspaceId).length >= INVITES_PER_WORKSPACE ||
      lastHour.filter((sent) => same(sent.email)).length >= INVITES_PER_ADDRESS
    ) {
      return problem(request, 'rate_limited', { retry_after_seconds: 3600, headers: { 'retry-after': '3600' } });
    }
    const sent = {
      invitation_id: crypto.randomUUID(),
      workspace_id: workspaceId,
      email,
      role,
      project_ids:
        UNSCOPED_ROLES.includes(role) || !isStringList(body.project_ids) ? null : storedList(body.project_ids),
      invited_by: session.user.user_id,
      created_at: new Date(now).toISOString(),
    };
    const next: WorkspaceChanges = { ...changes, invitations: [...(changes.invitations ?? []), sent] };
    const invitation = invitationList(next, cookies, workspaceId, now).find(
      (candidate) => candidate.invitation_id === sent.invitation_id,
    );
    if (!invitation) throw new Error('The new invitation is missing');
    return HttpResponse.json({ data: invitation }, { status: 201, headers: { 'set-cookie': changesCookie(next) } });
  }),

  mock('delete', '/api/v1/workspaces/{workspace_id}/invitations/{invitation_id}', ({ request, cookies, params }) => {
    const session = signedIn(cookies);
    if (!session) return problem(request, 'unauthenticated');
    const changes = readChanges(cookies);
    const access = accessTo(params.workspace_id, session.user, changes, cookies);
    if (!access) return problem(request, 'not_found');
    if (!can(access, 'members:manage')) return problem(request, 'forbidden');
    const invitation = invitationList(changes, cookies, access.workspace.workspace_id).find(
      (candidate) => candidate.invitation_id === params.invitation_id,
    );
    if (!invitation) return problem(request, 'not_found');
    // Withdrawing again is not an error; an invitation that was used or ran out cannot be withdrawn
    if (invitation.status === 'cancelled') return noContent();
    if (invitation.status !== 'pending') return problem(request, 'invalid_state_transition');
    const next: WorkspaceChanges = {
      ...changes,
      withdrawn: [...(changes.withdrawn ?? []), invitation.invitation_id],
    };
    return noContent({ 'set-cookie': changesCookie(next) });
  }),
];
