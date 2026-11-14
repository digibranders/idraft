'use client';

import { Calendar, Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';

import { addDays, addMonths, isBusinessDate, monthStart, type BusinessDate } from './business-date';
import { MonthGrid, type DayReasons, type MonthGridProps } from './month-grid';
import {
  checkRange,
  firstDay,
  firstDayKnown,
  lastEnd,
  limitDaysOf,
  PRESET_DAYS,
  RANGE_PRESETS,
  resolveRange,
  type DateRangeValue,
  type RangeLimits,
  type RangePreset,
  type RangeProblem,
  type ResolvedRange,
} from './range-model';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Popover } from '@/components/ui/popover';
import { Tooltip } from '@/components/ui/tooltip';
import { announce } from '@/lib/a11y/announcer';
import { useMediaQuery } from '@/lib/dom/use-media-query';
import { formatBusinessDate, formatDateRange } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * 768 px, the `md` breakpoint of the classes below: from it the calendar shows two months (the one before the end
 * month is `max-md:hidden`), below it one. CSS decides what is drawn; this says what is visible, for the month
 * buttons and the month that keyboard focus needs in view. Until the client has read it (the server, hydration)
 * it answers narrow, and the calendar is not in the page then.
 */
const TWO_MONTHS = '(width >= 48rem)';

export interface DateRangePickerProps extends RangeLimits {
  value: DateRangeValue;
  onValueChange: (value: DateRangeValue) => void;
  /** The project's IANA zone, for the note "Dates in Europe/Berlin" (`today` is already a day of it). */
  timeZone: string;
  /** `md` (36 px) in the top bar, `sm` (32 px) in forms. Default `md`. */
  size?: 'sm' | 'md' | undefined;
}

interface Draft {
  from: string;
  to: string;
}

const draftOf = (range: ResolvedRange): Draft => ({ from: range.from, to: range.to });

/** Which of the two fields a problem is about, for `aria-invalid`. */
function fieldsOf(problem: RangeProblem | null): Readonly<Record<keyof Draft, boolean>> {
  if (problem === null) return { from: false, to: false };
  switch (problem.code) {
    case 'invalid':
      return { from: problem.field === 'from', to: problem.field === 'to' };
    case 'before_start':
      return { from: true, to: false };
    case 'future':
      return { from: false, to: true };
    case 'order':
    case 'too_long':
      return { from: true, to: true };
  }
}

interface TriggerProps extends Omit<ButtonProps, 'children' | 'className' | 'aria-label' | 'variant' | 'size'> {
  accessibleName: string;
  long: string;
  short: string;
  tooltip: string;
  zoneNote: string;
  size: 'sm' | 'md';
}

/** The button. It passes the popover's props and ref on to the button, as a popover trigger must. */
function PickerTrigger({ accessibleName, long, short, tooltip, zoneNote, size, ...props }: TriggerProps): ReactElement {
  return (
    <Tooltip content={tooltip} detail={zoneNote} side="bottom" purpose="label">
      <Button variant="secondary" size={size} aria-label={accessibleName} {...props}>
        <Icon icon={Calendar} className="hidden text-foreground-tertiary sm:block" />
        {/* Both forms are in the page and CSS picks one at 640 px, so the server and the client render the same */}
        <span className="hidden sm:inline">{long}</span>
        <span className="sm:hidden">{short}</span>
        <Icon icon={ChevronDown} size="sm" className="text-foreground-tertiary" />
      </Button>
    </Tooltip>
  );
}

/**
 * The date range of a page, in the top bar (10-forms.md section 10.2): a button that names the range, and a popover
 * with the presets (7, 28 and 90 days) and a custom range. The custom range has a typed start and end and a
 * calendar; nothing applies until "Apply". Every day is a project day (`today` and `timeZone` come from the
 * project; the component never reads the clock). A range longer than the limit, before the first day with data,
 * after today, or in the wrong order is refused with the reason in words: nothing is clamped silently.
 */
