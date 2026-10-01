import type { components } from '@/lib/api/schema';

/**
 * Keyword metrics as the API builds them (backend `keywords/metric_values.py` and
 * `domain/keyword_metrics.py`): a year of monthly volumes with the trend (least-squares slope over the
 * mean, percent a month) and seasonality (each month over the mean; seasonal above 1.5 and below 0.67),
 * and the metric contract's `MetricValue` for the volume. The mocks make the months from a keyword's
 * average volume, deterministically, so a keyword reads the same on every request.
 */

type KeywordMetrics = components['schemas']['KeywordMetrics'];
type MetricValue = components['schemas']['MetricValue'];
type MetricsHistory = components['schemas']['KeywordMetricsHistory'];
type MonthlySearches = components['schemas']['MonthlySearches'];

export interface LabsReading {
  keywordId: string;
  locationId: number;
  languageCode: string;
  volume: number;
  difficulty: number;
  /** USD, as a decimal string. */
  cpc: string;
  intent: string;
  fetchedAt: string;
}

const TREND_MONTHS = 12;
const TREND_MONTHS_MIN = 3;
const SEASONAL_HIGH = 1.5;
const SEASONAL_LOW = 0.67;
const SEASONALITY_METHOD =
  "Each month's search volume divided by the mean of the last 12 months; seasonal when the highest index is above 1.5 and the lowest below 0.67";
const TREND_METHOD =
  'Linear regression slope of the last 12 monthly search volumes, divided by their mean (a fraction a month); a fitted value, so no numerator or denominator';
/** The last month Labs reports in the mocks: the data month of every fixture reading. */
const DATA_YEAR = 2026;
const DATA_MONTH = 8;

/** A small number from a text, the same on every run, to vary the months of one keyword from another. */
function seedOf(text: string): number {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619);
  return (hash >>> 0) / 4294967295;
}

/**
 * Twelve months ending with the data month, oldest first, averaging `volume`: a gentle trend up or down and
 * a seasonal swing for about a quarter of the keywords.
 */
export function monthsOf(seed: string, volume: number): MonthlySearches[] {
  const random = seedOf(seed);
  const slope = (random - 0.5) * 0.04;
  const swing = random > 0.75 ? 0.6 : 0.12;
  const peak = Math.floor(random * 1000) % 12;
  return Array.from({ length: TREND_MONTHS }, (_, offset) => {
    const step = offset - (TREND_MONTHS - 1);
    const monthIndex = (((DATA_MONTH - 1 + step) % 12) + 12) % 12;
    const year = DATA_YEAR + Math.floor((DATA_MONTH - 1 + step) / 12);
    const season = 1 + swing * Math.cos(((monthIndex - peak) / 12) * 2 * Math.PI);
    const level = 1 + slope * (offset - (TREND_MONTHS - 1) / 2);
    return { year, month: monthIndex + 1, search_volume: Math.max(0, Math.round(volume * season * level)) };
  });
}

const known = (months: readonly MonthlySearches[]): number[] =>
  months.flatMap((month) => (month.search_volume === null ? [] : [month.search_volume])).slice(-TREND_MONTHS);

/** Percent a month, or `null` with fewer than three months or a mean of zero. */
export function trendPctPerMonth(months: readonly MonthlySearches[]): number | null {
  const volumes = known(months);
  if (volumes.length < TREND_MONTHS_MIN) return null;
  const mean = volumes.reduce((sum, value) => sum + value, 0) / volumes.length;
  if (mean === 0) return null;
  const middle = (volumes.length - 1) / 2;
  let covariance = 0;
  let variance = 0;
  volumes.forEach((value, x) => {
    covariance += (x - middle) * (value - mean);
    variance += (x - middle) ** 2;
  });
  return (covariance / variance / mean) * 100;
}

/** Each month's index and whether the keyword is seasonal; empty and `null` without twelve months. */
export function seasonalityOf(months: readonly MonthlySearches[]): {
  index: Map<number, number>;
  seasonal: boolean | null;
} {
  const year = months.filter((month) => month.search_volume !== null).slice(-TREND_MONTHS);
  if (year.length < TREND_MONTHS) return { index: new Map(), seasonal: null };
  const mean = year.reduce((sum, month) => sum + (month.search_volume ?? 0), 0) / TREND_MONTHS;
  if (mean === 0) return { index: new Map(), seasonal: null };
  const index = new Map(year.map((month) => [month.month, (month.search_volume ?? 0) / mean]));
  const values = [...index.values()];
  return { index, seasonal: Math.max(...values) > SEASONAL_HIGH && Math.min(...values) < SEASONAL_LOW };
}

