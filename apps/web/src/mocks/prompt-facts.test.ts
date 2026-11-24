import { describe, expect, it } from 'vitest';

import { fixtureIntentOf, FIXTURE_PROMPTS } from './prompt-fixtures';
import {
  enginePieceOf,
  linkedKeywordOf,
  OTHER_BRANDS,
  topicEngineFacts,
  promptEngineFacts,
  type FactsAnswer,
} from './prompt-facts';
import { latestOf } from './answer-screenshots';
import { NOT_VALID } from './answer-builder';

const SCOPE = { workspaceId: 'w', projectId: 'p', now: Date.parse('2026-11-13T00:00:00Z') };

const answer = (
  id: string,
  at: string,
  own: { mentioned: boolean; order: number | null; list: boolean },
  valid = true,
): FactsAnswer => ({
  id,
  at,
  facts: {
    ...NOT_VALID,
    is_valid: valid,
    own_mentioned: valid && own.mentioned,
    own_mention_order: own.order,
    had_structured_list: own.list,
  },
  citations: [],
});

describe('the fixture intents', () => {
  it('follow the rule: branded navigational, hiring transactional, how and what informational, which and should commercial', () => {
    expect(fixtureIntentOf('Is Fynix a good SEO agency for software companies?', true)).toBe('navigational');
    expect(fixtureIntentOf('Should a startup hire an SEO agency or a freelancer?', false)).toBe('transactional');
    expect(fixtureIntentOf('How do I fix crawl errors that Google reports?', false)).toBe('informational');
    expect(fixtureIntentOf('What is the difference between SEO and paid search?', false)).toBe('informational');
    expect(fixtureIntentOf('Which SEO agency is best for a SaaS startup in Germany?', false)).toBe('commercial');
    expect(fixtureIntentOf('Something else', false)).toBe('unknown');
  });

  it("vary across Fynix's prompts", () => {
    const [prompts] = [...FIXTURE_PROMPTS.values()];
    expect(new Set(prompts?.map((prompt) => prompt.intent))).toEqual(
      new Set(['informational', 'commercial', 'transactional', 'navigational', 'unknown']),
    );
  });
});

describe('linkedKeywordOf', () => {
  it('is the same for a prompt every time, shares keywords across the prompts of a topic and leaves some prompts unlinked', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `prompt-${String(i)}`);
    const links = ids.map((id) => linkedKeywordOf(id, ['Local SEO']));
    expect(links).toEqual(ids.map((id) => linkedKeywordOf(id, ['Local SEO'])));
    expect(links.some((link) => link === null)).toBe(true);
    const keywords = new Set(links.flatMap((link) => (link === null ? [] : [link.keyword])));
    expect(keywords.size).toBeLessThanOrEqual(3);
    expect(keywords.size).toBeGreaterThan(0);
  });
});

describe('enginePieceOf', () => {
  const answers = [
    answer('3', '2026-11-12T02:00:00Z', { mentioned: true, order: 2, list: true }),
    answer('2', '2026-11-09T02:00:00Z', { mentioned: true, order: null, list: false }),
    answer('1', '2026-11-05T02:00:00Z', { mentioned: false, order: null, list: true }),
    answer('0', '2026-11-02T02:00:00Z', { mentioned: true, order: 1, list: true }, false),
  ];

  it('counts the ordered answers from the facts of the valid answers only', () => {
    const piece = enginePieceOf('p', 'chatgpt_web', answers);
    expect(piece.position).toEqual({
      rank_sum: 2,
      ordered_answers: 1,
      mentions: 2,
      answers: 3,
      by_order: { counts: [0, 1, 0, 0], rank_sum: 2 },
    });
    expect(piece.observations).toBe(4);
    expect(piece.latest?.observation_id).toBe('3');
  });

  it('splits the mentions into four tones that add up, on a classifying engine only', () => {
    const piece = enginePieceOf('p', 'chatgpt_web', answers);
    const tones = piece.sentiment;
    expect(tones).not.toBeNull();
    expect((tones?.positive ?? 0) + (tones?.neutral ?? 0) + (tones?.negative ?? 0) + (tones?.mixed ?? 0)).toBe(2);
    expect(enginePieceOf('p', 'google_ai_mode', answers).sentiment).toBeNull();
  });

  it('draws the same brands every time and never more than the answers it has', () => {
    const first = enginePieceOf('p', 'gemini_web', answers);
    expect(first).toEqual(enginePieceOf('p', 'gemini_web', answers));
    for (const brand of first.others) {
      expect(OTHER_BRANDS).toContain(brand.name);
      expect(brand.k).toBeLessThanOrEqual(3);
      expect(brand.k).toBeGreaterThan(0);
    }
  });

  it('has no latest answer and zero counts for an engine without a valid answer', () => {
    const piece = enginePieceOf('p', 'chatgpt_web', [
      answer('0', '2026-11-02T02:00:00Z', { mentioned: false, order: null, list: false }, false),
    ]);
    expect(piece.latest).toBeNull();
    expect(piece.position).toEqual({
      rank_sum: 0,
      ordered_answers: 0,
      mentions: 0,
      answers: 0,
      by_order: { counts: [0, 0, 0, 0], rank_sum: 0 },
    });
  });
});

describe('topicEngineFacts', () => {
  it('adds the position counts and weights the recommendation by prompt', () => {
    const a = enginePieceOf('a', 'chatgpt_web', [
      answer('1', '2026-11-12T02:00:00Z', { mentioned: true, order: 1, list: true }),
    ]);
    const b = enginePieceOf('b', 'chatgpt_web', [
      answer('2', '2026-11-13T02:00:00Z', { mentioned: true, order: 3, list: true }),
      answer('3', '2026-11-09T02:00:00Z', { mentioned: false, order: null, list: false }),
    ]);
    const topic = topicEngineFacts('chatgpt_web', [a, b]);
    expect(topic.position).toEqual({
      rank_sum: 4,
      ordered_answers: 2,
      mentions: 2,
      answers: 3,
      by_order: { counts: [1, 0, 1, 0], rank_sum: 4 },
    });
    // The API leaves `latest` out of topic rows
    expect(topic.latest).toBeUndefined();
    expect(topic.recommended?.pooled?.trials).toBe(3);
    expect(topic.recommended?.denominator).toBe(2);
    expect(promptEngineFacts(a, (newest) => latestOf(SCOPE, 'chatgpt_web', newest)).recommended?.denominator).toBe(1);
  });
});
