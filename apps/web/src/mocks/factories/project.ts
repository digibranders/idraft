import { MOCK_CREATED_AT, MOCK_WORKSPACE, type MockProjectSeed } from '../fixtures';
import type { components } from '@/lib/api/schema';

type Project = components['schemas']['Project'];

/**
 * A project of the API, built from a fixture seed and typed by the generated schema. As in the API today,
 * `primary_domain` and `default_location_id` are null: they arrive with the keyword system. The fixture's
 * host is for a test that sets them through `overrides`.
 */
export function projectFactory(seed: MockProjectSeed, overrides: Partial<Project> = {}): Project {
  return {
    project_id: seed.project_id,
    workspace_id: MOCK_WORKSPACE.workspace_id,
    name: seed.name,
    slug: seed.slug,
    primary_domain: null,
    default_location_id: null,
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
