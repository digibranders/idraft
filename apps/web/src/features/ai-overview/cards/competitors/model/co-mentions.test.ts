import { describe, expect, it } from 'vitest';

import { coMentionMatrix } from './co-mentions';
import { at, competitor, engine, entityCells, id, own, share, summaryOf, weighted } from './summary-fixtures';
import { trackedSetOf } from './tracked-set';
import type { CoMentionCell, CoMentionMatrix } from './types';
import type { Schemas, SummaryEntity } from '@/lib/api/types';

const CODE = 'chatgpt_web';

interface Brand {
  entity: SummaryEntity;
  /** Valid answers that name it, of `trials`. */
  k: number;
  trials?: number;
}

const FOUR: Brand[] = [
  { entity: own(), k: 30 },
  { entity: competitor(2, 'HubSpot'), k: 50 },
  { entity: competitor(3, 'Zoho'), k: 20 },
  { entity: competitor(4, 'Asana'), k: 10 },
];

const pair = (a: number, b: number, answers: number): Schemas['CoMentionPair'] => ({ a: id(a), b: id(b), answers });

/** A pairs read: the `total` block gives each brand's mentions, `co_mentions` the pairs. */
function matrixOf(brands: Brand[], pairs: Schemas['CoMentionPair'][], answers = 100, code = CODE): CoMentionMatrix {
  const summary = summaryOf({
    entities: brands.map((brand) => brand.entity),
    total: [
      engine(code, {
        mentioned: weighted(0, answers, [0]),
        share: share(answers, answers),
        entities: brands.map((brand) => {
          const trials = brand.trials ?? answers;
          return entityCells(brand.entity, weighted(brand.k, trials, [brand.k / trials]), share(brand.k, answers));
        }),
      }),
    ],
    coMentions: [{ engine_code: code, answers, pairs }],
  });
  const result = coMentionMatrix(summary, CODE, trackedSetOf(summary, null));
  if (result.status !== 'read') throw new Error('expected a read');
  return result;
}

const PAIRS = [pair(1, 2, 20), pair(1, 3, 8), pair(2, 3, 5)];

const cellAt = (matrix: CoMentionMatrix, row: number, column: number): CoMentionCell =>
  at(at(matrix.cells, row), column);

describe('coMentionMatrix', () => {
  it('the matrix is symmetric with you first, then by mention rate, capped at the top 8', () => {
    const matrix = matrixOf(FOUR, PAIRS);
    expect(matrix.entities.map((entity) => entity.name)).toEqual(['Fynix', 'HubSpot', 'Zoho', 'Asana']);
    expect(matrix.cells).toHaveLength(4);
    for (const [row, line] of matrix.cells.entries()) {
      expect(line).toHaveLength(4);
      for (const [column, cell] of line.entries()) {
        if (row === column) continue;
        const mirror = cellAt(matrix, column, row);
        expect([cell.k, cell.n, cell.value]).toEqual([mirror.k, mirror.n, mirror.value]);
        expect([cell.rowId, cell.columnId]).toEqual([mirror.columnId, mirror.rowId]);
      }
    }
    expect(cellAt(matrix, 0, 1)).toMatchObject({ k: 20, n: 100, state: 'ok', value: 0.2 });

    const many = [
      { entity: own(), k: 5 },
      ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ entity: competitor(n, `Brand ${n}`), k: n * 10 })),
    ];
    const capped = matrixOf(many, []);
    expect(capped.entities).toHaveLength(8);
    expect(capped.omitted).toBe(2);
    // you first even with the lowest rate, then the highest rates: Brand 10 (100), 9 (90) and so on
    expect(capped.entities.slice(0, 3).map((entity) => entity.name)).toEqual(['Fynix', 'Brand 10', 'Brand 9']);
    expect(capped.entities.map((entity) => entity.name)).not.toContain('Brand 2');
    expect(capped.cells.every((line) => line.length === 8)).toBe(true);
  });

  it("a pair absent from pairs is 0 of the engine's answers", () => {
    const matrix = matrixOf(FOUR, PAIRS);
    const asana = matrix.entities.findIndex((entity) => entity.name === 'Asana');
    expect(cellAt(matrix, 0, asana)).toMatchObject({ k: 0, n: 100, state: 'ok', value: 0 });
    expect(cellAt(matrix, asana, 0)).toMatchObject({ k: 0, n: 100, state: 'ok', value: 0 });
  });

  it('the diagonal is answers named over valid answers from the pooled counts', () => {
    const matrix = matrixOf(FOUR, PAIRS);
    expect(cellAt(matrix, 0, 0)).toMatchObject({ k: 30, n: 100, state: 'ok', value: 0.3 });
    expect(cellAt(matrix, 1, 1)).toMatchObject({ k: 50, n: 100, value: 0.5 });
  });

  it('a diagonal whose trials differ from the engine answers is n/a', () => {
    const brands = FOUR.map((brand) => (brand.entity.name === 'Zoho' ? { ...brand, trials: 90 } : brand));
    const matrix = matrixOf(brands, PAIRS);
    const zoho = matrix.entities.findIndex((entity) => entity.name === 'Zoho');
    expect(cellAt(matrix, zoho, zoho)).toMatchObject({ state: 'none', value: null });
    expect(cellAt(matrix, 0, 0).state).toBe('ok');
  });

  it('fewer than 4 valid answers makes every cell insufficient', () => {
    const brands = FOUR.map((brand) => ({ ...brand, k: 1, trials: 3 }));
    const matrix = matrixOf(brands, [pair(1, 2, 2)], 3);
    expect(matrix.cells.flat().every((cell) => cell.state === 'insufficient' && cell.value === null)).toBe(true);
    // the counts stay for the tooltip
    const hubspot = matrix.entities.findIndex((entity) => entity.name === 'HubSpot');
    expect(cellAt(matrix, 0, hubspot)).toMatchObject({ k: 2, n: 3 });
  });

  it('is unread without the engine in co_mentions or without the mention counts', () => {
    const summary = summaryOf({
      total: [engine(CODE, { entities: [] })],
      coMentions: [{ engine_code: 'gemini_web', answers: 10, pairs: [] }],
    });
    expect(coMentionMatrix(summary, CODE, trackedSetOf(summary, null))).toEqual({ status: 'unread' });
    const bare = summaryOf({ coMentions: [{ engine_code: CODE, answers: 10, pairs: [] }] });
    expect(coMentionMatrix(bare, CODE, trackedSetOf(bare, null))).toEqual({ status: 'unread' });
  });
});
