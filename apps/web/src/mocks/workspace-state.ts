import { jsonCookie, readJsonCookie } from './cookie-json';
import { domainRefFactory } from './factories/domain';
import { locationRefFactory } from './factories/location';
import { projectFactory } from './factories/project';
import {
  MOCK_CREATED_AT,
  MOCK_INVITED_USER,
  MOCK_PROJECTS,
  MOCK_USERS,
  MOCK_WORKSPACE,
  type MockUserSeed,
} from './fixtures';
import { hasJoined, WORKSPACE_COOKIE } from './session';
import { z } from 'zod';

import type { components } from '@/lib/api/schema';
import type { Role } from '@/lib/api/types';

type Schemas = components['schemas'];
type Project = Schemas['Project'];
type Invitation = Schemas['Invitation'];
type Member = Schemas['Member'];

/**
 * What one browser changed in the workspace through the mocks: projects created and edited, the workspace's
 * name, slug and time zone, members' roles and access, invitations sent and withdrawn, and a workspace an
 * operator created. It lives in a cookie, as the saved name does (./session.ts), so the server's MSW and the
 * browser's worker see the same workspace. Each change is small; the fixtures stay the base.
 */
export { WORKSPACE_COOKIE };

/** The fields of a project the mocks keep for one created here. */
export interface CreatedProject {
  project_id: string;
  workspace_id: string;
  name: string;
  slug: string;
  timezone: string;
  deep_check_weekday: number;
  default_language_code: string | null;
  /** The canonical host, or `null`. */
  primary_domain?: string | null | undefined;
  default_location_id?: number | null | undefined;
  /**
   * The own entity created with the project (19 section 3.3, `own_entity`). It is kept here, with the project,
   * because one answer sets one cookie; ./entities-state.ts reads it as part of its base.
   */
  own_entity?: CreatedOwnEntity | undefined;
  created_at: string;
}

/** Ids and texts only: the rest of the entity, its aliases and domains are the defaults of `own_entity`. */
export interface CreatedOwnEntity {
  entity_id: string;
  canonical_name: string;
  aliases: { alias_id: string; alias: string }[];
  domains: { entity_domain_id: string; host: string }[];
}

export interface ProjectEdit {
  name?: string | undefined;
  slug?: string | undefined;
  timezone?: string | undefined;
  deep_check_weekday?: number | undefined;
  default_language_code?: string | null | undefined;
  status?: Project['status'] | undefined;
  /** The canonical host, or `null` once removed. */
  primary_domain?: string | null | undefined;
  default_location_id?: number | null | undefined;
}

export interface MemberEdit {
  role?: Role | undefined;
  project_ids?: string[] | null | undefined;
  removed?: true | undefined;
}

export interface SentInvitation {
  invitation_id: string;
  workspace_id: string;
  email: string;
  role: Role;
  project_ids: string[] | null;
  invited_by: string;
  created_at: string;
}

export interface OwnWorkspace {
  workspace_id: string;
  name: string;
  slug: string;
  timezone: string;
  owner: string;
  created_at: string;
}

