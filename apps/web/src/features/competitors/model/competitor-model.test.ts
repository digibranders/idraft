import { describe, expect, it } from 'vitest';

import {
  cellOver,
  changeOf,
  biggestMover,
  entityRows,
  meanOf,
  rankedCompetitors,
  roleOf,
  standingOf,
  strongestEngine,
  weeklyValues,
  type AiCompetitor,
} from './competitor-model';

const value = (v: number | null, previous: number | null = null): never =>
  ({ value: v, previous: previous === null ? null : { value: previous } }) as never;

const row = (id: string, role: 'own' | 'competitor', chat: number | null, gem: number | null): AiCompetitor =>
  ({
    entity: { entity_id: id, canonical_name: id, role, color_index: null, entity_type: 'brand' },
    by_engine: [
      {
        engine_code: 'chatgpt_web',
        mention_rate: value(chat, 0.1),
        citation_share: value(0.2),
        share_of_voice: value(0.3),
      },
      {
        engine_code: 'gemini_web',
        mention_rate: value(gem, 0.3),
        citation_share: value(null),
        share_of_voice: value(0.1),
      },
    ],
  }) as never;

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value');
  return value;
};

describe('meanOf', () => {
  it('ignores unknown values and is null when none is known', () => {
    expect(meanOf([0.2, null, 0.4])).toBeCloseTo(0.3);
    expect(meanOf([null, null])).toBeNull();
    expect(meanOf([])).toBeNull();
  });
});

describe('cellOver', () => {
  const rows = entityRows([row('a', 'competitor', 0.4, 0.2)]);
  it('is one engine alone, or the mean of the engines asked', () => {
    expect(cellOver(must(rows[0]), 'mention_rate', ['chatgpt_web']).value).toBe(0.4);
    expect(cellOver(must(rows[0]), 'mention_rate', ['chatgpt_web', 'gemini_web']).value).toBeCloseTo(0.3);
  });
  it('averages the previous period over the same engines', () => {
    const cell = cellOver(must(rows[0]), 'mention_rate', ['chatgpt_web', 'gemini_web']);
    expect(cell.previous).toBeCloseTo(0.2);
    expect(changeOf(cell)).toBeCloseTo(0.1);
  });
  it('has no previous when an engine with a value lacks one, and no change then', () => {
    const cell = cellOver(must(rows[0]), 'citation_share', ['chatgpt_web', 'gemini_web']);
    expect(cell.value).toBeCloseTo(0.2);
    expect(cell.previous).toBeNull();
    expect(changeOf(cell)).toBeNull();
  });
  it('is null for an engine the row has no cell for', () => {
    expect(cellOver(must(rows[0]), 'mention_rate', ['google_ai_mode']).value).toBeNull();
  });
});

describe('rankedCompetitors', () => {
  it('lists competitors highest first with unknown last, and leaves the own brand out', () => {
    const rows = entityRows([
      row('own', 'own', 0.9, 0.9),
      row('low', 'competitor', 0.1, 0.1),
      row('none', 'competitor', null, null),
      row('high', 'competitor', 0.5, 0.5),
    ]);
    expect(rankedCompetitors(rows, 'mention_rate', ['chatgpt_web']).map((r) => r.id)).toEqual(['high', 'low', 'none']);
  });
  it('gives the own brand the brand colour and the others the palette in turn', () => {
    const rows = entityRows([row('own', 'own', 1, 1), row('c', 'competitor', 1, 1)]);
    expect(roleOf(must(rows[0]), 0)).toEqual({ kind: 'brand' });
    expect(roleOf(must(rows[1]), 1)).toEqual({ kind: 'palette', index: 3 });
    expect(roleOf(must(rows[1]), 5)).toEqual({ kind: 'palette', index: 2 });
  });
});

describe('weeklyValues', () => {
  const point = (t: string, v: number | null): never => ({ t, value: v }) as never;
  const series = [
    { entity_id: 'a', engine_code: 'chatgpt_web', points: [point('2026-11-02', 0.2), point('2026-11-09', 0.4)] },
    { entity_id: 'a', engine_code: 'gemini_web', points: [point('2026-11-02', 0.4), point('2026-11-09', null)] },
    { entity_id: 'b', engine_code: 'chatgpt_web', points: [point('2026-11-09', 0.1)] },
    { entity_id: null, engine_code: 'chatgpt_web', points: [point('2026-11-16', 0.9)] },
  ] as never[];
  it('averages the engines in scope per week and leaves a gap where none has a value', () => {
    const out = weeklyValues(series, ['chatgpt_web', 'gemini_web']);
    expect(out.weeks).toEqual(['2026-11-02', '2026-11-09', '2026-11-16']);
    const a = must(out.byEntity.get('a'));
    expect(a[0]).toBeCloseTo(0.3);
    expect(a[1]).toBeCloseTo(0.4);
    expect(a[2]).toBeNull();
    expect(out.byEntity.get('b')).toEqual([null, 0.1, null]);
  });
  it('leaves out an engine that is not in scope and a series with no entity', () => {
    const out = weeklyValues(series, ['gemini_web']);
    expect(out.byEntity.has('b')).toBe(false);
    expect(must(out.byEntity.get('a'))[0]).toBeCloseTo(0.4);
  });
});

describe('standingOf', () => {
  const rows = entityRows([
    row('own', 'own', 0.3, 0.3),
    row('a', 'competitor', 0.5, 0.5),
    row('b', 'competitor', 0.1, 0.1),
    row('none', 'competitor', null, null),
  ]);
  it('ranks your brand among the brands that have a value and counts the competitors ahead', () => {
    expect(standingOf(rows, 'mention_rate', ['chatgpt_web'])).toEqual({ rank: 2, of: 3, ahead: 1 });
  });
  it('has no rank while your brand has no value', () => {
    const none = entityRows([row('own', 'own', null, null), row('a', 'competitor', 0.5, 0.5)]);
    expect(standingOf(none, 'mention_rate', ['chatgpt_web'])).toEqual({ rank: null, of: 1, ahead: 0 });
  });
  it('is first when no competitor is higher', () => {
    const lead = entityRows([row('own', 'own', 0.9, 0.9), row('a', 'competitor', 0.5, 0.5)]);
    expect(standingOf(lead, 'mention_rate', ['chatgpt_web']).rank).toBe(1);
  });
});

describe('biggestMover', () => {
  it('is the competitor with the largest change in either direction, never your brand', () => {
    const rows = entityRows([row('own', 'own', 0.9, 0.9), row('a', 'competitor', 0.4, 0.4)]);
    const mover = biggestMover(rows, 'mention_rate', ['chatgpt_web']);
    expect(mover?.name).toBe('a');
    expect(mover?.change).toBeCloseTo(0.3);
  });
  it('is null when no competitor has a previous period', () => {
    expect(biggestMover(entityRows([row('a', 'competitor', 0.4, 0.4)]), 'citation_share', ['chatgpt_web'])).toBeNull();
  });
});

describe('strongestEngine', () => {
  const rows = entityRows([row('own', 'own', 0.2, 0.6)]);
  it('is the engine with the highest value', () => {
    expect(strongestEngine(must(rows[0]), 'mention_rate', ['chatgpt_web', 'gemini_web'])).toEqual({
      engine: 'gemini_web',
      value: 0.6,
    });
  });
  it('is null when no engine has a value', () => {
    expect(strongestEngine(must(rows[0]), 'citation_share', ['gemini_web'])).toBeNull();
  });
});
