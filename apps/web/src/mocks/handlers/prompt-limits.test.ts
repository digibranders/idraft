import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { FIXTURE_PROMPTS, PROMPT_QUOTA } from '../prompt-fixtures';
import { AI_ANSWER_QUOTA } from '../prompts-state';
import type { Schemas } from '@/lib/api/types';
import { dataOf, mockBrowser, type MockBrowser } from '@/test/mock-api';

/** The answer is read through a shape declared against the generated type, so a change to `AiLimits` breaks this file. */
const USE: z.ZodType<Schemas['QuotaUse']> = z.object({ limit: z.number(), used: z.number() }).strict();
const RUNS: z.ZodType<Schemas['ManualRuns']> = z.object({ limit: z.number(), used: z.number() }).strict();
const LIMITS: z.ZodType<Schemas['AiLimits']> = z
  .object({ prompts: USE, ai_observations_month: USE, manual_runs_today: RUNS })
  .strict();
const RESPONSE: z.ZodType<Schemas['AiLimitsResponse']> = z.object({ data: LIMITS }).strict();

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');
const FYNIX = `${W}/projects/${fynix.project_id}`;
const CLEANSTART = `${W}/projects/${cleanstart.project_id}`;
const FIRST = FIXTURE_PROMPTS.get(fynix.project_id)?.[0]?.prompt_id ?? '';
/** Thursday 12 November 2026, noon UTC. */
const NOW = Date.parse('2026-11-12T12:00:00Z');

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const limitsOf = async (who: MockBrowser, project = FYNIX): Promise<Schemas['AiLimits']> =>
  RESPONSE.parse((await who.call('GET', `${project}/ai/limits`)).body).data;

describe('GET ai/limits', () => {
  it('answers the generated shape and moves with an add', async () => {
    const editor = mockBrowser('editor');
    const before = await limitsOf(editor);
    expect(before.prompts).toEqual({ limit: PROMPT_QUOTA, used: 24 });
    expect(before.manual_runs_today).toEqual({ limit: 20, used: 0 });
    expect(before.ai_observations_month.limit).toBe(AI_ANSWER_QUOTA);
    const added = await editor.call('POST', `${FYNIX}/prompts/bulk-create`, {
      items: [
        { text: 'Which agency audits shop sites in Munich?', language_code: 'en', country_iso: 'DE' },
        { text: 'Which agency audits shop sites in Hamburg?', language_code: 'en', country_iso: 'DE' },
      ],
    });
    expect(added.status).toBe(200);
    expect((await limitsOf(editor)).prompts.used).toBe(26);
  });

  it('moves with an archive and a restore, and counts the whole workspace', async () => {
    const editor = mockBrowser('editor');
    await editor.call('POST', `${FYNIX}/prompts/bulk-archive`, { ids: [FIRST], archive: true });
    expect((await limitsOf(editor)).prompts.used).toBe(23);
    // Another project of the workspace reads the same count
    expect((await limitsOf(editor, CLEANSTART)).prompts.used).toBe(23);
    await editor.call('POST', `${FYNIX}/prompts/bulk-archive`, { ids: [FIRST], archive: false });
    expect((await limitsOf(editor)).prompts.used).toBe(24);
  });

  it('moves with a Run now, in the manual runs of the project today and in the answers of the month', async () => {
    const editor = mockBrowser('editor');
    const before = await limitsOf(editor);
    const run = await editor.call('POST', `${FYNIX}/prompts/${FIRST}/run-now`, { engine_codes: ['chatgpt_web'] });
    expect(run.status).toBe(202);
    const after = await limitsOf(editor);
    expect(after.manual_runs_today).toEqual({ limit: 20, used: 1 });
    expect(after.ai_observations_month.used).toBeGreaterThan(before.ai_observations_month.used);
    // The runs of another project are its own
    expect((await limitsOf(editor, CLEANSTART)).manual_runs_today.used).toBe(0);
  });

  it('is read by every role that reads data, a viewer included', async () => {
    for (const role of ['viewer', 'analyst'] as const) {
      expect((await mockBrowser(role).call('GET', `${FYNIX}/ai/limits`)).status).toBe(200);
    }
    expect(dataOf(await mockBrowser('viewer').call('GET', `${FYNIX}/ai/limits`), LIMITS).prompts.limit).toBe(
      PROMPT_QUOTA,
    );
  });
});
