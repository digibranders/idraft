import { describe, expect, it } from 'vitest';

import { domainFigures, engineRows } from './domain-model';
import type { EngineCode, SourceDomainDetailData, SourceDomainRow, SourcesMeta } from '@/lib/citations/types';

const ENGINES: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];

const META: SourcesMeta = {
  window: { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' },
  include_branded: false,
  engine_codes: [...ENGINES],
  answers: 4812,
  answers_citing: 4000,
  citation_units: 18420,
  by_role: [{ domain_role: 'third_party', citation_units: 18420, observations: 4000 }],
};

const rowOf = (overrides: Partial<SourceDomainRow> = {}): SourceDomainRow => ({
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 1000,
  observations: 400,
  prompts: 30,
  engines: [
    { engine_code: 'chatgpt_web', citation_units: 600 },
    { engine_code: 'gemini_web', citation_units: 400 },
    { engine_code: 'google_ai_mode', citation_units: 0 },
  ],
  source_share: { value: 1000 / 18420, numerator: 1000, denominator: 18420, n_observations: 4812 },
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  ...overrides,
});

const week = (
  start: string,
  units: number,
  all: number,
  answers = 10,
): SourceDomainDetailData['engines'][number]['series'][number] => ({
  week_start: start,
  citation_units: units,
  observations: units === 0 ? 0 : Math.ceil(units / 2),
  all_citation_units: all,
  answers,
});

const detailOf = (overrides: Partial<SourceDomainDetailData> = {}): SourceDomainDetailData => ({
  registrable_domain: 'g2.com',
  rows: [rowOf()],
  engines: [
    { engine_code: 'chatgpt_web', series: [week('2026-10-12', 200, 3000), week('2026-10-19', 400, 4000)] },
    { engine_code: 'gemini_web', series: [week('2026-10-12', 150, 2500), week('2026-10-19', 250, 3500)] },
    { engine_code: 'google_ai_mode', series: [week('2026-10-12', 0, 0, 0), week('2026-10-19', 0, 0, 0)] },
  ],
  top_pages: [],
  prompts: [],
  cited_with: [],
  ...overrides,
});

describe('domainFigures', () => {
  it('sums units and share over the rows', () => {
    const detail = detailOf({
      rows: [
        rowOf({ citation_units: 1000, domain_role: 'third_party' }),
        rowOf({ citation_units: 500, domain_role: 'competitor', role_entity_id: 'ent-1' }),
      ],
    });
    const figures = domainFigures(detail, META);
    expect(figures.units).toBe(1500);
    expect(figures.total).toBe(18420);
    expect(figures.share).toEqual({ value: 1500 / 18420, units: 1500, total: 18420 });
    expect(figures.answersInScope).toBe(4812);
  });

  it('one role gives answers and prompts', () => {
    const figures = domainFigures(detailOf(), META);
    expect(figures.answers).toBe(400);
    expect(figures.prompts).toBe(30);
  });

  it('several roles give answers and prompts as unknown, never a sum', () => {
    const detail = detailOf({
      rows: [rowOf({ observations: 400, prompts: 30 }), rowOf({ observations: 90, prompts: 12, domain_role: 'own' })],
    });
    const figures = domainFigures(detail, META);
    expect(figures.answers).toBeNull();
    expect(figures.prompts).toBeNull();
  });

  it('has no share, not 0%, when the scope has no unit', () => {
    const figures = domainFigures(detailOf({ rows: [rowOf({ citation_units: 0 })] }), { ...META, citation_units: 0 });
    expect(figures.share).toEqual({ value: null, units: 0, total: 0 });
  });
});

describe('engineRows', () => {
  it('takes units per engine from the rows and the engine total from the weekly all_citation_units', () => {
    const [chatgpt, gemini] = engineRows(detailOf(), ENGINES);
    expect(chatgpt).toMatchObject({ code: 'chatgpt_web', state: 'share', units: 600, total: 7000 });
    expect(gemini).toMatchObject({ code: 'gemini_web', state: 'share', units: 400, total: 6000 });
  });

  it('takes the answers that cite the domain from the weekly observations', () => {
    const [chatgpt] = engineRows(detailOf(), ENGINES);
    expect(chatgpt).toMatchObject({ answers: 100 + 200 });
  });

  it('gives a share that is units over the engine total', () => {
    const [chatgpt, gemini] = engineRows(detailOf(), ENGINES);
    expect(chatgpt?.state === 'share' && chatgpt.share).toBeCloseTo(600 / 7000, 10);
    expect(gemini?.state === 'share' && gemini.share).toBeCloseTo(400 / 6000, 10);
  });

  it('gives an engine with no unit in scope no share, not 0%, and says it asked nothing when it has no answer', () => {
    const [, , mode] = engineRows(detailOf(), ENGINES);
    expect(mode).toEqual({ code: 'google_ai_mode', state: 'none', units: 0, answers: 0, asked: false });
  });

  it('says an engine with answers and no citation did ask, so its zeros are real', () => {
    const detail = detailOf({
      engines: [
        { engine_code: 'google_ai_mode', series: [week('2026-10-12', 0, 0, 40), week('2026-10-19', 0, 0, 25)] },
      ],
    });
    expect(engineRows(detail, ['google_ai_mode'])).toEqual([
      { code: 'google_ai_mode', state: 'none', units: 0, answers: 0, asked: true },
    ]);
  });

  it('keeps a real 0% for an engine that has units, none of them the domain', () => {
    const detail = detailOf({
      rows: [rowOf({ engines: [{ engine_code: 'chatgpt_web', citation_units: 0 }] })],
      engines: [{ engine_code: 'chatgpt_web', series: [week('2026-10-12', 0, 3000)] }],
    });
    expect(engineRows(detail, ['chatgpt_web'])).toEqual([
      { code: 'chatgpt_web', state: 'share', units: 0, total: 3000, answers: 0, share: 0 },
    ]);
  });

  it('lists the engines in the fixed engine order and leaves out an engine that is not in scope', () => {
    const rows = engineRows(detailOf(), ['google_ai_mode', 'chatgpt_web']);
    expect(rows.map((row) => row.code)).toEqual(['chatgpt_web', 'google_ai_mode']);
  });

  it('says unknown for an engine in scope that the detail has no series for, never a figure', () => {
    const detail = detailOf({ engines: [] });
    expect(engineRows(detail, ['gemini_web'])).toEqual([{ code: 'gemini_web', state: 'unknown' }]);
  });
});
