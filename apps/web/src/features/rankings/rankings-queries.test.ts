import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { refreshKeywords } from './rankings-queries';
import { queryKey } from '@/lib/api/keys';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '@/mocks/fixtures';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const TENANCY = { workspace_id: SCOPE.workspaceId, project_id: SCOPE.projectId };

describe('refreshKeywords', () => {
  it('also marks the events of the project and every SERP snapshot read stale, so a finished check refreshes the keyword page', async () => {
    const client = new QueryClient();
    const events = queryKey(`${P}/seo/rank-events`, TENANCY, { 'filter[tracked_keyword_id]': 'tk1' });
    const snapshot = queryKey(`${P}/serp-snapshots/{serp_snapshot_id}`, { ...TENANCY, serp_snapshot_id: '42' });
    const serpCurrent = queryKey(`${P}/tracked-keywords/{tracked_keyword_id}/serp-current`, {
      ...TENANCY,
      tracked_keyword_id: 'tk1',
    });
    const runs = queryKey(`${P}/runs`, TENANCY);
    const otherProject = queryKey(`${P}/seo/rank-events`, { ...TENANCY, project_id: 'another-project' });
    for (const key of [events, snapshot, serpCurrent, runs, otherProject]) client.setQueryData(key, { data: [] });
    for (const key of [events, snapshot, serpCurrent, runs, otherProject]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    }

    await refreshKeywords(client, SCOPE);

    expect(client.getQueryState(events)?.isInvalidated).toBe(true);
    expect(client.getQueryState(snapshot)?.isInvalidated).toBe(true);
    expect(client.getQueryState(serpCurrent)?.isInvalidated).toBe(true);
    // Neither another call of the project nor another project's events are touched
    expect(client.getQueryState(runs)?.isInvalidated).toBe(false);
    expect(client.getQueryState(otherProject)?.isInvalidated).toBe(false);
  });
});
