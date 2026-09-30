import { hashKey } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { normalizeFilters, projectKey, queryKey, workspaceKey } from './keys';

const W = '0192d1a8-7e8b-7c3a-9f3e-3b5a2c1d4e5f';
const P = '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b6a';

describe('normalizeFilters', () => {
  it('sorts keys, so two objects that differ only in key order are the same key', () => {
    const first = normalizeFilters({ loc: '2840', dev: 'desktop', win: '28d' });
    const second = normalizeFilters({ win: '28d', loc: '2840', dev: 'desktop' });
    expect(Object.keys(first)).toEqual(['dev', 'loc', 'win']);
    expect(hashKey([first])).toBe(hashKey([second]));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('drops undefined, null and empty lists', () => {
    expect(normalizeFilters({ a: undefined, b: null, c: [], d: 0, e: '', f: false })).toEqual({
      d: 0,
      e: '',
      f: false,
    });
  });

  it('drops a value equal to its default, lists compared item by item', () => {
    const defaults = { limit: 50, offset: 0, 'filter[status_in]': ['active', 'paused'] };
    expect(normalizeFilters({ limit: 50, offset: 0, 'filter[status_in]': ['active', 'paused'] }, defaults)).toEqual({});
    expect(normalizeFilters({ limit: 100, 'filter[status_in]': ['paused', 'active'] }, defaults)).toEqual({
      'filter[status_in]': ['paused', 'active'],
      limit: 100,
    });
  });

  it('is empty for no filters', () => {
    expect(normalizeFilters()).toEqual({});
  });
});

describe('queryKey', () => {
  it('puts the tenancy first, shortened, then the resource and the query', () => {
    expect(
      queryKey(
        '/api/v1/workspaces/{workspace_id}/projects/{project_id}/seo/tracked-keywords',
        { workspace_id: W, project_id: P },
        { limit: 50 },
      ),
    ).toEqual(['ws', W, 'p', P, 'seo', 'tracked-keywords', { limit: 50 }]);
  });

  it('keeps a list segment that no id follows', () => {
    expect(queryKey('/api/v1/workspaces/{workspace_id}/projects', { workspace_id: W })).toEqual([
      'ws',
      W,
      'projects',
      {},
    ]);
    expect(queryKey('/api/v1/workspaces')).toEqual(['workspaces', {}]);
    expect(queryKey('/api/v1/me')).toEqual(['me', {}]);
  });

  it('lies under the prefixes used to invalidate a project or a workspace', () => {
    const key = queryKey('/api/v1/workspaces/{workspace_id}/projects/{project_id}', {
      workspace_id: W,
      project_id: P,
    });
    expect(key.slice(0, 4)).toEqual(projectKey(W, P));
    expect(key.slice(0, 2)).toEqual(workspaceKey(W));
  });

  it('gives the same key to queries that differ only in key order or defaults', () => {
    const path = '/api/v1/workspaces/{workspace_id}/projects';
    const defaults = { limit: 50, offset: 0 };
    expect(queryKey(path, { workspace_id: W }, { offset: 0, limit: 50 }, defaults)).toEqual(
      queryKey(path, { workspace_id: W }, {}, defaults),
    );
  });

  it('refuses a path outside the API and a missing path parameter', () => {
    expect(() => queryKey('/me')).toThrow('Not an API path');
    expect(() => queryKey('/api/v1/workspaces/{workspace_id}')).toThrow('Missing path parameter workspace_id');
  });
});
