import type { EngineCode, PromptSummaryRow } from '@/lib/api/types';
import { engineRates, type RateFigure, type RateReason } from '@/lib/rates/strip-model';
import type { RateState } from '@/lib/stats';

/**
 * By country (CH-23) as plain data: for each country of the project's prompts, the chosen metric of every asked
 * engine, read from that country's own summary. Pure. Every figure is the strip's own (`engineRates`) over the
 * prompts of one country, so a country's row equals the same page with that country chosen (R12). Engines are never
 * pooled, and a row with too few valid answers or none carries no rate: unknown is never 0.
 */

export type CountryMetric = 'mention' | 'citation' | 'share_of_voice';

export const COUNTRY_METRICS: readonly CountryMetric[] = ['mention', 'citation', 'share_of_voice'];

export const isCountryMetric = (value: string): value is CountryMetric =>
  COUNTRY_METRICS.some((metric) => metric === value);

/** The countries drawn, the ones with the most prompts; the rest are counted in the footnote. */
export const MAX_COUNTRY_GROUPS = 8;

/** Comparing markets needs two of them. */
export const MIN_COUNTRIES = 2;

const FIGURE_OF = { mention: 'mentioned', citation: 'cited', share_of_voice: 'shareOfVoice' } as const;

/** What the model needs of one country's read. */
export interface CountryRead {
  country: string;
  /** The prompt rows of the country's summary; `null` while it has not answered and when it failed. */
  prompts: readonly PromptSummaryRow[] | null;
  failed: boolean;
}

/** One engine's figure in one country: the rate with its counts, or why there is none. */
export interface EngineFigure {
  engineCode: EngineCode;
  state: RateState;
  /** Only when `state` is `ok`. */
  value: number | null;
  /** The valid answers behind the rate; for share of voice, those that name a brand. */
  answers: number;
  /** The answers that count; `null` for share of voice. */
  successes: number | null;
  /** The prompts the rate is the mean over, each counted once. */
  prompts: number;
  reason: RateReason | null;
}

export type CountryGroup =
  | {
      kind: 'ready';
      country: string;
      /** The prompts of the country in this scope. */
      prompts: number;
      /** One for each asked engine, in order. */
      rows: EngineFigure[];
    }
  | { kind: 'failed'; country: string };

export type CountryModel =
  | { kind: 'tooFewCountries'; countries: number }
  | {
      kind: 'groups';
      /** The countries with most prompts first (a tie by country code), then the countries whose read failed. */
      groups: CountryGroup[];
      /** The countries that answered and are not drawn, over `MAX_COUNTRY_GROUPS`. */
      hidden: number;
      countries: number;
    };

export interface CountryInput {
  /** The countries of the project's prompts. */
  countries: readonly string[];
  reads: readonly CountryRead[];
  asked: readonly EngineCode[];
  metric: CountryMetric;
}

const figureOf = (engineCode: EngineCode, figure: RateFigure): EngineFigure => ({
  engineCode,
  state: figure.state,
  value: figure.value,
  answers: figure.answers,
  successes: figure.successes,
  prompts: figure.prompts,
  reason: figure.reason,
});

export function countryModel({ countries, reads, asked, metric }: CountryInput): CountryModel {
  if (countries.length < MIN_COUNTRIES) return { kind: 'tooFewCountries', countries: countries.length };
  // A read that has not answered is not a group yet; the card waits for it
  const answered = reads
    .flatMap((read) => (read.prompts === null || read.failed ? [] : [{ country: read.country, prompts: read.prompts }]))
    .sort((a, b) => b.prompts.length - a.prompts.length || a.country.localeCompare(b.country));
  const shown = answered.slice(0, MAX_COUNTRY_GROUPS).map(({ country, prompts }): CountryGroup => ({
    kind: 'ready',
    country,
    prompts: prompts.length,
    rows: asked.map((code) => figureOf(code, engineRates(prompts, code)[FIGURE_OF[metric]])),
  }));
  // A failure is never cut: its group is where the person retries
  const failed = reads
    .filter((read) => read.failed)
    .map((read): CountryGroup => ({ kind: 'failed', country: read.country }));
  return {
    kind: 'groups',
    groups: [...shown, ...failed],
    hidden: answered.length - shown.length,
    countries: countries.length,
  };
}
