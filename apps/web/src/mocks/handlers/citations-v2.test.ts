import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CITATIONS_FIXTURE } from '../citations-v2-fixture';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { mockBrowser } from '@/test/mock-api';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');
const P = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${fynix.project_id}`;
const ENTITY = z.object({ entity: z.object({ entity_id: z.string() }) });

async function competitorIds(): Promise<string[]> {
  const answer = await mockBrowser('viewer').call('GET', `${P}/entities?filter[role]=competitor`);
  return z
    .array(ENTITY)
    .parse(answer.body.data)
    .map((row) => row.entity.entity_id);
}

describe('the Citations v2 routes', () => {
  it('answers the overview of ChatGPT with the preview numbers, on the project own domain', async () => {
    const answer = await mockBrowser('viewer').call(
      'GET',
      `${P}/ai/citation-overview?filter[engine_code_in]=chatgpt_web`,
    );
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      citations: CITATIONS_FIXTURE.expected.chatgpt.strip.citations,
      own_urls: CITATIONS_FIXTURE.expected.chatgpt.strip.urls,
      domains: CITATIONS_FIXTURE.expected.chatgpt.strip.domains,
      window: { runs: 4, latest_run_number: 48 },
    });
  });

  it('pages the cited pages, own pages on the project host, with the owner counts of every role', async () => {
    const answer = await mockBrowser('viewer').call(
      'GET',
      `${P}/ai/cited-pages?filter[engine_code_in]=chatgpt_web&filter[domain_role_in]=own&limit=200`,
    );
    expect(answer.status).toBe(200);
    const rows = z.array(z.object({ host: z.string() })).parse(answer.body.data);
    expect(rows.every((row) => row.host === fynix.host)).toBe(true);
    expect(answer.body.meta).toMatchObject({ owners: { all: CITATIONS_FIXTURE.expected.chatgpt.pages.all } });
  });

  it('refuses runs other than 1, 2 or 4, a long q and an unknown sort', async () => {
    const browser = mockBrowser('viewer');
    expect((await browser.call('GET', `${P}/ai/citation-overview?runs=3`)).status).toBe(422);
    expect((await browser.call('GET', `${P}/ai/cited-pages?q=${'a'.repeat(201)}`)).status).toBe(422);
    expect((await browser.call('GET', `${P}/ai/cited-pages?sort=-volume`)).status).toBe(422);
  });

  it('needs one to five tracked competitors for the gap routes', async () => {
    const browser = mockBrowser('viewer');
    const ids = await competitorIds();
    expect((await browser.call('GET', `${P}/ai/citation-gaps`)).status).toBe(422);
    const untracked = await browser.call(
      'GET',
      `${P}/ai/citation-gaps?filter[competitor_id_in]=0192d1a8-dead-7000-8000-000000000001`,
    );
    expect(untracked).toMatchObject({ status: 422, code: 'competitor_not_tracked' });
    const list = await browser.call(
      'GET',
      `${P}/ai/citation-gaps?filter[engine_code_in]=chatgpt_web&filter[competitor_id_in]=${ids.slice(0, 3).join(',')},${ids[0] ?? ''}`,
    );
    expect(list.status).toBe(200);
    expect(list.body.meta).toMatchObject({
      gaps: CITATIONS_FIXTURE.expected.chatgpt.gaps.gaps,
      prompts: CITATIONS_FIXTURE.expected.chatgpt.gaps.prompts,
    });
    expect(z.object({ competitors: z.array(z.unknown()) }).parse(list.body.meta).competitors).toHaveLength(3);
  });

  it('answers 404 for a page no answer cites and for a prompt with no answer', async () => {
    const browser = mockBrowser('viewer');
    const ids = await competitorIds();
    expect((await browser.call('GET', `${P}/ai/cited-pages/999999`)).status).toBe(404);
    const gap = await browser.call(
      'GET',
      `${P}/ai/citation-gaps/0192d1a8-c177-7000-8000-999999999999?filter[competitor_id_in]=${ids[0] ?? ''}`,
    );
    expect(gap.status).toBe(404);
  });
});
