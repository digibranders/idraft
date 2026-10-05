/**
 * Date and time formatting. Timestamps arrive in UTC and display in the project timezone;
 * business dates (YYYY-MM-DD) arrive already computed in the project timezone and are never converted.
 * Spec: docs/design-system/22-content-formatting.md section 4.
 */
import { TZDate } from '@date-fns/tz';
import { differenceInSeconds, format, parseISO } from 'date-fns';

const DEFAULT_LOCALE = 'en-US';

function toZoned(instant: Date | string, timeZone: string): TZDate {
  const d = typeof instant === 'string' ? parseISO(instant) : instant;
  return new TZDate(d.getTime(), timeZone);
}

function sameYear(a: TZDate, b: TZDate): boolean {
  return a.getFullYear() === b.getFullYear();
}

/** Short timezone name for display, e.g. "EDT", "CEST" or "GMT+5:30", depending on locale data. */
export function timeZoneAbbreviation(instant: Date | string, timeZone: string, locale = DEFAULT_LOCALE): string {
  const d = typeof instant === 'string' ? parseISO(instant) : instant;
  const part = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
    .formatToParts(d)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

/** Table timestamp: "Sep 29, 18:32". Adds the year when it differs from the current year: "Sep 29, 2025, 18:32". */
export function formatTableDateTime(instant: Date | string, timeZone: string, now: Date = new Date()): string {
  const z = toZoned(instant, timeZone);
  const n = new TZDate(now.getTime(), timeZone);
  return sameYear(z, n) ? format(z, 'MMM d, HH:mm') : format(z, 'MMM d, yyyy, HH:mm');
}

/** The calendar date of an instant in the project timezone as "2026-09-29", for a name of a file. */
export function formatIsoDate(instant: Date | string, timeZone: string): string {
  return format(toZoned(instant, timeZone), 'yyyy-MM-dd');
}

/** Detail timestamp: "Sep 29, 2026 · 18:32 EDT". Used in inspectors, detail pages and exports headers. */
export function formatDetailDateTime(instant: Date | string, timeZone: string, locale = DEFAULT_LOCALE): string {
  const z = toZoned(instant, timeZone);
  return `${format(z, 'MMM d, yyyy')} · ${format(z, 'HH:mm')} ${timeZoneAbbreviation(instant, timeZone, locale)}`;
}

/**
 * Relative time for freshness labels: "just now", "12m ago", "3h ago", "2d ago".
 * Beyond 7 days it falls back to the table date format.
 */
export function formatRelative(instant: Date | string, timeZone: string, now: Date = new Date()): string {
  const d = typeof instant === 'string' ? parseISO(instant) : instant;
  const s = differenceInSeconds(now, d);
  if (s < 0) return formatTableDateTime(d, timeZone, now);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return formatTableDateTime(d, timeZone, now);
}

/** Business date (already in project timezone): "2026-09-29" -> "Sep 29, 2026". No timezone conversion. */
export function formatBusinessDate(isoDate: string, { withYear = true }: { withYear?: boolean } = {}): string {
  const parts = isoDate.split('-').map(Number);
  const [y, m, d] = parts;
  if (y === undefined || m === undefined || d === undefined || parts.some(Number.isNaN)) return isoDate;
  const local = new Date(y, m - 1, d);
  return withYear ? format(local, 'MMM d, yyyy') : format(local, 'MMM d');
}

/** A calendar month: (2026, 9) -> "Sep 2026". `month` runs from 1 to 12. */
export function formatMonth(year: number, month: number): string {
  return format(new Date(year, month - 1, 1), 'MMM yyyy');
}

/** Chart axis date: "Sep 29"; add year on the first tick of each year (caller passes showYear). */
export function formatChartDate(isoDate: string, showYear = false): string {
  return formatBusinessDate(isoDate, { withYear: showYear });
}

/** Date range label: "Sep 1 to Sep 28, 2026" (never a dash). */
export function formatDateRange(fromIso: string, toIso: string): string {
  const fromYear = fromIso.slice(0, 4);
  const toYear = toIso.slice(0, 4);
  const from = formatBusinessDate(fromIso, { withYear: fromYear !== toYear });
  return `${from} to ${formatBusinessDate(toIso)}`;
}

/** The time zone of this browser, for times that belong to the person rather than a project (their sessions). */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** A date written the way `locale` writes it, for the format example of Settings > Preferences: "Sep 30, 2026". */
export function formatLocaleDate(instant: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(instant);
}
