import { describe, expect, it } from 'vitest';

import { trackedSetQuery } from './tracked-set-query';
import { projectEntitiesQuery } from '@/features/entities/entity-queries';

const PROJECT = { workspaceId: 'w-1', projectId: 'p-1' };

describe('trackedSetQuery', () => {
  it('reads the entities of the project, under the key the entities screens use', () => {
    const options = trackedSetQuery(PROJECT);
    expect(options.queryKey).toEqual(['ws', 'w-1', 'p', 'p-1', 'entities', {}]);
    expect(options.queryKey).toEqual(projectEntitiesQuery(PROJECT).queryKey);
  });

  it('is the same key for the same project and another one for another project', () => {
    expect(trackedSetQuery(PROJECT).queryKey).toEqual(trackedSetQuery({ ...PROJECT }).queryKey);
    expect(trackedSetQuery({ ...PROJECT, projectId: 'p-2' }).queryKey).not.toEqual(trackedSetQuery(PROJECT).queryKey);
  });
});
