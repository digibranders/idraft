import { screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CountTabs, toggleCountTab, type CountTabsItem, type CountTabsProps } from './count-tabs';
import { EMPTY_VALUE } from '@/lib/format';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

type EventType = 'rank' | 'url' | 'aio';

const ITEMS: readonly CountTabsItem<EventType>[] = [
  { value: 'rank', label: 'Rank moves', countText: '12' },
  { value: 'url', label: 'URL changes', countText: '4' },
  { value: 'aio', label: 'AI Overview', countText: EMPTY_VALUE },
];

function baseProps(
  value: readonly EventType[],
  onValueChange: (next: readonly EventType[]) => void,
  items: readonly CountTabsItem<EventType>[] = ITEMS,
): CountTabsProps<EventType> {
  return { label: 'Event types', allLabel: 'All events', allCountText: '23', items, value, onValueChange };
}

function Controlled({
  initial = [],
  items,
  spy,
}: {
  initial?: readonly EventType[];
  items?: readonly CountTabsItem<EventType>[];
  spy?: (next: readonly EventType[]) => void;
}): ReactElement {
  const [value, setValue] = useState<readonly EventType[]>(initial);
  return (
    <CountTabs
      {...baseProps(
        value,
        (next) => {
          spy?.(next);
          setValue(next);
        },
        items,
      )}
    />
  );
}

const button = (name: string): HTMLElement => screen.getByRole('button', { name });

describe('toggleCountTab', () => {
  it('adds a type that is not pressed, keeping the order of pressing', () => {
    expect(toggleCountTab([], 'rank')).toEqual(['rank']);
    expect(toggleCountTab(['rank'], 'url')).toEqual(['rank', 'url']);
  });

  it('removes a pressed type and gives [] when the last one goes', () => {
    expect(toggleCountTab(['rank', 'url'], 'rank')).toEqual(['url']);
    expect(toggleCountTab(['rank'], 'rank')).toEqual([]);
  });

  it('does not change its input', () => {
    const value: readonly EventType[] = ['rank'];
    toggleCountTab(value, 'url');
    expect(value).toEqual(['rank']);
  });
});

