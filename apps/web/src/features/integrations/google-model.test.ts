import { describe, expect, it } from 'vitest';

import {
  accountOf,
  analyticsRows,
  ANALYTICS_SCOPE,
  canRetryConnect,
  connectErrorKey,
  connectionToUse,
  displayStatus,
  googleView,
  liveIntegration,
  productSection,
  propertyRows,
  scopeKind,
  WEBMASTERS_SCOPE,
  type GoogleView,
} from './google-model';
import {
  analyticsPropertyFactory,
  connectionFactory,
  integrationFactory,
  propertyFactory,
} from '@/mocks/factories/integrations';

const PROJECT = 'project-1';
const second = connectionFactory({ connection_id: 'connection-2', status: 'reauth_required' });
const first = connectionFactory({ connection_id: 'connection-1' });
const gscOnly = connectionFactory({ connection_id: 'connection-3', access: { gsc: true, ga4: false } });
const ga4Only = connectionFactory({ connection_id: 'connection-4', access: { gsc: false, ga4: true } });
const ga4Link = (overrides = {}): ReturnType<typeof integrationFactory> =>
  integrationFactory({
    integration_id: 'integration-2',
    kind: 'ga4',
    external_property: 'properties/11',
    ...overrides,
  });

const connectedView = (view: GoogleView): Extract<GoogleView, { kind: 'connected' }> => {
  if (view.kind !== 'connected') throw new Error('expected connected');
  return view;
};

describe('which connection the pickers are for', () => {
  it('prefers the one Google just returned, then the newest that works, and skips a revoked one', () => {
    const revoked = connectionFactory({ connection_id: 'connection-0', status: 'revoked' });
    expect(connectionToUse([second, first], 'connection-2')).toBe(second);
    expect(connectionToUse([second, first], null)).toBe(first);
    expect(connectionToUse([revoked, second], 'connection-0')).toBe(second);
    expect(connectionToUse([revoked], null)).toBeNull();
    expect(connectionToUse([first], 'someone-elses')).toBe(first);
  });
});

describe('the state of the page', () => {
  it('is not connected without a connection or a property', () => {
    expect(googleView({ integrations: [], connections: [], returnedId: null })).toEqual({ kind: 'not-connected' });
    // A member who cannot list connections sees nothing to choose from
    expect(googleView({ integrations: [], connections: null, returnedId: 'connection-1' })).toEqual({
      kind: 'not-connected',
    });
  });

  it('is connected, with no property of either product, for a connection that has none', () => {
    expect(googleView({ integrations: [], connections: [first], returnedId: null })).toEqual({
      kind: 'connected',
      connection: first,
      reauth: false,
      gsc: null,
      ga4: null,
    });
  });

  it('asks to reconnect for the whole connection when Google no longer accepts the sign-in', () => {
    const view = connectedView(googleView({ integrations: [], connections: [second], returnedId: null }));
    expect(view).toMatchObject({ reauth: true, connection: second });
    expect(displayStatus(view)).toBe('reauth_required');
    // One property saying so is enough for a reader, who cannot list connections
    const integration = integrationFactory({ connection_status: 'reauth_required' });
    expect(
      connectedView(googleView({ integrations: [integration], connections: null, returnedId: null })),
    ).toMatchObject({ reauth: true, connection: null, gsc: integration });
    const ga4 = ga4Link({ status: 'reauth_required' });
    expect(connectedView(googleView({ integrations: [ga4], connections: null, returnedId: null })).reauth).toBe(true);
  });

  it('carries the live property of each product', () => {
    const gsc = integrationFactory({ connection_id: 'connection-1' });
    const ga4 = ga4Link({ connection_id: 'connection-1' });
    const view = connectedView(googleView({ integrations: [ga4, gsc], connections: [first], returnedId: null }));
    expect([view.gsc, view.ga4, view.connection]).toEqual([gsc, ga4, first]);
    expect(accountOf(view)).toBe('seo@fynix.digital');
  });

  it('takes the worst status of the properties and the connection, and does not count a missing permission as an error', () => {
    const failing = integrationFactory({ connection_id: 'connection-1', status: 'error' });
    const failed = connectedView(googleView({ integrations: [failing], connections: [first], returnedId: null }));
    expect(displayStatus(failed)).toBe('error');
    const unticked = integrationFactory({
      connection_id: 'connection-1',
      status: 'error',
      last_error: 'scope_missing',
    });
    const view = connectedView(googleView({ integrations: [unticked], connections: [first], returnedId: null }));
    expect(displayStatus(view)).toBe('active');
  });

  it('names the account from a property when the connection cannot be read', () => {
    const view = googleView({
      integrations: [integrationFactory({ external_account: 'owner@fynix.digital' })],
      connections: null,
      returnedId: null,
    });
    expect(accountOf(view)).toBe('owner@fynix.digital');
  });

  it('ignores a property that was switched off, per product', () => {
    expect(liveIntegration([integrationFactory({ status: 'disabled' })], 'gsc')).toBeNull();
    expect(liveIntegration([integrationFactory({ status: 'disabled' }), integrationFactory()], 'gsc')).not.toBeNull();
    expect(liveIntegration([integrationFactory()], 'ga4')).toBeNull();
    expect(liveIntegration([ga4Link()], 'ga4')).not.toBeNull();
  });
});

