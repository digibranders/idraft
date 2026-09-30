import { permissionsFor } from './permissions';
import { MOCK_CREATED_AT, MOCK_WORKSPACE, type MockUserSeed } from '../fixtures';
import type { components } from '@/lib/api/schema';
import type { Me, MeMembership, Role } from '@/lib/api/types';

type Schemas = components['schemas'];
type MeUser = Schemas['MeUser'];
type MeWorkspace = Schemas['MeWorkspace'];
type Workspace = Schemas['Workspace'];

/**
 * Builders for the identity payloads of the API, typed by the generated schema. Each takes overrides, so
 * a test states only what it is about: `meFactory({ user: { two_factor_enabled: true } })`.
 */

export function userFactory(seed: MockUserSeed, overrides: Partial<MeUser> = {}): MeUser {
  return {
    user_id: seed.user_id,
    name: seed.name,
    email: seed.email,
    email_verified: true,
    image: null,
    two_factor_enabled: seed.two_factor_enabled,
    is_platform_operator: seed.is_platform_operator,
    created_at: MOCK_CREATED_AT,
    ...overrides,
  };
}

export function workspaceFactory(overrides: Partial<Workspace> = {}): Workspace {
  return {
    ...MOCK_WORKSPACE,
    logo: null,
    plan_code: 'agency',
    timezone: 'Europe/Berlin',
    status: 'active',
    created_at: MOCK_CREATED_AT,
    purge_after: null,
    ...overrides,
  };
}

const meWorkspace = (workspace: Workspace): MeWorkspace => ({
  workspace_id: workspace.workspace_id,
  name: workspace.name,
  slug: workspace.slug,
  status: workspace.status,
});

export function membershipFactory(
  role: Role,
  {
    projectIds = null,
    workspace = workspaceFactory(),
  }: { projectIds?: readonly string[] | null; workspace?: Workspace } = {},
): MeMembership {
  return {
    workspace: meWorkspace(workspace),
    role,
    project_ids: projectIds === null ? null : [...projectIds],
    permissions: permissionsFor(role),
  };
}

export interface MeOverrides {
  user?: Partial<MeUser>;
  session?: Partial<Me['session']>;
  memberships?: MeMembership[];
}

/** A session lasts 7 days after its last use (the API's idle lifetime). */
const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

/** `/me` for a fixture user: their user record, their session and their membership of Digibranders. */
export function meFactory(seed: MockUserSeed, overrides: MeOverrides = {}): Me {
  return {
    user: userFactory(seed, overrides.user),
    session: {
      auth_method: 'session',
      expires_at: new Date(Date.now() + SESSION_IDLE_MS).toISOString(),
      fresh_until: null,
      ...overrides.session,
    },
    memberships: overrides.memberships ?? [membershipFactory(seed.role, { projectIds: seed.project_ids })],
  };
}
