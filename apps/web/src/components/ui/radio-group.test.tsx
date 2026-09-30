import { screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RadioGroup, type FocusHandle, type RadioOption } from './radio-group';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

type Action = 'pause' | 'notify' | 'continue';
const OPTIONS: readonly RadioOption<Action>[] = [
  { value: 'pause', label: 'Pause collection', description: 'No checks run until the next month' },
  { value: 'notify', label: 'Notify only' },
  { value: 'continue', label: 'Keep collecting', disabled: true },
];

function Controlled({
  initial = null,
  presentation,
  onChange,
}: {
  initial?: Action | null;
  presentation?: 'list' | 'cards';
  onChange?: (value: Action) => void;
}): ReactElement {
  const [value, setValue] = useState<Action | null>(initial);
  return (
    <RadioGroup
      legend="At the hard limit"
      value={value}
      options={OPTIONS}
      presentation={presentation}
      onValueChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}
const radio = (name: string): HTMLElement => screen.getByRole('radio', { name });

describe('RadioGroup', () => {
  it('is a radio group named by its legend, with one radio per option', () => {
    renderWithProviders(<Controlled />);
    expect(screen.getByRole('radiogroup', { name: 'At the hard limit' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByText('At the hard limit')).toHaveClass('type-label');
  });

  it('starts with nothing chosen only when it is given no value', () => {
    renderWithProviders(<Controlled />);
    for (const item of screen.getAllByRole('radio')) expect(item).toHaveAttribute('aria-checked', 'false');
  });

  it('chooses on a click on the circle or on the label', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<Controlled onChange={onChange} />);
    await user.click(radio('Notify only'));
    expect(radio('Notify only')).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByText('Pause collection'));
    expect(radio('Pause collection')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Notify only')).toHaveAttribute('aria-checked', 'false');
    expect(onChange.mock.calls.map(([value]) => value as Action)).toEqual(['notify', 'pause']);
  });

  it('moves and chooses with the arrow keys, skipping a disabled option', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<Controlled initial="pause" onChange={onChange} />);
    radio('Pause collection').focus();
    await user.keyboard('{ArrowDown}');
    expect(radio('Notify only')).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('notify');
    await user.keyboard('{ArrowDown}');
    expect(radio('Pause collection')).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('pause');
  });

  it('describes an option with the line under its label, which is not part of its name', () => {
    renderWithProviders(<Controlled />);
    expect(radio('Pause collection')).toHaveAccessibleDescription('No checks run until the next month');
  });

  it('does not let a disabled option be chosen', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<Controlled onChange={onChange} />);
    await user.click(screen.getByText('Keep collecting'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Keep collecting')).toHaveClass('text-foreground-disabled');
  });

  it('draws a 16 px circle in a 24 px target, with the focus ring on the circle', () => {
    renderWithProviders(<Controlled initial="notify" />);
    const item = radio('Notify only');
    expect(item).toHaveClass(
      'size-4',
      'rounded-full',
      'border-border-strong',
      'data-checked:bg-primary',
      'focus-visible:focus-ring',
    );
    expect(item.parentElement).toHaveClass('size-6');
    expect(item).toHaveAttribute('data-checked');
  });

  it('draws each option as a card when every option needs a sentence, with the ring on the card', () => {
    renderWithProviders(<Controlled presentation="cards" />);
    const card = radio('Pause collection').closest('label');
    expect(card).toHaveClass(
      'rounded-md',
      'border',
      'p-3',
      'has-data-checked:border-primary-border',
      'has-data-checked:bg-surface-selected',
      'has-focus-visible:focus-ring',
    );
    expect(radio('Pause collection')).not.toHaveClass('focus-visible:focus-ring');
  });

  it('disables every option when the group is disabled', () => {
    renderWithProviders(
      <RadioGroup legend="At the hard limit" value="pause" options={OPTIONS} onValueChange={vi.fn()} disabled />,
    );
    for (const item of screen.getAllByRole('radio')) expect(item).toHaveAttribute('aria-disabled', 'true');
  });

  it('lets a form move focus into the group: to the chosen radio, or the first enabled one', () => {
    const focusRef = { current: null as FocusHandle | null };
    const { rerender } = renderWithProviders(
      <RadioGroup
        legend="At the hard limit"
        value="notify"
        options={OPTIONS}
        onValueChange={vi.fn()}
        focusRef={focusRef}
      />,
    );
    focusRef.current?.focus();
    expect(radio('Notify only')).toHaveFocus();
    rerender(
      <RadioGroup
        legend="At the hard limit"
        value={null}
        options={OPTIONS}
        onValueChange={vi.fn()}
        focusRef={focusRef}
      />,
    );
    radio('Notify only').blur();
    focusRef.current?.focus();
    expect(radio('Pause collection')).toHaveFocus();
  });

  it('has no accessibility violations as a list and as cards', async () => {
    const { container } = renderWithProviders(
      <div>
        <Controlled initial="pause" />
        <Controlled initial="notify" presentation="cards" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
