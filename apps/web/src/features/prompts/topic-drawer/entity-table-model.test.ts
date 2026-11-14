import { describe, expect, it } from 'vitest';

import { entityTable, MAX_ENTITIES } from './entity-table-model';
import {
  cell,
  competitor,
  engine,
  entityCells,
  own,
  topicRow,
  weighted,
} from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { EngineSummary } from '@/lib/api/types';

const CODES = ['chatgpt_web', 'gemini_web'] as const;
const TRACKED = [competitor('beta', 'Beta'), own('own', 'Acme'), competitor('gamma', 'Gamma')];

/** An engine of 10 answers that name a brand, with the entity cells given as `[id, mentioned k of 10, share sum]`. */
const onEngine = (
  code: string,
  rows: readonly (readonly [id: string, mentioned: number, share: number])[],
  answers = 10,
): EngineSummary =>
  engine(code, {
    mentioned: weighted(5, answers, 5),
    share_of_voice: cell(answers, answers),
    entities: rows.map(([id, mentioned, share]) =>
      entityCells(id, weighted(mentioned, answers, 5), cell(share, answers)),
    ),
  });

const row = (...engines: EngineSummary[]) => topicRow('topic', 'Technical SEO', 5, engines);
const leadersOf = (rows: ReturnType<typeof entityTable>, code: string): string[] =>
  rows
    .filter((entry) => entry.cells.find((entry2) => entry2.engineCode === code)?.leads)
    .map((entry) => entry.entityId);

