import type { QueryClient } from '@tanstack/react-query';

import { apiAllPagesQuery, apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { Role } from '@/lib/api/types';

/** The roles in the order the dialogs list them, from the most to the least access (24-security.md section 3.1). */
export const ROLES: readonly Role[] = ['owner', 'admin', 'editor', 'analyst', 'viewer', 'billing'];

/** Every project, or some of them. */
export type AccessChoice = 'all' | 'some';

const MEMBERS = '/api/v1/workspaces/{workspace_id}/members';
const INVITATIONS = '/api/v1/workspaces/{workspace_id}/invitations';
const PROJECTS = '/api/v1/workspaces/{workspace_id}/projects';
/** Every member: the table shows them all, whatever the page size of the API. */
export const membersQuery = (workspaceId: string): ApiQueryOptions<typeof MEMBERS> =>
  apiAllPagesQuery(MEMBERS, { params: { path: { workspace_id: workspaceId } } });

/** Every pending invitation, read page by page like the members. */
export const invitationsQuery = (workspaceId: string): ApiQueryOptions<typeof INVITATIONS> =>
  apiAllPagesQuery(INVITATIONS, { params: { path: { workspace_id: workspaceId } } });

/**
 * Every active and paused project, for the project lists of the member and invitation dialogs. Fetched
 * again each time a dialog opens: projects are created, renamed and archived on other screens, and a
 * stale list would offer an archived project the API refuses.
 */
export const projectsQuery = (workspaceId: string): ApiQueryOptions<typeof PROJECTS> => ({
  ...apiAllPagesQuery(PROJECTS, { params: { path: { workspace_id: workspaceId } } }),
  staleTime: 0,
});

const WORKSPACE = '/api/v1/workspaces/{workspace_id}';

export const workspaceQuery = (workspaceId: string): ApiQueryOptions<typeof WORKSPACE> =>
  apiQuery(WORKSPACE, { params: { path: { workspace_id: workspaceId } } });

/**
 * Refreshes the members and the invitations together: a change to a member can withdraw the invitations
 * they sent (when they stop managing members), so the two lists change as one.
 */
export function refreshPeople(queryClient: QueryClient, workspaceId: string): void {
  void queryClient.invalidateQueries({ queryKey: membersQuery(workspaceId).queryKey });
  void queryClient.invalidateQueries({ queryKey: invitationsQuery(workspaceId).queryKey });
}
