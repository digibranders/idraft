import { describe, expect, it } from 'vitest';

import { shareNoteOf, withBrandMentionShare } from './brand-mention-share';
import { brandMentionRead, ENTITY_CELL_CAP } from './brand-mentions';
import { cellFigure } from './rate-model';
import type { EngineSummary, EntityCells, MetricCell, PromptsSummary } from '@/lib/api/types';

const cell = (numerator: number, denominator: number): MetricCell =>
  ({ numerator, denominator, n_observations: denominator, value: null }) as MetricCell;

const OLD_SHARE = cell(7.5, 12);
const OWN = 'own-1';
const RIVAL = 'rival-1';

const entity = (id: string, mentions: number, previous?: number): EntityCells =>
  ({
    entity_id: id,
    mentioned: cell(mentions, 20),
    share_of_voice: OLD_SHARE,
    ...(previous === undefined ? {} : { previous: { mentioned: cell(previous, 20), share_of_voice: OLD_SHARE } }),
  }) as EntityCells;

const engine = (entities?: EntityCells[], previous = false): EngineSummary =>
  ({
    engine_code: 'chatgpt_web',
    mentioned: cell(6, 20),
    cited: cell(0, 20),
    share_of_voice: OLD_SHARE,
    ...(entities === undefined ? {} : { entities }),
    ...(previous ? { previous: { mentioned: cell(0, 0), cited: cell(0, 0), share_of_voice: OLD_SHARE } } : {}),
  }) as EngineSummary;

const summaryOf = (
  blocks: { prompt?: EngineSummary; topic?: EngineSummary; total?: EngineSummary },
  tracked = 2,
): PromptsSummary =>
  ({
    entities: [
      { entity_id: OWN, name: 'Northwind', role: 'own' },
      { entity_id: RIVAL, name: 'Rival', role: 'competitor' },
      ...Array.from({ length: tracked - 2 }, (_, index) => ({ entity_id: `x${index}`, name: 'X', role: 'competitor' })),
    ],
    prompts: blocks.prompt === undefined ? [] : [{ engines: [blocks.prompt] }],
    topics: blocks.topic === undefined ? [] : [{ term_id: 't1', engines: [blocks.topic] }],
    ...(blocks.total === undefined ? {} : { total: { engines: [blocks.total] } }),
  }) as unknown as PromptsSummary;

describe('withBrandMentionShare: the share of voice cell as brand-mention counts (D17)', () => {
  it('is the own mentions over all tracked-brand mentions of the block, never the old sum of shares', () => {
    const read = withBrandMentionShare(summaryOf({ total: engine([entity(OWN, 6), entity(RIVAL, 10)]) }));
    const share = read.total?.engines[0]?.share_of_voice;
    expect(share).toMatchObject({ numerator: 6, denominator: 16, value: 0.375 });
    expect(share === undefined ? undefined : shareNoteOf(share)).toBeUndefined();
    // Each brand's own cell is its mentions over the same total
    expect(read.total?.engines[0]?.entities?.map((entry) => entry.share_of_voice.numerator)).toEqual([6, 10]);
  });

  it('marks a block without entity cells as not collected, and cellFigure says so', () => {
    const read = withBrandMentionShare(summaryOf({ prompt: engine() }));
    const block = read.prompts[0]?.engines[0];
    expect(block?.share_of_voice).toMatchObject({ numerator: 0, denominator: 0, value: null });
    expect(cellFigure(block, 'share_of_voice')).toMatchObject({ state: 'none', reason: 'notCollected' });
  });

  it('takes the counts of a topic row and of the total from the read that has the entity cells', () => {
    const own = summaryOf({ topic: engine(), total: engine() });
    const source = summaryOf({ topic: engine([entity(OWN, 5), entity(RIVAL, 15)]), total: engine([entity(OWN, 9), entity(RIVAL, 11)]) });
    const read = withBrandMentionShare(own, source);
    expect(read.topics[0]?.engines[0]?.share_of_voice).toMatchObject({ numerator: 5, denominator: 20 });
    expect(read.total?.engines[0]?.share_of_voice).toMatchObject({ numerator: 9, denominator: 20 });
  });

  it('adds the total block of the source to a read that has none', () => {
    const read = withBrandMentionShare(summaryOf({ prompt: engine() }), summaryOf({ total: engine([entity(OWN, 3), entity(RIVAL, 3)]) }));
    expect(read.total?.engines[0]?.share_of_voice).toMatchObject({ numerator: 3, denominator: 6 });
  });

  it('reads the window before from the previous cells of the entities', () => {
    const read = withBrandMentionShare(summaryOf({ total: engine([entity(OWN, 6, 2), entity(RIVAL, 10, 8)], true) }));
    expect(read.total?.engines[0]?.previous?.share_of_voice).toMatchObject({ numerator: 2, denominator: 10 });
  });

  it('says the counts are cut by the cap when the cells are at the cap and the tracked set is longer', () => {
    const cells = Array.from({ length: ENTITY_CELL_CAP }, (_, index) => entity(index === 0 ? OWN : `e${index}`, 1));
    const read = withBrandMentionShare(summaryOf({ total: engine(cells) }, ENTITY_CELL_CAP + 3));
    const total = read.total?.engines[0];
    expect(total?.share_of_voice).toMatchObject({ denominator: 0, value: null });
    expect(cellFigure(total, 'share_of_voice')).toMatchObject({ state: 'none', reason: 'capped' });
    // The same cells of a project that tracks exactly that many brands are whole
    expect(brandMentionRead(engine(cells), new Set([OWN]), ENTITY_CELL_CAP).kind).toBe('counts');
  });
});
