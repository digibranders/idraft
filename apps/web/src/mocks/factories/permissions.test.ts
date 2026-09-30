import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PERMISSION_HOLDERS, permissionsFor } from './permissions';

const BACKEND = path.join(import.meta.dirname, '../../../../../backend/src/sightline/api/permissions.py');
const source = readFileSync(BACKEND, 'utf8');

/** The backend's table, read from its source: `Permission.X: holders,` lines and the role groups. */
function backendHolders(): Record<string, string[]> {
  const values = Object.fromEntries(
    [...source.matchAll(/^\s+([A-Z_]+) = "([a-z_:]+)"$/gm)].map(([, name, value]) => [name, value]),
  );
  const roles: Record<string, string> = { _OWNER: 'owner', _ADMIN: 'admin', _EDITOR: 'editor' };
  Object.assign(roles, { _ANALYST: 'analyst', _VIEWER: 'viewer', _BILLING: 'billing' });
  const groups: Record<string, string[]> = {
    _MANAGERS: ['owner', 'admin'],
    _WRITERS: ['owner', 'admin', 'editor'],
    _ANALYSTS: ['owner', 'admin', 'editor', 'analyst'],
  };
  const expand = (holders: string): string[] =>
    holders
      .replace(/[()]/g, '')
      .split(',')
      .map((part) => part.trim().replace(/^\*/, ''))
      .filter((part) => part !== '')
      .flatMap((part) => groups[part] ?? [roles[part] ?? `unknown ${part}`]);
  const table = /_HOLDERS[^{]*\{([\s\S]*?)^\}/m.exec(source)?.[1] ?? '';
  return Object.fromEntries(
    [...table.matchAll(/Permission\.([A-Z_]+): (.+),$/gm)].map(([, name, holders]) => [
      values[name ?? ''] ?? `unknown ${name ?? ''}`,
      expand(holders ?? '').sort(),
    ]),
  );
}

describe('the role table of the mocks', () => {
  it('is the table of the API', () => {
    const backend = backendHolders();
    expect(Object.keys(backend).length).toBeGreaterThan(20);
    const mocks = Object.fromEntries(
      Object.entries(PERMISSION_HOLDERS).map(([permission, holders]) => [permission, [...holders].sort()]),
    );
    expect(mocks).toEqual(backend);
  });

  it('gives a viewer read access and nothing to write', () => {
    expect(permissionsFor('viewer')).toEqual(['data:read']);
    expect(permissionsFor('owner')).toContain('workspace:delete');
    expect(permissionsFor('admin')).not.toContain('workspace:delete');
  });
});