describe('CountTabs', () => {
  it('is a toolbar named by its label, with every name carrying its count', () => {
    renderWithProviders(<Controlled />);
    expect(screen.getByRole('toolbar', { name: 'Event types' })).toBeInTheDocument();
    expect(button('All events, 23')).toBeInTheDocument();
    expect(button('Rank moves, 12')).toBeInTheDocument();
    expect(button('URL changes, 4')).toBeInTheDocument();
    // An unknown count is shown as unknown, never as 0
    expect(button(`AI Overview, ${EMPTY_VALUE}`)).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows the count beside the label in a badge', () => {
    renderWithProviders(<Controlled />);
    const rank = button('Rank moves, 12');
    expect(rank).toHaveTextContent('Rank moves12');
    expect(rank.querySelector('[data-slot="badge"]')).toHaveTextContent('12');
  });

  it('presses All for [] and shows All unpressed after a type is pressed', async () => {
    const spy = vi.fn();
    const { user } = renderWithProviders(<Controlled spy={spy} />);
    expect(button('All events, 23')).toHaveAttribute('aria-pressed', 'true');
    await user.click(button('Rank moves, 12'));
    expect(spy).toHaveBeenLastCalledWith(['rank']);
    expect(button('Rank moves, 12')).toHaveAttribute('aria-pressed', 'true');
    expect(button('All events, 23')).toHaveAttribute('aria-pressed', 'false');
  });

  it('presses several types, and unpressing the last returns to All', async () => {
    const spy = vi.fn();
    const { user } = renderWithProviders(<Controlled spy={spy} />);
    await user.click(button('Rank moves, 12'));
    await user.click(button('URL changes, 4'));
    expect(spy).toHaveBeenLastCalledWith(['rank', 'url']);
    await user.click(button('Rank moves, 12'));
    expect(spy).toHaveBeenLastCalledWith(['url']);
    await user.click(button('URL changes, 4'));
    expect(spy).toHaveBeenLastCalledWith([]);
    expect(button('All events, 23')).toHaveAttribute('aria-pressed', 'true');
  });

  it('clears the selection when All is pressed, and does nothing when All is already pressed', async () => {
    const spy = vi.fn();
    const { user } = renderWithProviders(<Controlled initial={['rank', 'url']} spy={spy} />);
    await user.click(button('All events, 23'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith([]);
    await user.click(button('All events, 23'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('marks the pressed item with the primary fill and a count on primary-hover, and not by colour alone', () => {
    renderWithProviders(<Controlled initial={['rank']} />);
    const rank = button('Rank moves, 12');
    // Weight 500 comes with `type-body-strong`: the pressed label is heavier, which is a second cue besides the fill
    expect(rank).toHaveClass('bg-primary', 'text-primary-foreground', 'type-body-strong', 'border-primary');
    expect(rank.querySelector('[data-slot="badge"]')).toHaveClass('bg-primary-hover', 'text-primary-foreground');
    const url = button('URL changes, 4');
    expect(url).not.toHaveClass('bg-primary');
    expect(url).toHaveClass('border-border', 'bg-surface', 'hover:bg-surface-hover');
    // The state is also in the attribute that assistive technology reads
    expect(rank).toHaveAttribute('aria-pressed', 'true');
    expect(url).toHaveAttribute('aria-pressed', 'false');
  });

  it('uses the control height of its size', () => {
    const first = renderWithProviders(<Controlled />);
    expect(button('All events, 23')).toHaveClass('h-control');
    first.unmount();
    renderWithProviders(<CountTabs {...baseProps([], vi.fn())} size="sm" />);
    expect(button('All events, 23')).toHaveClass('h-control-sm');
  });

  it('is one Tab stop: All for [], the pressed item otherwise', async () => {
    const first = renderWithProviders(<Controlled />);
    const stops = (): string[] =>
      screen
        .getAllByRole('button')
        .filter((item) => item.tabIndex === 0)
        .map((item) => item.textContent ?? '');
    expect(stops()).toEqual(['All events23']);
    await first.user.tab();
    expect(button('All events, 23')).toHaveFocus();
    first.unmount();
    renderWithProviders(<Controlled initial={['url']} />);
    expect(stops()).toEqual(['URL changes4']);
  });

  it('moves focus with Left and Right, wrapping at both ends, and with Home and End', async () => {
    const { user } = renderWithProviders(<Controlled />);
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(button('Rank moves, 12')).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(button(`AI Overview, ${EMPTY_VALUE}`)).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(button('All events, 23')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(button(`AI Overview, ${EMPTY_VALUE}`)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(button('All events, 23')).toHaveFocus();
    await user.keyboard('{End}');
    expect(button(`AI Overview, ${EMPTY_VALUE}`)).toHaveFocus();
    // Moving focus does not press anything
    expect(button('All events, 23')).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles the focused item with Space and Enter', async () => {
    const spy = vi.fn();
    const { user } = renderWithProviders(<Controlled spy={spy} />);
    await user.tab();
    await user.keyboard('{ArrowRight} ');
    expect(spy).toHaveBeenLastCalledWith(['rank']);
    await user.keyboard('{Enter}');
    expect(spy).toHaveBeenLastCalledWith([]);
  });

  it('keeps the Tab stop on the item that was last focused with the arrows', async () => {
    const { user } = renderWithProviders(<Controlled />);
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(button('Rank moves, 12')).toHaveAttribute('tabindex', '0');
    expect(button('All events, 23')).toHaveAttribute('tabindex', '-1');
  });

  it('keeps a disabled item focusable, shows its reason and does not toggle', async () => {
    const spy = vi.fn();
    const items: readonly CountTabsItem<EventType>[] = [
      ...ITEMS.slice(0, 2),
      { value: 'aio', label: 'AI Overview', countText: '0', disabledReason: 'No AI Overview events in this window' },
    ];
    const { user } = renderWithProviders(<Controlled items={items} spy={spy} />);
    const disabled = button('AI Overview, 0');
    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    expect(disabled).not.toBeDisabled();
    await user.tab();
    await user.keyboard('{End}');
    expect(disabled).toHaveFocus();
    expect(disabled).toHaveAccessibleDescription('No AI Overview events in this window');
    await user.click(disabled);
    await user.keyboard(' {Enter}');
    expect(spy).not.toHaveBeenCalled();
    expect(disabled).toHaveAttribute('aria-pressed', 'false');
  });

  it('presses nothing, and says so, when the value holds a type that is not among the items', () => {
    renderWithProviders(<CountTabs {...baseProps(['url'], vi.fn(), ITEMS.slice(0, 1))} />);
    // A type that is not offered (a filter left over from another window) is not drawn as pressed ...
    expect(screen.getAllByRole('button').filter((item) => item.getAttribute('aria-pressed') === 'true')).toHaveLength(
      0,
    );
    // ... and the toolbar marks the state, so the caller and a test can tell it from a plain "All"
    expect(screen.getByRole('toolbar')).toHaveAttribute('data-unmatched-value', 'true');
    // The toolbar stays one Tab stop
    expect(screen.getAllByRole('button').filter((item) => item.tabIndex === 0)).toHaveLength(1);
  });

  it('does not mark a matched or empty value as unmatched', () => {
    const first = renderWithProviders(<Controlled />);
    expect(screen.getByRole('toolbar')).not.toHaveAttribute('data-unmatched-value');
    first.unmount();
    renderWithProviders(<Controlled initial={['rank']} />);
    expect(screen.getByRole('toolbar')).not.toHaveAttribute('data-unmatched-value');
  });

  it('keys an item whose value is the empty string apart from "All"', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const onValueChange = vi.fn();
      renderWithProviders(
        <CountTabs
          label="Types"
          allLabel="All"
          allCountText="3"
          items={[
            { value: '', label: 'Other', countText: '1' },
            { value: 'rank', label: 'Rank', countText: '2' },
          ]}
          value={[]}
          onValueChange={onValueChange}
        />,
      );
      expect(screen.getAllByRole('button')).toHaveLength(3);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('renders hostile labels as text', () => {
    const items: readonly CountTabsItem<EventType>[] = [
      { value: 'rank', label: '<img src=x onerror=alert(1)>', countText: '1' },
    ];
    const { container } = renderWithProviders(<Controlled items={items} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it.each(['light', 'dark'])('has no violation in the %s theme', async (theme) => {
    document.documentElement.className = theme === 'dark' ? 'dark' : '';
    try {
      const { container } = renderWithProviders(
        <Controlled
          initial={['rank']}
          items={[
            ...ITEMS.slice(0, 2),
            { value: 'aio', label: 'AI Overview', countText: '0', disabledReason: 'None in this window' },
          ]}
        />,
      );
      expect(await axe(container)).toHaveNoViolations();
    } finally {
      document.documentElement.className = '';
    }
  });
});
