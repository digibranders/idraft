import { describe, expect, it } from 'vitest';

import {
  accountOf,
  canRetryConnect,
  connectErrorKey,
  connectionToUse,
  displayStatus,
  gscView,
  liveIntegration,
  propertyRows,
  scopeKind,
  WEBMASTERS_SCOPE,
} from './gsc-model';
import { connectionFactory, integrationFactory, propertyFactory } from '@/mocks/factories/integrations';

const PROJECT = 'project-1';
const second = connectionFactory({ connection_id: 'connection-2', status: 'reauth_required' });
const first = connectionFactory({ connection_id: 'connection-1' });

describe('which connection the picker is for', () => {
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
    expect(gscView({ integration: null, connections: [], returnedId: null })).toEqual({ kind: 'not-connected' });
    // A member who cannot list connections sees nothing to choose from
    expect(gscView({ integration: null, connections: null, returnedId: 'connection-1' })).toEqual({
      kind: 'not-connected',
    });
  });

  it('opens the picker for a connection that has no property, the one Google returned first', () => {
    expect(gscView({ integration: null, connections: [first], returnedId: null })).toEqual({
      kind: 'choose',
      connection: first,
    });
  });

  it('asks to reconnect when Google no longer accepts the sign-in, with or without a property', () => {
    expect(gscView({ integration: null, connections: [second], returnedId: null })).toEqual({
      kind: 'reauth',
      connection: second,
      integration: null,
    });
    const integration = integrationFactory({ connection_status: 'reauth_required' });
    expect(gscView({ integration, connections: null, returnedId: null })).toMatchObject({
      kind: 'reauth',
      connection: null,
      integration,
    });
  });

  it('is connected once a property is live, with the connection when the member can read it', () => {
    const integration = integrationFactory({ connection_id: 'connection-1' });
    expect(gscView({ integration, connections: [first], returnedId: 'connection-1' })).toEqual({
      kind: 'connected',
      integration,
      connection: first,
    });
  });

  it('takes the worst status of the integration and its connection', () => {
    const integration = integrationFactory({ connection_id: 'connection-1', status: 'error' });
    const view = gscView({ integration, connections: [first], returnedId: null });
    if (view.kind !== 'connected') throw new Error('expected connected');
    expect(displayStatus(view)).toBe('error');
    expect(accountOf(view)).toBe('seo@fynix.digital');
  });

  it('names the account from the property when the connection cannot be read', () => {
    const view = gscView({
      integration: integrationFactory({ external_account: 'owner@fynix.digital' }),
      connections: null,
      returnedId: null,
    });
    expect(accountOf(view)).toBe('owner@fynix.digital');
  });

  it('ignores a property that was switched off', () => {
    expect(liveIntegration([integrationFactory({ status: 'disabled' })])).toBeNull();
    expect(liveIntegration([integrationFactory({ status: 'disabled' }), integrationFactory()])).not.toBeNull();
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

describe('the property rows', () => {
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

describe('scopes', () => {
  it('names the scopes the backend asks for, and any other as other', () => {
    expect(scopeKind(WEBMASTERS_SCOPE)).toBe('webmasters');
    expect(scopeKind('openid')).toBe('openid');
    expect(scopeKind('https://www.googleapis.com/auth/userinfo.email')).toBe('email');
    expect(scopeKind('https://example.com/drive')).toBe('other');
  });
});
