import 'server-only';

import { cache } from 'react';

import { unwrap } from '@/lib/api/client';
import { serverApi } from '@/lib/api/server';
import type { Workspace } from '@/lib/api/types';

/** The workspace with `workspaceId` as the API has it now (its time zone is not part of `/me`). Once per request. */
export const workspaceById = cache(async (workspaceId: string): Promise<Workspace> => {
  const client = await serverApi();
  const { data } = await unwrap(
    client.GET('/api/v1/workspaces/{workspace_id}', { params: { path: { workspace_id: workspaceId } } }),
  );
  return data;
});
