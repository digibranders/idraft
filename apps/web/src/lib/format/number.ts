/**
 * Number formatting. The only permitted way to turn a number into display text.
 * Spec: docs/design-system/22-content-formatting.md section 2.
 */

export const MINUS = '−'; // typographic minus sign, same advance width as "+" in tabular figures
export const EMPTY_VALUE = 'n/a';

const DEFAULT_LOCALE = 'en-US';

export type NumberContext = 'table' | 'summary' | 'axis' | 'tooltip';

export interface FormatOptions {
  locale?: string;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function withMinus(text: string): string {
  return text.startsWith('-') ? MINUS + text.slice(1) : text;
}

/** Exact integer with grouping: 1240 -> "1,240". Used in tables and tooltips. */
export function formatInteger(value: number | null | undefined, opts: FormatOptions = {}): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE;
  return withMinus(
    new Intl.NumberFormat(opts.locale ?? DEFAULT_LOCALE, { maximumFractionDigits: 0 }).format(Math.round(value)),
  );
}

/**
 * Compact count: 12400 -> "12.4K", 1240000 -> "1.24M". Three significant digits.
 * Values below 10,000 are always exact ("9,870"), so small counts never lose precision.
 */
export function formatCompact(value: number | null | undefined, opts: FormatOptions = {}): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE;
  if (Math.abs(value) < 10_000) return formatInteger(value, opts);
  return withMinus(
    new Intl.NumberFormat(opts.locale ?? DEFAULT_LOCALE, {
      notation: 'compact',
      maximumSignificantDigits: 3,
    }).format(value),
  );
}

/** Count formatted for a display context: tables and tooltips exact, summaries and axes compact. */
export function formatCount(
  value: number | null | undefined,
  context: NumberContext,
  opts: FormatOptions = {},
): string {
  return context === 'table' || context === 'tooltip' ? formatInteger(value, opts) : formatCompact(value, opts);
}

/**
 * Ratio (0..1) as percent: 0.472 -> "47.2%".
 * Default one decimal; `decimals: 0` for headline values whose interval half-width is 2 points or more
 * (docs/20-frontend-specification.md section 3.11).
 */
export function formatPercent(
  ratio: number | null | undefined,
  { decimals = 1, locale }: FormatOptions & { decimals?: 0 | 1 | 2 } = {},
): string {
  if (!isFiniteNumber(ratio)) return EMPTY_VALUE;
  return withMinus(
    new Intl.NumberFormat(locale ?? DEFAULT_LOCALE, {
      style: 'percent',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(ratio),
  );
}

/**
 * Change of a rate in percentage points: 0.053 -> "+5.3 pts". Zero renders "0 pts" without sign.
 * Rates always change in points, never in relative percent, to avoid "+50%" for 2% -> 3%.
 */
export function formatPointsDelta(
  deltaRatio: number | null | undefined,
  { decimals = 1 }: { decimals?: 0 | 1 } = {},
): string {
  if (!isFiniteNumber(deltaRatio)) return EMPTY_VALUE;
  const points = deltaRatio * 100;
  const rounded = Number(points.toFixed(decimals));
  if (rounded === 0) return '0 pts';
  const abs = Math.abs(rounded).toFixed(decimals);
  return `${rounded > 0 ? '+' : MINUS}${abs} pts`;
}

/** Signed integer delta: 3 -> "+3", -12 -> "−12", 0 -> "0". For counts, not ranks. */
export function formatSignedInteger(value: number | null | undefined, opts: FormatOptions = {}): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE;
  const rounded = Math.round(value);
  if (rounded === 0) return '0';
  const body = formatInteger(Math.abs(rounded), opts);
  return `${rounded > 0 ? '+' : MINUS}${body}`;
}

/** Relative change for counts and money (not rates): 0.124 -> "+12.4%". */
export function formatRelativeChange(
  ratio: number | null | undefined,
  { decimals = 1 }: { decimals?: 0 | 1 } = {},
): string {
  if (!isFiniteNumber(ratio)) return EMPTY_VALUE;
  const pct = Number((ratio * 100).toFixed(decimals));
  if (pct === 0) return '0%';
  return `${pct > 0 ? '+' : MINUS}${Math.abs(pct).toFixed(decimals)}%`;
}

/**
 * USD. Two decimals from $0.01 upward ("$24.18"); four decimals below one cent ("$0.0042");
 * compact above $100,000 in summary contexts only.
 */
export function formatCurrency(
  usd: number | null | undefined,
  { context = 'table', locale }: FormatOptions & { context?: NumberContext } = {},
): string {
  if (!isFiniteNumber(usd)) return EMPTY_VALUE;
  const abs = Math.abs(usd);
  const fmt = (options: Intl.NumberFormatOptions) =>
    withMinus(
      new Intl.NumberFormat(locale ?? DEFAULT_LOCALE, { style: 'currency', currency: 'USD', ...options }).format(usd),
    );
  if (abs > 0 && abs < 0.01) return fmt({ minimumFractionDigits: 4, maximumFractionDigits: 4 });
  if ((context === 'summary' || context === 'axis') && abs >= 100_000) {
    return fmt({ notation: 'compact', maximumSignificantDigits: 3 });
  }
  return fmt({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * USD price of one unit, as a price book lists it: at least two decimals and as many as six when the price
 * needs them, so $0.012 stays $0.012 and is never rounded to a cent (23 section 11.4).
 */
export function formatUnitPrice(usd: number | null | undefined, { locale }: FormatOptions = {}): string {
  if (!isFiniteNumber(usd)) return EMPTY_VALUE;
  return withMinus(
    new Intl.NumberFormat(locale ?? DEFAULT_LOCALE, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(usd),
  );
}

/** Decimal with fixed precision for scores and estimates: 0.0421 -> "0.042". */
export function formatDecimal(
  value: number | null | undefined,
  digits: 1 | 2 | 3 = 3,
  opts: FormatOptions = {},
): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE;
  return withMinus(
    new Intl.NumberFormat(opts.locale ?? DEFAULT_LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value),
  );
}

/** Interval text for confidence intervals: (0.29, 0.39) -> "29% to 39%". Never uses a dash. */
export function formatInterval(
  low: number | null | undefined,
  high: number | null | undefined,
  decimals: 0 | 1 = 0,
): string {
  if (!isFiniteNumber(low) || !isFiniteNumber(high)) return EMPTY_VALUE;
  return `${formatPercent(low, { decimals })} to ${formatPercent(high, { decimals })}`;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;
const BYTES_PER_UNIT = 1024;

/** File size in binary units, one decimal below 10 and none above: 1536 -> "1.5 KB", 52428800 -> "50 MB". */
export function formatBytes(bytes: number | null | undefined, opts: FormatOptions = {}): string {
  if (!isFiniteNumber(bytes) || bytes < 0) return EMPTY_VALUE;
  let size = bytes;
  let unit = 0;
  while (size >= BYTES_PER_UNIT && unit < BYTE_UNITS.length - 1) {
    size /= BYTES_PER_UNIT;
    unit += 1;
  }
  const digits = unit > 0 && size < 10 ? 1 : 0;
  const text = new Intl.NumberFormat(opts.locale ?? DEFAULT_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(size);
  return `${text} ${BYTE_UNITS[unit] ?? 'B'}`;
}

/** Sample count text: (612, 1800) -> "612 of 1,800". */
export function formatSampleCount(k: number | null | undefined, n: number | null | undefined): string {
  if (!isFiniteNumber(k) || !isFiniteNumber(n)) return EMPTY_VALUE;
  return `${formatInteger(k)} of ${formatInteger(n)}`;
}
