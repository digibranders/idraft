import { domainRefFactory } from './domain';
import { locationRefFactory } from './location';
import { MOCK_CREATED_AT, MOCK_WORKSPACE, type MockProjectSeed } from '../fixtures';
import type { components } from '@/lib/api/schema';

type Project = components['schemas']['Project'];

/**
 * A project of the API, built from a fixture seed and typed by the generated schema. The seed's host is the
 * primary domain and its location the default one (19 section 3.3); a seed without a host has neither.
 */
export function projectFactory(seed: MockProjectSeed, overrides: Partial<Project> = {}): Project {
  return {
    project_id: seed.project_id,
    workspace_id: MOCK_WORKSPACE.workspace_id,
    name: seed.name,
    slug: seed.slug,
    primary_domain: seed.host === '' ? null : domainRefFactory(seed.host),
    default_location_id: seed.location_id,
    default_location: locationRefFactory(seed.location_id),
    default_language_code: 'en',
    timezone: seed.timezone,
    deep_check_weekday: 1,
    status: 'active',
    data_version: 1,
    entity_config_version: 1,
    created_by: null,
    created_at: MOCK_CREATED_AT,
    updated_at: MOCK_CREATED_AT,
    ...overrides,
  };
}
