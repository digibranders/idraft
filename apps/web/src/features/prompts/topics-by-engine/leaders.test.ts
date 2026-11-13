import { describe, expect, it } from 'vitest';

import { cell, competitor, engine, entityCells, own, weighted } from './cells-fixtures';
import { leaderOn, topCompetitors } from './leaders';
import type { EngineSummary, EntityCells } from '@/lib/api/types';

const TRACKED = [
  own('own', 'Acme'),
  competitor('beta', 'Beta'),
  competitor('gamma', 'Gamma'),
  competitor('delta', 'Delta'),
];

/** Share of voice of an entity over `answers` answers that name a brand: `sum` is the sum of its shares. */
const share = (sum: number, answers = 10) => cell(sum, answers);

/** An engine with `answers` answers naming a brand and the entity cells given as `[id, share sum, mentioned rate]`. */
const withEntities = (
  rows: readonly (readonly [id: string, shareSum: number, mentioned: number | null])[],
  answers = 10,
): EngineSummary =>
  engine('chatgpt_web', {
    share_of_voice: cell(answers, answers),
    entities: rows.map(([id, shareSum, mentioned]): EntityCells =>
      entityCells(
        id,
        mentioned === null ? weighted(0, 0, 0) : weighted(Math.round(mentioned * 10), 10, 5),
        share(shareSum, answers),
      ),
    ),
  });

describe('leaderOn: the tracked competitor that leads an engine', () => {
  it('picks the competitor with the highest share of voice on the engine', () => {
    const leader = leaderOn(
      withEntities([
        ['own', 3, 0.3],
        ['beta', 4, 0.4],
        ['gamma', 2, 0.2],
      ]),
      TRACKED,
    );
    expect(leader).toMatchObject({
      engineCode: 'chatgpt_web',
      state: 'leader',
      entityId: 'beta',
      name: 'Beta',
      tiedWith: [],
    });
    expect(leader.share?.value).toBe(0.4);
    // The answers behind the share are there for the words: 10 answers name a brand
    expect(leader.share?.denominator).toBe(10);
  });

  it('never picks the own brand', () => {
    const leader = leaderOn(
      withEntities([
        ['own', 6, 0.9],
        ['gamma', 1, 0.1],
      ]),
      TRACKED,
    );
    expect(leader.entityId).toBe('gamma');
  });

  it('gives the own share beside the leader', () => {
    const leader = leaderOn(
      withEntities([
        ['own', 3, 0.3],
        ['beta', 4, 0.4],
      ]),
      TRACKED,
    );
    expect(leader.own?.value).toBe(0.3);
    // Without a cell for the own brand there is nothing to put beside the leader, not a share of 0
    expect(leaderOn(withEntities([['beta', 4, 0.4]]), TRACKED).own).toBeNull();
  });

  it('breaks a tie by the higher mention rate, then by the order of the entities, and names the tied', () => {
    const byMention = leaderOn(
      withEntities([
        ['beta', 3, 0.2],
        ['gamma', 3, 0.5],
        ['delta', 1, 0.9],
      ]),
      TRACKED,
    );
    expect(byMention).toMatchObject({ entityId: 'gamma', tiedWith: ['Beta'] });

    const byOrder = leaderOn(
      withEntities([
        ['gamma', 3, 0.4],
        ['beta', 3, 0.4],
      ]),
      TRACKED,
    );
    // Beta comes before Gamma in the tracked entities, whatever the order of the cells
    expect(byOrder).toMatchObject({ entityId: 'beta', tiedWith: ['Gamma'] });
  });

  it('says none named when every competitor is at 0', () => {
    const leader = leaderOn(
      withEntities([
        ['own', 5, 0.5],
        ['beta', 0, 0],
        ['gamma', 0, 0],
      ]),
      TRACKED,
    );
    expect(leader).toMatchObject({ state: 'none-named', entityId: null, name: null, share: null, tiedWith: [] });
    // The own share is still there for the tooltip
    expect(leader.own?.value).toBe(0.5);
  });

  it('says too few when fewer than 4 answers name a tracked brand, whatever the shares say', () => {
    const leader = leaderOn(
      withEntities(
        [
          ['beta', 2, 0.5],
          ['gamma', 1, 0.2],
        ],
        3,
      ),
      TRACKED,
    );
    expect(leader).toMatchObject({ state: 'too-few', entityId: null, name: null, share: null });
  });

  it('is unknown without entity cells', () => {
    expect(leaderOn(undefined, TRACKED).state).toBe('unknown');
    expect(leaderOn(engine('chatgpt_web', { share_of_voice: cell(10, 10) }), TRACKED).state).toBe('unknown');
    expect(leaderOn(engine('chatgpt_web', { share_of_voice: cell(10, 10), entities: null }), TRACKED).state).toBe(
      'unknown',
    );
    // No competitor tracked at all is not a leader of 0
    expect(leaderOn(withEntities([['own', 5, 0.5]]), [own('own', 'Acme')]).state).toBe('none-named');
  });

  it('ignores an entity that is not in the tracked set', () => {
    const leader = leaderOn(
      withEntities([
        ['stranger', 9, 0.9],
        ['gamma', 1, 0.1],
      ]),
      TRACKED,
    );
    expect(leader.entityId).toBe('gamma');
  });
});

describe('topCompetitors: the competitors drawn against the own brand', () => {
  it('takes the 3 most mentioned competitors by window mentions, ties by order', () => {
    const cells = withEntities([
      ['delta', 0, 0.3],
      ['gamma', 0, 0.5],
      ['beta', 0, 0.5],
      ['own', 0, 0.9],
      ['extra', 0, 0.1],
    ]);
    const tracked = [...TRACKED, competitor('extra', 'Extra')];
    // Beta before Gamma on the tie at 50 percent; the own brand is never a competitor
    expect(topCompetitors(cells, tracked, 3)).toEqual(['beta', 'gamma', 'delta']);
  });

  it('never takes a competitor with 0 mentions', () => {
    const cells = withEntities([
      ['beta', 0, 0.2],
      ['gamma', 0, 0],
      ['delta', 0, null],
    ]);
    expect(topCompetitors(cells, TRACKED, 3)).toEqual(['beta']);
  });

  it('is empty without entity cells', () => {
    expect(topCompetitors(undefined, TRACKED, 3)).toEqual([]);
    expect(topCompetitors(engine('chatgpt_web'), TRACKED, 3)).toEqual([]);
  });
});
