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
  grants,
  integrationsCookie,
  integrationWorld,
  isGrant,
  liveIntegrations,
  MOCK_ANALYTICS_PROPERTIES,
  MOCK_GOOGLE_ACCOUNT,
  MOCK_PROPERTIES,
  scopesOf,
  withConnection,
  withConnectionGrant,
  withConnectionStatus,
  withIntegration,
  withIntegrationStatus,
  type IntegrationWorld,
  type MockProperty,
  type Product,
  type StoredConnection,
  type StoredIntegration,
} from '../integrations-state';
import { freshSessionRequired, invalid, mock, problem } from '../respond';
import { GOOGLE_GRANT_COOKIE, isFresh } from '../session';
import { MOCK_USERS } from '../fixtures';
import type {
  AnalyticsProperty,
  Connection,
  Integration,
  Problem,
  Project,
  SiteProperty,
  ValidationItem,
} from '@/lib/api/types';

/**
 * Google (Search Console and GA4 share one connection), as far as the backend has built it (19 section 3.10,
 * `api/integrations`): starting a connection, the connections of the workspace, the properties of each product
 * of one, linking a property to a project and switching it off, and disconnecting. There is no Google: the
 * address `authorize` answers is the page the person would come back to, with the connection already made, so
 * the whole flow can be walked in a browser. The grant is both products unless the `mock-google-grant` cookie
 * says `gsc` or `ga4` (Google's granular consent). Starting, switching off and disconnecting need a fresh
 * session; managing needs `integrations:manage` and every project (a connection is the workspace's, shared by
 * its projects).
 */

const W = '/api/v1/workspaces/{workspace_id}';
const P = `${W}/projects/{project_id}`;
const ONE_LINK = {
  gsc: 'The project already has a Search Console property.',
  ga4: 'The project already has a GA4 property.',
} as const satisfies Record<Product, string>;
const MISSING = {
  gsc: 'Search Console access was not granted. Connect the Google account again and tick it.',
  ga4: 'GA4 access was not granted. Connect the Google account again and tick it.',
} as const satisfies Record<Product, string>;

