/**
 * The permission keys of the API (docs/24-security.md section 3.2, backend/src/sightline/api/permissions.py).
 * The OpenAPI document types a membership's permissions as plain strings, so the app names them here; the
 * mocks' role table is keyed by this list, and its test compares that table with the backend's.
 */
export const PERMISSIONS = [
  'workspace:delete',
  'workspace:update',
  'members:manage',
  'integrations:manage',
  'providers:manage',
  'budgets:manage',
  'costs:read',
  'projects:write',
  'keywords:write',
  'prompts:write',
  'entities:write',
  'taxonomy:write',
  'panels:core:modify',
  'schedules:write',
  'runs:trigger',
  'data:read',
  'raw:read',
  'exports:create',
  'audit:read',
  'alerts:write',
  'views:write',
  'imports:write',
  'api_keys:manage',
  'ops:read',
  'tasks:requeue',
  'fp:logs:write',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Whether a membership holds `permission`. The client never decides access: this only hides or disables
 * what the API would refuse (20-frontend-specification.md section 3.9).
 */
export function can(permissions: readonly string[], permission: Permission): boolean {
  return permissions.includes(permission);
}

/**
 * Whether a membership may open the project: `null` is every project, a list limits it to those. The API
 * answers 404 for any other, so the app treats such a project as one that does not exist.
 */
export function canOpenProject(projectIds: readonly string[] | null, projectId: string): boolean {
  return projectIds === null || projectIds.includes(projectId);
}

/**
 * Whether a membership may create a project: `projects:write`, and every project in view. The API refuses a
 * member limited to some projects before it reads the request (19 section 3.3).
 */
export function canCreateProjects(membership: {
  permissions: readonly string[];
  project_ids: readonly string[] | null;
}): boolean {
  return can(membership.permissions, 'projects:write') && membership.project_ids === null;
}
