import type { Connection, ConnectionStatus, Integration, SiteProperty } from '@/lib/api/types';

/**
 * What Integrations > Search Console shows, decided from what the API said (docs/18 section 4.1 and
 * 24-page-templates.md section 9.12). Pure: the screen reads queries and the address, this says which state
 * that is, so the states can be tested without rendering.
 */

/** The scope Search Console reading needs; the others only name the account. */
export const WEBMASTERS_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
/** What the backend asks Google for (`CONNECT_SCOPES`), shown before the person consents. */
export const REQUESTED_SCOPES: readonly string[] = ['openid', 'email', WEBMASTERS_SCOPE];

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

export type GscView =
  | { kind: 'not-connected' }
  /** A connection with no property chosen: the picker. */
  | { kind: 'choose'; connection: Connection }
  /** Google no longer accepts the saved sign-in. The property, when one was chosen, is kept. */
  | { kind: 'reauth'; connection: Connection | null; integration: Integration | null }
  | { kind: 'connected'; integration: Integration; connection: Connection | null };

/** The property the project reads now: a switched off one is history, not state. */
export const liveIntegration = (integrations: readonly Integration[]): Integration | null =>
  integrations.find((integration) => integration.kind === 'gsc' && integration.status !== 'disabled') ?? null;

/**
 * The connection the picker is for: the one Google just returned (`?connection_id=`) when it is still usable,
 * else the newest that works, so a project without a property can use an account the workspace connected
 * before. A revoked connection is gone. `connections` come newest first.
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

export interface GscInputs {
  integration: Integration | null;
  /** `null` while the member cannot list connections (only `data:read`). */
  connections: readonly Connection[] | null;
  returnedId: string | null;
}

export function gscView({ integration, connections, returnedId }: GscInputs): GscView {
  if (integration !== null) {
    const connection = connections?.find((candidate) => candidate.connection_id === integration.connection_id) ?? null;
    const needsReauth =
      integration.status === 'reauth_required' ||
      integration.connection_status === 'reauth_required' ||
      connection?.status === 'reauth_required';
    return needsReauth ? { kind: 'reauth', connection, integration } : { kind: 'connected', integration, connection };
  }
  const connection = connections === null ? null : connectionToUse(connections, returnedId);
  if (connection === null) return { kind: 'not-connected' };
  return connection.status === 'reauth_required'
    ? { kind: 'reauth', connection, integration: null }
    : { kind: 'choose', connection };
}

/** The status to show on the connection: the worst of what the integration and the connection report. */
export function displayStatus(view: Extract<GscView, { kind: 'connected' | 'reauth' }>): ConnectionStatus {
  if (view.kind === 'reauth') return 'reauth_required';
  const { integration, connection } = view;
  if (integration.status === 'error' || connection?.status === 'error') return 'error';
  return connection?.status ?? integration.connection_status ?? 'active';
}

/** The account to name: the connection's label, else the one the integration kept. */
export const accountOf = (view: GscView): string | null => {
  if (view.kind === 'not-connected') return null;
  const connection = view.connection;
  if (connection?.subject_label !== undefined && connection.subject_label !== null) return connection.subject_label;
  return view.kind === 'choose' ? null : (view.integration?.external_account ?? null);
};

export interface PropertyRow {
  property: SiteProperty;
  /** The property matches this project's primary domain, a Domain property before a URL prefix. */
  suggested: boolean;
  /** Why it cannot be chosen, or `null` when it can. */
  blocked: 'unverified' | 'linked' | null;
}

/**
 * The properties as the picker lists them: the suggested one first, then the ones that can be chosen, then
 * the ones that cannot, each group in the order the API gave (Domain properties first).
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

export type ScopeKind = 'webmasters' | 'openid' | 'email' | 'other';

export function scopeKind(scope: string): ScopeKind {
  if (scope === WEBMASTERS_SCOPE) return 'webmasters';
  if (scope === 'openid') return 'openid';
  if (scope === 'email' || scope === 'https://www.googleapis.com/auth/userinfo.email') return 'email';
  return 'other';
}
