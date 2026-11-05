import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller, workspaceCaller, type ProjectCaller } from './access';
import {
  bodyError,
  extraMembers,
  isOneOf,
  isRecord,
  notAnObject,
  offsetPageOf,
  offsetPaging,
  queryError,
} from './rules';
import {
  CONNECTION_STATUSES,
  integrationsCookie,
  integrationWorld,
  liveIntegrations,
  MOCK_GOOGLE_ACCOUNT,
  MOCK_PROPERTIES,
  MOCK_SCOPES,
  withConnection,
  withConnectionStatus,
  withIntegration,
  withIntegrationStatus,
  type IntegrationWorld,
  type MockProperty,
  type StoredConnection,
  type StoredIntegration,
} from '../integrations-state';
import { freshSessionRequired, invalid, mock, problem } from '../respond';
import { isFresh } from '../session';
import { MOCK_USERS } from '../fixtures';
import type { Connection, Integration, Problem, Project, SiteProperty, ValidationItem } from '@/lib/api/types';

/**
 * Google Search Console, as far as the backend has built it (19 section 3.10, `api/integrations`): starting
 * a connection, the connections of the workspace, the properties of one, linking a property to a project and
 * switching it off, and disconnecting. There is no Google: the address `authorize` answers is the page the
 * person would come back to, with the connection already made, so the whole flow can be walked in a browser.
 * Starting, switching off and disconnecting need a fresh session; managing needs `integrations:manage` and
 * every project (a connection is the workspace's, shared by its projects).
 */

const W = '/api/v1/workspaces/{workspace_id}';
const P = `${W}/projects/{project_id}`;
const ONE_LINK = 'The project already has a Search Console property.';

function connectionView(world: IntegrationWorld, row: StoredConnection): Connection {
  const user = MOCK_USERS.find((candidate) => candidate.user_id === row.connectedBy);
  return {
    connection_id: row.id,
    product: 'gsc',
    auth_method: 'oauth',
    subject_label: MOCK_GOOGLE_ACCOUNT,
    scopes: [...MOCK_SCOPES],
    status: row.status,
    connected_by: user === undefined ? null : { user_id: user.user_id, name: user.name, email: user.email },
    connected_at: row.connectedAt,
    last_refresh_at: null,
    last_error_code: row.status === 'reauth_required' ? 'invalid_grant' : null,
    integration_count: liveIntegrations(world).filter((link) => link.connectionId === row.id).length,
  };
}

function integrationView(world: IntegrationWorld, row: StoredIntegration): Integration {
  const connection = world.connections.find((candidate) => candidate.id === row.connectionId);
  return {
    integration_id: row.id,
    project_id: row.projectId,
    connection_id: row.connectionId,
    kind: 'gsc',
    external_property: row.property,
    external_account: MOCK_GOOGLE_ACCOUNT,
    status: row.status,
    connection_status: connection?.status ?? null,
    last_success_at: null,
    last_error: null,
    backfill_state: {},
    sync: null,
    created_at: row.createdAt,
  };
}

/** Whether two properties cover the same site, so counting both would count one visit twice. */
const overlaps = (first: MockProperty, other: MockProperty): boolean =>
  first.external_property !== other.external_property &&
  (first.host === other.host || first.host.endsWith(`.${other.host}`) || other.host.endsWith(`.${first.host}`));

function propertyViews(
  world: IntegrationWorld,
  projects: readonly Pick<Project, 'slug' | 'project_id'>[],
): SiteProperty[] {
  const live = liveIntegrations(world);
  return MOCK_PROPERTIES.map((property) => {
    const linked = live.find((row) => row.property === property.external_property);
    const clash = live
      .map((row) => ({ row, other: MOCK_PROPERTIES.find((candidate) => candidate.external_property === row.property) }))
      .find((entry) => entry.other !== undefined && overlaps(property, entry.other));
    const suggested = projects.find((project) => project.slug === property.suggestedFor);
    return {
      external_property: property.external_property,
      label: property.property_type === 'domain' ? property.host : property.external_property,
      property_type: property.property_type,
      permission_level: property.permission_level,
      is_selectable: property.permission_level !== 'siteUnverifiedUser',
      suggested_project_id: suggested?.project_id ?? null,
      linked_project_id: linked?.projectId ?? null,
      overlap_warning:
        clash === undefined ? null : { external_property: clash.row.property, project_id: clash.row.projectId },
    };
  });
}

