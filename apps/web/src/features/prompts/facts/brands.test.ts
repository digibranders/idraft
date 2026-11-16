import { describe, expect, it } from 'vitest';

import { brandsOf, LIST_SIZE } from './brands';
import { cellOf, engine, entityCells, rowOf, topicCell } from './test-helpers';
import type { TrackedEntity } from './types';

const ME = '00000000-0000-4000-8000-000000000001';
const RIVAL = '00000000-0000-4000-8000-000000000002';
const ENTITIES: TrackedEntity[] = [
  { entity_id: ME, name: 'Northwind', role: 'own' },
  { entity_id: RIVAL, name: 'HubSpot', role: 'competitor' },
];
const SCOPE = ['chatgpt_web', 'gemini_web'];

/** An engine with `valid` answers where Northwind is named `me` times, HubSpot `rival` times, and others as given. */
const withBrands = (
  code: string,
  valid: number,
  me: number,
  rival: number,
  others: [string, number][] = [],
): ReturnType<typeof engine> =>
  engine(code, {
    valid,
    entities: [entityCells(ME, cellOf(me, valid)), entityCells(RIVAL, cellOf(rival, valid))],
    other_brands: others.map(([name, k]) => ({ name, mentioned: cellOf(k, valid) })),
  });

describe('brandsOf', () => {
  it('lists the tracked and the other brands, most named first, with the own brand marked', () => {
    const reading = brandsOf([rowOf(withBrands('chatgpt_web', 10, 3, 6, [['Copper', 4]]))], ['chatgpt_web'], ENTITIES);
    expect(reading.state).toBe('ok');
    expect(reading.shown.map((row) => [row.place, row.name, row.own, row.tracked])).toEqual([
      [1, 'HubSpot', false, true],
      [2, 'Copper', false, false],
      [3, 'Northwind', true, true],
    ]);
  });

  it('gives counts for one prompt on one engine only, never for an average of rates', () => {
    const row = rowOf(withBrands('chatgpt_web', 10, 3, 6), withBrands('gemini_web', 10, 5, 2));
    expect(brandsOf([row], ['chatgpt_web'], ENTITIES).shown[0]?.counts).toEqual({ code: 'chatgpt_web', k: 6, n: 10 });
    expect(brandsOf([row], SCOPE, ENTITIES).shown.every((brand) => brand.counts === null)).toBe(true);
    expect(brandsOf([row, row], ['chatgpt_web'], ENTITIES).shown.every((brand) => brand.counts === null)).toBe(true);
  });

  it('averages each engine prompt weighted, then the engines with equal weight', () => {
    // Northwind on ChatGPT: prompts at 100% (2 answers... use 4 each) and 0%, so 50%. On Gemini: 20%. Equal weight: 35%.
    const rows = [
      rowOf(withBrands('chatgpt_web', 4, 4, 0), withBrands('gemini_web', 10, 2, 0)),
      rowOf(withBrands('chatgpt_web', 40, 0, 0)),
    ];
    const own = brandsOf(rows, SCOPE, ENTITIES).shown.find((brand) => brand.own);
    expect(own?.rate).toBeCloseTo(0.35);
  });

  it('leaves out an engine with fewer than 4 valid answers over the rows', () => {
    const rows = [rowOf(withBrands('chatgpt_web', 10, 5, 0), withBrands('gemini_web', 3, 3, 0))];
    const reading = brandsOf(rows, SCOPE, ENTITIES);
    expect(reading.codes).toEqual(['chatgpt_web']);
    expect(reading.shown.find((brand) => brand.own)?.rate).toBe(0.5);
  });

  it('counts a brand that the list leaves out of a prompt as named in none of its answers, not as unknown', () => {
    const rows = [
      rowOf(withBrands('chatgpt_web', 10, 0, 0, [['Copper', 10]])),
      rowOf(withBrands('chatgpt_web', 10, 0, 0, [])),
    ];
    expect(brandsOf(rows, ['chatgpt_web'], ENTITIES).shown.find((brand) => brand.name === 'Copper')?.rate).toBe(0.5);
  });

  it('cuts the list at the top ten and pins the own brand when it is below', () => {
    const others: [string, number][] = Array.from({ length: 12 }, (_, i) => [`Brand ${String(i)}`, 9 - (i % 9)]);
    const reading = brandsOf([rowOf(withBrands('chatgpt_web', 10, 1, 0, others))], ['chatgpt_web'], ENTITIES);
    expect(reading.shown).toHaveLength(LIST_SIZE);
    expect(reading.shown.some((brand) => brand.own)).toBe(false);
    expect(reading.own).toMatchObject({ name: 'Northwind', own: true });
    expect(reading.total).toBe(13);
    expect(brandsOf([rowOf(withBrands('chatgpt_web', 10, 9, 0, others))], ['chatgpt_web'], ENTITIES).own).toBeNull();
  });

  it('keeps the own brand when it is named in no answer, and drops other brands that are not', () => {
    const reading = brandsOf([rowOf(withBrands('chatgpt_web', 10, 0, 0, [['Copper', 0]]))], ['chatgpt_web'], ENTITIES);
    expect(reading.shown.map((row) => row.name)).toEqual(['Northwind']);
  });

  it('counts a brand that was added as a competitor once, as tracked', () => {
    const added: TrackedEntity[] = [
      ...ENTITIES,
      { entity_id: '00000000-0000-4000-8000-000000000003', name: 'copper', role: 'competitor' },
    ];
    const row = rowOf(
      engine('chatgpt_web', {
        valid: 10,
        entities: [
          entityCells(ME, cellOf(1, 10)),
          entityCells(RIVAL, cellOf(0, 10)),
          entityCells('00000000-0000-4000-8000-000000000003', cellOf(4, 10)),
        ],
        other_brands: [{ name: 'Copper', mentioned: cellOf(4, 10) }],
      }),
    );
    const copper = brandsOf([row], ['chatgpt_web'], added).shown.filter(
      (brand) => brand.name.toLowerCase() === 'copper',
    );
    expect(copper).toHaveLength(1);
    expect(copper[0]?.tracked).toBe(true);
  });

  it('reads a topic row as one prompt-weighted row and offers no counts', () => {
    const topic = engine('chatgpt_web', {
      valid: 20,
      mentioned: topicCell(0.3, 2, 20),
      entities: [entityCells(ME, topicCell(0.3, 2, 20)), entityCells(RIVAL, topicCell(0.6, 2, 20))],
    });
    const reading = brandsOf([rowOf(topic)], ['chatgpt_web'], ENTITIES);
    expect(reading.shown.map((row) => [row.name, row.rate])).toEqual([
      ['HubSpot', 0.6],
      ['Northwind', 0.3],
    ]);
    expect(reading.shown.every((row) => row.counts === null)).toBe(true);
    expect(reading.answers).toBe(20);
  });

  it('is unknown with a reason', () => {
    expect(brandsOf([rowOf(engine('chatgpt_web', { valid: 10 }))], ['chatgpt_web'], ENTITIES)).toMatchObject({
      state: 'unknown',
      reason: 'not_collected',
      shown: [],
    });
    expect(brandsOf([rowOf(withBrands('chatgpt_web', 0, 0, 0))], ['chatgpt_web'], ENTITIES)).toMatchObject({
      state: 'unknown',
      reason: 'unobserved',
    });
    expect(brandsOf([rowOf(withBrands('chatgpt_web', 3, 1, 0))], ['chatgpt_web'], ENTITIES)).toMatchObject({
      state: 'unknown',
      reason: 'too_few_answers',
    });
  });
});
