import type { HttpResponse } from 'msw';

import { unknownQuery } from './rules';
import {
  ENTITIES_COOKIE,
  entitiesCookie,
  entityConfigVersion,
  entityWorld,
  readEntityChanges,
  type EntityChanges,
  type EntityWorld,
} from '../entities-state';
import { PERMISSION_HOLDERS } from '../factories/permissions';
import { invalid, problem } from '../respond';
import { readSession, type MockSession } from '../session';
import { accessTo, projectList, readChanges, type WorkspaceAccess, type WorkspaceChanges } from '../workspace-state';
import type { Problem, Project } from '@/lib/api/types';
import type { Permission } from '@/lib/permissions/permissions';

/**
 * Who is calling and what they may see, checked in the API's order (19 section 2.2): the session (`401`), a
 * query parameter the route does not have (`422`), the membership (`404`), the project scope (`404`), then
 * the permission (`403`). Anything the caller cannot see is a `404` with the same body, so a mock never
 * confirms that another tenant's object exists.
 */

export function signedIn(cookies: Readonly<Record<string, string>>): MockSession | null {
  const session = readSession(cookies);
  return session?.state === 'active' ? session : null;
}

export const can = (access: WorkspaceAccess, permission: Permission): boolean =>
  PERMISSION_HOLDERS[permission].includes(access.membership.role);

/** The projects of a workspace the member may open, with the `entity_config_version` the entity changes moved. */
export function visibleProjects(
  access: WorkspaceAccess,
  changes: WorkspaceChanges,
  entityChanges: EntityChanges,
): Project[] {
  const allowed = access.membership.project_ids;
  return projectList(changes, access.workspace.workspace_id)
    .filter((project) => allowed === null || allowed.includes(project.project_id))
    .map((project) => ({ ...project, entity_config_version: entityConfigVersion(entityChanges, project.project_id) }));
}

export interface WorkspaceCaller {
  session: MockSession;
  access: WorkspaceAccess;
  changes: WorkspaceChanges;
  entityChanges: EntityChanges;
  world: EntityWorld;
  /** The projects the caller may open. */
  projects: Project[];
  url: URL;
}

export interface ProjectCaller extends WorkspaceCaller {
  project: Project;
}

interface Gate {
  permission: Permission;
  /** The query parameters the route has; any other is a `422`. */
  query?: readonly string[];
  /**
   * The route changes something every project shares (a workspace entity), so a member limited to some
   * projects gets `403` (backend `require_permission(..., every_project=True)`).
   */
  everyProject?: boolean;
}

type PathParam = string | readonly string[] | undefined;

/** The `Set-Cookie` that keeps `changes`, or the `422` to answer when they no longer fit in the cookie. */
export function savedEntities(request: Request, changes: EntityChanges): string | HttpResponse<Problem> {
  return (
    entitiesCookie(changes) ??
    problem(request, 'mock_state_full', {
      detail: `What this browser changed no longer fits in the mock state. Expire the ${ENTITIES_COOKIE} cookie to start again from the fixtures.`,
    })
  );
}

export function workspaceCaller(
  request: Request,
  cookies: Readonly<Record<string, string>>,
  workspaceId: PathParam,
  { permission, query = [], everyProject = false }: Gate,
): WorkspaceCaller | HttpResponse<Problem> {
  const session = signedIn(cookies);
  if (!session) return problem(request, 'unauthenticated');
  const url = new URL(request.url);
  const unknown = unknownQuery(url, query);
  if (unknown.length > 0) return invalid(request, unknown);
  const changes = readChanges(cookies);
  const access = accessTo(workspaceId, session.user, changes, cookies);
  if (!access) return problem(request, 'not_found');
  if (!can(access, permission)) return problem(request, 'forbidden');
  if (everyProject && access.membership.project_ids !== null) {
    return problem(request, 'forbidden', { detail: 'Not available to a member who is limited to some projects.' });
  }
  const entityChanges = readEntityChanges(cookies);
  return {
    session,
    access,
    changes,
    entityChanges,
    world: entityWorld(entityChanges, changes),
    projects: visibleProjects(access, changes, entityChanges),
    url,
  };
}

export function projectCaller(
  request: Request,
  cookies: Readonly<Record<string, string>>,
  workspaceId: PathParam,
  projectId: PathParam,
  { permission, query = [] }: Gate,
): ProjectCaller | HttpResponse<Problem> {
  const session = signedIn(cookies);
  if (!session) return problem(request, 'unauthenticated');
  const url = new URL(request.url);
  const unknown = unknownQuery(url, query);
  if (unknown.length > 0) return invalid(request, unknown);
  const changes = readChanges(cookies);
  const access = accessTo(workspaceId, session.user, changes, cookies);
  if (!access) return problem(request, 'not_found');
  const entityChanges = readEntityChanges(cookies);
  const projects = visibleProjects(access, changes, entityChanges);
  const project = projects.find((candidate) => candidate.project_id === projectId);
  if (!project) return problem(request, 'not_found');
  if (!can(access, permission)) return problem(request, 'forbidden');
  return {
    session,
    access,
    changes,
    entityChanges,
    world: entityWorld(entityChanges, changes),
    projects,
    project,
    url,
  };
}
