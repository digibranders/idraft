import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DateRangePicker, type DateRangePickerProps } from './date-range-picker';
import type { DateRangeValue } from './range-model';
import { announce } from '@/lib/a11y/announcer';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// The real announcer, watched: the picker speaks through it and never through a live region of its own
vi.mock('@/lib/a11y/announcer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/a11y/announcer')>();
  return { ...actual, announce: vi.fn(actual.announce) };
});

// Dates are pinned: the picker never reads the clock, so no test depends on the machine's
const TODAY = '2026-11-13';
const ZONE = 'Europe/Berlin';
const PRESET_28: DateRangeValue = { kind: 'preset', preset: '28d' };
const TOO_LONG_105 = '105 days is longer than the 91 day limit. Pick a later start date or an earlier end date.';

function props(extra: Partial<DateRangePickerProps> = {}): DateRangePickerProps {
  return { value: PRESET_28, onValueChange: vi.fn(), today: TODAY, timeZone: ZONE, ...extra };
}

type Rendered = ReturnType<typeof renderWithProviders>;
type User = Rendered['user'];

const trigger = (name: string | RegExp = /^Date range:/): HTMLElement => screen.getByRole('button', { name });
const popup = (): HTMLElement | null => document.querySelector('[data-slot="popover"]');
const button = (name: string): HTMLElement => screen.getByRole('button', { name });
const field = (name: 'Start date' | 'End date'): HTMLInputElement => {
  const input = screen.getByRole('textbox', { name });
  if (!(input instanceof HTMLInputElement)) throw new Error(`${name} is not an input`);
  return input;
};

async function openPicker(ui: ReactElement): Promise<Rendered> {
  const rendered = renderWithProviders(ui);
  await rendered.user.click(trigger());
  await screen.findByRole('dialog', { name: 'Date range' });
  return rendered;
}

async function openCustom(
  extra: Partial<DateRangePickerProps> = {},
): Promise<Rendered & { onValueChange: ReturnType<typeof vi.fn> }> {
  const onValueChange = vi.fn();
  const rendered = await openPicker(<DateRangePicker {...props({ onValueChange, ...extra })} />);
  await rendered.user.click(button('Custom range'));
  await waitFor(() => expect(field('Start date')).toHaveFocus());
  return { ...rendered, onValueChange };
}

async function typeInto(user: User, name: 'Start date' | 'End date', text: string): Promise<void> {
  await user.clear(field(name));
  await user.type(field(name), text);
}

const note = (): HTMLElement => {
  const id = button('Apply').getAttribute('aria-describedby');
  const element = id === null ? null : document.getElementById(id);
  if (element === null) throw new Error('Apply has no description');
  return element;
};

/**
 * The width of the window, as the picker's media query sees it: a wide one (768 px and up) shows two months, a
 * narrow one (a phone) shows the month of the end only. jsdom has no `matchMedia`, so a test says which.
 */