export interface WorkspaceChanges {
  workspace?: { name?: string | undefined; slug?: string | undefined; timezone?: string | undefined } | undefined;
  created?: CreatedProject[] | undefined;
  edited?: Record<string, ProjectEdit> | undefined;
  members?: Record<string, MemberEdit> | undefined;
  invitations?: SentInvitation[] | undefined;
  withdrawn?: string[] | undefined;
  ownWorkspaces?: OwnWorkspace[] | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** An invitation lasts 7 days (19 section 3.2.2). */
const INVITATION_DAYS = 7;

/**
 * The two invitations the fixture workspace has pending, sent two days and one day before the mocks
 * started, so the list is never empty on a first visit and they never run out during a session.
 */
const started = Date.now();
export const MOCK_PENDING_INVITATIONS: readonly SentInvitation[] = [
  {
    invitation_id: '0192d1a8-6c20-7d01-8b11-000000000001',
    workspace_id: MOCK_WORKSPACE.workspace_id,
    email: 'lena@digibranders.test',
    role: 'editor',
    project_ids: null,
    invited_by: MOCK_USERS[0]?.user_id ?? '',
    created_at: new Date(started - 2 * DAY_MS).toISOString(),
  },
  {
    invitation_id: '0192d1a8-6c20-7d01-8b11-000000000002',
    workspace_id: MOCK_WORKSPACE.workspace_id,
    email: 'sam@clientco.test',
    role: 'viewer',
    project_ids: [MOCK_PROJECTS[1]?.project_id ?? ''],
    invited_by: MOCK_USERS[1]?.user_id ?? '',
    created_at: new Date(started - DAY_MS).toISOString(),
  },
];

const ROLE = z.enum(['owner', 'admin', 'editor', 'analyst', 'viewer', 'billing']);
const STATUS = z.enum(['active', 'paused', 'archived']);
/** The shape the cookie must have; anything else (an older version of the mocks, a hand edit) is ignored. */
const CHANGES = z.object({
  workspace: z.object({ name: z.string(), slug: z.string(), timezone: z.string() }).partial().optional(),
  created: z
    .array(
      z.object({
        project_id: z.string(),
        workspace_id: z.string(),
        name: z.string(),
        slug: z.string(),
        timezone: z.string(),
        deep_check_weekday: z.number(),
        default_language_code: z.string().nullable(),
        primary_domain: z.string().nullable().optional(),
        default_location_id: z.number().nullable().optional(),
        own_entity: z
          .object({
            entity_id: z.string(),
            canonical_name: z.string(),
            aliases: z.array(z.object({ alias_id: z.string(), alias: z.string() })),
            domains: z.array(z.object({ entity_domain_id: z.string(), host: z.string() })),
          })
          .optional(),
        created_at: z.string(),
      }),
    )
    .optional(),
  edited: z
    .record(
      z.string(),
      z
        .object({
          name: z.string(),
          slug: z.string(),
          timezone: z.string(),
          deep_check_weekday: z.number(),
          default_language_code: z.string().nullable(),
          status: STATUS,
          primary_domain: z.string().nullable(),
          default_location_id: z.number().nullable(),
        })
        .partial(),
    )
    .optional(),
  members: z
    .record(
      z.string(),
      z.object({
        role: ROLE.optional(),
        project_ids: z.array(z.string()).nullable().optional(),
        removed: z.literal(true).optional(),
      }),
    )
    .optional(),
  invitations: z
    .array(
      z.object({
        invitation_id: z.string(),
        workspace_id: z.string(),
        email: z.string(),
        role: ROLE,
        project_ids: z.array(z.string()).nullable(),
        invited_by: z.string(),
        created_at: z.string(),
      }),
    )
    .optional(),
  withdrawn: z.array(z.string()).optional(),
  ownWorkspaces: z
    .array(
      z.object({
        workspace_id: z.string(),
        name: z.string(),
        slug: z.string(),
        timezone: z.string(),
        owner: z.string(),
        created_at: z.string(),
      }),
    )
    .optional(),
});

/** What the cookie holds, checked against its shape: a cookie that does not fit is ignored, never trusted. */
export const readChanges = (cookies: Readonly<Record<string, string>>): WorkspaceChanges =>
  readJsonCookie<WorkspaceChanges>(cookies, WORKSPACE_COOKIE, CHANGES, {});

/** The `Set-Cookie` that keeps `changes`. Throws when they no longer fit in a cookie. */
export function changesCookie(changes: WorkspaceChanges): string {
  const cookie = jsonCookie(WORKSPACE_COOKIE, changes);
  if (cookie === null) {
    throw new Error(
      `The mock workspace state no longer fits in its cookie. Expire the ${WORKSPACE_COOKIE} cookie to start again from the fixtures.`,
    );
  }
  return cookie;
}

/** The fixture workspace as this browser changed it. */
export function currentWorkspace(changes: WorkspaceChanges): {
  workspace_id: string;
  name: string;
  slug: string;
  timezone: string;
} {
  return {
    workspace_id: MOCK_WORKSPACE.workspace_id,
    name: changes.workspace?.name ?? MOCK_WORKSPACE.name,
    slug: changes.workspace?.slug ?? MOCK_WORKSPACE.slug,
    timezone: changes.workspace?.timezone ?? 'Europe/Berlin',
  };
}

/** The people of the fixture workspace: every fixture user, and the invited person once they joined. */
function fixtureMembers(cookies: Readonly<Record<string, string>>): MockUserSeed[] {
  return hasJoined(cookies) ? [...MOCK_USERS, MOCK_INVITED_USER] : [...MOCK_USERS];
}

export interface Membership {
  role: Role;
  project_ids: readonly string[] | null;
}

/** A person's role and access in the fixture workspace now, or `null` once they were removed. */
export function membershipOf(
  user: MockUserSeed,
  changes: WorkspaceChanges,
  cookies: Readonly<Record<string, string>>,
): Membership | null {
  if (!fixtureMembers(cookies).some((member) => member.user_id === user.user_id)) return null;
  const edit = changes.members?.[user.user_id];
  if (edit?.removed === true) return null;
  // `null` is every project, so only a missing list falls back to the fixture's
  return {
    role: edit?.role ?? user.role,
    project_ids: edit?.project_ids === undefined ? user.project_ids : edit.project_ids,
  };
}

/** The members of the fixture workspace as the API lists them, by name. */
export function memberList(
  changes: WorkspaceChanges,
  cookies: Readonly<Record<string, string>>,
  viewer: { user_id: string; canManage: boolean },
): Member[] {
  return fixtureMembers(cookies)
    .flatMap((seed) => {
      const membership = membershipOf(seed, changes, cookies);
      if (membership === null) return [];
      // Two-factor and activity are for managers and for the person's own row (19 section 3.2)
      const visible = viewer.canManage || viewer.user_id === seed.user_id;
      return [
        {
          user: { user_id: seed.user_id, name: seed.name, email: seed.email },
          role: membership.role,
          project_ids: membership.project_ids === null ? null : [...membership.project_ids],
          joined_at: MOCK_CREATED_AT,
          last_active_at: visible ? '2026-09-30T08:30:00Z' : null,
          two_factor_enabled: visible ? seed.two_factor_enabled : null,
        },
      ];
    })
    .sort((a, b) => a.user.name.localeCompare(b.user.name, 'en', { sensitivity: 'base' }));
}

/** The saved changes of a project, without the members that were never set. */
function editOf(changes: WorkspaceChanges, projectId: string): Partial<Project> {
  const edit = changes.edited?.[projectId] ?? {};
  const out: Partial<Project> = {};
  if (edit.name !== undefined) out.name = edit.name;
  if (edit.slug !== undefined) out.slug = edit.slug;
  if (edit.timezone !== undefined) out.timezone = edit.timezone;
  if (edit.deep_check_weekday !== undefined) out.deep_check_weekday = edit.deep_check_weekday;
  if (edit.default_language_code !== undefined) out.default_language_code = edit.default_language_code;
  if (edit.status !== undefined) out.status = edit.status;
  if (edit.primary_domain !== undefined) {
    out.primary_domain = edit.primary_domain === null ? null : domainRefFactory(edit.primary_domain);
  }
  if (edit.default_location_id !== undefined) {
    out.default_location_id = edit.default_location_id;
    out.default_location = locationRefFactory(edit.default_location_id);
  }
  return out;
}

/** Every project of a workspace with this browser's edits, and the ones created here; by name. */
export function projectList(changes: WorkspaceChanges, workspaceId: string = MOCK_WORKSPACE.workspace_id): Project[] {
  const fixtures =
    workspaceId === MOCK_WORKSPACE.workspace_id
      ? MOCK_PROJECTS.map((seed) => projectFactory(seed, editOf(changes, seed.project_id)))
      : [];
  const created = (changes.created ?? [])
    .filter((project) => project.workspace_id === workspaceId)
    .map((project) =>
      projectFactory(
        {
          project_id: project.project_id,
          name: project.name,
          slug: project.slug,
          host: project.primary_domain ?? '',
          timezone: project.timezone,
          location_id: project.default_location_id ?? null,
        },
        {
          workspace_id: project.workspace_id,
          deep_check_weekday: project.deep_check_weekday,
          default_language_code: project.default_language_code,
          created_at: project.created_at,
          updated_at: project.created_at,
          ...editOf(changes, project.project_id),
        },
      ),
    );
  return [...fixtures, ...created].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/** The fixture invitation of the invited person counts as accepted once they joined. */
const joinedBy = (sent: SentInvitation, cookies: Readonly<Record<string, string>>): boolean =>
  sent.email === MOCK_INVITED_USER.email && hasJoined(cookies);

/** The invitations of the fixture workspace, newest first, with the state each is in now. */
export function invitationList(
  changes: WorkspaceChanges,
  cookies: Readonly<Record<string, string>>,
  workspaceId: string = MOCK_WORKSPACE.workspace_id,
  now: number = Date.now(),
): Invitation[] {
  const people = [...MOCK_USERS, MOCK_INVITED_USER];
  return [...MOCK_PENDING_INVITATIONS, ...(changes.invitations ?? [])]
    .filter((sent) => sent.workspace_id === workspaceId)
    .map((sent): Invitation => {
      const inviter = people.find((person) => person.user_id === sent.invited_by);
      const expires = Date.parse(sent.created_at) + INVITATION_DAYS * DAY_MS;
      const withdrawn = changes.withdrawn?.includes(sent.invitation_id) === true;
      return {
        invitation_id: sent.invitation_id,
        email: sent.email,
        role: sent.role,
        project_ids: sent.project_ids,
        invited_by: {
          user_id: sent.invited_by,
          name: inviter?.name ?? '',
          email: inviter?.email ?? '',
        },
        created_at: sent.created_at,
        expires_at: new Date(expires).toISOString(),
        status: withdrawn ? 'cancelled' : joinedBy(sent, cookies) ? 'accepted' : expires <= now ? 'expired' : 'pending',
      };
    })
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/** The workspaces an operator created here that `userId` owns. */
export const ownWorkspacesOf = (changes: WorkspaceChanges, userId: string): OwnWorkspace[] =>
  (changes.ownWorkspaces ?? []).filter((workspace) => workspace.owner === userId);

export interface WorkspaceAccess {
  workspace: { workspace_id: string; name: string; slug: string; timezone: string };
  membership: Membership;
}

/** The workspaces `user` belongs to now: the fixture one unless removed, and any they created here. */
export function workspacesOf(
  user: MockUserSeed,
  changes: WorkspaceChanges,
  cookies: Readonly<Record<string, string>>,
): WorkspaceAccess[] {
  const fixture = membershipOf(user, changes, cookies);
  const own = ownWorkspacesOf(changes, user.user_id).map((workspace): WorkspaceAccess => ({
    workspace: {
      workspace_id: workspace.workspace_id,
      name: workspace.name,
      slug: workspace.slug,
      timezone: workspace.timezone,
    },
    membership: { role: 'owner', project_ids: null },
  }));
  return [...(fixture === null ? [] : [{ workspace: currentWorkspace(changes), membership: fixture }]), ...own];
}

/** `user`'s access to the workspace with `workspaceId`, or `null`: not a member, or no such workspace. */
export const accessTo = (
  workspaceId: string | readonly string[] | undefined,
  user: MockUserSeed,
  changes: WorkspaceChanges,
  cookies: Readonly<Record<string, string>>,
): WorkspaceAccess | null =>
  workspacesOf(user, changes, cookies).find((access) => access.workspace.workspace_id === workspaceId) ?? null;
