import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { findBrandId, projectEntitiesQuery, sameBrand } from './project-entities';
import { mswPath } from '@/mocks/respond';
import { server } from '@/test/msw';

const PROJECT = { workspaceId: 'w-1', projectId: 'p-1' };

describe('projectEntitiesQuery', () => {
  it('reads the entities of the project, under the key every screen that reads them shares', () => {
    expect(projectEntitiesQuery(PROJECT).queryKey).toEqual(['ws', 'w-1', 'p', 'p-1', 'entities', {}]);
  });

  it('is the same key for the same project and another one for another project', () => {
    expect(projectEntitiesQuery(PROJECT).queryKey).toEqual(projectEntitiesQuery({ ...PROJECT }).queryKey);
    expect(projectEntitiesQuery({ ...PROJECT, projectId: 'p-2' }).queryKey).not.toEqual(
      projectEntitiesQuery(PROJECT).queryKey,
    );
  });
});

describe('sameBrand', () => {
  it('ignores case and the space around a name', () => {
    expect(sameBrand(' HubSpot ', 'hubspot')).toBe(true);
    expect(sameBrand('HubSpot', 'Hub Spot')).toBe(false);
  });
});

describe('findBrandId', () => {
  const entity = (id: string, name: string, type: 'brand' | 'person'): object => ({
    entity_id: id,
    entity_type: type,
    canonical_name: name,
  });
  const answer = (rows: object[]): void =>
    server.use(
      http.get(mswPath('/api/v1/workspaces/:w/entities'), () => HttpResponse.json({ data: rows, meta: {}, links: {} })),
    );

  it('finds the brand of that name in any case, and not an entity of another type', async () => {
    answer([entity('e-1', 'Acme', 'person'), entity('e-2', 'ACME', 'brand')]);
    await expect(findBrandId(new QueryClient(), 'w-1', ' acme ')).resolves.toBe('e-2');
  });

  it('is null when the workspace has no such brand', async () => {
    answer([entity('e-1', 'Acme Corp', 'brand')]);
    await expect(findBrandId(new QueryClient(), 'w-1', 'Acme')).resolves.toBeNull();
  });

  it('rejects when the read fails', async () => {
    server.use(http.get(mswPath('/api/v1/workspaces/:w/entities'), () => HttpResponse.json({}, { status: 500 })));
    await expect(findBrandId(new QueryClient(), 'w-1', 'Acme')).rejects.toBeDefined();
  });
});