function connectionView(world: IntegrationWorld, row: StoredConnection): Connection {
  const user = MOCK_USERS.find((candidate) => candidate.user_id === row.connectedBy);
  return {
    connection_id: row.id,
    product: 'google',
    auth_method: 'oauth',
    subject_label: MOCK_GOOGLE_ACCOUNT,
    scopes: scopesOf(row.grant),
    access: { gsc: grants(row.grant, 'gsc'), ga4: grants(row.grant, 'ga4') },
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
  // Connecting again without this product's box stops its property, as the backend does
  const unticked = connection !== undefined && row.status !== 'disabled' && !grants(connection.grant, row.kind);
  return {
    integration_id: row.id,
    project_id: row.projectId,
    connection_id: row.connectionId,
    kind: row.kind,
    external_property: row.property,
    external_account: MOCK_GOOGLE_ACCOUNT,
    status: unticked ? 'error' : row.status,
    connection_status: connection?.status ?? null,
    last_success_at: null,
    last_error: unticked ? 'scope_missing' : null,
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
  const live = liveIntegrations(world).filter((row) => row.kind === 'gsc');
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

function analyticsViews(world: IntegrationWorld): AnalyticsProperty[] {
  const live = liveIntegrations(world).filter((row) => row.kind === 'ga4');
  return MOCK_ANALYTICS_PROPERTIES.map((property) => ({
    ...property,
    linked_project_id: live.find((row) => row.property === property.external_property)?.projectId ?? null,
  }));
}

const GA4_PROPERTY = /^properties\/[0-9]{1,20}$/;

/** `403` for a member who may manage connections but is limited to some projects, as the backend refuses. */
const limited = (request: Request, caller: ProjectCaller): HttpResponse<Problem> | null =>
  caller.access.membership.project_ids === null
    ? null
    : problem(request, 'forbidden', { detail: 'Not available to a member who is limited to some projects.' });

/** The world when the connection can be asked for `product`'s properties; else the problem the backend answers. */
function usableConnection(
  request: Request,
  cookies: Readonly<Record<string, string>>,
  connectionId: string | readonly string[] | undefined,
  product: Product,
): IntegrationWorld | HttpResponse<Problem> {
  const world = integrationWorld(cookies);
  const connection = world.connections.find((row) => row.id === connectionId);
  if (connection === undefined || connection.status === 'revoked') return problem(request, 'not_found');
  if (connection.status !== 'active') {
    return problem(request, 'integration_reauth_required', { detail: 'Connect the Google account again.' });
  }
  if (!grants(connection.grant, product)) {
    return problem(request, 'integration_scope_missing', { detail: MISSING[product] });
  }
  return world;
}

export const integrationHandlers: HttpHandler[] = [
  mock('post', `${P}/integrations/google/authorize`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'integrations:manage',
    });
    if (caller instanceof Response) return caller;
    const refused = limited(request, caller);
    if (refused !== null) return refused;
    if (!isFresh(caller.session)) return freshSessionRequired(request);
    const world = integrationWorld(cookies);
    const ticked = cookies[GOOGLE_GRANT_COOKIE];
    const grant = isGrant(ticked) ? ticked : 'both';
    // Connecting again for a connection that needs it renews that one; otherwise there is a new connection
    const renewing = world.connections.find((row) => row.status === 'reauth_required');
    const made =
      renewing === undefined
        ? withConnection(world, {
            status: 'active',
            connectedBy: caller.session.user.user_id,
            connectedAt: new Date().toISOString(),
            grant,
          })
        : {
            world: withConnectionGrant(withConnectionStatus(world, renewing.id, 'active'), renewing.id, grant),
            id: renewing.id,
          };
    const cookie = integrationsCookie(made.world);
    if (cookie === null) return problem(request, 'mock_state_full');
    const back = new URL(request.url);
    back.pathname = `/${caller.access.workspace.slug}/${caller.project.slug}/integrations/google`;
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
      ...(body.kind === undefined || body.kind === 'gsc' || body.kind === 'ga4'
        ? []
        : [bodyError('kind', 'literal_error', "Input should be 'gsc' or 'ga4'")]),
      ...(body.kind === 'ga4' &&
      typeof body.external_property === 'string' &&
      !GA4_PROPERTY.test(body.external_property)
        ? [bodyError('external_property', 'value_error', 'A GA4 property is written `properties/` and its number')]
        : []),
    ];
    if (errors.length > 0) return invalid(request, errors);
    const kind: Product = body.kind === 'ga4' ? 'ga4' : 'gsc';
    const world = integrationWorld(cookies);
    const connection = world.connections.find((row) => row.id === body.connection_id);
    if (connection === undefined || connection.status === 'revoked') return problem(request, 'not_found');
    if (connection.status !== 'active') return problem(request, 'integration_reauth_required');
    if (!grants(connection.grant, kind))
      return problem(request, 'integration_scope_missing', { detail: MISSING[kind] });
    const readable =
      kind === 'gsc'
        ? MOCK_PROPERTIES.some(
            (row) => row.external_property === body.external_property && row.permission_level !== 'siteUnverifiedUser',
          )
        : MOCK_ANALYTICS_PROPERTIES.some((row) => row.external_property === body.external_property);
    if (!readable || typeof body.external_property !== 'string') {
      return problem(request, 'property_not_accessible', {
        detail: 'This account cannot read that property. Pick one from the list.',
      });
    }
    const live = liveIntegrations(world).filter((row) => row.kind === kind);
    if (live.some((row) => row.projectId === caller.project.project_id)) {
      return problem(request, 'duplicate', { detail: ONE_LINK[kind] });
    }
    if (live.some((row) => row.property === body.external_property)) {
      return problem(request, 'duplicate', { detail: 'This property is already linked to a project.' });
    }
    const made = withIntegration(world, {
      projectId: caller.project.project_id,
      connectionId: connection.id,
      kind,
      property: body.external_property,
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
      ...(product === null || isOneOf(product, ['google', 'bing_wmt', 'cloudflare'] as const)
        ? []
        : [queryError('filter[product]', 'enum', 'Allowed: google, bing_wmt, cloudflare.')]),
      ...(status === null || isOneOf(status, CONNECTION_STATUSES)
        ? []
        : [queryError('filter[status]', 'enum', `Allowed: ${CONNECTION_STATUSES.join(', ')}.`)]),
      ...(Array.isArray(paging) ? paging : []),
    ];
    if (errors.length > 0 || Array.isArray(paging)) return invalid(request, errors);
    const world = integrationWorld(cookies);
    // Newest first, as the backend lists them
    const rows = world.connections
      .filter((row) => (product === null || product === 'google') && (status === null || row.status === status))
      .sort((first, second) => second.connectedAt.localeCompare(first.connectedAt))
      .map((row) => connectionView(world, row));
    return HttpResponse.json(offsetPageOf(rows, paging));
  }),

  mock('get', `${W}/connections/{connection_id}/properties/gsc`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, {
      permission: 'integrations:manage',
      everyProject: true,
    });
    if (caller instanceof Response) return caller;
    const found = usableConnection(request, cookies, params.connection_id, 'gsc');
    if (found instanceof Response) return found;
    return HttpResponse.json({ data: propertyViews(found, caller.projects) });
  }),

  mock('get', `${W}/connections/{connection_id}/properties/ga4`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, {
      permission: 'integrations:manage',
      everyProject: true,
    });
    if (caller instanceof Response) return caller;
    const found = usableConnection(request, cookies, params.connection_id, 'ga4');
    if (found instanceof Response) return found;
    return HttpResponse.json({ data: analyticsViews(found) });
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
