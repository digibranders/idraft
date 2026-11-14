import { describe, expect, it } from 'vitest';

import { entityTotals, previousEntityTotals } from './entity-totals';
import {
  cell,
  competitor,
  engine,
  entityCells,
  id,
  own,
  promptRow,
  share,
  summaryOf,
  weighted,
} from './summary-fixtures';
import { trackedSetOf } from './tracked-set';
import type { EngineEntityTotals } from './types';

const CODE = 'chatgpt_web';
const FYNIX = id(1);
const HUBSPOT = id(2);
const ZOHO = id(3);

/** Two prompts: 3 answers naming a tracked brand in the first, 8 in the second. */
function promptRows() {
  return [
    promptRow(1, [
      engine(CODE, {
        mentioned: cell(1, 3),
        share: share(2, 2),
        entities: [
          entityCells(FYNIX, cell(1, 3), share(1, 2)),
          entityCells(HUBSPOT, cell(2, 3), share(1, 2)),
          entityCells(ZOHO, cell(0, 3), share(0, 2)),
        ],
      }),
    ]),
    promptRow(2, [
      engine(CODE, {
        mentioned: cell(2, 6),
        share: share(8, 8),
        entities: [
          entityCells(FYNIX, cell(2, 6), share(2, 8)),
          entityCells(HUBSPOT, cell(5, 6), share(6, 8)),
          entityCells(ZOHO, cell(0, 6), share(0, 8)),
        ],
      }),
    ]),
  ];
}

/** The same two prompts as one `total` block, as the real server aggregates them. */
function totalBlock() {
  return [
    engine(CODE, {
      mentioned: weighted(3, 9, [1 / 3, 1 / 3]),
      share: share(10, 10),
      entities: [
        entityCells(FYNIX, weighted(3, 9, [1 / 3, 1 / 3]), share(3, 10)),
        entityCells(HUBSPOT, weighted(7, 9, [2 / 3, 5 / 6]), share(7, 10)),
        entityCells(ZOHO, weighted(0, 9, [0, 0]), share(0, 10)),
      ],
    }),
  ];
}

const tracked = (summary = summaryOf()) => trackedSetOf(summary, null);

function read(summary = summaryOf({ prompts: promptRows() })): EngineEntityTotals {
  const totals = entityTotals(summary, CODE, tracked(summary));
  if (totals.status !== 'read') throw new Error('expected a read');
  return totals;
}

const figuresOf = (totals: EngineEntityTotals, entityId: string) => {
  const found = totals.entities.find((entry) => entry.entity.entityId === entityId);
  if (found === undefined) throw new Error(`no figures for ${entityId}`);
  return found;
};

