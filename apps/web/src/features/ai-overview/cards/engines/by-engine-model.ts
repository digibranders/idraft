import type { EngineAggregate, OverviewAggregates, Change } from '../../data/aggregates';
import type { EngineCode } from '@/lib/api/types';
import { deltaInput, type RateChange, type Side } from '@/lib/compare/change-model';
import type { MetricDeltaInput } from '@/lib/format';
import type { RateFigure, RateReason } from '@/lib/rates/strip-model';
import { equalWeightAverage, wilsonInterval, type Interval, type RateState } from '@/lib/stats';

/**
 * AI by engine (WB-OV-06) as plain data: for each engine that is asked, the mention, citation and share of voice
 * of the strip with the counts behind them, how each moved, and the own citation share. Every figure is the
 * strip's own (`buildAggregates`), so the card and the strip agree for the same scope (R12). The equal-weight line
 * is beside the rows and names the engines it averages; engines are never pooled (R3).
 */

export type RateKind = 'mention' | 'citation' | 'shareOfVoice';

export const RATE_KINDS: readonly RateKind[] = ['mention', 'citation', 'shareOfVoice'];

export interface RateCell {
  state: RateState;
  /** Only when `state` is `ok`: a rate under 4 valid answers is not written. */
  value: number | null;
  /** The valid answers behind the rate; for share of voice, those that name a brand. */
  answers: number;
  /** The answers that count; `null` for share of voice. */
  successes: number | null;
  /** The prompts the rate is the mean over, each counted once. */
  prompts: number;
  reason: RateReason | null;
  /** The 95 percent Wilson interval of the pooled answers; mention and citation only, from 4 answers. */
  interval: Interval | null;
  /** The change since the window before; its value is `null` without a comparison. Colour only when detectable. */
  change: MetricDeltaInput;
  /** The same figure of the window before, for the change's tooltip; `null` without one. */
  previous: RateFigure | null;
}

/** Own citation units over every citation unit of the engine, or why there is no figure. */
export type OwnCitation =
  | { status: 'read'; state: RateState; value: number | null; k: number; n: number }
  | { status: 'brandedOnly' | 'notRead' };

export interface EngineRow {
  engineCode: EngineCode;
  label: string;
  mention: RateCell;
  citation: RateCell;
  shareOfVoice: RateCell;
  ownCitation: OwnCitation;
  validAnswers: number;
  allAnswers: number;
}

/** The equal-weight average of the engines that have a rate, with the engines it is made of. */
export interface EngineAverage {
  metric: RateKind;
  value: number;
  engines: EngineCode[];
}

export interface ByEngineModel {
  rows: EngineRow[];
  /** One for each rate that at least 2 engines show; one engine's rate is no average. */
  averages: EngineAverage[];
  /** The prompts in scope; `null` while the prompt rows are not read. */
  promptCount: number | null;
}

/** What the sources read can say of the own citation: it ran, it did not run, or it cannot answer branded only. */
export type SourcesState = 'read' | 'notRead' | 'brandedOnly';

const FIGURES = {
  mention: (engine: EngineAggregate) => ({
    now: engine.mentioned,
    before: engine.previous?.mentioned ?? null,
    change: engine.change.mentioned,
  }),
  citation: (engine: EngineAggregate) => ({
    now: engine.cited,
    before: engine.previous?.cited ?? null,
    change: engine.change.cited,
  }),
  shareOfVoice: (engine: EngineAggregate) => ({
    now: engine.shareOfVoice,
    before: engine.previous?.shareOfVoice ?? null,
    change: engine.change.shareOfVoice,
  }),
} as const satisfies Record<
  RateKind,
  (engine: EngineAggregate) => { now: RateFigure; before: RateFigure | null; change: Change }
>;

const sideOf = (figure: RateFigure, value: number): Side => ({
  value,
  answers: figure.answers,
  successes: figure.successes,
  prompts: figure.prompts,
});

/** The change as `Delta` takes it: through `deltaInput`, with the aggregates' own verdict as the only source of colour. */
function changeInput(now: RateFigure, before: RateFigure | null, change: Change): MetricDeltaInput {
  if (change.delta === null || now.value === null || before === null || before.value === null) return deltaInput(null);
  const asChange: RateChange = {
    points: change.delta,
    detectable: change.detectable,
    now: sideOf(now, now.value),
    before: sideOf(before, before.value),
    engines: 1,
  };
  return deltaInput(asChange);
}

