import type { QueryClient } from '@tanstack/react-query';

import { projectKey, workspaceKey } from '@/lib/api/keys';
import { apiAllPagesQuery, apiMutation, apiQuery, type ApiQueryOptions } from '@/lib/api/query';

/**
 * Search Console's connection and the property a project reads (19 section 3.10): what the page shows, and
 * the writes of its buttons. Every change is pessimistic, since a connection is a credential: the page waits
 * for the answer and reads again (20 section 3.5, Mutations). Everything is read again whenever it is asked
 * for: Google can change a connection's state between two visits.
 */

const W = '/api/v1/workspaces/{workspace_id}';
const CONNECTIONS = `${W}/connections` as const;
const CONNECTION = `${CONNECTIONS}/{connection_id}` as const;
const PROPERTIES = `${CONNECTION}/properties` as const;
const INTEGRATIONS = `${W}/projects/{project_id}/integrations` as const;
const INTEGRATION = `${INTEGRATIONS}/{integration_id}` as const;
const AUTHORIZE = `${INTEGRATIONS}/{kind}/authorize` as const;

/** The workspace and the project whose Search Console page is open. */
export interface GscScope {
  workspaceId: string;
  projectId: string;
}

/** The properties linked to the project, switched off ones included (the page reads which is live). */
export const integrationsQuery = (scope: GscScope): ApiQueryOptions<typeof INTEGRATIONS> => ({
  ...apiAllPagesQuery(INTEGRATIONS, (integration) => integration.integration_id, {
    params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
  }),
  staleTime: 0,
});

/** The workspace's Search Console connections, newest first. Only those who manage integrations may list them. */
export const connectionsQuery = (workspaceId: string): ApiQueryOptions<typeof CONNECTIONS> => ({
  ...apiAllPagesQuery(CONNECTIONS, (connection) => connection.connection_id, {
    params: { path: { workspace_id: workspaceId }, query: { 'filter[product]': 'gsc' } },
  }),
  staleTime: 0,
});

/** What the connected account can see in Search Console. It asks Google, so it is read when the picker opens. */
export const propertiesQuery = (workspaceId: string, connectionId: string): ApiQueryOptions<typeof PROPERTIES> => ({
  ...apiQuery(PROPERTIES, { params: { path: { workspace_id: workspaceId, connection_id: connectionId } } }),
  staleTime: 0,
});

/**
 * After a change to the connection or the property: the project's properties, the workspace's connections
 * and the tracked keywords, whose `gsc` state is `not_connected` until a property is live. Resolves once the
 * queries on screen have read again.
 */
export function refreshGsc(queryClient: QueryClient, scope: GscScope): Promise<void> {
  const project = projectKey(scope.workspaceId, scope.projectId);
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: [...project, 'integrations'] }),
    queryClient.invalidateQueries({ queryKey: [...workspaceKey(scope.workspaceId), 'connections'] }),
    queryClient.invalidateQueries({ queryKey: [...project, 'seo', 'tracked-keywords'] }),
  ]).then(() => undefined);
}

export const AUTHORIZE_GSC = apiMutation('post', AUTHORIZE);
export const CHOOSE_PROPERTY = apiMutation('post', INTEGRATIONS);
export const SWITCH_OFF_PROPERTY = apiMutation('delete', INTEGRATION);
export const DISCONNECT_GOOGLE = apiMutation('delete', CONNECTION);
