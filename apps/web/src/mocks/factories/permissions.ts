import type { Role } from '@/lib/api/types';

/**
 * The permission keys each role holds, as the API grants them (docs/24-security.md section 3.2,
 * backend/src/sightline/api/permissions.py). The OpenAPI document types permissions as plain strings, so
 * the mocks keep this copy; permissions.test.ts compares it with the backend's table.
 */
const MANAGERS: readonly Role[] = ['owner', 'admin'];
const WRITERS: readonly Role[] = ['owner', 'admin', 'editor'];
const ANALYSTS: readonly Role[] = ['owner', 'admin', 'editor', 'analyst'];

export const PERMISSION_HOLDERS: Readonly<Record<string, readonly Role[]>> = {
  'workspace:delete': ['owner'],
  'workspace:update': MANAGERS,
  'members:manage': MANAGERS,
  'integrations:manage': MANAGERS,
  'providers:manage': MANAGERS,
  'budgets:manage': [...MANAGERS, 'billing'],
  'costs:read': [...ANALYSTS, 'billing'],
  'projects:write': WRITERS,
  'keywords:write': WRITERS,
  'prompts:write': WRITERS,
  'entities:write': WRITERS,
  'taxonomy:write': WRITERS,
  'panels:core:modify': MANAGERS,
  'schedules:write': WRITERS,
  'runs:trigger': ANALYSTS,
  'data:read': [...ANALYSTS, 'viewer'],
  'raw:read': ANALYSTS,
  'exports:create': ANALYSTS,
  'audit:read': MANAGERS,
  'alerts:write': WRITERS,
  'views:write': ANALYSTS,
  'imports:write': WRITERS,
  'api_keys:manage': MANAGERS,
  'ops:read': WRITERS,
  'tasks:requeue': MANAGERS,
  'fp:logs:write': [],
};

/** The role's permission keys, sorted, as `/me` lists them. */
export function permissionsFor(role: Role): string[] {
  return Object.entries(PERMISSION_HOLDERS)
    .filter(([, holders]) => holders.includes(role))
    .map(([permission]) => permission)
    .sort();
}
