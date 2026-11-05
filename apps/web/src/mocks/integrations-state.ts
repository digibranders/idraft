import { z } from 'zod';

import { jsonCookie, readJsonCookie } from './cookie-json';
import { FIRST_MINTED, mockId, mockIdNumber } from './mock-ids';
import { INTEGRATIONS_COOKIE } from './session';

/**
 * What one browser did with Google through the mocks (19 section 3.10, backend `api/integrations`): the
 * connections it made and the properties it linked to projects. There is no Google here, so a connection is
 * made the moment the person is sent to "consent", and the account is always the one below. A connection
 * carries what the person granted (both products, or one, as Google's granular consent allows). Only the
 * changes are kept, in their own cookie and in a compact form: each row a tuple, an id as its number.
 */
export { INTEGRATIONS_COOKIE };

export const CONNECTION_STATUSES = ['active', 'reauth_required', 'revoked', 'error'] as const;
/** What a property of a project is for (`Integration.kind`, the two Google products). */
export type Product = 'gsc' | 'ga4';
export const INTEGRATION_STATUSES = ['active', 'reauth_required', 'disabled', 'error'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/** The Google account every mocked consent signs in. */
export const MOCK_GOOGLE_ACCOUNT = 'seo@fynix.digital';
/** What a mocked connection was granted: both products, or only one of them. */
export const GRANTS = ['both', 'gsc', 'ga4'] as const;
export type MockGrant = (typeof GRANTS)[number];
export const isGrant = (value: string | undefined): value is MockGrant => GRANTS.some((grant) => grant === value);

const WEBMASTERS = 'https://www.googleapis.com/auth/webmasters.readonly';
const ANALYTICS = 'https://www.googleapis.com/auth/analytics.readonly';
/** The scopes a grant gives (the backend asks for `CONNECT_SCOPES`; Google returns what was ticked). */
export const scopesOf = (grant: MockGrant): string[] => [
  'openid',
  'email',
  ...(grant === 'ga4' ? [] : [WEBMASTERS]),
  ...(grant === 'gsc' ? [] : [ANALYTICS]),
];
/** Whether a grant reaches a product. */
export const grants = (grant: MockGrant, product: Product): boolean => grant === 'both' || grant === product;
/** Every scope of a full grant, for tests that only need a connection that can do everything. */
export const MOCK_SCOPES: readonly string[] = scopesOf('both');

/** A GA4 property the mocked account can see, with its Analytics account. */
export interface MockAnalyticsProperty {
  external_property: string;
  label: string;
  account_id: string;
  account_label: string;
  property_type: 'ordinary' | 'subproperty' | 'rollup' | 'unspecified';
}

/** By account then name, as the backend lists them. */
export const MOCK_ANALYTICS_PROPERTIES: readonly MockAnalyticsProperty[] = [
  {
    external_property: 'properties/412003011',
    label: 'Cleanstart website',
    account_id: 'accounts/90311',
    account_label: 'Cleanstart Inc',
    property_type: 'ordinary',
  },
  {
    external_property: 'properties/398844120',
    label: 'Fynix blog',
    account_id: 'accounts/77210',
    account_label: 'Fynix Digital',
    property_type: 'ordinary',
  },
  {
    external_property: 'properties/398844007',
    label: 'Fynix website',
    account_id: 'accounts/77210',
    account_label: 'Fynix Digital',
    property_type: 'ordinary',
  },
  {
    external_property: 'properties/398845333',
    label: 'Fynix, all sites',
    account_id: 'accounts/77210',
    account_label: 'Fynix Digital',
    property_type: 'rollup',
  },
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

/** `[id, status, connected by (user id), connected at, grant]` */
const CONNECTION = z.tuple([z.number().int(), z.enum(CONNECTION_STATUSES), z.string(), z.string(), z.enum(GRANTS)]);
/** `[id, project id, connection id, kind, property, status, created at]` */
const INTEGRATION = z.tuple([
  z.number().int(),
  z.string(),
  z.number().int(),
  z.enum(['gsc', 'ga4']),
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
  grant: MockGrant;
}

export interface StoredIntegration {
  id: string;
  projectId: string;
  connectionId: string;
  kind: Product;
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
    connections: stored.connections.map(([n, status, connectedBy, connectedAt, grant]) => ({
      id: idOf('connection', n),
      status,
      connectedBy,
      connectedAt,
      grant,
    })),
    integrations: stored.integrations.map(([n, projectId, connection, kind, property, status, createdAt]) => ({
      id: idOf('integration', n),
      projectId,
      connectionId: idOf('connection', connection),
      kind,
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
      row.grant,
    ]),
    integrations: world.integrations.map((row) => [
      numberOf('integration', row.id),
      row.projectId,
      numberOf('connection', row.connectionId),
      row.kind,
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

/** `world` with the connection granted `grant` (the same account connecting again, ticking other boxes). */
export const withConnectionGrant = (
  world: IntegrationWorld,
  connectionId: string,
  grant: MockGrant,
): IntegrationWorld => ({
  ...world,
  connections: world.connections.map((row) => (row.id === connectionId ? { ...row, grant } : row)),
});

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
