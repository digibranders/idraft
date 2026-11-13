'use client';

import { useTranslations } from 'next-intl';
import { useId, type KeyboardEvent, type ReactElement } from 'react';

import { addDays, addMonths, monthWeeks, weekdayIndex, type BusinessDate } from './business-date';
import { formatBusinessDate, formatMonth } from '@/lib/format';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const LAST_WEEKDAY = WEEKDAYS.length - 1;
const MONTHS_PER_YEAR = 12;

/** Why a day cannot be picked, in words: spoken as the description of the disabled day. */
export interface DayReasons {
  /** Before `min`; `null` when `min` is `null`. */
  before: string | null;
  /** After `max`: the day is in the future, or past the longest range. */
  after: string;
}

export interface MonthGridProps {
  /** Any day of the month shown. */
  month: BusinessDate;
  /** The picked start and end (end null while only a start is picked); `hover` previews the end. */
  from: BusinessDate | null;
  to: BusinessDate | null;
  hover?: BusinessDate | null | undefined;
  /** Days outside `min` to `max` are disabled and not focusable. */
  min: BusinessDate | null;
  max: BusinessDate;
  today: BusinessDate;
  reasons: DayReasons;
  /** The roving focus day (one Tab stop in all the months shown). */
  focusDay: BusinessDate;
  /** The picker moves the shown months when it leaves them, and moves focus to the day. */
  onFocusDayChange: (day: BusinessDate) => void;
  onPick: (day: BusinessDate) => void;
  onHover?: ((day: BusinessDate | null) => void) | undefined;
}

/** Where a key moves the focus from `day`, or `null` for a key the grid does not handle. */
function moveTarget(key: string, shift: boolean, day: BusinessDate): BusinessDate | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(day, -1);
    case 'ArrowRight':
      return addDays(day, 1);
    case 'ArrowUp':
      return addDays(day, -7);
    case 'ArrowDown':
      return addDays(day, 7);
    case 'PageUp':
      return addMonths(day, shift ? -MONTHS_PER_YEAR : -1);
    case 'PageDown':
      return addMonths(day, shift ? MONTHS_PER_YEAR : 1);
    case 'Home':
      return addDays(day, -weekdayIndex(day));
    case 'End':
      return addDays(day, LAST_WEEKDAY - weekdayIndex(day));
    default:
      return null;
  }
}

/**
 * One month of days (10-forms.md section 10.1): a `grid` with Monday first, outside days hidden, 32 px day
 * cells, and the keyboard of the ARIA grid pattern with one Tab stop. It is controlled: it reports where the
 * focus should go and the picker decides which months to show and moves the focus. A day outside `min` to `max`
 * is disabled, so it cannot be focused, and says why.
 */
export function MonthGrid({
  month,
  from,
  to,
  hover,
  min,
  max,
  today,
  reasons,
  focusDay,
  onFocusDayChange,
  onPick,
  onHover,
}: MonthGridProps): ReactElement {
  const t = useTranslations('common.dateRange');
  const weekdays = useTranslations('common.weekdays');
  const reasonId = useId();
  const beforeId = `${reasonId}-before`;
  const afterId = `${reasonId}-after`;

  const [year = '', monthNumber = ''] = month.split('-');
  const caption = formatMonth(Number(year), Number(monthNumber));
  const end = to ?? (from !== null && hover != null && hover >= from ? hover : null);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, day: BusinessDate): void => {
    // Alt, Control and Command with an arrow belong to the browser (history, tabs)
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = moveTarget(event.key, event.shiftKey, day);
    if (target === null) return;
    event.preventDefault();
    const upper = target > max ? max : target;
    const next = min !== null && upper < min ? min : upper;
    if (next !== day) onFocusDayChange(next);
  };

  return (
    // The pointer leaving ends the end-date preview; role="presentation" tells assistive technology this is only layout
    <div role="presentation" className="flex w-56 shrink-0 flex-col gap-2" onMouseLeave={() => onHover?.(null)}>
      {/* As tall as the month buttons of the picker, which sit at its ends; the grid is named by the same text */}
      <p aria-hidden="true" className="flex h-8 items-center justify-center type-subsection-title">
        {caption}
      </p>
      {/* Divs, not a table with a grid role: the lint rules allow that role on the data table only */}
      <div role="grid" aria-label={caption} className="flex flex-col">
        <div role="row" className="grid grid-cols-7">
          {WEEKDAYS.map((weekday) => (
            <div
              key={weekday}
              role="columnheader"
              aria-label={weekdays(weekday)}
              className="flex size-8 items-center justify-center type-meta"
            >
              {t(`weekdaysShort.${weekday}`)}
            </div>
          ))}
        </div>
        {monthWeeks(month).map((week, row) => (
          <div key={row} role="row" className="grid grid-cols-7">
            {week.map((day, column) => {
              if (day === null) return <div key={column} role="presentation" className="size-8" />;
              const disabled = day > max || (min !== null && day < min);
              const edge = day === from || day === end;
              const between = from !== null && end !== null && day > from && day < end;
              const selected = from !== null && to !== null ? day >= from && day <= to : from !== null && day === from;
              const reason = !disabled
                ? undefined
                : day > max
                  ? afterId
                  : reasons.before === null
                    ? undefined
                    : beforeId;
              const dayName = t('day', {
                weekday: weekdays(WEEKDAYS[weekdayIndex(day)] ?? 'monday'),
                date: formatBusinessDate(day),
              });
              return (
                <div key={day} role="gridcell" aria-selected={selected}>
                  <button
                    type="button"
                    data-day={day}
                    aria-label={dayName}
                    aria-current={day === today ? 'date' : undefined}
                    aria-describedby={reason}
                    disabled={disabled}
                    tabIndex={day === focusDay ? 0 : -1}
                    onClick={() => onPick(day)}
                    onKeyDown={(event) => onKeyDown(event, day)}
                    onFocus={() => {
                      if (day !== focusDay) onFocusDayChange(day);
                    }}
                    onMouseEnter={() => onHover?.(day)}
                    className={cn(
                      'size-8 rounded-md num type-body text-foreground focus-visible:focus-ring-inset',
                      disabled ? 'cursor-not-allowed text-foreground-disabled' : 'hover:bg-surface-hover',
                      between && 'rounded-none bg-primary-subtle',
                      day === today && 'type-body-strong text-primary-text',
                      edge && 'bg-primary text-primary-foreground hover:bg-primary',
                    )}
                  >
                    {Number(day.slice(8))}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <span id={afterId} hidden>
        {reasons.after}
      </span>
      {reasons.before === null ? null : (
        <span id={beforeId} hidden>
          {reasons.before}
        </span>
      )}
    </div>
  );
}