function cellOf(kind: RateKind, engine: EngineAggregate): RateCell {
  const { now, before, change } = FIGURES[kind](engine);
  const counted = kind !== 'shareOfVoice' && now.state === 'ok' && now.successes !== null;
  return {
    state: now.state,
    value: now.value,
    answers: now.answers,
    successes: now.successes,
    prompts: now.prompts,
    reason: now.reason,
    interval: counted && now.successes !== null ? wilsonInterval(now.successes, now.answers) : null,
    change: changeInput(now, before, change),
    previous: before,
  };
}

function ownCitationOf(engine: EngineAggregate, sources: SourcesState): OwnCitation {
  if (sources === 'brandedOnly') return { status: 'brandedOnly' };
  const share = engine.citationShare;
  if (sources === 'notRead' || share === null) return { status: 'notRead' };
  return { status: 'read', state: share.state, value: share.value, k: share.k, n: share.n };
}

export function buildByEngine({
  aggregates,
  sources,
}: {
  aggregates: OverviewAggregates;
  sources: SourcesState;
}): ByEngineModel {
  const rows = aggregates.engines
    .filter((engine) => engine.asked)
    .map((engine): EngineRow => ({
      engineCode: engine.engineCode,
      label: engine.label,
      mention: cellOf('mention', engine),
      citation: cellOf('citation', engine),
      shareOfVoice: cellOf('shareOfVoice', engine),
      ownCitation: ownCitationOf(engine, sources),
      validAnswers: engine.validAnswers,
      allAnswers: engine.allAnswers,
    }));
  const averages = RATE_KINDS.flatMap((metric): EngineAverage[] => {
    const rated = rows.flatMap((row) => (row[metric].state === 'ok' && row[metric].value !== null ? [row] : []));
    const { value, used } = equalWeightAverage(rated.map((row) => row[metric].value));
    return value === null || used < 2 ? [] : [{ metric, value, engines: rated.map((row) => row.engineCode) }];
  });
  return { rows, averages, promptCount: aggregates.promptCount };
}

/** A row of the Table view and the export: one engine and one rate, with everything its percent rests on. */
export interface LongRow {
  engineCode: EngineCode;
  label: string;
  metric: RateKind | 'ownCitation';
  /** `ok`, `insufficient`, `no_answers`, `no_valid_answers`, `no_brand_named`, `branded_only` or `not_read`. */
  status: string;
  value: number | null;
  k: number | null;
  n: number | null;
  prompts: number | null;
  interval: Interval | null;
  change: MetricDeltaInput | null;
  previous: RateFigure | null;
}

const REASON_STATUS = {
  noAnswers: 'no_answers',
  noneValid: 'no_valid_answers',
  noBrandNamed: 'no_brand_named',
} as const satisfies Record<RateReason, string>;

const statusOf = (cell: RateCell): string =>
  cell.state === 'none' ? REASON_STATUS[cell.reason ?? 'noAnswers'] : cell.state;

export function longRows(model: ByEngineModel): LongRow[] {
  return model.rows.flatMap((row): LongRow[] => {
    const base = { engineCode: row.engineCode, label: row.label };
    const rates = RATE_KINDS.map((metric): LongRow => {
      const cell = row[metric];
      return {
        ...base,
        metric,
        status: statusOf(cell),
        value: cell.value,
        k: cell.state === 'none' ? null : cell.successes,
        n: cell.state === 'none' ? null : cell.answers,
        prompts: cell.state === 'none' ? null : cell.prompts,
        interval: cell.interval,
        change: cell.change,
        previous: cell.previous,
      };
    });
    const own = row.ownCitation;
    const ownRow: LongRow =
      own.status === 'read'
        ? {
            ...base,
            metric: 'ownCitation',
            status: own.state === 'none' ? 'no_answers' : own.state,
            value: own.value,
            k: own.k,
            n: own.n,
            prompts: null,
            interval: null,
            change: null,
            previous: null,
          }
        : {
            ...base,
            metric: 'ownCitation',
            status: own.status === 'brandedOnly' ? 'branded_only' : 'not_read',
            value: null,
            k: null,
            n: null,
            prompts: null,
            interval: null,
            change: null,
            previous: null,
          };
    return [...rates, ownRow];
  });
}
