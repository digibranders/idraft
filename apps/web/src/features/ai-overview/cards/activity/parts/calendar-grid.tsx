'use client';

import { Receipt, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { CalendarCell, CalendarWeek } from '../model/calendar-model';
import { WEEKDAYS } from '../model/schedule-days';
import { useDayText, useWeekdayName } from './daily-table';
import { SEQUENTIAL_BINS, sequentialBin, type HeatBinKey } from '@/components/app/chart/heat-bins';
import { Icon } from '@/components/ui/icon';
import { Tooltip } from '@/components/ui/tooltip';
import { formatChartDate, formatInteger } from '@/lib/format';
import { cn } from '@/lib/utils';

/*
 * The calendar of CH-20 as a table: weekdays are rows, weeks are columns. `HeatmapGrid` was tried first and cannot
 * carry this card: its cell is a rate with one line of text, and it has no cell for a day with no known schedule, for
 * the failure count or for the glyph of a budget-blocked run. The fills still come from the one bin function of
 * `heat-bins.ts` (a second table of bins would fail its guard test), so the same colour means the same rate here as on
 * every heat-map.
 */

/** The words of each bin, from the heat-map's own key (`chart.heatmap.bins`): the key names the bounds once. */
const BIN_WORDS = {
  seq1: 'bins.seq1',
  seq2: 'bins.seq2',
  seq3: 'bins.seq3',
  seq4: 'bins.seq4',
  seq5: 'bins.seq5',
  seq6: 'bins.seq6',
  seq7: 'bins.seq7',
  divNeg3: 'bins.divNeg3',
  divNeg2: 'bins.divNeg2',
  divNeg1: 'bins.divNeg1',
  divZero: 'bins.divZero',
  divPos1: 'bins.divPos1',
  divPos2: 'bins.divPos2',
  divPos3: 'bins.divPos3',
} as const satisfies Record<HeatBinKey, string>;

const SWATCH = 'size-4 shrink-0 rounded-xs border border-border-subtle forced-color-adjust-none';
/** A day with no rate (no schedule known, nothing planned): the surface, with a hairline like the other cells. */
const NO_RATE = 'bg-surface text-foreground';
/** The look of a cell: the fill of its bin and the text colour measured for that fill. */
function lookOf(cell: CalendarCell): string {
  if (cell.state.kind !== 'rate') return NO_RATE;
  const bin = sequentialBin(cell.state.rate);
  return `${bin.fill} ${bin.text}`;
}

/** The name of a day, with its counts: what a screen reader reads in the cell and what the tooltip says. */
export function useCellLabel(): (cell: CalendarCell) => string {
  const t = useTranslations('aiOverview.activity.calendar');
  const dayText = useDayText();
  return (cell) => {
    const { counts } = cell;
    const parts: string[] = [];
    if (cell.state.kind === 'rate') {
      parts.push(
        t('cellRate', { valid: formatInteger(counts.valid), scheduled: formatInteger(counts.scheduled ?? 0) }),
      );
    } else {
      parts.push(t(cell.state.kind === 'unknown' ? 'cellUnknown' : 'cellNothing'));
      if (counts.answers > 0) {
        parts.push(t('cellCollected', { answers: formatInteger(counts.answers), valid: formatInteger(counts.valid) }));
      }
    }
    if (counts.empty > 0) parts.push(t('cellEmpty', { count: formatInteger(counts.empty) }));
    if (counts.refused > 0) parts.push(t('cellRefused', { count: formatInteger(counts.refused) }));
    if (counts.error > 0) parts.push(t('cellError', { count: counts.error }));
    if (counts.budgetBlocked > 0) parts.push(t('cellBlocked', { count: counts.budgetBlocked }));
    return t('cellLabel', { day: dayText(counts.date), parts: parts.join(', ') });
  };
}

export interface CalendarGridProps {
  /** Names the table and its scrolling region: "Collection calendar for ChatGPT, ...". */
  caption: string;
  weeks: readonly CalendarWeek[];
}

/**
 * The cells carry the rate as their fill, and the failures and the budget-blocked runs as a glyph each (the failure
 * glyph with its count). The fill never stands alone: every cell with a day in it has its counts in words as its
 * accessible name and tooltip, and the key below names each fill and glyph. On a narrow screen the table scrolls inside
 * its own region, never the page.
 */
export function CalendarGrid({ caption, weeks }: CalendarGridProps): ReactElement {
  const t = useTranslations('aiOverview.activity.calendar');
  const weekdayName = useWeekdayName();
  const heatmap = useTranslations('chart.heatmap');
  const labelOf = useCellLabel();
  return (
    <div className="flex flex-col gap-3">
      {/* A region that scrolls takes the keyboard and a name, so the weeks past the edge can be reached */}
      <div
        role="region"
        aria-label={caption}
        tabIndex={0}
        className="min-w-0 overflow-x-auto rounded-md outline-none focus-visible:focus-ring"
      >
        <table className="min-w-max border-separate border-spacing-0.5">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <td />
              {weeks.map((week) => (
                <th
                  key={week.start}
                  scope="col"
                  aria-label={t('weekOf', { date: formatChartDate(week.start) })}
                  className="px-1 text-center type-micro font-normal text-foreground-secondary"
                >
                  {formatChartDate(week.start)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAYS.map((weekday, place) => (
              <tr key={weekday}>
                <th scope="row" className="pr-2 text-left type-micro font-normal text-foreground-secondary">
                  {weekdayName(weekday)}
                </th>
                {weeks.map((week) => {
                  const cell = week.cells[place] ?? null;
                  if (cell === null) return <td key={week.start} aria-hidden="true" />;
                  const label = labelOf(cell);
                  return (
                    <Tooltip key={week.start} content={label} purpose="label">
                      <td
                        aria-label={label}
                        className={cn(
                          'h-5 min-w-10 rounded-xs border border-border-subtle p-0 text-center align-middle type-micro',
                          lookOf(cell),
                        )}
                      >
                        <span aria-hidden="true" className="flex items-center justify-center gap-1">
                          {cell.counts.failures > 0 ? (
                            <span data-glyph="failure" className="inline-flex items-center gap-0.5 num">
                              <Icon icon={TriangleAlert} size="xs" />
                              {formatInteger(cell.counts.failures)}
                            </span>
                          ) : null}
                          {cell.counts.budgetBlocked > 0 ? (
                            <span data-glyph="budget-blocked" className="inline-flex items-center">
                              <Icon icon={Receipt} size="xs" />
                            </span>
                          ) : null}
                        </span>
                      </td>
                    </Tooltip>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={t('keyLabel')} className="flex flex-wrap items-center gap-x-4 gap-y-1 type-meta">
        {SEQUENTIAL_BINS.map((bin) => (
          <li key={bin.key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn(SWATCH, bin.fill)} />
            {heatmap(BIN_WORDS[bin.key])}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn(SWATCH, NO_RATE)} />
          {t('keyUnknown')}
        </li>
        <li className="flex items-center gap-1.5">
          <Icon icon={TriangleAlert} size="sm" />
          {t('keyFailures')}
        </li>
        <li className="flex items-center gap-1.5">
          <Icon icon={Receipt} size="sm" />
          {t('keyBlocked')}
        </li>
      </ul>
    </div>
  );
}
