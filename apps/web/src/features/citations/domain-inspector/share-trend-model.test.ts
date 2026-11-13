import { describe, expect, it } from 'vitest';

import { engineRole, shareTrend } from './share-trend-model';
import type { DomainEngineSeries, DomainEngineWeek, EngineCode, SourceDomainDetailData } from '@/lib/citations/types';

const week = (weekStart: string, units: number, all: number): DomainEngineWeek => ({
  week_start: weekStart,
  citation_units: units,
  observations: units,
  all_citation_units: all,
  answers: all === 0 ? 0 : 10,
});
const seriesOf = (code: EngineCode, weeks: DomainEngineWeek[]): DomainEngineSeries => ({
  engine_code: code,
  series: weeks,
});
const dataOf = (engines: DomainEngineSeries[]): SourceDomainDetailData => ({
  registrable_domain: 'g2.com',
  rows: [],
  engines,
  top_pages: [],
  prompts: [],
  cited_with: [],
});

describe('shareTrend', () => {
  it('has one series per engine, never pooled', () => {
    const trend = shareTrend(
      dataOf([
        seriesOf('chatgpt_web', [week('2026-10-19', 10, 100)]),
        seriesOf('gemini_web', [week('2026-10-19', 30, 100)]),
      ]),
    );
    expect(trend?.series.map((entry) => entry.code)).toEqual(['chatgpt_web', 'gemini_web']);
    // A pooled line would be 40 of 200, 20%: neither engine reads that
    expect(trend?.series.map((entry) => entry.values)).toEqual([[0.1], [0.3]]);
  });

  it('lists the weeks of every engine once, in order', () => {
    const trend = shareTrend(
      dataOf([
        seriesOf('gemini_web', [week('2026-10-26', 5, 50), week('2026-10-12', 1, 50)]),
        seriesOf('chatgpt_web', [week('2026-10-19', 2, 20)]),
      ]),
    );
    expect(trend?.weeks).toEqual(['2026-10-12', '2026-10-19', '2026-10-26']);
    // An engine that has no row for a week has no figure that week
    expect(trend?.series.find((entry) => entry.code === 'chatgpt_web')?.values).toEqual([null, 0.1, null]);
  });

  it('puts the engines in the fixed engine order whatever order the read gave', () => {
    const trend = shareTrend(
      dataOf([
        seriesOf('google_ai_mode', [week('2026-10-19', 1, 10)]),
        seriesOf('chatgpt_web', [week('2026-10-19', 1, 10)]),
      ]),
    );
    expect(trend?.series.map((entry) => entry.code)).toEqual(['chatgpt_web', 'google_ai_mode']);
  });

  it('leaves a week with no unit on the engine as a gap (null), not 0', () => {
    const trend = shareTrend(dataOf([seriesOf('chatgpt_web', [week('2026-10-12', 0, 0), week('2026-10-19', 5, 50)])]));
    expect(trend?.series[0]?.values).toEqual([null, 0.1]);
    expect(trend?.series[0]?.cells[0]).toBeNull();
  });

  it('keeps a week with units on the engine and none for the domain as a real 0', () => {
    const trend = shareTrend(dataOf([seriesOf('chatgpt_web', [week('2026-10-12', 0, 40), week('2026-10-19', 5, 50)])]));
    expect(trend?.series[0]?.values).toEqual([0, 0.1]);
    expect(trend?.series[0]?.cells[0]).toEqual({ units: 0, total: 40 });
  });

  it('takes the value as the domain units over all_citation_units', () => {
    const trend = shareTrend(dataOf([seriesOf('chatgpt_web', [week('2026-10-19', 125, 1000)])]));
    expect(trend?.series[0]?.values).toEqual([0.125]);
  });

  it('keeps the counts behind every point', () => {
    const trend = shareTrend(dataOf([seriesOf('chatgpt_web', [week('2026-10-19', 125, 1000)])]));
    expect(trend?.series[0]?.cells).toEqual([{ units: 125, total: 1000 }]);
  });

  it('is null when no engine has a figure in any week', () => {
    expect(shareTrend(dataOf([]))).toBeNull();
    expect(shareTrend(dataOf([seriesOf('chatgpt_web', [week('2026-10-19', 0, 0)])]))).toBeNull();
  });
});

describe('engineRole', () => {
  it('colours the engines by their place in the fixed order', () => {
    expect(engineRole('chatgpt_web')).toEqual({ kind: 'brand' });
    expect(engineRole('gemini_web')).toEqual({ kind: 'palette', index: 2 });
    expect(engineRole('google_ai_mode')).toEqual({ kind: 'palette', index: 3 });
    expect(engineRole('google_ai_overview')).toEqual({ kind: 'palette', index: 4 });
    expect(engineRole('some_other_engine')).toEqual({ kind: 'other' });
  });
});