function stubWidth(wide: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

const months = (): (string | null)[] => screen.getAllByRole('grid').map((grid) => grid.getAttribute('aria-label'));

beforeEach(() => {
  stubWidth(true);
});

afterEach(() => {
  vi.mocked(announce).mockClear();
  vi.unstubAllGlobals();
});

describe('DateRangePicker trigger', () => {
  it('is named with the long form, the short form and the dates, and shows the long and the short form', () => {
    renderWithProviders(<DateRangePicker {...props()} />);
    const button = trigger('Date range: Last 28 days (28d), Oct 17 to Nov 13, 2026');
    // Both are rendered and CSS switches them at 640 px: no difference between server and client
    const long = within(button).getByText('Last 28 days');
    const short = within(button).getByText('28d');
    expect(long).toHaveClass('hidden', 'sm:inline');
    expect(short).toHaveClass('sm:hidden');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it.each<[string, DateRangeValue, string]>([
    ['a preset', PRESET_28, 'Date range: Last 28 days (28d), Oct 17 to Nov 13, 2026'],
    ['the 7 day preset', { kind: 'preset', preset: '7d' }, 'Date range: Last 7 days (7d), Nov 7 to Nov 13, 2026'],
    [
      'a custom range',
      { kind: 'custom', from: '2026-09-01', to: '2026-10-31' },
      'Date range: Sep 1 to Oct 31, 2026 (61d)',
    ],
  ])('has the text it shows at every width inside its name (WCAG 2.5.3), for %s', (_label, value, name) => {
    renderWithProviders(<DateRangePicker {...props({ value })} />);
    const button = trigger(name);
    const shown = [...button.querySelectorAll('span')].map((span) => span.textContent ?? '');
    // The long form (640 px and up) and the short form (below it)
    expect(shown).toHaveLength(2);
    for (const text of shown) expect(name).toContain(text);
  });

  it('names each preset with its own number of days', () => {
    const { rerender } = renderWithProviders(
      <DateRangePicker {...props({ value: { kind: 'preset', preset: '7d' } })} />,
    );
    expect(trigger('Date range: Last 7 days (7d), Nov 7 to Nov 13, 2026')).toHaveTextContent('7d');
    rerender(<DateRangePicker {...props({ value: { kind: 'preset', preset: '90d' } })} />);
    expect(trigger('Date range: Last 90 days (90d), Aug 16 to Nov 13, 2026')).toHaveTextContent('90d');
  });

  it('shows the dates of a custom range, once in the visible text, and its length as the short form', () => {
    renderWithProviders(
      <DateRangePicker {...props({ value: { kind: 'custom', from: '2026-09-01', to: '2026-10-31' } })} />,
    );
    const custom = trigger('Date range: Sep 1 to Oct 31, 2026 (61d)');
    expect(within(custom).getAllByText('Sep 1 to Oct 31, 2026')).toHaveLength(1);
    expect(custom).toHaveTextContent('61d');
  });

  it('shows the resolved dates and the zone in a tooltip', async () => {
    const { user } = renderWithProviders(<DateRangePicker {...props()} />);
    await user.hover(trigger());
    await waitFor(() => {
      const tip = document.querySelector('[data-slot="tooltip"]');
      expect(tip).toHaveTextContent('Oct 17 to Nov 13, 2026');
      expect(tip).toHaveTextContent('Dates in Europe/Berlin');
    });
  });

  it('takes the 32 px size for forms', () => {
    renderWithProviders(<DateRangePicker {...props({ size: 'sm' })} />);
    expect(trigger()).toHaveClass('h-control-sm');
  });
});

describe('DateRangePicker presets', () => {
  it('opens from the keyboard and puts focus on the applied preset', async () => {
    const { user } = renderWithProviders(<DateRangePicker {...props()} />);
    await user.tab();
    expect(trigger()).toHaveFocus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Date range' });
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Last 28 days' })).toHaveFocus());
  });

  it('lists the presets and marks the applied one, with presets only and no calendar', async () => {
    await openPicker(<DateRangePicker {...props()} />);
    const group = screen.getByRole('group', { name: 'Presets' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual(['Last 7 days', 'Last 28 days', 'Last 90 days', 'Custom range']);
    expect(button('Last 28 days')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Last 7 days')).toHaveAttribute('aria-pressed', 'false');
    // "Custom range" opens a pane: it says expanded, and not pressed (it is not a toggle of its own)
    expect(button('Custom range')).toHaveAttribute('aria-expanded', 'false');
    expect(button('Custom range')).not.toHaveAttribute('aria-pressed');
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('disables a preset longer than maxDays, keeps it focusable, and says why in words', async () => {
    const onValueChange = vi.fn();
    const { user } = await openPicker(<DateRangePicker {...props({ onValueChange, maxDays: 60 })} />);
    const ninety = button('Last 90 days');
    expect(ninety).toHaveAttribute('aria-disabled', 'true');
    expect(ninety).toHaveAccessibleDescription('A range is at most 60 days.');
    expect(button('Last 28 days')).not.toHaveAttribute('aria-disabled', 'true');
    expect(button('Last 28 days')).not.toHaveAccessibleDescription();
    ninety.focus();
    expect(ninety).toHaveFocus();
    await user.click(ninety);
    await user.keyboard('{Enter}');
    expect(onValueChange).not.toHaveBeenCalled();
    expect(popup()).not.toBeNull();
    await user.click(button('Last 7 days'));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith({ kind: 'preset', preset: '7d' });
  });

  it('disables no preset with the default limit, which holds the widest', async () => {
    await openPicker(<DateRangePicker {...props()} />);
    for (const name of ['Last 7 days', 'Last 28 days', 'Last 90 days']) {
      expect(button(name)).not.toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('applies a preset and closes, and speaks it', async () => {
    const onValueChange = vi.fn();
    const { user } = await openPicker(<DateRangePicker {...props({ onValueChange })} />);
    await user.click(button('Last 7 days'));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith({ kind: 'preset', preset: '7d' });
    await waitFor(() => expect(popup()).toBeNull());
    expect(announce).toHaveBeenCalledWith('Date range: Last 7 days', expect.anything());
    expect(trigger()).toHaveFocus();
  });

  it('sizes the presets popover to its content by class, 176 px, and lets it shrink', async () => {
    await openPicker(<DateRangePicker {...props()} />);
    expect(popup()).toHaveClass('w-44', 'min-w-0');
    expect(popup()).not.toHaveClass('w-162');
  });

  it('closes with Escape and returns focus to the trigger, with no change', async () => {
    const onValueChange = vi.fn();
    const { user } = await openPicker(<DateRangePicker {...props({ onValueChange })} />);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(popup()).toBeNull());
    expect(trigger()).toHaveFocus();
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe('DateRangePicker custom range', () => {
  it('opens the pane from "Custom range" and focuses Start date, filled with the applied dates', async () => {
    await openCustom();
    expect(button('Custom range')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Custom range' })).toBeInTheDocument();
    expect(field('Start date')).toHaveValue('2026-10-17');
    expect(field('End date')).toHaveValue('2026-11-13');
    expect(field('Start date')).toHaveAttribute('placeholder', 'YYYY-MM-DD');
    expect(field('Start date')).toHaveAttribute('inputmode', 'numeric');
    expect(field('Start date')).toHaveAttribute('autocomplete', 'off');
  });

  it('opens with the pane when the applied range is custom, with focus on "Custom range"', async () => {
    renderWithProviders(
      <DateRangePicker {...props({ value: { kind: 'custom', from: '2026-09-01', to: '2026-10-31' } })} />,
    );
    await screen.findByRole('button', { name: /^Date range:/ });
    fireEvent.click(trigger());
    await screen.findByRole('dialog');
    expect(field('Start date')).toHaveValue('2026-09-01');
    expect(field('End date')).toHaveValue('2026-10-31');
    expect(button('Custom range')).toHaveAttribute('aria-expanded', 'true');
    expect(button('Custom range')).not.toHaveAttribute('aria-pressed');
    await waitFor(() => expect(button('Custom range')).toHaveFocus());
  });

  it('refuses 105 days with the reason in words, disables Apply and describes it by the reason', async () => {
    const { user } = await openCustom();
    await typeInto(user, 'Start date', '2026-08-01');
    await typeInto(user, 'End date', '2026-11-13');
    expect(note()).toHaveTextContent(TOO_LONG_105);
    expect(note()).toHaveClass('text-negative-text');
    expect(button('Apply')).toBeDisabled();
    expect(button('Apply')).toHaveAccessibleDescription(TOO_LONG_105);
    expect(field('Start date')).toHaveAttribute('aria-invalid', 'true');
    expect(announce).toHaveBeenCalledWith(TOO_LONG_105, expect.anything());
  });

  it('allows 91 days and refuses 92, the boundary both ways', async () => {
    const onValueChange = vi.fn();
    const { user } = await openCustom({ onValueChange });
    await typeInto(user, 'Start date', '2026-08-14');
    await typeInto(user, 'End date', '2026-11-13');
    expect(note()).toHaveTextContent('92 days is longer than the 91 day limit.');
    expect(button('Apply')).toBeDisabled();
    await typeInto(user, 'Start date', '2026-08-15');
    expect(button('Apply')).toBeEnabled();
    expect(note()).toHaveTextContent('A range is at most 91 days.');
    expect(note()).not.toHaveClass('text-negative-text');
    expect(field('Start date')).not.toHaveAttribute('aria-invalid', 'true');
    await user.click(button('Apply'));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith({ kind: 'custom', from: '2026-08-15', to: '2026-11-13' });
    await waitFor(() => expect(popup()).toBeNull());
    expect(announce).toHaveBeenCalledWith('Date range: Aug 15 to Nov 13, 2026', expect.anything());
  });

  it('applies a valid range with Enter in a date field', async () => {
    const onValueChange = vi.fn();
    const { user } = await openCustom({ onValueChange });
    await typeInto(user, 'Start date', '2026-11-01');
    await user.keyboard('{Enter}');
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith({ kind: 'custom', from: '2026-11-01', to: '2026-11-13' });
    await waitFor(() => expect(popup()).toBeNull());
  });

  it('keeps the pane open on Enter while a date is wrong', async () => {
    const onValueChange = vi.fn();
    const { user } = await openCustom({ onValueChange });
    await typeInto(user, 'End date', '2026-11-14');
    await user.keyboard('{Enter}');
    await typeInto(user, 'Start date', 'garbage');
    await user.keyboard('{Enter}');
    expect(onValueChange).not.toHaveBeenCalled();
    expect(popup()).not.toBeNull();
    expect(button('Apply')).toBeDisabled();
  });

  it('clamps a maxDays above the ceiling of the routes (92) to 92, in the note and in the check', async () => {
    const { user } = await openCustom({ maxDays: 365 });
    expect(note()).toHaveTextContent('A range is at most 92 days.');
    await typeInto(user, 'Start date', '2026-08-13');
    expect(note()).toHaveTextContent('93 days is longer than the 92 day limit.');
    await typeInto(user, 'Start date', '2026-08-14');
    expect(button('Apply')).toBeEnabled();
  });

  it('says a real day before 2000 is before the first day, and not that its format is wrong', async () => {
    const { user } = await openCustom();
    await typeInto(user, 'Start date', '1999-12-31');
    expect(note()).toHaveTextContent('Data starts on Jan 1, 2000, so earlier dates are not available.');
    expect(note()).not.toHaveTextContent('YYYY-MM-DD');
    expect(field('Start date')).toHaveAttribute('aria-invalid', 'true');
    expect(button('Apply')).toBeDisabled();
  });

  it('keeps the note inside the width of the fields and months, however long its words', async () => {
    const { user } = await openCustom();
    // Without these the longest message (110 characters) would set the width of the popover
    expect(note()).toHaveClass('w-0', 'min-w-full');
    await typeInto(user, 'Start date', '2026-08-01');
    expect(note()).toHaveTextContent(TOO_LONG_105);
    expect(note()).toHaveClass('w-0', 'min-w-full');
  });

  it('takes a narrower limit from the page and says its number', async () => {
    const { user } = await openCustom({ maxDays: 60 });
    expect(note()).toHaveTextContent('A range is at most 60 days.');
    await typeInto(user, 'Start date', '2026-09-01');
    expect(note()).toHaveTextContent('74 days is longer than the 60 day limit.');
  });

  it('says in words that an end date is in the future, and that a start is after the end', async () => {
    const { user } = await openCustom();
    await typeInto(user, 'End date', '2026-11-14');
    expect(note()).toHaveTextContent('Dates after today, Nov 13, 2026, are not available.');
    expect(field('End date')).toHaveAttribute('aria-invalid', 'true');
    await typeInto(user, 'Start date', '2026-11-10');
    await typeInto(user, 'End date', '2026-11-01');
    expect(note()).toHaveTextContent('The start date is after the end date.');
    expect(button('Apply')).toBeDisabled();
  });

  it('says when the data starts, and disables the days before it in the calendar', async () => {
    const { user } = await openCustom({ earliest: '2026-03-02' });
    await typeInto(user, 'Start date', '2026-03-01');
    expect(note()).toHaveTextContent('Data starts on Mar 2, 2026, so earlier dates are not available.');
    expect(button('Apply')).toBeDisabled();
    // Typing a day moves the calendar to its month
    await typeInto(user, 'Start date', '2026-03-10');
    const before = button('Sunday, Mar 1, 2026');
    expect(before).toBeDisabled();
    expect(before).toHaveAccessibleDescription('Data starts on Mar 2, 2026, so earlier dates are not available.');
    expect(button('Monday, Mar 2, 2026')).toBeEnabled();
    expect(button('Previous month')).toBeDisabled();
  });

  it('shows the format message for an empty or malformed date only after the field is left', async () => {
    const { user } = await openCustom();
    await user.clear(field('Start date'));
    await user.type(field('Start date'), '2026-13');
    expect(button('Apply')).toBeDisabled();
    expect(note()).toHaveTextContent('A range is at most 91 days.');
    await user.tab();
    expect(note()).toHaveTextContent('Enter the date as YYYY-MM-DD.');
    expect(field('Start date')).toHaveAttribute('aria-invalid', 'true');
    expect(field('Start date')).toHaveAccessibleDescription('Enter the date as YYYY-MM-DD.');
  });

  it('survives hostile text: nothing is run or echoed, and Apply stays disabled with the format message', async () => {
    await openCustom();
    const hostile = [
      '<img src=x onerror=alert(1)>',
      '<script>window.hacked=1</script>',
      '9'.repeat(5000),
      '2026-11-13\u{0000}',
      '\u{202E}2026-11-13',
      "2026-11-13'; DROP TABLE",
      '\u{1F4A5}\u{1F4A5}\u{1F4A5}',
      '2026-02-30',
      '\u{FF12}\u{FF10}\u{FF12}\u{FF16}-11-13',
      '${2026}-11-13',
    ];
    for (const text of hostile) {
      fireEvent.change(field('Start date'), { target: { value: text } });
      fireEvent.blur(field('Start date'));
      expect(button('Apply')).toBeDisabled();
      expect(note()).toHaveTextContent('Enter the date as YYYY-MM-DD.');
      expect(note()).not.toHaveTextContent(text.slice(0, 8));
    }
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect('hacked' in window).toBe(false);
  });

  it('trims the spaces around a typed or pasted date', async () => {
    const onValueChange = vi.fn();
    const { user } = await openCustom({ onValueChange });
    fireEvent.change(field('Start date'), { target: { value: '  2026-11-01 ' } });
    expect(button('Apply')).toBeEnabled();
    await user.click(button('Apply'));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith({ kind: 'custom', from: '2026-11-01', to: '2026-11-13' });
  });

  it('applies a custom range that equals a preset as a custom range', async () => {
    const onValueChange = vi.fn();
    const { user } = await openCustom({ onValueChange });
    await user.click(button('Apply'));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith({ kind: 'custom', from: '2026-10-17', to: '2026-11-13' });
  });

  it('shows the zone note, and cancels without a change', async () => {
    const onValueChange = vi.fn();
    const { user } = await openCustom({ onValueChange });
    expect(screen.getByText('Dates in Europe/Berlin')).toBeInTheDocument();
    await typeInto(user, 'Start date', '2026-11-01');
    await user.click(button('Cancel'));
    await waitFor(() => expect(popup()).toBeNull());
    expect(onValueChange).not.toHaveBeenCalled();
    expect(trigger()).toHaveFocus();
  });

  it('starts again from the applied range when it is reopened, whatever was typed before', async () => {
    const { user } = await openCustom();
    await typeInto(user, 'Start date', 'garbage');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(popup()).toBeNull());
    await user.click(trigger());
    await screen.findByRole('dialog');
    // A preset is applied, so the pane is closed again and opens with the resolved dates
    expect(screen.queryByRole('grid')).toBeNull();
    await user.click(button('Custom range'));
    expect(field('Start date')).toHaveValue('2026-10-17');
  });

  it('closes with Escape from a text field, with no change', async () => {
    const { user, onValueChange } = await openCustom();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(popup()).toBeNull());
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe('DateRangePicker calendar', () => {
  it('shows two months, the end month and the one before, and hides the first below 768 px by class', async () => {
    await openCustom();
    const grids = screen.getAllByRole('grid');
    expect(grids.map((grid) => grid.getAttribute('aria-label'))).toEqual(['Oct 2026', 'Nov 2026']);
    expect(grids[0]?.closest('.max-md\\:hidden')).not.toBeNull();
    expect(grids[1]?.closest('.max-md\\:hidden')).toBeNull();
  });

  it('sizes the popover to its content by class and stacks the panes below 768 px', async () => {
    await openCustom();
    expect(popup()).toHaveClass('w-auto', 'max-w-(--available-width)');
    expect(popup()).not.toHaveClass('w-162');
    const pane = screen.getByRole('group', { name: 'Custom range' });
    expect(pane.parentElement).toHaveClass('flex-col', 'md:flex-row');
    // The two fields and the month side by side fit 292 px: 2 x 128 px, 8 px between, month 224 px
    expect(field('Start date')).toHaveClass('w-32');
    expect(field('End date')).toHaveClass('w-32');
  });

  it('marks the typed range in the calendar', async () => {
    await openCustom();
    expect(button('Saturday, Oct 17, 2026')).toHaveClass('bg-primary');
    expect(button('Friday, Nov 13, 2026')).toHaveClass('bg-primary');
    expect(button('Monday, Nov 2, 2026')).toHaveClass('bg-primary-subtle');
    expect(button('Friday, Oct 16, 2026')).not.toHaveClass('bg-primary', 'bg-primary-subtle');
  });

  it('has one Tab stop in the months, on the end of the range', async () => {
    await openCustom();
    const stops = screen.getAllByRole('grid').flatMap((grid) => [...grid.querySelectorAll('button[tabindex="0"]')]);
    expect(stops).toEqual([button('Friday, Nov 13, 2026')]);
  });

  it('restarts the range with the first pick and completes it with the second, in the text fields too', async () => {
    const { user } = await openCustom();
    await user.click(button('Tuesday, Oct 20, 2026'));
    expect(field('Start date')).toHaveValue('2026-10-20');
    expect(field('End date')).toHaveValue('');
    expect(button('Apply')).toBeDisabled();
    await user.click(button('Thursday, Nov 5, 2026'));
    expect(field('Start date')).toHaveValue('2026-10-20');
    expect(field('End date')).toHaveValue('2026-11-05');
    expect(button('Apply')).toBeEnabled();
    expect(announce).toHaveBeenCalledWith('Date range: Oct 20 to Nov 5, 2026', expect.anything());
  });

  it('swaps the two picks when the second is before the first', async () => {
    const { user } = await openCustom();
    await user.click(button('Tuesday, Oct 20, 2026'));
    await user.click(button('Saturday, Oct 17, 2026'));
    expect(field('Start date')).toHaveValue('2026-10-17');
    expect(field('End date')).toHaveValue('2026-10-20');
  });

  it('says which end dates are not available when the cap is earlier than today, and disables them', async () => {
    const onValueChange = vi.fn();
    const { user } = await openCustom({ onValueChange });
    // Back from Oct and Nov to May and Jun
    for (let step = 0; step < 5; step += 1) await user.click(button('Previous month'));
    await user.click(button('Friday, May 1, 2026'));
    expect(field('Start date')).toHaveValue('2026-05-01');
    expect(note()).toHaveTextContent(
      'End dates after Jul 30, 2026 are not available, because a range is at most 91 days.',
    );
    for (let step = 0; step < 2; step += 1) await user.click(button('Next month'));
    const beyond = button('Friday, Jul 31, 2026');
    expect(beyond).toBeDisabled();
    expect(beyond).toHaveAccessibleDescription(
      'End dates after Jul 30, 2026 are not available, because a range is at most 91 days.',
    );
    expect(button('Thursday, Jul 30, 2026')).toBeEnabled();
    await user.click(button('Thursday, Jul 30, 2026'));
    expect(button('Apply')).toBeEnabled();
    await user.click(button('Apply'));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith({ kind: 'custom', from: '2026-05-01', to: '2026-07-30' });
  });

  it('shows only the limit when the cap is later than today', async () => {
    const { user } = await openCustom();
    for (let step = 0; step < 2; step += 1) await user.click(button('Previous month'));
    await user.click(button('Tuesday, Sep 1, 2026'));
    expect(note()).toHaveTextContent('A range is at most 91 days.');
    expect(note()).not.toHaveTextContent('End dates after');
  });

  it('keeps the months where they were when a day inside them is typed', async () => {
    const { user } = await openCustom();
    await typeInto(user, 'Start date', '2026-10-20');
    expect(screen.getAllByRole('grid').map((grid) => grid.getAttribute('aria-label'))).toEqual([
      'Oct 2026',
      'Nov 2026',
    ]);
  });

  it('moves the months with Previous and Next, which stop at today and at the first day with data', async () => {
    const { user } = await openCustom({ earliest: '2026-08-10' });
    expect(button('Next month')).toBeDisabled();
    await user.click(button('Previous month'));
    expect(screen.getAllByRole('grid').map((grid) => grid.getAttribute('aria-label'))).toEqual([
      'Sep 2026',
      'Oct 2026',
    ]);
    await user.click(button('Previous month'));
    expect(screen.getAllByRole('grid').map((grid) => grid.getAttribute('aria-label'))).toEqual([
      'Aug 2026',
      'Sep 2026',
    ]);
    expect(button('Previous month')).toBeDisabled();
    await user.click(button('Next month'));
    expect(button('Previous month')).toBeEnabled();
  });

  it('moves focus by day, week and month from the keyboard, across the months shown', async () => {
    const { user } = await openCustom();
    button('Friday, Nov 13, 2026').focus();
    await user.keyboard('{ArrowLeft}');
    expect(button('Thursday, Nov 12, 2026')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(button('Thursday, Nov 5, 2026')).toHaveFocus();
    await user.keyboard('{PageUp}');
    expect(button('Monday, Oct 5, 2026')).toHaveFocus();
    // Out of the months shown: they move so the day is visible and focus follows it
    await user.keyboard('{PageUp}');
    await waitFor(() => expect(button('Saturday, Sep 5, 2026')).toHaveFocus());
    expect(screen.getAllByRole('grid').map((grid) => grid.getAttribute('aria-label'))).toEqual([
      'Sep 2026',
      'Oct 2026',
    ]);
    await user.keyboard('{Enter}');
    expect(field('Start date')).toHaveValue('2026-09-05');
  });

  it('does not move focus past today, and keeps the popover open on arrow keys', async () => {
    const { user } = await openCustom();
    button('Friday, Nov 13, 2026').focus();
    await user.keyboard('{ArrowRight}{ArrowDown}{End}');
    expect(button('Friday, Nov 13, 2026')).toHaveFocus();
    expect(popup()).not.toBeNull();
  });
});

describe('DateRangePicker at the first business date (2000-01-01), with no earliest day given', () => {
  // A page that does not know its first day of data: the grid must stop at the first business date, not throw
  const EARLY = {
    today: '2000-03-15',
    value: { kind: 'preset', preset: '7d' },
  } satisfies Partial<DateRangePickerProps>;

  it('disables Previous at January 2000 instead of showing December 1999', async () => {
    const { user } = await openCustom(EARLY);
    expect(months()).toEqual(['Feb 2000', 'Mar 2000']);
    await user.click(button('Previous month'));
    expect(months()).toEqual(['Jan 2000', 'Feb 2000']);
    expect(button('Previous month')).toBeDisabled();
    expect(button('Saturday, Jan 1, 2000')).toBeEnabled();
  });

  it('stops the keyboard at Jan 1, 2000: a move to an earlier year or month lands there, and the grid stays', async () => {
    const { user } = await openCustom(EARLY);
    button('Wednesday, Mar 15, 2000').focus();
    await user.keyboard('{Shift>}{PageUp}{/Shift}');
    await waitFor(() => expect(button('Saturday, Jan 1, 2000')).toHaveFocus());
    expect(months()).toEqual(['Jan 2000', 'Feb 2000']);
    expect(button('Previous month')).toBeDisabled();
    // Every further move back stays on the first day, and nothing throws
    await user.keyboard('{PageUp}{ArrowLeft}{ArrowUp}{Home}{Shift>}{PageUp}{/Shift}');
    expect(button('Saturday, Jan 1, 2000')).toHaveFocus();
    expect(months()).toEqual(['Jan 2000', 'Feb 2000']);
  });

  it('reaches Jan 2000 from today by 27 Shift+Page Up presses, as a person holding the key would', async () => {
    const { user } = await openCustom();
    button('Friday, Nov 13, 2026').focus();
    await user.keyboard('{Shift>}{PageUp}{/Shift}'.repeat(27));
    await waitFor(() => expect(button('Saturday, Jan 1, 2000')).toHaveFocus());
    expect(months()).toEqual(['Jan 2000', 'Feb 2000']);
  });

  it('on a phone shows January 2000 alone, with Previous disabled', async () => {
    stubWidth(false);
    const { user } = await openCustom(EARLY);
    await user.click(button('Previous month'));
    await user.click(button('Previous month'));
    expect(months()).toEqual(['Jan 2000']);
    expect(button('Previous month')).toBeDisabled();
  });
});

describe('DateRangePicker on a phone (below 768 px): one month is shown, the end month', () => {
  beforeEach(() => {
    stubWidth(false);
  });

  it('enables Previous until the month shown, not the hidden one before it, is the first with data', async () => {
    const { user } = await openCustom({ earliest: '2026-08-10' });
    for (const month of ['Oct 2026', 'Sep 2026', 'Aug 2026']) {
      expect(button('Previous month')).toBeEnabled();
      await user.click(button('Previous month'));
      expect(months().at(-1)).toBe(month);
    }
    expect(button('Previous month')).toBeDisabled();
    // August is shown and holds the first day with data; July, before it, is not there
    expect(months()).toEqual(['Aug 2026']);
    expect(button('Sunday, Aug 9, 2026')).toBeDisabled();
    expect(button('Monday, Aug 10, 2026')).toBeEnabled();
  });

  it('shows the month of a day that keyboard focus moves into the hidden first month', async () => {
    const { user } = await openCustom();
    button('Friday, Nov 13, 2026').focus();
    await user.keyboard('{PageUp}');
    await waitFor(() => expect(button('Tuesday, Oct 13, 2026')).toHaveFocus());
    // Oct is now the month that stays in view
    expect(months().at(-1)).toBe('Oct 2026');
  });

  it('shows the month of a typed day, as the month in view', async () => {
    const { user } = await openCustom();
    await typeInto(user, 'Start date', '2026-09-10');
    expect(months().at(-1)).toBe('Sep 2026');
  });

  it('still disables Next at the month of today', async () => {
    await openCustom();
    expect(button('Next month')).toBeDisabled();
  });
});

describe('DateRangePicker source', () => {
  it('never reads the clock: today is a prop', () => {
    const folder = path.join(import.meta.dirname);
    for (const file of ['date-range-picker.tsx', 'month-grid.tsx', 'range-model.ts', 'business-date.ts']) {
      const source = readFileSync(path.join(folder, file), 'utf8');
      expect(source, file).not.toMatch(/Date\.now\(|new Date\(\)|performance\.now/);
    }
  });
});

describe('DateRangePicker accessibility', () => {
  it.each(['light', 'dark'])(
    'has no violation closed, with presets, and with the calendar, in the %s theme',
    async (theme) => {
      document.documentElement.className = theme === 'dark' ? 'dark' : '';
      try {
        const { user, container } = renderWithProviders(<DateRangePicker {...props()} />);
        expect(await axe(container)).toHaveNoViolations();
        await user.click(trigger());
        const dialog = await screen.findByRole('dialog', { name: 'Date range' });
        expect(await axe(dialog)).toHaveNoViolations();
        await user.click(button('Custom range'));
        await screen.findAllByRole('grid');
        expect(await axe(document.body)).toHaveNoViolations();
        await user.clear(field('Start date'));
        await user.type(field('Start date'), '2026-08-01');
        await user.tab();
        expect(note()).toHaveTextContent(TOO_LONG_105);
        expect(await axe(document.body)).toHaveNoViolations();
      } finally {
        document.documentElement.className = '';
      }
    },
  );
});