describe('what a product section shows', () => {
  const sectionOf = (
    connection: ReturnType<typeof connectionFactory> | null,
    integrations: ReturnType<typeof integrationFactory>[],
    product: 'gsc' | 'ga4',
  ): ReturnType<typeof productSection> =>
    productSection(
      connectedView(googleView({ integrations, connections: connection && [connection], returnedId: null })),
      product,
    );

  it('offers the picker for a product with access and no property, and the property once chosen', () => {
    expect(sectionOf(first, [], 'gsc')).toEqual({ kind: 'choose', connection: first });
    expect(sectionOf(first, [], 'ga4')).toEqual({ kind: 'choose', connection: first });
    const gsc = integrationFactory({ connection_id: 'connection-1' });
    expect(sectionOf(first, [gsc], 'gsc')).toEqual({ kind: 'chosen', integration: gsc });
    expect(sectionOf(first, [gsc], 'ga4')).toEqual({ kind: 'choose', connection: first });
  });

  it('says access was not granted for the product the person unticked, and still offers the other', () => {
    expect(sectionOf(gscOnly, [], 'ga4')).toEqual({ kind: 'access-missing', integration: null });
    expect(sectionOf(gscOnly, [], 'gsc')).toEqual({ kind: 'choose', connection: gscOnly });
    expect(sectionOf(ga4Only, [], 'gsc')).toEqual({ kind: 'access-missing', integration: null });
    expect(sectionOf(ga4Only, [], 'ga4')).toEqual({ kind: 'choose', connection: ga4Only });
  });

  it('keeps naming a property whose product was unticked at the last connection', () => {
    const kept = integrationFactory({ connection_id: 'connection-4', status: 'error', last_error: 'scope_missing' });
    expect(sectionOf(ga4Only, [kept], 'gsc')).toEqual({ kind: 'access-missing', integration: kept });
    // A reader cannot list the connection, so the property says it
    expect(sectionOf(null, [kept], 'gsc')).toEqual({ kind: 'access-missing', integration: kept });
  });

  it('has nothing to choose from while the sign-in needs renewing, or for a reader', () => {
    expect(sectionOf(second, [], 'gsc')).toEqual({ kind: 'unavailable' });
    expect(sectionOf(null, [ga4Link()], 'gsc')).toEqual({ kind: 'unavailable' });
  });
});

describe('the failures Google can return with', () => {
  it('maps each code to its message and anything else to the generic one', () => {
    expect(connectErrorKey('scope_denied')).toBe('scopeDenied');
    expect(connectErrorKey('integration_not_configured')).toBe('integrationNotConfigured');
    expect(connectErrorKey('whatever')).toBe('unknown');
  });

  it('does not offer a retry where the installation has no Google client', () => {
    expect(canRetryConnect('integration_not_configured')).toBe(false);
    expect(canRetryConnect('exchange_failed')).toBe(true);
  });
});

describe('the Search Console property rows', () => {
  const domain = propertyFactory({ external_property: 'sc-domain:a.com', suggested_project_id: PROJECT });
  const prefix = propertyFactory({ external_property: 'https://a.com/', property_type: 'url_prefix' });
  const unverified = propertyFactory({ external_property: 'https://u.com/', is_selectable: false });
  const taken = propertyFactory({ external_property: 'https://t.com/', linked_project_id: 'project-2' });

  it('puts the suggested property first, then the ones that can be chosen, then the ones that cannot', () => {
    const rows = propertyRows([unverified, prefix, taken, domain], PROJECT);
    expect(rows.map((row) => row.property.external_property)).toEqual([
      'sc-domain:a.com',
      'https://a.com/',
      'https://u.com/',
      'https://t.com/',
    ]);
    expect(rows.map((row) => row.suggested)).toEqual([true, false, false, false]);
  });

  it('says why a property cannot be chosen', () => {
    const rows = propertyRows([unverified, taken, prefix], PROJECT);
    expect(rows.map((row) => row.blocked)).toEqual([null, 'unverified', 'linked']);
  });

  it('suggests nothing that is for another project, or that cannot be read', () => {
    const other = propertyFactory({ suggested_project_id: 'project-2' });
    const unreadable = propertyFactory({ suggested_project_id: PROJECT, is_selectable: false });
    expect(propertyRows([other, unreadable], PROJECT).some((row) => row.suggested)).toBe(false);
  });
});

describe('the GA4 property rows', () => {
  const blog = analyticsPropertyFactory({ external_property: 'properties/1', label: 'Blog' });
  const shop = analyticsPropertyFactory({
    external_property: 'properties/2',
    label: 'Shop',
    linked_project_id: 'project-2',
  });
  const site = analyticsPropertyFactory({ external_property: 'properties/3', label: 'Site' });

  it('keeps the order of the API, with the properties another project uses last', () => {
    const rows = analyticsRows([blog, shop, site]);
    expect(rows.map((row) => row.property.label)).toEqual(['Blog', 'Site', 'Shop']);
    expect(rows.map((row) => row.blocked)).toEqual([null, null, 'linked']);
  });
});

describe('scopes', () => {
  it('names the scopes the backend asks for, and any other as other', () => {
    expect(scopeKind(WEBMASTERS_SCOPE)).toBe('webmasters');
    expect(scopeKind(ANALYTICS_SCOPE)).toBe('analytics');
    expect(scopeKind('openid')).toBe('openid');
    expect(scopeKind('https://www.googleapis.com/auth/userinfo.email')).toBe('email');
    expect(scopeKind('https://example.com/drive')).toBe('other');
  });
});