const monthEnd = (year: number, month: number): string => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

function windowOf(months: readonly MonthlySearches[]): MetricValue['window'] {
  const first = months[0];
  const last = months.at(-1);
  if (first === undefined || last === undefined) {
    return { from: `${String(DATA_YEAR)}-08-01`, to: `${String(DATA_YEAR)}-08-31`, timezone: 'UTC' };
  }
  return {
    from: `${String(first.year)}-${String(first.month).padStart(2, '0')}-01`,
    to: monthEnd(last.year, last.month),
    timezone: 'UTC',
  };
}

const filtersOf = (reading: LabsReading): Record<string, unknown> => ({
  location_id: reading.locationId,
  language_code: reading.languageCode,
});

/** The search volume in the metric contract: a provider estimate over the year's window. */
export function searchVolumeValue(reading: LabsReading, months: readonly MonthlySearches[]): MetricValue {
  return {
    metric: 'seo.search_volume',
    value: reading.volume,
    numerator: null,
    denominator: null,
    unit: 'count',
    n_observations: 1,
    n_keywords: 1,
    window: windowOf(months),
    filters: filtersOf(reading),
    is_estimate: true,
    method: 'Provider-reported average monthly search volume (DataForSEO Labs), annual average',
    method_version: 1,
    source: 'dataforseo_labs',
  };
}

const dataMonth = `${String(DATA_YEAR)}-${String(DATA_MONTH).padStart(2, '0')}-01`;

/** Labs' current metrics for a keyword at a location and language. */
export function keywordMetrics(reading: LabsReading): KeywordMetrics {
  const months = monthsOf(reading.keywordId + String(reading.locationId), reading.volume);
  const level = reading.difficulty < 34 ? 'LOW' : reading.difficulty < 67 ? 'MEDIUM' : 'HIGH';
  return {
    source: 'dataforseo_labs',
    location_id: reading.locationId,
    language_code: reading.languageCode,
    fetched_at: reading.fetchedAt,
    data_month: dataMonth,
    search_volume: searchVolumeValue(reading, months),
    cpc_usd: reading.cpc,
    competition: Math.round(reading.difficulty) / 100,
    competition_level: level,
    keyword_difficulty: reading.difficulty,
    intent_main: reading.intent,
    trend_pct_per_month: trendPctPerMonth(months),
    is_seasonal: seasonalityOf(months).seasonal,
  };
}

/** The metrics history: one snapshot (the fixtures have one reading each) with its trend and seasonality. */
export function metricsHistory(reading: LabsReading | null, snapshotId: string): MetricsHistory {
  const months = reading === null ? [] : monthsOf(reading.keywordId + String(reading.locationId), reading.volume);
  const trend = trendPctPerMonth(months);
  const { index, seasonal } = seasonalityOf(months);
  return {
    snapshots:
      reading === null
        ? []
        : [
            {
              snapshot_id: snapshotId,
              fetched_at: reading.fetchedAt,
              data_month: dataMonth,
              search_volume: reading.volume,
              monthly_searches: months,
              cpc_usd: reading.cpc,
              keyword_difficulty: reading.difficulty,
              is_material_change: true,
            },
          ],
    trend: {
      metric: 'seo.search_volume_trend',
      value: trend === null ? null : trend / 100,
      numerator: null,
      denominator: null,
      unit: 'ratio',
      n_observations: known(months).length,
      n_keywords: 1,
      window: windowOf(months),
      filters: reading === null ? {} : filtersOf(reading),
      is_estimate: true,
      method: TREND_METHOD,
      method_version: 1,
      source: 'dataforseo_labs',
    },
    seasonality: {
      index_by_month: [...index.entries()].sort(([a], [b]) => a - b).map(([month, value]) => ({ month, index: value })),
      is_seasonal: seasonal,
      method: SEASONALITY_METHOD,
    },
  };
}
