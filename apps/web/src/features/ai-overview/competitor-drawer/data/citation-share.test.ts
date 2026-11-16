import { describe, expect, it } from 'vitest';

import { citationShareOf } from './citation-share';
import type { Schemas } from '@/lib/api/types';

type Response = Schemas['AiCompetitorsResponse'];

const value = (share: number | null, units: number): Schemas['AiMetricValue'] =>
  ({ value: share, numerator: share === null ? null : share * units, denominator: units }) as Schemas['AiMetricValue'];

function row(id: string, byEngine: Record<string, [number | null, number]>): Response['data'][number] {
  return {
    entity: { entity_id: id },
    by_engine: Object.entries(byEngine).map(([code, [share, units]]) => ({
      engine_code: code,
      citation_share: value(share, units),
    })),
  } as unknown as Response['data'][number];
}

const response = (...rows: Response['data']): Response => ({ data: rows, meta: {} }) as unknown as Response;

describe('citationShareOf', () => {
  it('is the share of one platform', () => {
    const result = citationShareOf(
      response(row('own', { chatgpt_web: [0.2, 100] }), row('rival', { chatgpt_web: [0.1, 100] })),
      ['chatgpt_web'],
      'own',
      'rival',
    );
    expect(result).toEqual({ own: 0.2, rival: 0.1 });
  });

  it('averages the platforms where both brands have a share, and leaves out a thin one', () => {
    const result = citationShareOf(
      response(
        row('own', { chatgpt_web: [0.2, 100], gemini_web: [0.4, 100], google_ai_mode: [0.9, 2] }),
        row('rival', { chatgpt_web: [0.1, 100], gemini_web: [0.3, 100], google_ai_mode: [0.9, 2] }),
      ),
      ['chatgpt_web', 'gemini_web', 'google_ai_mode'],
      'own',
      'rival',
    );
    expect(result.own).toBeCloseTo(0.3);
    expect(result.rival).toBeCloseTo(0.2);
  });

  it('has none when a brand is not in the answer or has no value, never 0', () => {
    expect(citationShareOf(response(row('own', { chatgpt_web: [0.2, 100] })), ['chatgpt_web'], 'own', 'rival')).toEqual(
      {
        own: null,
        rival: null,
      },
    );
    expect(
      citationShareOf(
        response(row('own', { chatgpt_web: [null, 100] }), row('rival', { chatgpt_web: [0.1, 100] })),
        ['chatgpt_web'],
        'own',
        'rival',
      ),
    ).toEqual({ own: null, rival: null });
  });
});