/** `403` for a member who may manage connections but is limited to some projects, as the backend refuses. */
const limited = (request: Request, caller: ProjectCaller): HttpResponse<Problem> | null =>
  caller.access.membership.project_ids === null
    ? null
    : problem(request, 'forbidden', { detail: 'Not available to a member who is limited to some projects.' });

export const integrationHandlers: HttpHandler[] = [
  mock('post', `${P}/integrations/{kind}/authorize`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'integrations:manage',
    });
    if (caller instanceof Response) return caller;
    const refused = limited(request, caller);
    if (refused !== null) return refused;
    if (params.kind !== 'gsc') return problem(request, 'not_found');
    if (!isFresh(caller.session)) return freshSessionRequired(request);
    const world = integrationWorld(cookies);
    // Connecting again for a connection that needs it renews that one; otherwise there is a new connection
    const renewing = world.connections.find((row) => row.status === 'reauth_required');
    const made =
      renewing === undefined
        ? withConnection(world, {
            status: 'active',
            connectedBy: caller.session.user.user_id,
            connectedAt: new Date().toISOString(),
          })
        : { world: withConnectionStatus(world, renewing.id, 'active'), id: renewing.id };
    const cookie = integrationsCookie(made.world);
    if (cookie === null) return problem(request, 'mock_state_full');
    const back = new URL(request.url);
    back.pathname = `/${caller.access.workspace.slug}/${caller.project.slug}/integrations/gsc`;
    back.search = `?connection_id=${made.id}`;
    return HttpResponse.json(
      {
        data: {
          authorization_url: back.toString(),
          state_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        },
      },
      { headers: { 'set-cookie': cookie } },
    );
  }),

  mock('get', `${P}/integrations`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['offset', 'limit'],
    });
    if (caller instanceof Response) return caller;
    const paging = offsetPaging(caller.url);
    if (Array.isArray(paging)) return invalid(request, paging);
    const world = integrationWorld(cookies);
    const rows = world.integrations
      .filter((row) => row.projectId === caller.project.project_id)
      .map((row) => integrationView(world, row));
    return HttpResponse.json(offsetPageOf(rows, paging));
  }),

  mock('post', `${P}/integrations`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'integrations:manage',
    });
    if (caller instanceof Response) return caller;
    const refused = limited(request, caller);
    if (refused !== null) return refused;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors: ValidationItem[] = [
      ...extraMembers(body, ['connection_id', 'kind', 'external_property']),
      ...(['connection_id', 'kind', 'external_property'] as const).flatMap((name) =>
        typeof body[name] === 'string' ? [] : [bodyError(name, 'missing', 'Field required')],
      ),
      ...(body.kind === undefined || body.kind === 'gsc'
        ? []
        : [bodyError('kind', 'literal_error', "Input should be 'gsc'")]),
    ];
    if (errors.length > 0) return invalid(request, errors);
    const world = integrationWorld(cookies);
    const connection = world.connections.find((row) => row.id === body.connection_id);
    if (connection === undefined || connection.status === 'revoked') return problem(request, 'not_found');
    if (connection.status !== 'active') return problem(request, 'integration_reauth_required');
    const property = MOCK_PROPERTIES.find((row) => row.external_property === body.external_property);
    if (property === undefined || property.permission_level === 'siteUnverifiedUser') {
      return problem(request, 'property_not_accessible', {
        detail: 'This account cannot read that property. Pick one from the list.',
      });
    }
    const live = liveIntegrations(world);
    if (live.some((row) => row.projectId === caller.project.project_id)) {
      return problem(request, 'duplicate', { detail: ONE_LINK });
    }
    if (live.some((row) => row.property === property.external_property)) {
      return problem(request, 'duplicate', { detail: 'This property is already linked to a project.' });
    }
    const made = withIntegration(world, {
      projectId: caller.project.project_id,
      connectionId: connection.id,
      property: property.external_property,
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    const cookie = integrationsCookie(made.world);
    if (cookie === null) return problem(request, 'mock_state_full');
    const row = made.world.integrations.find((candidate) => candidate.id === made.id);
    if (row === undefined) throw new Error('The new link is missing');
    return HttpResponse.json(
      { data: integrationView(made.world, row) },
      { status: 201, headers: { 'set-cookie': cookie } },
    );
  }),

  mock('delete', `${P}/integrations/{integration_id}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'integrations:manage',
    });
    if (caller instanceof Response) return caller;
    const refused = limited(request, caller);
    if (refused !== null) return refused;
    if (!isFresh(caller.session)) return freshSessionRequired(request);
    const world = integrationWorld(cookies);
    const row = world.integrations.find(
      (candidate) => candidate.id === params.integration_id && candidate.projectId === caller.project.project_id,
    );
    if (row === undefined) return problem(request, 'not_found');
    const next = withIntegrationStatus(world, row.id, 'disabled');
    const cookie = integrationsCookie(next);
    if (cookie === null) return problem(request, 'mock_state_full');
    const changed = next.integrations.find((candidate) => candidate.id === row.id);
    if (changed === undefined) throw new Error('The switched off link is missing');
    return HttpResponse.json({ data: integrationView(next, changed) }, { headers: { 'set-cookie': cookie } });
  }),

  mock('get', `${W}/connections`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, {
      permission: 'integrations:manage',
      query: ['filter[product]', 'filter[status]', 'offset', 'limit'],
      everyProject: true,
    });
    if (caller instanceof Response) return caller;
    const product = caller.url.searchParams.get('filter[product]');
    const status = caller.url.searchParams.get('filter[status]');
    const paging = offsetPaging(caller.url);
    const errors: ValidationItem[] = [
      ...(product === null || isOneOf(product, ['gsc', 'ga4', 'bing_wmt', 'cloudflare'] as const)
        ? []
        : [queryError('filter[product]', 'enum', 'Allowed: gsc, ga4, bing_wmt, cloudflare.')]),
      ...(status === null || isOneOf(status, CONNECTION_STATUSES)
        ? []
        : [queryError('filter[status]', 'enum', `Allowed: ${CONNECTION_STATUSES.join(', ')}.`)]),
      ...(Array.isArray(paging) ? paging : []),
    ];
    if (errors.length > 0 || Array.isArray(paging)) return invalid(request, errors);
    const world = integrationWorld(cookies);
    // Newest first, as the backend lists them
    const rows = world.connections
      .filter((row) => (product === null || product === 'gsc') && (status === null || row.status === status))
      .sort((first, second) => second.connectedAt.localeCompare(first.connectedAt))
      .map((row) => connectionView(world, row));
    return HttpResponse.json(offsetPageOf(rows, paging));
  }),

  mock('get', `${W}/connections/{connection_id}/properties`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, {
      permission: 'integrations:manage',
      everyProject: true,
    });
    if (caller instanceof Response) return caller;
    const world = integrationWorld(cookies);
    const connection = world.connections.find((row) => row.id === params.connection_id);
    if (connection === undefined || connection.status === 'revoked') return problem(request, 'not_found');
    if (connection.status !== 'active') {
      return problem(request, 'integration_reauth_required', { detail: 'Connect the Google account again.' });
    }
    return HttpResponse.json({ data: propertyViews(world, caller.projects) });
  }),

  mock('delete', `${W}/connections/{connection_id}`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, {
      permission: 'integrations:manage',
      everyProject: true,
    });
    if (caller instanceof Response) return caller;
    if (!isFresh(caller.session)) return freshSessionRequired(request);
    const world = integrationWorld(cookies);
    const connection = world.connections.find((row) => row.id === params.connection_id);
    if (connection === undefined) return problem(request, 'not_found');
    // The numbers stay; the properties of the connection are switched off
    const revoked = withConnectionStatus(world, connection.id, 'revoked');
    const next = liveIntegrations(revoked)
      .filter((row) => row.connectionId === connection.id)
      .reduce((acc, row) => withIntegrationStatus(acc, row.id, 'disabled'), revoked);
    const cookie = integrationsCookie(next);
    if (cookie === null) return problem(request, 'mock_state_full');
    const changed = next.connections.find((row) => row.id === connection.id);
    if (changed === undefined) throw new Error('The revoked connection is missing');
    return HttpResponse.json({ data: connectionView(next, changed) }, { headers: { 'set-cookie': cookie } });
  }),
];