describe('entityTotals', () => {
  it('share of voice is the sum of numerators over the sum of denominators of the prompt rows, not the mean of the shares', () => {
    const totals = read();
    const fynix = figuresOf(totals, FYNIX);
    // (1 + 2) / (2 + 8) = 0.3, where the mean of 1/2 and 2/8 would be 0.375
    expect(fynix.share).toMatchObject({ state: 'ok', numerator: 3, answers: 10 });
    expect(fynix.share.value).toBeCloseTo(0.3, 10);
    expect(figuresOf(totals, HUBSPOT).share.value).toBeCloseTo(0.7, 10);
    expect(totals.answersNamingTracked).toBe(10);
    expect(totals.validAnswers).toBe(9);
  });

  it('a total block gives the same figures as the prompt rows on the same data', () => {
    const fromRows = read();
    const fromTotal = read(summaryOf({ prompts: promptRows(), total: totalBlock() }));
    for (const entityId of [FYNIX, HUBSPOT, ZOHO]) {
      const a = figuresOf(fromRows, entityId);
      const b = figuresOf(fromTotal, entityId);
      expect(b.share.value).toBeCloseTo(a.share.value ?? Number.NaN, 10);
      expect(b.share.answers).toBe(a.share.answers);
      expect(b.mention.value).toBeCloseTo(a.mention.value ?? Number.NaN, 10);
      expect([b.mention.k, b.mention.n, b.mention.prompts]).toEqual([a.mention.k, a.mention.n, a.mention.prompts]);
    }
    expect(fromTotal.validAnswers).toBe(fromRows.validAnswers);
  });

  it('mention k and n come from pooled successes and trials', () => {
    const totals = read(summaryOf({ total: totalBlock() }));
    const hubspot = figuresOf(totals, HUBSPOT).mention;
    // the cell's own numerator and denominator are a sum of rates over 2 prompts: they are not the counts
    expect(hubspot).toMatchObject({ k: 7, n: 9, prompts: 2, state: 'ok' });
    expect(hubspot.value).toBeCloseTo(0.75, 10);
  });

  it('fewer than 4 answers naming a tracked brand is insufficient with no value', () => {
    const thin = summaryOf({
      prompts: [
        promptRow(1, [
          engine(CODE, {
            mentioned: cell(1, 3),
            share: share(3, 3),
            entities: [
              entityCells(FYNIX, cell(1, 3), share(1, 3)),
              entityCells(HUBSPOT, cell(2, 3), share(2, 3)),
              entityCells(ZOHO, cell(0, 3), share(0, 3)),
            ],
          }),
        ]),
      ],
    });
    const totals = read(thin);
    expect(totals.state).toBe('insufficient');
    expect(totals.answersNamingTracked).toBe(3);
    const fynix = figuresOf(totals, FYNIX);
    expect(fynix.share).toMatchObject({ state: 'insufficient', value: null, answers: 3 });
    expect(fynix.mention).toMatchObject({ state: 'insufficient', value: null, k: 1, n: 3 });
  });

  it('exactly 4 answers naming a tracked brand is enough', () => {
    const four = summaryOf({
      prompts: [
        promptRow(1, [
          engine(CODE, {
            mentioned: cell(1, 4),
            share: share(4, 4),
            entities: [
              entityCells(FYNIX, cell(1, 4), share(1, 4)),
              entityCells(HUBSPOT, cell(3, 4), share(3, 4)),
              entityCells(ZOHO, cell(0, 4), share(0, 4)),
            ],
          }),
        ]),
      ],
    });
    const totals = read(four);
    expect(totals.state).toBe('ok');
    expect(figuresOf(totals, FYNIX).share.value).toBeCloseTo(0.25, 10);
    expect(figuresOf(totals, FYNIX).mention.state).toBe('ok');
  });

  it('an engine the summary does not list is unread and never zero', () => {
    const summary = summaryOf({ prompts: promptRows() });
    expect(entityTotals(summary, 'gemini_web', tracked(summary))).toEqual({ status: 'unread' });
    // listed but read without the entities (no `include=entities`)
    const bare = summaryOf({ prompts: [promptRow(1, [engine(CODE, { mentioned: cell(1, 3), share: share(2, 2) })])] });
    expect(entityTotals(bare, CODE, tracked(bare))).toEqual({ status: 'unread' });
    // no rows and no total: nothing is known
    const empty = summaryOf();
    expect(entityTotals(empty, CODE, tracked(empty))).toEqual({ status: 'unread' });
  });

  it('a brand with no cell on a read engine has no figure rather than zero', () => {
    const missing = summaryOf({
      prompts: [
        promptRow(1, [
          engine(CODE, {
            mentioned: cell(1, 4),
            share: share(4, 4),
            entities: [entityCells(FYNIX, cell(1, 4), share(4, 4))],
          }),
        ]),
      ],
    });
    const zoho = figuresOf(read(missing), ZOHO);
    expect(zoho.share).toMatchObject({ state: 'none', value: null });
    expect(zoho.mention).toMatchObject({ state: 'none', value: null });
  });

  it('shares of all tracked entities add up to 1 on an engine with answers', () => {
    const totals = read();
    const sum = totals.entities.reduce((total, entry) => total + (entry.share.value ?? 0), 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('own entities come first and competitors keep the summary order', () => {
    const summary = summaryOf({
      entities: [competitor(3, 'Zoho'), competitor(2, 'HubSpot'), own()],
      prompts: promptRows(),
    });
    const totals = read(summary);
    expect(totals.entities.map((entry) => entry.entity.name)).toEqual(['Fynix', 'Zoho', 'HubSpot']);
  });
});

describe('previousEntityTotals', () => {
  it('a previous window with no entry for the engine gives no previous', () => {
    const current = summaryOf({ prompts: promptRows() });
    const set = tracked(current);
    const gemini = summaryOf({
      prompts: [promptRow(1, [engine('gemini_web', { mentioned: cell(1, 4), share: share(4, 4), entities: [] })])],
    });
    expect(previousEntityTotals(gemini, CODE, set)).toBeNull();
    expect(previousEntityTotals(null, CODE, set)).toBeNull();
  });

  it('a previous window with no valid answer gives no previous', () => {
    const current = summaryOf({ prompts: promptRows() });
    const none = summaryOf({
      prompts: [
        promptRow(1, [
          engine(CODE, {
            entities: [entityCells(FYNIX, cell(0, 0), share(0, 0))],
          }),
        ]),
      ],
    });
    expect(previousEntityTotals(none, CODE, tracked(current))).toBeNull();
  });

  it('a previous window with answers reads like the current one', () => {
    const current = summaryOf({ prompts: promptRows() });
    const previous = previousEntityTotals(summaryOf({ prompts: promptRows() }), CODE, tracked(current));
    expect(previous?.status).toBe('read');
    expect(previous === null ? null : figuresOf(previous, FYNIX).share.numerator).toBe(3);
  });
});
