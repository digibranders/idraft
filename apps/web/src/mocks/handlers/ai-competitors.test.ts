import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_ENTITY_IDS } from '../entity-fixtures';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import type { Schemas } from '@/lib/api/types';
import { mockBrowser, type Answer } from '@/test/mock-api';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
if (fynix === undefined) throw new Error('The fixture project fynix is missing');
const BASE = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${fynix.project_id}/ai`;
const WINDOW = 'from=2026-10-16&to=2026-11-12';

const get = (path: string, role: 'owner' | 'viewer' = 'owner'): Promise<Answer> => mockBrowser(role).call('GET', path);

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ai/competitors in the mock (the part the competitor drawer reads)', () => {
  it('gives each tracked entity a citation share per engine over the citation units of the engine', async () => {
    const answer = await get(`${BASE}/competitors?${WINDOW}`);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const body = answer.body as unknown as Schemas['AiCompetitorsResponse'];
    expect(body.data.length).toBeGreaterThan(1);
    for (const engine of ['chatgpt_web']) {
      const cells = body.data.map((row) => row.by_engine.find((entry) => entry.engine_code === engine)?.citation_share);
      const total = cells[0]?.denominator ?? 0;
      expect(total).toBeGreaterThan(0);
      // Every entity is counted against the same units, so the shares of all the entities add up to at most 1
      const sum = cells.reduce((part, cell) => part + (cell?.value ?? 0), 0);
      expect(sum).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('narrows the rows to entity_ids and refuses a parameter the route does not have', async () => {
    const one = await get(`${BASE}/competitors?${WINDOW}&entity_ids=${MOCK_ENTITY_IDS.brightwave}`);
    expect((one.body as unknown as Schemas['AiCompetitorsResponse']).data.map((row) => row.entity.entity_id)).toEqual([
      MOCK_ENTITY_IDS.brightwave,
    ]);
    expect((await get(`${BASE}/competitors?${WINDOW}&bogus=1`)).status).toBe(422);
  });
});

describe('ai/sources/overlap in the mock (a fixture: the API has no such read yet)', () => {
  it('answers two lists of at most 8 domains whose shares add up to at most 1', async () => {
    const answer = await get(`${BASE}/sources/overlap?entity_id=${MOCK_ENTITY_IDS.brightwave}&${WINDOW}`);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const { theirs, yours } = (answer.body as { data: Record<'theirs' | 'yours', { share: number }[]> }).data;
    for (const list of [theirs, yours]) {
      expect(list.length).toBeGreaterThan(0);
      expect(list.length).toBeLessThanOrEqual(8);
      expect(list.reduce((sum, entry) => sum + entry.share, 0)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('is a 404 for a brand that is not a tracked competitor', async () => {
    expect((await get(`${BASE}/sources/overlap?entity_id=${MOCK_ENTITY_IDS.fynix}`)).status).toBe(404);
  });
});