export function DateRangePicker({
  value,
  onValueChange,
  timeZone,
  size = 'md',
  today,
  earliest,
  maxDays,
}: DateRangePickerProps): ReactElement {
  const t = useTranslations('common.dateRange');
  const common = useTranslations('common');
  const limits: RangeLimits = { today, earliest, maxDays };
  const limitDays = limitDaysOf(limits);
  const range = resolveRange(value, today);
  const resolvedText = formatDateRange(range.from, range.to);
  const label = value.kind === 'preset' ? t('lastDays', { days: PRESET_DAYS[value.preset] }) : resolvedText;
  const shortLabel = t('short', { days: range.days });
  // The button shows the long form from 640 px and the short one below it: the name holds both, so what a person
  // sees (and says to a voice control) is in the name at every width (WCAG 2.5.3)
  const named = `${t('namePrefix')} ${label} (${shortLabel})`;
  const name = value.kind === 'preset' ? `${named}, ${resolvedText}` : named;
  const twoMonths = useMediaQuery(TWO_MONTHS);

  const ids = useId();
  const fromId = `${ids}-from`;
  const toId = `${ids}-to`;
  const noteId = `${ids}-note`;
  const presetsId = `${ids}-presets`;
  const limitId = `${ids}-limit`;

  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(value.kind === 'custom');
  const [draft, setDraft] = useState<Draft>(() => draftOf(range));
  const [touched, setTouched] = useState<Readonly<Record<keyof Draft, boolean>>>({ from: false, to: false });
  /** The month in the second grid; the first shows the month before it. */
  const [anchor, setAnchor] = useState<BusinessDate>(() => monthStart(range.to));
  const [focusDay, setFocusDay] = useState<BusinessDate>(range.to);
  const [hover, setHover] = useState<BusinessDate | null>(null);

  const appliedRef = useRef<HTMLButtonElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const focusAfterRender = useRef(false);
  const startAfterRender = useRef(false);

  const fromText = draft.from.trim();
  const toText = draft.to.trim();
  const fromDay = isBusinessDate(fromText) ? fromText : null;
  const toDay = isBusinessDate(toText) ? toText : null;
  const problem = checkRange(fromText, toText, limits);
  // A format problem waits until the field is left; the others are known as soon as both dates are
  const shown = problem !== null && (problem.code !== 'invalid' || touched[problem.field]) ? problem : null;
  const invalid = fieldsOf(shown);

  const problemWords = (found: RangeProblem): string => {
    switch (found.code) {
      case 'invalid':
        return t('invalid');
      case 'order':
        return t('order');
      case 'future':
        return t('future', { date: formatBusinessDate(found.today) });
      case 'before_start':
        return t(found.known ? 'beforeStart' : 'beforeFirst', { date: formatBusinessDate(found.earliest) });
      case 'too_long':
        return t('tooLong', { days: found.days, max: found.max });
    }
  };

  // While only a start is picked, the second pick is held to the cap in both directions: no later than the start
  // plus the cap, and no earlier than the start minus it (a second pick before the start swaps the two)
  const picking = fromDay !== null && toDay === null;
  const gridMax = picking ? lastEnd(fromDay, limits) : today;
  // The grids stop at the first day with data, or at the first business date (2000-01-01) when there is none:
  // a month before it cannot be drawn
  const first = firstDay(limits);
  const spanMin = picking ? addDays(fromDay, 1 - limitDays) : first;
  const gridMin = spanMin > first ? spanMin : first;
  const startLimited = gridMin > first;
  const beforeWords = startLimited
    ? t('startLimited', { date: formatBusinessDate(gridMin), max: limitDays })
    : t(firstDayKnown(limits) ? 'beforeStart' : 'beforeFirst', { date: formatBusinessDate(gridMin) });
  const endWords = t('endLimited', { date: formatBusinessDate(gridMax), max: limitDays });
  const reasons: DayReasons = {
    before: beforeWords,
    after: gridMax < today ? endWords : t('future', { date: formatBusinessDate(today) }),
  };
  const limitWords = [gridMax < today ? endWords : null, startLimited ? beforeWords : null].filter(
    (words): words is string => words !== null,
  );
  const noteWords =
    shown !== null
      ? problemWords(shown)
      : limitWords.length > 0
        ? limitWords.join(' ')
        : t('limit', { max: limitDays });
  const clampDay = (day: BusinessDate): BusinessDate => (day > gridMax ? gridMax : day < gridMin ? gridMin : day);
  // The one Tab stop is always a day the grids can focus
  const tabDay = clampDay(focusDay);

  const spoken = open && shown !== null ? problemWords(shown) : null;
  useEffect(() => {
    if (spoken !== null) announce(spoken, { key: 'date-range-problem' });
  }, [spoken]);

  useEffect(() => {
    if (customOpen && startAfterRender.current) {
      startAfterRender.current = false;
      fromRef.current?.focus();
    }
  }, [customOpen]);

  // Keyboard focus follows the focus day, in whichever month it is (`showDay` has put that month in view)
  useEffect(() => {
    if (!focusAfterRender.current) return;
    focusAfterRender.current = false;
    paneRef.current?.querySelector<HTMLButtonElement>(`button[data-day="${tabDay}"]`)?.focus();
  }, [tabDay, anchor]);

  /**
   * Puts the month of `day` in view, moving the months by the least. Two months are in view from 768 px (the
   * month of the end is the second); below it only the second is, and a day of the first month hidden there
   * cannot take focus, so its month becomes the one shown.
   */
  const showDay = (day: BusinessDate): void => {
    const month = monthStart(day);
    const last = monthStart(today);
    setAnchor((current) => {
      if (month === current || (twoMonths && month === monthStart(addMonths(current, -1)))) return current;
      const next = month > current || !twoMonths ? month : addMonths(month, 1);
      return next > last ? last : next;
    });
  };

  const moveFocus = (day: BusinessDate): void => {
    setFocusDay(day);
    showDay(day);
    focusAfterRender.current = true;
  };

  const navigate = (months: 1 | -1): void => {
    focusAfterRender.current = false;
    setAnchor((current) => addMonths(current, months));
    // The Tab stop moves with the months, so it stays in view (and never leaves the days the grids have)
    setFocusDay((current) => clampDay(addMonths(current, months)));
  };

  const type = (field: keyof Draft, text: string): void => {
    setDraft((current) => ({ ...current, [field]: text }));
    const day = text.trim();
    if (isBusinessDate(day) && day <= today) {
      setFocusDay(day);
      showDay(day);
    }
  };

  const pick = (day: BusinessDate): void => {
    setHover(null);
    // The first pick starts a range, the second ends it (before the start, it swaps), the next starts another
    if (fromDay === null || toDay !== null) {
      setDraft({ from: day, to: '' });
      return;
    }
    const first = day < fromDay ? day : fromDay;
    const last = day < fromDay ? fromDay : day;
    setDraft({ from: first, to: last });
    announce(`${t('namePrefix')} ${formatDateRange(first, last)}`, { key: 'date-range-pick' });
  };

  const handleOpenChange = (next: boolean): void => {
    if (next) {
      setDraft(draftOf(range));
      setTouched({ from: false, to: false });
      setAnchor(monthStart(range.to));
      setFocusDay(range.to);
      setHover(null);
      setCustomOpen(value.kind === 'custom');
    }
    setOpen(next);
  };

  const choose = (preset: RangePreset): void => {
    onValueChange({ kind: 'preset', preset });
    announce(`${t('namePrefix')} ${t('lastDays', { days: PRESET_DAYS[preset] })}`, { key: 'date-range' });
    setOpen(false);
  };

  const apply = (): void => {
    if (problem !== null) return;
    onValueChange({ kind: 'custom', from: fromText, to: toText });
    announce(`${t('namePrefix')} ${formatDateRange(fromText, toText)}`, { key: 'date-range' });
    setOpen(false);
  };

  const showCustom = (): void => {
    if (customOpen) fromRef.current?.focus();
    else {
      startAfterRender.current = true;
      setCustomOpen(true);
    }
  };

  const gridProps: Omit<MonthGridProps, 'month'> = {
    from: fromDay,
    to: toDay,
    hover,
    min: gridMin,
    max: gridMax,
    today,
    reasons,
    focusDay: tabDay,
    onFocusDayChange: moveFocus,
    onPick: pick,
    onHover: setHover,
  };
  const firstMonth = addMonths(anchor, -1);
  // Previous stops when the earliest month in VIEW is the first with days: the month before the end month is in
  // view from 768 px, and on a phone it is hidden, so it does not count there
  const previousDisabled = monthStart(twoMonths ? firstMonth : anchor) <= monthStart(gridMin);
  const nextDisabled = anchor >= monthStart(today);
  // The month before the first with days is not drawn (it could not be before 2000, and holds no data)
  const showFirstMonth = monthStart(firstMonth) >= monthStart(gridMin);

  const textField = (field: keyof Draft, id: string, text: string): ReactElement => (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="type-label">
        {t(field)}
      </label>
      <Input
        id={id}
        ref={field === 'from' ? fromRef : undefined}
        size="sm"
        className="w-32 aria-invalid:border-negative-solid"
        inputMode="numeric"
        autoComplete="off"
        placeholder={t('placeholder')}
        value={text}
        aria-invalid={invalid[field] ? true : undefined}
        aria-describedby={invalid[field] ? noteId : undefined}
        onChange={(event) => type(field, event.target.value)}
        onBlur={() => setTouched((current) => ({ ...current, [field]: true }))}
      />
    </div>
  );

  const presetApplied = (preset: RangePreset): boolean => value.kind === 'preset' && value.preset === preset;

  return (
    <Popover
      trigger={
        <PickerTrigger
          accessibleName={name}
          long={label}
          short={shortLabel}
          tooltip={resolvedText}
          zoneNote={t('zone', { zone: timeZone })}
          size={size}
        />
      }
      aria-label={t('label')}
      padding="list"
      align="end"
      // Presets alone: 176 px. With the calendar the popover is as wide as its content, and the popover's own
      // cap (the available width) holds it inside a narrow screen
      width={customOpen ? 'date-range' : 'content'}
      className={customOpen ? 'w-auto' : 'w-44 min-w-0'}
      open={open}
      onOpenChange={handleOpenChange}
      initialFocus={appliedRef}
    >
      <div ref={paneRef} className="flex flex-col gap-3 md:flex-row md:items-start">
        <div
          role="group"
          aria-labelledby={presetsId}
          className={cn('flex w-full flex-col gap-1', customOpen && 'md:w-44 md:shrink-0')}
        >
          <p id={presetsId} className="px-2 type-meta">
            {t('presets')}
          </p>
          {RANGE_PRESETS.map((preset) => {
            // A preset longer than the page's limit would be refused when the address is read back
            const tooLong = PRESET_DAYS[preset] > limitDays;
            return (
              <Button
                key={preset}
                ref={presetApplied(preset) ? appliedRef : undefined}
                variant="ghost"
                size="sm"
                aria-pressed={presetApplied(preset)}
                // aria-disabled, not the disabled attribute: it stays in the Tab order and its reason can be read
                disabled={tooLong}
                focusableWhenDisabled
                aria-describedby={tooLong ? limitId : undefined}
                className="w-full justify-between"
                onClick={() => choose(preset)}
              >
                {t('lastDays', { days: PRESET_DAYS[preset] })}
                {presetApplied(preset) ? <Icon icon={Check} size="sm" /> : null}
              </Button>
            );
          })}
          {RANGE_PRESETS.some((preset) => PRESET_DAYS[preset] > limitDays) ? (
            <span id={limitId} hidden>
              {t('limit', { max: limitDays })}
            </span>
          ) : null}
          <Button
            ref={value.kind === 'custom' ? appliedRef : undefined}
            variant="ghost"
            size="sm"
            // It opens the pane, so it is expanded or not; the applied range is what the check mark shows
            aria-expanded={customOpen}
            className="w-full justify-between"
            onClick={showCustom}
          >
            {t('custom')}
            {value.kind === 'custom' ? <Icon icon={Check} size="sm" /> : <Icon icon={ChevronRight} size="sm" />}
          </Button>
        </div>
        {customOpen ? (
          <fieldset className="flex min-w-0 flex-col gap-3 border-border-subtle max-md:border-t max-md:pt-3 md:border-l md:pl-3">
            <legend className="sr-only">{t('custom')}</legend>
            {/* A form, so Enter in a date field applies a valid range as Apply does */}
            <form
              noValidate
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                apply();
              }}
            >
              <div className="flex gap-2">
                {textField('from', fromId, draft.from)}
                {textField('to', toId, draft.to)}
              </div>
              {/* w-0 min-w-full: the note wraps inside the width of the fields and the months. It adds nothing to
                  the width of the popover, which is as wide as its content, however long the message is */}
              <p id={noteId} className={cn('w-0 min-w-full type-meta', shown !== null && 'text-negative-text')}>
                {noteWords}
              </p>
              <div className="relative flex gap-4">
                {showFirstMonth ? (
                  <div className="max-md:hidden">
                    <MonthGrid month={firstMonth} {...gridProps} />
                  </div>
                ) : null}
                <MonthGrid month={anchor} {...gridProps} />
                <IconButton
                  icon={ChevronLeft}
                  label={t('previousMonth')}
                  disabled={previousDisabled}
                  onClick={() => navigate(-1)}
                  className="absolute top-0 left-0"
                />
                <IconButton
                  icon={ChevronRight}
                  label={t('nextMonth')}
                  disabled={nextDisabled}
                  onClick={() => navigate(1)}
                  className="absolute top-0 right-0"
                />
              </div>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <p className="min-w-0 type-meta break-words">{t('zone', { zone: timeZone })}</p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                    {common('cancel')}
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={problem !== null}
                    aria-describedby={noteId}
                  >
                    {t('apply')}
                  </Button>
                </div>
              </div>
            </form>
          </fieldset>
        ) : null}
      </div>
    </Popover>
  );
}
