import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MonthGrid, type MonthGridProps } from './month-grid';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const TODAY = '2026-11-13';
const REASONS = {
  before: 'Data starts on Mar 2, 2026, so earlier dates are not available.',
  after: 'Dates after today, Nov 13, 2026, are not available.',
};

function props(extra: Partial<MonthGridProps> = {}): MonthGridProps {
  return {
    month: '2026-11-01',
    from: null,
    to: null,
    min: null,
    max: TODAY,
    today: TODAY,
    focusDay: TODAY,
    reasons: REASONS,
    onFocusDayChange: vi.fn(),
    onPick: vi.fn(),
    ...extra,
  };
}

const day = (name: string): HTMLElement => screen.getByRole('button', { name });
const cellOf = (name: string): HTMLElement => {
  const cell = day(name).closest<HTMLElement>('[role="gridcell"]');
  if (cell === null) throw new Error(`${name} is not in a cell`);
  return cell;
};

describe('MonthGrid structure', () => {
  it('is a grid named by its month, with seven column headers that start on Monday', () => {
    renderWithProviders(<MonthGrid {...props()} />);
    const grid = screen.getByRole('grid', { name: 'Nov 2026' });
    const headers = within(grid).getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
    // The short form is for the eye; the name is the whole weekday
    expect(headers[0]).toHaveAccessibleName('Monday');
    expect(headers[6]).toHaveAccessibleName('Sunday');
  });

  it('puts Nov 1, a Sunday, in the last cell of the first week, and shows no day of another month', () => {
    renderWithProviders(<MonthGrid {...props()} />);
    const grid = screen.getByRole('grid');
    const rows = within(grid).getAllByRole('row');
    // Row 0 is the header row
    const first = within(rows[1] as HTMLElement).getAllByRole('gridcell');
    expect(first).toHaveLength(1);
    expect(first[0]).toContainElement(day('Sunday, Nov 1, 2026'));
    expect(rows[1]?.children).toHaveLength(7);
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(30);
    // Six weeks: the 1st (Sunday) alone, four full ones, and the 30th (Monday) alone
    expect(rows).toHaveLength(1 + 6);
  });

  it('shows the month in a visible caption that screen readers skip, since the grid is named by it', () => {
    const { container } = renderWithProviders(<MonthGrid {...props()} />);
    const caption = container.querySelector('[aria-hidden="true"]');
    expect(caption).toHaveTextContent('Nov 2026');
    expect(caption).toHaveClass('type-subsection-title');
  });

  it('names each day with its weekday and date', () => {
    renderWithProviders(<MonthGrid {...props()} />);
    expect(day('Thursday, Nov 12, 2026')).toHaveTextContent('12');
    expect(day('Monday, Nov 9, 2026')).toBeInTheDocument();
  });

  it('shows any day of the month as that month', () => {
    renderWithProviders(<MonthGrid {...props({ month: '2026-02-20', focusDay: '2026-02-20' })} />);
    expect(screen.getByRole('grid', { name: 'Feb 2026' })).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(28);
  });

  it('gives each day a fixed square cell of 32 px, so one scale is one length', () => {
    renderWithProviders(<MonthGrid {...props()} />);
    expect(day('Thursday, Nov 12, 2026')).toHaveClass('size-8', 'rounded-md', 'type-body', 'num');
  });
});

