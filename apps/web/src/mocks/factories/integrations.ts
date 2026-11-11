import { MOCK_CREATED_AT, MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '../fixtures';
import { MOCK_GOOGLE_ACCOUNT, MOCK_SCOPES } from '../integrations-state';
import type { AnalyticsProperty, Connection, Integration, SiteProperty } from '@/lib/api/types';

/**
 * Builders for the integration payloads of the API, typed by the generated schema. Each takes overrides, so
 * a test states only what it is about: `connectionFactory({ status: 'reauth_required' })`.
 */

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');

export const CONNECTION_ID = '0192d1a8-e00e-7a10-8e0e-000000000001';
export const INTEGRATION_ID = '0192d1a8-e00f-7a10-8e0f-000000000001';

export function connectionFactory(overrides: Partial<Connection> = {}): Connection {
  const owner = mockUser('owner');
  return {
    connection_id: CONNECTION_ID,
    product: 'google',
    auth_method: 'oauth',
    subject_label: MOCK_GOOGLE_ACCOUNT,
    scopes: [...MOCK_SCOPES],
    access: { gsc: true, ga4: true },
    status: 'active',
    connected_by: { user_id: owner.user_id, name: owner.name, email: owner.email },
    connected_at: '2026-10-20T09:30:00Z',
    last_refresh_at: null,
    last_error_code: null,
    integration_count: 0,
    ...overrides,
  };
}

export function integrationFactory(overrides: Partial<Integration> = {}): Integration {
  return {
    integration_id: INTEGRATION_ID,
    project_id: fynix?.project_id ?? null,
    connection_id: CONNECTION_ID,
    kind: 'gsc',
    external_property: 'sc-domain:fynix.digital',
    external_account: MOCK_GOOGLE_ACCOUNT,
    status: 'active',
    connection_status: 'active',
    last_success_at: null,
    last_error: null,
    backfill_state: {},
    sync: null,
    created_at: MOCK_CREATED_AT,
    ...overrides,
  };
}

export function propertyFactory(overrides: Partial<SiteProperty> = {}): SiteProperty {
  return {
    external_property: 'sc-domain:fynix.digital',
    label: 'fynix.digital',
    property_type: 'domain',
    permission_level: 'siteOwner',
    is_selectable: true,
    suggested_project_id: null,
    linked_project_id: null,
    overlap_warning: null,
    ...overrides,
  };
}

export function analyticsPropertyFactory(overrides: Partial<AnalyticsProperty> = {}): AnalyticsProperty {
  return {
    external_property: 'properties/398844007',
    label: 'Fynix website',
    account_id: 'accounts/77210',
    account_label: 'Fynix Digital',
    property_type: 'ordinary',
    linked_project_id: null,
    ...overrides,
  };
}

export const WORKSPACE_ID = MOCK_WORKSPACE.workspace_id;
