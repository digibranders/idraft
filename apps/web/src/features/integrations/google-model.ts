import type { AnalyticsProperty, Connection, ConnectionStatus, Integration, SiteProperty } from '@/lib/api/types';

/**
 * What Integrations > Google shows, decided from what the API said (docs/18 section 4.1 and
 * 24-page-templates.md section 9.12). One Google login is one connection and carries two products, Search
 * Console and GA4, each with a property of its own. Pure: the screen reads queries and the address, this says
 * which state that is, so the states can be tested without rendering.
 */

/** The two products a Google connection carries; they are also the `kind` of a linked property. */
export const PRODUCTS = ['gsc', 'ga4'] as const;
export type Product = (typeof PRODUCTS)[number];

/** The scope Search Console reading needs; the others only name the account. */
export const WEBMASTERS_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
/** The scope GA4 reading needs. */
export const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
/** What the backend asks Google for (`CONNECT_SCOPES`), shown before the person consents. */
export const REQUESTED_SCOPES: readonly string[] = ['openid', 'email', WEBMASTERS_SCOPE, ANALYTICS_SCOPE];

/** `last_error` of a property whose product the person did not grant when they last connected. */
export const SCOPE_MISSING = 'scope_missing';

/** The failures the callback can come back with (`?error=`, backend `IntegrationService.complete`). */
export const CONNECT_ERRORS = [
  'invalid_state',
  'scope_denied',
  'no_refresh_token',
  'exchange_failed',
  'google_unavailable',
  'integration_not_configured',
] as const;
export type ConnectError = (typeof CONNECT_ERRORS)[number];

export const isConnectError = (value: string | null): value is ConnectError =>
  CONNECT_ERRORS.some((code) => code === value);

/** The message key of a failure; anything else the address carries is the generic one. */
export const CONNECT_ERROR_KEYS = {
  invalid_state: 'invalidState',
  scope_denied: 'scopeDenied',
  no_refresh_token: 'noRefreshToken',
  exchange_failed: 'exchangeFailed',
  google_unavailable: 'googleUnavailable',
  integration_not_configured: 'integrationNotConfigured',
} as const satisfies Record<ConnectError, string>;

export const connectErrorKey = (code: string): (typeof CONNECT_ERROR_KEYS)[ConnectError] | 'unknown' =>
  isConnectError(code) ? CONNECT_ERROR_KEYS[code] : 'unknown';

/** Trying again cannot fix an installation that has no Google client. */
export const canRetryConnect = (code: string): boolean => code !== 'integration_not_configured';

export type GoogleView =
  | { kind: 'not-connected' }
  | {
      kind: 'connected';
      /** `null` while the member cannot list connections (only `data:read`). */
      connection: Connection | null;
      /** Google no longer accepts the saved sign-in: it holds for the whole connection, both products. */
      reauth: boolean;
      gsc: Integration | null;
      ga4: Integration | null;
    };

/** The property of `kind` the project reads now: a switched off one is history, not state. */
export const liveIntegration = (integrations: readonly Integration[], kind: Product): Integration | null =>
  integrations.find((integration) => integration.kind === kind && integration.status !== 'disabled') ?? null;

/**
 * The connection the pickers are for: the one Google just returned (`?connection_id=`) when it is still
 * usable, else the newest that works, so a project without a property can use an account the workspace
 * connected before. A revoked connection is gone. `connections` come newest first.
 */
export function connectionToUse(connections: readonly Connection[], returnedId: string | null): Connection | null {
  const usable = connections.filter((connection) => connection.status !== 'revoked');
  return (
    usable.find((connection) => connection.connection_id === returnedId) ??
    usable.find((connection) => connection.status === 'active') ??
    usable[0] ??
    null
  );
}

export interface GoogleInputs {
  integrations: readonly Integration[];
  /** `null` while the member cannot list connections (only `data:read`). */
  connections: readonly Connection[] | null;
  returnedId: string | null;
}

const needsReauth = (integration: Integration | null): boolean =>
  integration !== null &&
  (integration.status === 'reauth_required' || integration.connection_status === 'reauth_required');

export function googleView({ integrations, connections, returnedId }: GoogleInputs): GoogleView {
  const gsc = liveIntegration(integrations, 'gsc');
  const ga4 = liveIntegration(integrations, 'ga4');
  // A project's two properties may sit on two connections (it chose them years apart); the first one's rules
  const linked = gsc ?? ga4;
  const connection =
    connections === null
      ? null
      : ((linked === null ? null : connections.find((candidate) => candidate.connection_id === linked.connection_id)) ??
        connectionToUse(connections, returnedId));
  if (connection === null && linked === null) return { kind: 'not-connected' };
  return {
    kind: 'connected',
    connection,
    reauth: needsReauth(gsc) || needsReauth(ga4) || connection?.status === 'reauth_required',
    gsc,
    ga4,
  };
}

