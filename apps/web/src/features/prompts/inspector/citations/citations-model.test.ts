import { describe, expect, it } from 'vitest';

import {
  ALL_ENGINES,
  engineCell,
  engineColumns,
  lostRows,
  notCited,
  staleSince,
  topRows,
  TOP_LIMIT,
} from './citations-model';
import type { PromptCounts } from '../../inspector-reads';
import type { MetricCell, ProjectEngine, PromptSummaryRow } from '@/lib/api/types';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';

const engine = (code: keyof typeof ENGINE_FACTS): ProjectEngine => ({
  active_prompts: 1,
  engine: ENGINE_FACTS[code],
  estimated_monthly_cost_usd: null,
  is_configured: true,
  is_enabled: true,
  location_ids: [2276],
  provider_code: 'openai',
  replicates: 1,
});

const cell = (k: number, n: number): MetricCell => ({
  numerator: k,
  denominator: n,
  n_observations: n,
  value: n === 0 ? null : k / n,
});

/** Counts whose engines have `valid` valid answers each, by engine code. */
const countsOf = (valid: Record<string, number>): PromptCounts => ({
  status: 'ready',
  row: {
    engines: Object.entries(valid).map(([code, n]) => ({ engine_code: code, cited: cell(0, n) })),
  } as unknown as PromptSummaryRow,
  entities: [],
  brandedIncluded: false,
  errorId: null,
  retry: () => undefined,
  retrying: false,
});

describe('engineColumns', () => {
  const all = [engine('google_ai_mode'), engine('chatgpt_web'), engine('gemini_web')];

  it('shows an engine column only for All engines with more than one engine, in the fixed order', () => {
    expect(engineColumns(all, ALL_ENGINES).map((column) => column.code)).toEqual([
      'chatgpt_web',
      'gemini_web',
      'google_ai_mode',
    ]);
    expect(engineColumns(all, 'gemini_web')).toEqual([]);
    expect(engineColumns([engine('chatgpt_web')], ALL_ENGINES)).toEqual([]);
    expect(engineColumns([], ALL_ENGINES)).toEqual([]);
  });

  it('carries the label of the engine', () => {
    expect(engineColumns(all, ALL_ENGINES)[0]).toEqual({ code: 'chatgpt_web', label: 'ChatGPT' });
  });
});

describe('engineCell', () => {
  const row = {
    engines: [
      { engine_code: 'chatgpt_web', citation_units: 4 },
      { engine_code: 'gemini_web', citation_units: 0 },
    ],
  } as const;

  it('is the units of the engine, and a real 0 where the engine had valid answers', () => {
    const counts = countsOf({ chatgpt_web: 3, gemini_web: 2 });
    expect(engineCell(row, 'chatgpt_web', counts)).toBe(4);
    expect(engineCell(row, 'gemini_web', counts)).toBe(0);
  });

  it('is n/a, not 0, for an engine with no valid answer', () => {
    expect(engineCell(row, 'gemini_web', countsOf({ chatgpt_web: 3, gemini_web: 0 }))).toBeNull();
  });

  it('is n/a for an engine the row does not list', () => {
    expect(engineCell(row, 'google_ai_mode', countsOf({ google_ai_mode: 2 }))).toBeNull();
  });

  it('trusts the row when the summary has no cell for the engine', () => {
    expect(engineCell(row, 'chatgpt_web', countsOf({}))).toBe(4);
  });
});

describe('topRows', () => {
  const rows = [
    { citation_units: 6, previous: { citation_units: 0, observations: 0 } },
    { citation_units: 5, previous: { citation_units: 2, observations: 1 } },
    { citation_units: 1, previous: { citation_units: 0, observations: 0 } },
    { citation_units: 4, previous: null },
    { citation_units: 3 },
    { citation_units: 2, previous: { citation_units: 0, observations: 0 } },
  ];

  it('marks a row New only with previous 0 and previous answers above 0', () => {
    const { rows: top, previousKnown } = topRows(rows, { previous_answers: 8 }, 2);
    expect(previousKnown).toBe(true);
    expect(top.map((entry) => entry.isNew)).toEqual([true, false, false, false, false]);
  });

  it('lists at most 5 rows', () => {
    expect(topRows(rows, { previous_answers: 8 }, 1).rows).toHaveLength(TOP_LIMIT);
  });

  it('marks nothing and says why when the previous period has no answers', () => {
    for (const meta of [{ previous_answers: 0 }, { previous_answers: null }, {}]) {
      const { rows: top, previousKnown } = topRows(rows, meta, 1);
      expect(previousKnown).toBe(false);
      expect(top.every((entry) => !entry.isNew)).toBe(true);
    }
  });
});

describe('notCited', () => {
  const roles = (
    own: number,
  ): { domain_role: 'own' | 'competitor'; citation_units: number; observations: number }[] => [
    { domain_role: 'own', citation_units: own, observations: own },
    { domain_role: 'competitor', citation_units: 3, observations: 2 },
  ];

  it('is true for own observations 0 over answers above 0', () => {
    expect(notCited({ answers: 8, by_role: roles(0) })).toBe(true);
  });

  it('is false when the own domain is cited', () => {
    expect(notCited({ answers: 8, by_role: roles(2) })).toBe(false);
  });

  it('is false with 0 answers: there is nothing to be cited in', () => {
    expect(notCited({ answers: 0, by_role: roles(0) })).toBe(false);
  });
});

describe('lostRows', () => {
  it('lists lost domains with their units before', () => {
    const page = {
      data: [
        {
          registrable_domain: 'g2.com',
          domain_role: 'third_party' as const,
          previous_units: 3,
          current_units: 0,
          first_seen_at: null,
          last_seen_at: null,
          role_entity_id: null,
        },
        {
          registrable_domain: 'rival.io',
          domain_role: 'competitor' as const,
          previous_units: 1,
          current_units: 0,
          first_seen_at: null,
          last_seen_at: null,
          role_entity_id: 'e-1',
        },
      ],
    };
    expect(lostRows(page)).toEqual([
      { key: 'g2.com:third_party:', domain: 'g2.com', role: 'third_party', units: 3 },
      { key: 'rival.io:competitor:e-1', domain: 'rival.io', role: 'competitor', units: 1 },
    ]);
  });
});

describe('staleSince', () => {
  const now = new Date('2026-11-13T12:00:00Z');

  it('gives the last valid answer when it is 7 days old or more', () => {
    expect(staleSince('2026-11-06T12:00:00Z', now)).toBe('2026-11-06T12:00:00Z');
    expect(staleSince('2026-10-01T02:00:00Z', now)).toBe('2026-10-01T02:00:00Z');
  });

  it('is null for a recent answer and for none', () => {
    expect(staleSince('2026-11-07T12:00:00Z', now)).toBeNull();
    expect(staleSince(null, now)).toBeNull();
    expect(staleSince(undefined, now)).toBeNull();
  });
});
