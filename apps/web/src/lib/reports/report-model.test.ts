import { describe, expect, it } from 'vitest';

import { figureOf, shareOfVoiceOf, trendOf } from './report-model';
import type { MetricCell } from '@/lib/api/types';
import type { ClientReport } from './types';

const cell = (successes: number, trials: number): MetricCell => ({
  value: trials > 0 ? successes / trials : null,
  numerator: successes,
  denominator: trials,
  n_observations: trials,
  pooled: { successes, trials },
});

const brand = (name: string, role: 'own' | 'competitor', mentions: number): ClientReport['brands'][number] => ({
  name,
  role,
  engines: [{ engine_code: 'chatgpt_web', mentioned: cell(mentions, 50) }],
});

const reportOf = (brands: ClientReport['brands']): ClientReport =>
  ({ host: 'example.com', brands, engines: [], cited_domains: [] }) as unknown as ClientReport;

describe('figureOf', () => {
  it('counts the answers of a pooled cell and gives a rate only from four of them', () => {
    expect(figureOf(cell(71, 192))).toMatchObject({ state: 'ok', successes: 71, answers: 192 });
    expect(figureOf(cell(2, 3))).toMatchObject({ state: 'insufficient', value: null, successes: 2, answers: 3 });
  });

  it('never makes no answers a rate of 0', () => {
    expect(figureOf(cell(0, 0))).toMatchObject({ state: 'none', value: null, answers: 0 });
  });
});

describe('shareOfVoiceOf', () => {
  it('is the own brand mentions over every tracked brand mention', () => {
    const report = reportOf([
      brand('Eventus', 'own', 20),
      brand('CyberNX', 'competitor', 30),
      brand('Wipro', 'competitor', 10),
    ]);
    expect(shareOfVoiceOf(report, 'chatgpt_web')).toMatchObject({ state: 'ok', successes: 20, answers: 60 });
  });

  it('is too few under four brand mentions', () => {
    const report = reportOf([brand('Eventus', 'own', 1), brand('CyberNX', 'competitor', 2)]);
    expect(shareOfVoiceOf(report, 'chatgpt_web')).toMatchObject({ state: 'insufficient', value: null, answers: 3 });
  });

  it('is not collected for a platform the brands have no cell on', () => {
    const report = reportOf([brand('Eventus', 'own', 20)]);
    expect(shareOfVoiceOf(report, 'gemini_web')).toEqual({ state: 'unavailable', reason: 'notCollected' });
  });

  it('is not counted when more brands are tracked than the report holds cells for', () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      brand(`B${String(index)}`, index === 0 ? 'own' : 'competitor', 5),
    );
    const report = reportOf([...many, { name: 'No cell', role: 'competitor', engines: [] }]);
    expect(shareOfVoiceOf(report, 'chatgpt_web')).toEqual({ state: 'unavailable', reason: 'capped' });
  });
});

describe('trendOf', () => {
  it('says how many weeks a pooled point holds, and nothing for a week on its own', () => {
    const point = (pooled: boolean, weeks: number | null): ClientReport['engines'][number]['weeks'][number] => ({
      week_start: '2026-11-02',
      is_pooled: pooled,
      pool_weeks: weeks,
      mentioned: cell(5, 20),
      cited: cell(1, 20),
    });
    const bars = trendOf({
      engine_code: 'chatgpt_web',
      mentioned: cell(0, 0),
      cited: cell(0, 0),
      weeks: [point(false, null), point(true, 3)],
    });
    expect(bars.map((bar) => bar.pooledWeeks)).toEqual([null, 3]);
  });

  it('makes the tallest week full height and a week with no answers empty', () => {
    const week = (
      start: string,
      successes: number,
      trials: number,
    ): ClientReport['engines'][number]['weeks'][number] => ({
      week_start: start,
      is_pooled: false,
      pool_weeks: null,
      mentioned: cell(successes, trials),
      cited: cell(0, trials),
    });
    const bars = trendOf({
      engine_code: 'chatgpt_web',
      mentioned: cell(0, 0),
      cited: cell(0, 0),
      weeks: [week('2026-11-02', 10, 40), week('2026-11-09', 20, 40), week('2026-11-16', 0, 0)],
    });
    expect(bars.map((bar) => bar.height)).toEqual([0.5, 1, 0]);
  });
});