describe('entityTable: the tracked entities by engine', () => {
  const topic = row(
    onEngine('chatgpt_web', [
      ['own', 3, 3],
      ['beta', 6, 5],
      ['gamma', 2, 2],
    ]),
    onEngine('gemini_web', [
      ['own', 9, 3],
      ['beta', 1, 1],
      ['gamma', 5, 6],
    ]),
  );

  it('puts the own brand first then the competitors in the order given, at most 20', () => {
    const rows = entityTable(topic, TRACKED, CODES, 'share_of_voice');
    expect(rows.map((entry) => [entry.entityId, entry.role])).toEqual([
      ['own', 'own'],
      ['beta', 'competitor'],
      ['gamma', 'competitor'],
    ]);
    expect(rows[0]?.cells.map((entry) => entry.engineCode)).toEqual(CODES);

    const many = Array.from({ length: 30 }, (_, at) => competitor(`c${String(at)}`, `Competitor ${String(at)}`));
    expect(entityTable(topic, [own('own', 'Acme'), ...many], CODES, 'mentioned')).toHaveLength(MAX_ENTITIES);
    expect(MAX_ENTITIES).toBe(20);
  });

  it('marks the leader of each engine, never the own brand', () => {
    const rows = entityTable(topic, TRACKED, CODES, 'share_of_voice');
    expect(leadersOf(rows, 'chatgpt_web')).toEqual(['beta']);
    expect(leadersOf(rows, 'gemini_web')).toEqual(['gamma']);
    // The own brand has the most mentions on Gemini and still leads nothing
    expect(rows.find((entry) => entry.entityId === 'own')?.cells.every((entry) => !entry.leads)).toBe(true);
  });

  it('marks the leader of the metric it shows: the highest Mentioned when it shows Mentioned', () => {
    const mentioned = row(
      onEngine('chatgpt_web', [
        ['beta', 2, 6],
        ['gamma', 7, 1],
      ]),
    );
    expect(leadersOf(entityTable(mentioned, TRACKED, CODES, 'share_of_voice'), 'chatgpt_web')).toEqual(['beta']);
    expect(leadersOf(entityTable(mentioned, TRACKED, CODES, 'mentioned'), 'chatgpt_web')).toEqual(['gamma']);
  });

  it('leaves no leader where no competitor is named or the answers are too few', () => {
    const quiet = row(
      onEngine('chatgpt_web', [
        ['beta', 0, 0],
        ['gamma', 0, 0],
      ]),
      onEngine(
        'gemini_web',
        [
          ['beta', 2, 2],
          ['gamma', 1, 1],
        ],
        3,
      ),
    );
    const rows = entityTable(quiet, TRACKED, CODES, 'share_of_voice');
    expect(leadersOf(rows, 'chatgpt_web')).toEqual([]);
    expect(leadersOf(rows, 'gemini_web')).toEqual([]);
  });

  it('leaves no leader by Mentioned where every competitor is at 0', () => {
    const quiet = row(
      onEngine('chatgpt_web', [
        ['own', 3, 3],
        ['beta', 0, 5],
        ['gamma', 0, 3],
      ]),
    );
    expect(leadersOf(entityTable(quiet, TRACKED, CODES, 'mentioned'), 'chatgpt_web')).toEqual([]);
  });

  it('leaves no leader by Mentioned over an engine with under 4 valid answers', () => {
    const few = row(
      onEngine(
        'gemini_web',
        [
          ['beta', 2, 2],
          ['gamma', 1, 1],
        ],
        3,
      ),
    );
    expect(leadersOf(entityTable(few, TRACKED, CODES, 'mentioned'), 'gemini_web')).toEqual([]);
  });

  it('gives a tie to the entity listed first, by either metric', () => {
    const tied = row(
      onEngine('chatgpt_web', [
        ['gamma', 5, 4],
        ['beta', 5, 4],
      ]),
    );
    // The tracked order is Beta, Acme, Gamma: Beta comes before Gamma
    expect(leadersOf(entityTable(tied, TRACKED, CODES, 'mentioned'), 'chatgpt_web')).toEqual(['beta']);
    expect(leadersOf(entityTable(tied, TRACKED, CODES, 'share_of_voice'), 'chatgpt_web')).toEqual(['beta']);
  });

  it('names the leader among the entities shown, not among the ones the cap leaves out', () => {
    const many = Array.from({ length: 24 }, (_, at) => competitor(`c${String(at)}`, `Competitor ${String(at)}`));
    const crowded = row(
      onEngine('chatgpt_web', [
        ['own', 3, 3],
        ...many.map((entity, at): [string, number, number] => [entity.entity_id, 1, at === 5 ? 3 : at === 22 ? 6 : 0]),
      ]),
    );
    const rows = entityTable(crowded, [own('own', 'Acme'), ...many], CODES, 'share_of_voice');
    expect(rows).toHaveLength(MAX_ENTITIES);
    // Competitor 22 has the most share but is not listed: the leader of the table is the best of those that are
    expect(leadersOf(rows, 'chatgpt_web')).toEqual(['c5']);
  });

  it('gives a null cell for an entity without cells, never 0', () => {
    const partial = row(
      onEngine('chatgpt_web', [['beta', 6, 5]]),
      // No entity cells at all on Gemini
      engine('gemini_web', { mentioned: weighted(5, 10, 5) }),
    );
    const rows = entityTable(partial, TRACKED, CODES, 'mentioned');
    const acme = rows.find((entry) => entry.entityId === 'own');
    expect(acme?.cells.map((entry) => entry.value)).toEqual([null, null]);
    expect(acme?.cells.map((entry) => entry.figure)).toEqual([null, null]);
    const beta = rows.find((entry) => entry.entityId === 'beta');
    expect(beta?.cells[0]?.value?.value).toBe(0.6);
    expect(beta?.cells[1]?.value).toBeNull();
    // An engine the topic has no cells for is a null cell too
    expect(entityTable(row(), TRACKED, CODES, 'mentioned')[0]?.cells.map((entry) => entry.value)).toEqual([null, null]);
  });

  it('uses Mentioned or Share of voice as asked, with the answers behind the value', () => {
    const mentioned = entityTable(topic, TRACKED, CODES, 'mentioned').find((entry) => entry.entityId === 'beta');
    expect(mentioned?.cells[0]?.value?.value).toBe(0.6);
    expect(mentioned?.cells[0]?.figure).toMatchObject({ state: 'ok', value: 0.6, answers: 10, successes: 6 });
    const share = entityTable(topic, TRACKED, CODES, 'share_of_voice').find((entry) => entry.entityId === 'beta');
    expect(share?.cells[0]?.value?.value).toBe(0.5);
    // Share of voice counts the answers that name a brand and has no count of successes
    expect(share?.cells[0]?.figure).toMatchObject({ state: 'ok', value: 0.5, answers: 10, successes: null });
  });

  it('is only the tracked entities when the topic is not read yet', () => {
    const rows = entityTable(undefined, TRACKED, CODES, 'mentioned');
    expect(rows.map((entry) => entry.entityId)).toEqual(['own', 'beta', 'gamma']);
    expect(rows.every((entry) => entry.cells.every((entry2) => entry2.value === null && !entry2.leads))).toBe(true);
  });
});
