import { describe, expect, it } from 'vitest';

import { CITATIONS_FIXTURE } from './citations-v2-fixture';

describe('the Citations v2 fixture (scripts/citations-fixture.mjs)', () => {
  it('holds the three engines, eight slots, the five tracked competitors and the 250 prompts', () => {
    expect(CITATIONS_FIXTURE.engines).toEqual(['chatgpt_web', 'gemini_web', 'google_ai_mode']);
    expect(CITATIONS_FIXTURE.slots).toHaveLength(8);
    expect(CITATIONS_FIXTURE.competitors).toHaveLength(5);
    expect(CITATIONS_FIXTURE.prompts).toHaveLength(250);
  });

  it('points every answer at a prompt, an engine, a slot and pages it lists', () => {
    for (const [prompt, engine, slot, , urls, rivals] of CITATIONS_FIXTURE.answers) {
      expect(CITATIONS_FIXTURE.prompts[prompt]).toBeDefined();
      expect(CITATIONS_FIXTURE.engines[engine]).toBeDefined();
      expect(slot).toBeGreaterThanOrEqual(1);
      expect(slot).toBeLessThanOrEqual(8);
      for (const url of urls) expect(CITATIONS_FIXTURE.urls[url]).toBeDefined();
      expect(rivals).toHaveLength(CITATIONS_FIXTURE.competitors.length);
    }
  });

  it('says a competitor page belongs to one of the tracked competitors', () => {
    for (const url of CITATIONS_FIXTURE.urls) {
      expect(url.competitor === null).toBe(url.role !== 'competitor');
    }
  });

  it('carries what the screen must show for ChatGPT, the enabled engines and all three', () => {
    expect(CITATIONS_FIXTURE.expected.chatgpt.engines).toEqual(['chatgpt_web']);
    expect(CITATIONS_FIXTURE.expected.chatgpt.strip.citations).toBeGreaterThan(0);
    expect(CITATIONS_FIXTURE.expected.three.gaps.gaps).toBeGreaterThanOrEqual(
      CITATIONS_FIXTURE.expected.chatgpt.gaps.gaps,
    );
  });
});
