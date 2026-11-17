import type { useTranslations } from 'next-intl';

import { formatInteger, formatTableDate, formatTableDateTime } from '@/lib/format';
import type { RunSlot, RunWindow, RunsChoice } from '@/lib/citations/board-queries';

/** The translator of `citations`, as `useTranslations('citations')` and `createTranslator` give it. */
export type CitationsTranslate = ReturnType<typeof useTranslations<'citations'>>;

const DAY_MS = 86_400_000;

/**
 * "Sep 28": a slot's day in the project's zone. The year is left out when it is the year of the latest answer, so a
 * screen of last year's data still reads in its own year.
 */
export const slotDay = (instant: string, timeZone: string, latest: string | null): string =>
  formatTableDate(instant, timeZone, new Date(latest ?? instant));

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

/**
 * The note of a Runs choice (brief 3.2, C 116), from `window.trend` (slots 1 to 8, oldest first): 4 runs are "N days",
 * the whole days from the oldest of slots 1 to 4 to the newest plus one run's length (the median days between
 * consecutive slots), so four weekly runs read 28 days; 2 runs are "<slot 2> to <slot 1>"; 1 run is "<slot 1>". With
 * fewer slots than the choice it names those there are; `null` with none.
 */
export function runsNote(
  choice: RunsChoice,
  trend: readonly RunSlot[],
  timeZone: string,
  latest: string | null,
  t: CitationsTranslate,
): string | null {
  const bySlot = new Map(trend.map((slot) => [slot.slot, slot]));
  const held = [4, 3, 2, 1].filter((slot) => slot <= choice).flatMap((slot) => bySlot.get(slot) ?? []);
  const oldest = held[0];
  const newest = held[held.length - 1];
  if (oldest === undefined || newest === undefined) return null;
  const day = (instant: string): string => slotDay(instant, timeZone, latest);
  if (held.length === 1) return day(newest.last_at);
  if (choice === 2) return t('toolbar.noteRange', { from: day(oldest.last_at), to: day(newest.last_at) });
  const span = Math.floor((Date.parse(newest.last_at) - Date.parse(oldest.first_at)) / DAY_MS);
  const ordered = [...trend].sort((a, b) => b.slot - a.slot);
  const steps = ordered.slice(1).map((slot, index) => {
    const before = ordered[index];
    return before === undefined ? 0 : Math.round((Date.parse(slot.first_at) - Date.parse(before.first_at)) / DAY_MS);
  });
  return t('toolbar.noteDays', { count: span + median(steps) });
}

export interface PreviousText {
  /** "the previous 4 runs (Aug 10 to Aug 31)" */
  full: string;
  /** "the previous 4 runs" (C 255) */
  short: string;
}

/** What every change on the page compares with (C 99 to 104), from `window.previous`. */
export function previousText(
  runs: RunsChoice,
  previous: readonly RunSlot[],
  timeZone: string,
  latest: string | null,
  t: CitationsTranslate,
): PreviousText {
  const short =
    runs === 1
      ? t('measures.previousShort1')
      : runs === 2
        ? t('measures.previousShort2')
        : t('measures.previousShort4');
  const ordered = [...previous].sort((a, b) => b.slot - a.slot);
  const oldest = ordered[0];
  const newest = ordered[ordered.length - 1];
  if (oldest === undefined || newest === undefined) return { full: short, short };
  const from = slotDay(oldest.first_at, timeZone, latest);
  const to = slotDay(newest.last_at, timeZone, latest);
  const full =
    runs === 1
      ? t('measures.previous1', { date: to })
      : runs === 2
        ? t('measures.previous2', { from, to })
        : t('measures.previous4', { from, to });
  return { full, short };
}

export const runsLabel = (runs: RunsChoice, t: CitationsTranslate): string =>
  runs === 1 ? t('toolbar.runs1') : runs === 2 ? t('toolbar.runs2') : t('toolbar.runs4');

/** "Updated Sep 28, 02:15 · run 48" (C 189): the latest answer in scope and the project's run number. */
export function updatedText(
  window: Pick<RunWindow, 'latest_answer_at' | 'latest_run_number'>,
  timeZone: string,
  t: CitationsTranslate,
): string | null {
  const latest = window.latest_answer_at;
  if (latest === null) return null;
  const time = formatTableDateTime(latest, timeZone, new Date(latest));
  return window.latest_run_number === null
    ? t('board.updatedNoRun', { time })
    : t('board.updated', { time, run: formatInteger(window.latest_run_number) });
}

/** "<platform>, <group>, <runs label>" of the empty states (C 106 to 108). */
export const scopeText = (
  parts: { platform: string; group: string; runs: RunsChoice },
  t: CitationsTranslate,
): string =>
  t('board.scopeText', {
    platform: parts.platform,
    group: parts.group,
    runs: runsLabel(parts.runs, t),
  });
