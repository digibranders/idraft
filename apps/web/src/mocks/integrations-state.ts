import { z } from 'zod';

import { jsonCookie, readJsonCookie } from './cookie-json';
import { FIRST_MINTED, mockId, mockIdNumber } from './mock-ids';
import { INTEGRATIONS_COOKIE } from './session';

/**
 * What one browser did with Google through the mocks (19 section 3.10, backend `api/integrations`): the
 * connections it made and the properties it linked to projects. There is no Google here, so a connection is
 * made the moment the person is sent to "consent", and the account is always the one below. Only the changes
 * are kept, in their own cookie and in a compact form: each row a tuple, an id as its number.
 */
export { INTEGRATIONS_COOKIE };

export const CONNECTION_STATUSES = ['active', 'reauth_required', 'revoked', 'error'] as const;
export const INTEGRATION_STATUSES = ['active', 'reauth_required', 'disabled', 'error'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/** The Google account every mocked consent signs in. */
export const MOCK_GOOGLE_ACCOUNT = 'seo@fynix.digital';
/** What the backend asks Google for (`CONNECT_SCOPES`). */
export const MOCK_SCOPES: readonly string[] = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/webmasters.readonly',
];

/** A property the mocked account can see, with the project whose primary domain it matches, by fixture slug. */
export interface MockProperty {
  external_property: string;
  property_type: 'domain' | 'url_prefix';
  permission_level: string;
  /** The host the property covers, as the backend compares it. */
  host: string;
  suggestedFor: string | null;
}

/** Domain properties first, as the backend lists them; one is unverified, so it cannot be chosen. */
export const MOCK_PROPERTIES: readonly MockProperty[] = [
  {
    external_property: 'sc-domain:cleanstart.com',
    property_type: 'domain',
    permission_level: 'siteOwner',
    host: 'cleanstart.com',
    suggestedFor: 'cleanstart',
  },
  {
    external_property: 'sc-domain:fynix.digital',
    property_type: 'domain',
    permission_level: 'siteOwner',
    host: 'fynix.digital',
    suggestedFor: 'fynix',
  },
  {
    external_property: 'https://blog.fynix.digital/',
    property_type: 'url_prefix',
    permission_level: 'siteFullUser',
    host: 'blog.fynix.digital',
    suggestedFor: null,
  },
  {
    external_property: 'https://eventussecurity.com/',
    property_type: 'url_prefix',
    permission_level: 'siteRestrictedUser',
    host: 'eventussecurity.com',
    suggestedFor: 'eventus-security',
  },
  {
    external_property: 'https://fynix.digital/',
    property_type: 'url_prefix',
    permission_level: 'siteOwner',
    host: 'fynix.digital',
    suggestedFor: null,
  },
  {
    external_property: 'https://old-shop.example.org/',
    property_type: 'url_prefix',
    permission_level: 'siteUnverifiedUser',
    host: 'old-shop.example.org',
    suggestedFor: null,
  },
];

/** `[id, status, connected by (user id), connected at]` */
const CONNECTION = z.tuple([z.number().int(), z.enum(CONNECTION_STATUSES), z.string(), z.string()]);
/** `[id, project id, connection id, property, status, created at]` */
const INTEGRATION = z.tuple([
  z.number().int(),
  z.string(),
  z.number().int(),
  z.string(),
  z.enum(INTEGRATION_STATUSES),
  z.string(),
]);
const STORED = z.object({
  /** The number the next row gets. */
  next: z.number().int().min(FIRST_MINTED),
  connections: z.array(CONNECTION),
  integrations: z.array(INTEGRATION),
});

export interface StoredConnection {
  id: string;
  status: ConnectionStatus;
  connectedBy: string;
  connectedAt: string;
}

export interface StoredIntegration {
  id: string;
  projectId: string;
  connectionId: string;
  property: string;
  status: IntegrationStatus;
  createdAt: string;
}

export interface IntegrationWorld {
  next: number;
  connections: StoredConnection[];
  integrations: StoredIntegration[];
}

type Stored = z.infer<typeof STORED>;
const EMPTY: Stored = { next: FIRST_MINTED, connections: [], integrations: [] };

const idOf = (kind: 'connection' | 'integration', n: number): string => mockId(kind, n);
const numberOf = (kind: 'connection' | 'integration', id: string): number => {
  const n = mockIdNumber(id, kind);
  if (n === null) throw new Error(`Not a mock ${kind} id: ${id}`);
  return n;
};

/** What the cookie holds: nothing connected until the person connects. */
export function integrationWorld(cookies: Readonly<Record<string, string>>): IntegrationWorld {
  const stored = readJsonCookie(cookies, INTEGRATIONS_COOKIE, STORED, EMPTY);
  return {
    next: stored.next,
    connections: stored.connections.map(([n, status, connectedBy, connectedAt]) => ({
      id: idOf('connection', n),
      status,
      connectedBy,
      connectedAt,
    })),
    integrations: stored.integrations.map(([n, projectId, connection, property, status, createdAt]) => ({
      id: idOf('integration', n),
      projectId,
      connectionId: idOf('connection', connection),
      property,
      status,
      createdAt,
    })),
  };
}

/** The `Set-Cookie` that keeps `world`, or `null` when it no longer fits in a cookie. */
export function integrationsCookie(world: IntegrationWorld): string | null {
  const stored: Stored = {
    next: world.next,
    connections: world.connections.map((row) => [
      numberOf('connection', row.id),
      row.status,
      row.connectedBy,
      row.connectedAt,
    ]),
    integrations: world.integrations.map((row) => [
      numberOf('integration', row.id),
      row.projectId,
      numberOf('connection', row.connectionId),
      row.property,
      row.status,
      row.createdAt,
    ]),
  };
  return jsonCookie(INTEGRATIONS_COOKIE, stored);
}

/** `world` with a new connection, and its id. */
export function withConnection(
  world: IntegrationWorld,
  row: Omit<StoredConnection, 'id'>,
): { world: IntegrationWorld; id: string } {
  const id = idOf('connection', world.next);
  return {
    id,
    world: { ...world, next: world.next + 1, connections: [...world.connections, { ...row, id }] },
  };
}

/** `world` with a new linked property, and its id. */
export function withIntegration(
  world: IntegrationWorld,
  row: Omit<StoredIntegration, 'id'>,
): { world: IntegrationWorld; id: string } {
  const id = idOf('integration', world.next);
  return {
    id,
    world: { ...world, next: world.next + 1, integrations: [...world.integrations, { ...row, id }] },
  };
}

export const withConnectionStatus = (
  world: IntegrationWorld,
  connectionId: string,
  status: ConnectionStatus,
): IntegrationWorld => ({
  ...world,
  connections: world.connections.map((row) => (row.id === connectionId ? { ...row, status } : row)),
});

export const withIntegrationStatus = (
  world: IntegrationWorld,
  integrationId: string,
  status: IntegrationStatus,
): IntegrationWorld => ({
  ...world,
  integrations: world.integrations.map((row) => (row.id === integrationId ? { ...row, status } : row)),
});

/** The properties that are switched on: a disabled one is free to be linked again. */
export const liveIntegrations = (world: IntegrationWorld): StoredIntegration[] =>
  world.integrations.filter((row) => row.status !== 'disabled');
