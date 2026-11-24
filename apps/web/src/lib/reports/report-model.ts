import type { ClientReport, ReportEngine } from './types';
import type { MetricCell } from '@/lib/api/types';
import { ENTITY_CELL_CAP, entityMentions } from '@/lib/rates/brand-mentions';
import { validAnswers } from '@/lib/rates/rate-model';
import { rateState } from '@/lib/stats';

/**
 * What the guest report says of a cell, with the rules of the app's Overview: a percent always comes with its counts,
 * too few answers is not a rate, and no answer is not 0 (`rate-model.ts`). Share of voice is the owner's definition
 * (D17): the own brand's mentions over every tracked brand's, worked out here from the brands' Mentioned counts because
 * the API does not send it.
 */

export type FigureState = 'ok' | 'insufficient' | 'none';
export type ShareReason = 'capped' | 'notCollected';

export interface Figure {
  state: FigureState;
  /** The share of `answers` that count, only when there are enough of them to be a rate. */
  value: number | null;
  successes: number | null;
  answers: number;
}

const successesOf = (cell: MetricCell): number | null => {
  if (cell.pooled != null) return cell.pooled.successes;
  return Number.isInteger(cell.numerator) ? cell.numerator : null;
};

/** One Mentioned or Cited cell as a figure. A cell of a topic or the total counts its answers in `pooled`. */
export function figureOf(cell: MetricCell): Figure {
  const answers = validAnswers(cell);
  const state = rateState(answers);
  return { state, value: state === 'ok' ? cell.value : null, successes: successesOf(cell), answers };
}

export type ShareFigure = Figure | { state: 'unavailable'; reason: ShareReason };

/** x of y brand mentions on one engine: the own brand's mentions over all the tracked brands' mentions. */
export function shareOfVoiceOf(report: ClientReport, engineCode: string): ShareFigure {
  const cells = report.brands.flatMap((brand) => {
    const cell = brand.engines.find((entry) => entry.engine_code === engineCode)?.mentioned;
    return cell === undefined ? [] : [{ own: brand.role === 'own', mentions: entityMentions(cell) }];
  });
  if (!cells.some((cell) => cell.own)) return { state: 'unavailable', reason: 'notCollected' };
  // The API gives cells for at most 20 brands: a longer list would make the total too small
  if (cells.length >= ENTITY_CELL_CAP && report.brands.length > cells.length) {
    return { state: 'unavailable', reason: 'capped' };
  }
  const all = cells.reduce((total, cell) => total + cell.mentions, 0);
  const own = cells.reduce((total, cell) => total + (cell.own ? cell.mentions : 0), 0);
  const state = rateState(all);
  return { state, value: state === 'ok' ? own / all : null, successes: own, answers: all };
}

/** The rate bars of the weekly trend: one entry for each week of the engine, as tall as its Mentioned rate. */
export function trendOf(engine: ReportEngine): { weekStart: string; figure: Figure; height: number }[] {
  const figures = engine.weeks.map((week) => ({ weekStart: week.week_start, figure: figureOf(week.mentioned) }));
  const top = Math.max(0.01, ...figures.map(({ figure }) => figure.value ?? 0));
  return figures.map(({ weekStart, figure }) => ({
    weekStart,
    figure,
    height: figure.value === null ? 0 : Math.max(0.06, figure.value / top),
  }));
}
