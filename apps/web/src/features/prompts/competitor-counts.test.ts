import { describe, expect, it } from 'vitest';

import { ALL_ENGINES, competitorCounts } from './competitor-counts';
import type { ObservationSummary, SummaryEntity } from '@/lib/api/types';

const OWN = 'own-brand';
const entities: SummaryEntity[] = [
  { entity_id: OWN, name: 'Fynix', role: 'own' },
  { entity_id: 'c-b', name: 'Beta', role: 'competitor' },
  { entity_id: 'c-a', name: 'Alpha', role: 'competitor' },
  { entity_id: 'c-z', name: 'Zulu', role: 'competitor' },
];

/** A row of the answers list; `valid` false is an answer that is in no count. */
const answer = (
  engine: string,
  named: { own?: boolean; competitors?: string[] } = {},
  valid = true,
  hasFacts = true,
): ObservationSummary =>
  ({
    engine_code: engine,
    facts: hasFacts
      ? { is_valid: valid, own_mentioned: named.own === true, competitor_mentions: named.competitors ?? [] }
      : null,
  }) as ObservationSummary;

const CHATGPT = 'chatgpt_web';
const GEMINI = 'gemini_web';

describe('the brands named in the answers to a prompt', () => {
  const answers = [
    answer(CHATGPT, { own: true, competitors: ['c-a', 'c-b'] }),
    answer(CHATGPT, { competitors: ['c-a'] }),
    answer(CHATGPT, { own: true }),
    answer(GEMINI, { competitors: ['c-b'] }),
    answer(GEMINI, {}),
  ];

  it('counts each tracked brand over the valid answers of every engine, the own brand first', () => {
    const counts = competitorCounts(answers, entities, ALL_ENGINES);
    expect(counts.answers).toBe(5);
    expect(counts.rows.map((row) => [row.name, row.own, row.mentions, row.share])).toEqual([
      ['Fynix', true, 2, 0.4],
      ['Alpha', false, 2, 0.4],
      ['Beta', false, 2, 0.4],
      ['Zulu', false, 0, 0],
    ]);
  });

  it('counts the answers of one engine only when one is chosen', () => {
    const counts = competitorCounts(answers, entities, GEMINI);
    expect(counts.answers).toBe(2);
    expect(counts.rows.map((row) => [row.name, row.mentions, row.share])).toEqual([
      ['Fynix', 0, 0],
      ['Beta', 1, 0.5],
      ['Alpha', 0, 0],
      ['Zulu', 0, 0],
    ]);
  });

  it('orders the competitors by their mentions, then by name', () => {
    const counts = competitorCounts(
      [answer(CHATGPT, { competitors: ['c-z'] }), answer(CHATGPT, { competitors: ['c-z', 'c-b'] })],
      entities,
      ALL_ENGINES,
    );
    expect(counts.rows.map((row) => row.name)).toEqual(['Fynix', 'Zulu', 'Beta', 'Alpha']);
  });

  it('leaves out an answer that is not valid or has no facts yet, which count in no rate', () => {
    const counts = competitorCounts(
      [
        answer(CHATGPT, { own: true }),
        answer(CHATGPT, { own: true, competitors: ['c-a'] }, false),
        answer(CHATGPT, { own: true }, true, false),
      ],
      entities,
      ALL_ENGINES,
    );
    expect(counts.answers).toBe(1);
    expect(counts.rows.map((row) => row.mentions)).toEqual([1, 0, 0, 0]);
  });

  it('counts a brand once for an answer that names it twice, and ignores a brand that is not tracked', () => {
    const counts = competitorCounts(
      [answer(CHATGPT, { competitors: ['c-a', 'c-a', 'untracked'] })],
      entities,
      ALL_ENGINES,
    );
    expect(counts.rows.find((row) => row.name === 'Alpha')?.mentions).toBe(1);
    expect(counts.rows).toHaveLength(4);
  });

  it('says whether any competitor was named at all, and gives no share without a valid answer', () => {
    expect(competitorCounts(answers, entities, ALL_ENGINES).named).toBe(true);
    expect(competitorCounts([answer(CHATGPT, { own: true })], entities, ALL_ENGINES).named).toBe(false);
    const none = competitorCounts([], entities, ALL_ENGINES);
    expect(none.answers).toBe(0);
    expect(none.named).toBe(false);
    expect(none.rows.every((row) => row.share === null)).toBe(true);
  });

  it('has only the own brand to list when no competitor is tracked', () => {
    const counts = competitorCounts(
      answers,
      entities.filter((entity) => entity.role === 'own'),
      ALL_ENGINES,
    );
    expect(counts.rows.map((row) => row.name)).toEqual(['Fynix']);
    expect(counts.tracked).toBe(0);
  });
});
