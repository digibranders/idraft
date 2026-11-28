import { describe, expect, it } from 'vitest';

import { EVENTUS_WORLD } from './ai-prompt-world';
import { MOCK_WORKSPACE, mockUser } from './fixtures';
import {
  AI_CITED_PAGE,
  AI_ERROR_PAGE,
  AI_NO_ANSWERS_PAGE,
  AI_NO_PROMPTS_PAGE,
  AI_QUIET_PAGE,
  pageAiOf,
} from './internal-links-page-ai';
import { crawledPage, EVENTUS } from './internal-links-world';
import { SESSION_COOKIE } from './session';
import type { PageAi } from '@/lib/internal-links/types';
import { server } from '@/test/msw';

const BASE = `http://localhost/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS.project_id}/internal-links/pages`;
const COOKIE = `${SESSION_COOKIE}=mock.active.${mockUser('owner').user_id}.${String(Date.now() + 600_000)}`;

function assertInvariants(ai: PageAi, urlId: string): void {
  expect(ai.answers_citing).toBeLessThanOrEqual(ai.answers);
  expect(ai.trend.reduce((sum, day) => sum + day.answers_citing, 0)).toBe(ai.answers_citing);
  expect(ai.trend.reduce((sum, day) => sum + day.answers, 0)).toBe(ai.answers);
  expect(ai.platforms.reduce((sum, platform) => sum + platform.answers_citing, 0)).toBe(ai.answers_citing);
  expect(ai.trend).toHaveLength(ai.days);
  expect(ai.prompts.every((prompt) => prompt.answers_citing > 0)).toBe(true);
  for (const prompt of ai.prompts) {
    expect(prompt.platforms.reduce((sum, platform) => sum + platform.answers, 0)).toBe(prompt.answers);
    expect(prompt.platforms.reduce((sum, platform) => sum + platform.answers_citing, 0)).toBe(prompt.answers_citing);
  }
  expect(ai.alongside.every((row) => row.answers_shared <= ai.answers_citing)).toBe(true);
  expect(ai.alongside.some((row) => String(row.url_id) === urlId)).toBe(false);
}

describe('pageAiOf (mocked page AI tab)', () => {
  it('keeps every invariant of spec 4 on all five exported fixture pages', () => {
    for (const id of [AI_CITED_PAGE, AI_QUIET_PAGE, AI_NO_ANSWERS_PAGE, AI_NO_PROMPTS_PAGE]) {
      const body = pageAiOf(id, { compare: 'previous_period' });
      assertInvariants(body, id);
    }
    expect(new Set([AI_CITED_PAGE, AI_QUIET_PAGE, AI_NO_ANSWERS_PAGE, AI_NO_PROMPTS_PAGE, AI_ERROR_PAGE]).size).toBe(5);
  });

  it('builds the cited page with 3 platforms, 28 days, 6 real Eventus prompts and 5 alongside rows', () => {
    const cited = pageAiOf(AI_CITED_PAGE, { compare: 'previous_period' });
    expect(cited.state).toBe('ready');
    expect(cited.platforms.map((platform) => platform.engine_code)).toEqual([
      'chatgpt_web',
      'gemini_web',
      'google_ai_mode',
    ]);
    expect(cited.trend).toHaveLength(28);
    expect(cited.compare_window).not.toBeNull();
    expect(cited.previous_answers).not.toBeNull();
    expect(cited.previous_answers_citing).not.toBeNull();

    const realTexts = new Set(EVENTUS_WORLD.definition.prompts.map((prompt) => prompt.text));
    expect(cited.prompts).toHaveLength(6);
    expect(cited.prompts.every((prompt) => realTexts.has(prompt.text))).toBe(true);

    expect(cited.alongside).toHaveLength(5);
    const ownInCrawl = cited.alongside.filter((row) => row.domain_role === 'own' && row.in_crawl);
    const ownOutside = cited.alongside.filter((row) => row.domain_role === 'own' && !row.in_crawl);
    const competitors = cited.alongside.filter((row) => row.domain_role === 'competitor');
    const thirdParty = cited.alongside.filter((row) => row.domain_role === 'third_party');
    expect(ownInCrawl).toHaveLength(2);
    expect(ownOutside).toHaveLength(1);
    expect(competitors).toHaveLength(1);
    expect(thirdParty).toHaveLength(1);
    for (const row of ownInCrawl) {
      expect(crawledPage(String(row.url_id))).toBeDefined();
    }
  });

  it('builds the quiet, no_answers and no_prompts states and honors compare=none', () => {
    const quiet = pageAiOf(AI_QUIET_PAGE, { compare: 'previous_period' });
    expect(quiet.state).toBe('ready');
    expect(quiet.answers_citing).toBe(0);
    expect(quiet.prompts).toEqual([]);
    expect(quiet.alongside).toEqual([]);

    const noAnswers = pageAiOf(AI_NO_ANSWERS_PAGE, { compare: 'previous_period' });
    expect(noAnswers.state).toBe('no_answers');
    expect(noAnswers.answers).toBe(0);

    const noPrompts = pageAiOf(AI_NO_PROMPTS_PAGE, { compare: 'previous_period' });
    expect(noPrompts.state).toBe('no_prompts');
    expect(noPrompts.answers).toBe(0);

    const uncompared = pageAiOf(AI_CITED_PAGE, { compare: 'none' });
    expect(uncompared.compare_window).toBeNull();
    expect(uncompared.previous_answers).toBeNull();
    expect(uncompared.previous_answers_citing).toBeNull();
    expect(uncompared.platforms.every((platform) => platform.previous_answers_citing === null)).toBe(true);
  });

  it('answers 500 for AI_ERROR_PAGE and 404 for an uncrawled page via MSW', async () => {
    server.resetHandlers();
    const errorRes = await fetch(`${BASE}/${AI_ERROR_PAGE}/ai?compare=previous_period`, {
      headers: { cookie: COOKIE },
    });
    expect(errorRes.status).toBe(500);

    const missingRes = await fetch(`${BASE}/999999/ai`, {
      headers: { cookie: COOKIE },
    });
    expect(missingRes.status).toBe(404);
  });
});