describe('MonthGrid days', () => {
  it('disables the days after today, so they cannot be focused or picked', () => {
    const onPick = vi.fn();
    renderWithProviders(<MonthGrid {...props({ onPick })} />);
    const future = day('Saturday, Nov 14, 2026');
    expect(future).toBeDisabled();
    expect(future).toHaveClass('text-foreground-disabled');
    expect(day('Friday, Nov 13, 2026')).toBeEnabled();
    fireEvent.click(future);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('disables the days before the first day with data', () => {
    renderWithProviders(<MonthGrid {...props({ month: '2026-03-01', min: '2026-03-02', focusDay: '2026-03-02' })} />);
    expect(day('Sunday, Mar 1, 2026')).toBeDisabled();
    expect(day('Monday, Mar 2, 2026')).toBeEnabled();
  });

  it('gives the reason of a disabled day in words, as its description', () => {
    renderWithProviders(
      <MonthGrid {...props({ month: '2026-03-01', min: '2026-03-02', focusDay: '2026-03-02', max: '2026-03-20' })} />,
    );
    expect(day('Sunday, Mar 1, 2026')).toHaveAccessibleDescription(REASONS.before);
    expect(day('Sunday, Mar 22, 2026')).toHaveAccessibleDescription(REASONS.after);
    expect(day('Tuesday, Mar 10, 2026')).not.toHaveAccessibleDescription();
  });

  it('cannot pick a day before the earliest start while a start is picked, and says why', () => {
    const onPick = vi.fn();
    const reasons = {
      ...REASONS,
      before: 'Start dates before Aug 3, 2026 are not available, because a range is at most 91 days.',
    };
    renderWithProviders(
      <MonthGrid
        {...props({ month: '2026-07-01', from: '2026-11-01', min: '2026-08-03', max: '2026-11-01', reasons, onPick })}
      />,
    );
    const july = day('Wednesday, Jul 1, 2026');
    expect(july).toBeDisabled();
    expect(july).toHaveAccessibleDescription(reasons.before);
    fireEvent.click(july);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('marks today with aria-current, and nothing else', () => {
    renderWithProviders(<MonthGrid {...props()} />);
    expect(day('Friday, Nov 13, 2026')).toHaveAttribute('aria-current', 'date');
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1);
    expect(day('Friday, Nov 13, 2026')).toHaveClass('text-primary-text', 'type-body-strong');
  });

  it('has one Tab stop: the focus day', () => {
    const { container } = renderWithProviders(<MonthGrid {...props({ focusDay: '2026-11-12' })} />);
    const stops = container.querySelectorAll('button[tabindex="0"]');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(day('Thursday, Nov 12, 2026'));
    expect(container.querySelectorAll('button[tabindex="-1"]').length).toBeGreaterThan(20);
  });

  it('has no Tab stop when the focus day is in another month', () => {
    const { container } = renderWithProviders(<MonthGrid {...props({ focusDay: '2026-10-12' })} />);
    expect(container.querySelectorAll('button[tabindex="0"]')).toHaveLength(0);
  });

  it('picks a day by click, and by Enter and Space on the focused day', async () => {
    const onPick = vi.fn();
    const { user } = renderWithProviders(<MonthGrid {...props({ onPick, focusDay: '2026-11-12' })} />);
    await user.click(day('Monday, Nov 9, 2026'));
    expect(onPick).toHaveBeenLastCalledWith('2026-11-09');
    day('Thursday, Nov 12, 2026').focus();
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenLastCalledWith('2026-11-12');
    await user.keyboard(' ');
    expect(onPick).toHaveBeenCalledTimes(3);
  });
});

describe('MonthGrid selection', () => {
  const range = { from: '2026-11-03', to: '2026-11-10' };

  it('marks the edges, the days between and today, and selects them for assistive technology', () => {
    renderWithProviders(<MonthGrid {...props(range)} />);
    expect(day('Tuesday, Nov 3, 2026')).toHaveClass('bg-primary', 'text-primary-foreground');
    expect(day('Tuesday, Nov 10, 2026')).toHaveClass('bg-primary', 'text-primary-foreground');
    const between = day('Friday, Nov 6, 2026');
    expect(between).toHaveClass('bg-primary-subtle', 'rounded-none');
    expect(between).not.toHaveClass('bg-primary');
    expect(day('Monday, Nov 2, 2026')).not.toHaveClass('bg-primary', 'bg-primary-subtle');
    expect(cellOf('Tuesday, Nov 3, 2026')).toHaveAttribute('aria-selected', 'true');
    expect(cellOf('Friday, Nov 6, 2026')).toHaveAttribute('aria-selected', 'true');
    expect(cellOf('Tuesday, Nov 10, 2026')).toHaveAttribute('aria-selected', 'true');
    expect(cellOf('Wednesday, Nov 11, 2026')).toHaveAttribute('aria-selected', 'false');
  });

  it('marks a start alone while the end is not picked', () => {
    renderWithProviders(<MonthGrid {...props({ from: '2026-11-03' })} />);
    expect(day('Tuesday, Nov 3, 2026')).toHaveClass('bg-primary');
    expect(cellOf('Tuesday, Nov 3, 2026')).toHaveAttribute('aria-selected', 'true');
    expect(cellOf('Wednesday, Nov 4, 2026')).toHaveAttribute('aria-selected', 'false');
  });

  it('previews the end under the pointer without selecting it', () => {
    renderWithProviders(<MonthGrid {...props({ from: '2026-11-03', hover: '2026-11-08' })} />);
    expect(day('Thursday, Nov 5, 2026')).toHaveClass('bg-primary-subtle');
    expect(day('Sunday, Nov 8, 2026')).toHaveClass('bg-primary');
    expect(cellOf('Thursday, Nov 5, 2026')).toHaveAttribute('aria-selected', 'false');
    expect(day('Monday, Nov 9, 2026')).not.toHaveClass('bg-primary-subtle');
  });

  it('does not preview an end before the start', () => {
    renderWithProviders(<MonthGrid {...props({ from: '2026-11-03', hover: '2026-11-01' })} />);
    expect(day('Sunday, Nov 1, 2026')).not.toHaveClass('bg-primary');
  });

  it('shows the part of a range that lies in this month when the range starts and ends in others', () => {
    renderWithProviders(<MonthGrid {...props({ from: '2026-10-20', to: '2026-12-01' })} />);
    expect(day('Sunday, Nov 1, 2026')).toHaveClass('bg-primary-subtle');
    expect(day('Friday, Nov 13, 2026')).toHaveClass('bg-primary-subtle');
  });

  it('reports the day under the pointer, and none when the pointer leaves', async () => {
    const onHover = vi.fn();
    const { user } = renderWithProviders(<MonthGrid {...props({ onHover })} />);
    await user.hover(day('Monday, Nov 9, 2026'));
    expect(onHover).toHaveBeenLastCalledWith('2026-11-09');
    await user.unhover(day('Monday, Nov 9, 2026'));
    expect(onHover).toHaveBeenLastCalledWith(null);
  });
});

describe('MonthGrid keyboard', () => {
  async function press(
    focusDay: string,
    keys: string,
    extra: Partial<MonthGridProps> = {},
  ): Promise<ReturnType<typeof vi.fn>> {
    // A test presses several keys, each on a grid of its own
    cleanup();
    const onFocusDayChange = vi.fn();
    const month = `${focusDay.slice(0, 7)}-01`;
    const { user } = renderWithProviders(<MonthGrid {...props({ month, focusDay, onFocusDayChange, ...extra })} />);
    const start = screen.getAllByRole('button').find((button) => button.getAttribute('tabindex') === '0');
    if (start === undefined) throw new Error('no Tab stop');
    start.focus();
    await user.keyboard(keys);
    return onFocusDayChange;
  }

  it('moves by one day with Left and Right', async () => {
    expect(await press('2026-11-12', '{ArrowRight}')).toHaveBeenCalledExactlyOnceWith('2026-11-13');
    expect(await press('2026-11-12', '{ArrowLeft}')).toHaveBeenCalledExactlyOnceWith('2026-11-11');
  });

  it('moves by one week with Up and Down', async () => {
    expect(await press('2026-11-13', '{ArrowUp}')).toHaveBeenCalledExactlyOnceWith('2026-11-06');
    expect(await press('2026-11-06', '{ArrowDown}')).toHaveBeenCalledExactlyOnceWith('2026-11-13');
  });

  it('moves by one month with Page Up and Page Down, and by one year with Shift', async () => {
    expect(await press('2026-11-13', '{PageUp}')).toHaveBeenCalledExactlyOnceWith('2026-10-13');
    expect(await press('2026-11-13', '{Shift>}{PageUp}{/Shift}')).toHaveBeenCalledExactlyOnceWith('2025-11-13');
    expect(await press('2026-05-31', '{PageDown}')).toHaveBeenCalledExactlyOnceWith('2026-06-30');
    expect(await press('2025-11-13', '{Shift>}{PageDown}{/Shift}')).toHaveBeenCalledExactlyOnceWith('2026-11-13');
  });

  it('moves to the Monday and the Sunday of the week with Home and End', async () => {
    expect(await press('2026-11-12', '{Home}')).toHaveBeenCalledExactlyOnceWith('2026-11-09');
    expect(await press('2026-10-14', '{End}', { month: '2026-10-01' })).toHaveBeenCalledExactlyOnceWith('2026-10-18');
  });

  it('stops at the last enabled day: no move past today, and a move that would pass it lands on it', async () => {
    expect(await press('2026-11-13', '{ArrowRight}')).not.toHaveBeenCalled();
    expect(await press('2026-11-12', '{End}')).toHaveBeenCalledExactlyOnceWith('2026-11-13');
    expect(await press('2026-11-13', '{End}')).not.toHaveBeenCalled();
    expect(await press('2026-11-13', '{PageDown}')).not.toHaveBeenCalled();
    expect(await press('2026-11-10', '{ArrowDown}')).toHaveBeenCalledExactlyOnceWith('2026-11-13');
  });

  it('stops at the first enabled day', async () => {
    const min = { min: '2026-03-02', month: '2026-03-01' };
    expect(await press('2026-03-02', '{ArrowLeft}', min)).not.toHaveBeenCalled();
    expect(await press('2026-03-09', '{PageUp}', min)).toHaveBeenCalledExactlyOnceWith('2026-03-02');
    expect(await press('2026-03-03', '{Home}', min)).toHaveBeenCalledExactlyOnceWith('2026-03-02');
  });

  it('stops at the first business date, so no key leads the picker to a day before 2000', async () => {
    const first = { min: '2000-01-01', month: '2000-05-01' };
    expect(await press('2000-05-10', '{Shift>}{PageUp}{/Shift}', first)).toHaveBeenCalledExactlyOnceWith('2000-01-01');
    expect(await press('2000-01-20', '{PageUp}', { ...first, month: '2000-01-01' })).toHaveBeenCalledExactlyOnceWith(
      '2000-01-01',
    );
    expect(await press('2000-01-01', '{ArrowLeft}', { ...first, month: '2000-01-01' })).not.toHaveBeenCalled();
    expect(await press('2000-01-05', '{Home}', { ...first, month: '2000-01-01' })).toHaveBeenCalledExactlyOnceWith(
      '2000-01-03',
    );
  });

  it('stops at the cap while only a start is picked', async () => {
    const capped = { max: '2026-07-30', month: '2026-07-01' };
    expect(await press('2026-07-29', '{PageDown}', capped)).toHaveBeenCalledExactlyOnceWith('2026-07-30');
    expect(await press('2026-07-30', '{ArrowRight}', capped)).not.toHaveBeenCalled();
  });

  it('stops at the earliest start the cap allows while only a start is picked', async () => {
    // A start on Nov 1 with at most 91 days: the first start is Aug 3
    const capped = { from: '2026-11-01', min: '2026-08-03' };
    expect(await press('2026-08-05', '{PageUp}', capped)).toHaveBeenCalledExactlyOnceWith('2026-08-03');
    expect(await press('2026-08-03', '{ArrowLeft}', capped)).not.toHaveBeenCalled();
  });

  it('crosses into the next month, which the picker then shows', async () => {
    expect(
      await press('2026-10-31', '{ArrowRight}', { month: '2026-10-01', max: TODAY }),
    ).toHaveBeenCalledExactlyOnceWith('2026-11-01');
  });

  it('leaves Tab, Escape and letters alone, so the popover and the browser keep them', async () => {
    const onFocusDayChange = await press('2026-11-12', '{Escape}a{Tab}');
    expect(onFocusDayChange).not.toHaveBeenCalled();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    day('Thursday, Nov 12, 2026').dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
  });

  it('prevents the page from scrolling on the keys it handles', () => {
    renderWithProviders(<MonthGrid {...props({ focusDay: '2026-11-12' })} />);
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    day('Thursday, Nov 12, 2026').dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(true);
  });
});

describe('MonthGrid accessibility', () => {
  it.each(['light', 'dark'])('has no violation in the %s theme', async (theme) => {
    document.documentElement.className = theme === 'dark' ? 'dark' : '';
    try {
      const { container } = renderWithProviders(
        <MonthGrid {...props({ from: '2026-11-03', to: '2026-11-10', min: '2026-11-02' })} />,
      );
      expect(await axe(container)).toHaveNoViolations();
    } finally {
      document.documentElement.className = '';
    }
  });
});
