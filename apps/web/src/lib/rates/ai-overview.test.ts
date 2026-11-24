import { describe, expect, it } from 'vitest';

import { aiOverviewFigure, aiOverviewTotalsOf, type AiOverviewTotals } from './ai-overview';

const totals = (over: Partial<AiOverviewTotals>): AiOverviewTotals => ({
  prompts: 30,
  linked: 20,
  tracked: 12,
  shown: 8,
  cited_own: 2,
  keywords_shown: 6,
  keywords_cited: 2,
  observed_at: '2026-11-20T08:00:00Z',
  ...over,
});

describe('aiOverviewFigure', () => {
  it('is null while the read carries no totals', () => {
    expect(aiOverviewFigure(undefined)).toBeNull();
  });

  it('is the cited share of the prompts whose keyword shows an overview, with its counts', () => {
    expect(aiOverviewFigure(totals({}))).toMatchObject({
      state: 'ok',
      value: 0.25,
      shown: 8,
      cited: 2,
      keywords: 6,
      tracked: 12,
    });
  });

  it('holds the floor to the distinct keywords, not the prompts that share them', () => {
    expect(aiOverviewFigure(totals({ shown: 9, keywords_shown: 3 }))).toMatchObject({
      state: 'insufficient',
      value: null,
      shown: 9,
    });
  });

  it('says why there is no rate and never gives a zero', () => {
    expect(aiOverviewFigure(totals({ tracked: 0, shown: 0, cited_own: 0, keywords_shown: 0 }))).toMatchObject({
      state: 'none',
      value: null,
      reason: 'notTracked',
    });
    expect(aiOverviewFigure(totals({ shown: 0, cited_own: 0, keywords_shown: 0 }))).toMatchObject({
      state: 'none',
      value: null,
      reason: 'noOverview',
    });
  });
});

describe('aiOverviewTotalsOf', () => {
  const cell = (
    source_state: 'ok' | 'no_surface' | 'not_tracked' | 'no_linked_keyword',
    keyword: string | null,
    cited: boolean | null = null,
  ) => ({
    source_state,
    keyword,
    shown: source_state === 'ok' ? true : source_state === 'no_surface' ? false : null,
    cited_own: source_state === 'ok' ? cited : source_state === 'no_surface' ? false : null,
    cited_position: null,
    observed_at: source_state === 'ok' || source_state === 'no_surface' ? '2026-11-20T08:00:00Z' : null,
    checks: 1,
  });

  it('is undefined when no row carries the cell', () => {
    expect(aiOverviewTotalsOf([{}, {}])).toBeUndefined();
  });

  it('counts the rows given and each keyword once', () => {
    const totals = aiOverviewTotalsOf([
      { ai_overview: cell('ok', 'soc', true) },
      { ai_overview: cell('ok', 'soc', true) },
      { ai_overview: cell('ok', 'mdr', false) },
      { ai_overview: cell('no_surface', 'edr') },
      { ai_overview: cell('not_tracked', null) },
      { ai_overview: cell('no_linked_keyword', null) },
    ]);
    expect(totals).toEqual({
      prompts: 6,
      linked: 5,
      tracked: 4,
      shown: 3,
      cited_own: 2,
      keywords_shown: 2,
      keywords_cited: 1,
      observed_at: '2026-11-20T08:00:00Z',
    });
  });
});