/** The status to show on the connection: the worst of what the properties and the connection report. */
export function displayStatus(view: Extract<GoogleView, { kind: 'connected' }>): ConnectionStatus {
  if (view.reauth) return 'reauth_required';
  const failing = [view.gsc, view.ga4].some(
    (integration) => integration !== null && integration.status === 'error' && integration.last_error !== SCOPE_MISSING,
  );
  if (failing || view.connection?.status === 'error') return 'error';
  return view.connection?.status ?? view.gsc?.connection_status ?? view.ga4?.connection_status ?? 'active';
}

/** The account to name: the connection's label, else the one a property kept. */
export const accountOf = (view: GoogleView): string | null => {
  if (view.kind === 'not-connected') return null;
  const label = view.connection?.subject_label;
  if (label !== undefined && label !== null) return label;
  return view.gsc?.external_account ?? view.ga4?.external_account ?? null;
};

/** What a product section shows. */
export type ProductSection =
  /** The person did not grant this product's permission: reconnect and tick it. The property, when one was kept, is named. */
  | { kind: 'access-missing'; integration: Integration | null }
  | { kind: 'chosen'; integration: Integration }
  /** A usable connection with no property chosen for the product: the picker. */
  | { kind: 'choose'; connection: Connection }
  /** Nothing to choose from: the sign-in needs renewing, or this member cannot list the connection. */
  | { kind: 'unavailable' };

const scopeOf = { gsc: WEBMASTERS_SCOPE, ga4: ANALYTICS_SCOPE } as const satisfies Record<Product, string>;

/** Whether the connection's granted scopes include the product. `null` when the member cannot read the connection. */
export const accessOf = (connection: Connection | null, product: Product): boolean | null =>
  connection === null ? null : connection.access[product];

export function productSection(view: Extract<GoogleView, { kind: 'connected' }>, product: Product): ProductSection {
  const integration = view[product];
  const scopeMissing =
    integration !== null && integration.status === 'error' && integration.last_error === SCOPE_MISSING;
  if (integration !== null && !scopeMissing) return { kind: 'chosen', integration };
  if (scopeMissing || accessOf(view.connection, product) === false) return { kind: 'access-missing', integration };
  if (view.connection !== null && view.connection.status === 'active') {
    return { kind: 'choose', connection: view.connection };
  }
  return { kind: 'unavailable' };
}

/** A Search Console property is a Domain (`sc-domain:`) or a URL prefix. */
export const isDomainProperty = (property: string): boolean => property.startsWith('sc-domain:');

export interface PropertyRow {
  property: SiteProperty;
  /** The property matches this project's primary domain, a Domain property before a URL prefix. */
  suggested: boolean;
  /** Why it cannot be chosen, or `null` when it can. */
  blocked: 'unverified' | 'linked' | null;
}

/**
 * The Search Console properties as the picker lists them: the suggested one first, then the ones that can be
 * chosen, then the ones that cannot, each group in the order the API gave (Domain properties first).
 */
export function propertyRows(properties: readonly SiteProperty[], projectId: string): PropertyRow[] {
  const rows = properties.map((property): PropertyRow => ({
    property,
    suggested: property.suggested_project_id === projectId && property.is_selectable,
    blocked: !property.is_selectable ? 'unverified' : property.linked_project_id === null ? null : 'linked',
  }));
  const rank = (row: PropertyRow): number => (row.suggested && row.blocked === null ? 0 : row.blocked === null ? 1 : 2);
  return rows
    .map((row, index) => ({ row, index }))
    .sort((first, second) => rank(first.row) - rank(second.row) || first.index - second.index)
    .map(({ row }) => row);
}

export interface AnalyticsRow {
  property: AnalyticsProperty;
  /** Why it cannot be chosen, or `null` when it can. */
  blocked: 'linked' | null;
}

/**
 * The GA4 properties as the picker lists them: the ones that can be chosen first, then the ones another
 * project already uses, each group in the order the API gave (by account, then name). Nothing is suggested:
 * a property's site is a web stream, which the API does not give here.
 */
export function analyticsRows(properties: readonly AnalyticsProperty[]): AnalyticsRow[] {
  const rows = properties.map((property): AnalyticsRow => ({
    property,
    blocked: property.linked_project_id === null ? null : 'linked',
  }));
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (first, second) =>
        Number(first.row.blocked !== null) - Number(second.row.blocked !== null) || first.index - second.index,
    )
    .map(({ row }) => row);
}

export type ScopeKind = 'webmasters' | 'analytics' | 'openid' | 'email' | 'other';

export function scopeKind(scope: string): ScopeKind {
  if (scope === WEBMASTERS_SCOPE) return 'webmasters';
  if (scope === ANALYTICS_SCOPE) return 'analytics';
  if (scope === 'openid') return 'openid';
  if (scope === 'email' || scope === 'https://www.googleapis.com/auth/userinfo.email') return 'email';
  return 'other';
}

/** The scope a product needs, for the tooltip of a line that was not granted. */
export const requiredScope = (product: Product): string => scopeOf[product];
