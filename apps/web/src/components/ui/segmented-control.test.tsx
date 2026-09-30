import { screen } from '@testing-library/react';
import { Monitor } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { FocusHandle } from './radio-group';
import { SegmentedControl, type SegmentedControlItem } from './segmented-control';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

type Device = 'desktop' | 'mobile' | 'both';
const ITEMS: readonly SegmentedControlItem<Device>[] = [
  { value: 'desktop', label: 'Desktop', icon: Monitor },
  { value: 'mobile', label: 'Mobile', count: '412' },
  { value: 'both', label: 'Both', disabled: true },
];

function Controlled({
  semantics = 'radio',
  size,
  onChange,
}: {
  semantics?: 'view' | 'radio';
  size?: 'sm' | 'md';
  onChange?: (value: Device) => void;
}): ReactElement {
  const [value, setValue] = useState<Device>('desktop');
  return (
    <SegmentedControl
      semantics={semantics}
      label="Device"
      value={value}
      items={ITEMS}
      size={size}
      onValueChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}
const segment = (name: RegExp): HTMLElement => screen.getByRole('radio', { name });

describe('SegmentedControl', () => {
  it('is a radio group with a visible legend when it sets a form value', () => {
    renderWithProviders(<Controlled />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Device' })).toBeInTheDocument();
    expect(screen.getByText('Device')).toHaveClass('type-label');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('is a radio group named without a visible label when it switches a view option', () => {
    renderWithProviders(<Controlled semantics="view" />);
    expect(screen.getByRole('radiogroup', { name: 'Device' })).toHaveAttribute('data-slot', 'segmented-control');
    expect(screen.queryByText('Device')).toBeNull();
  });

  it('says which segment is chosen with aria-checked, never with aria-pressed', () => {
    renderWithProviders(<Controlled />);
    expect(segment(/Desktop/)).toHaveAttribute('aria-checked', 'true');
    expect(segment(/Mobile/)).toHaveAttribute('aria-checked', 'false');
    for (const item of screen.getAllByRole('radio')) expect(item).not.toHaveAttribute('aria-pressed');
  });

  it('chooses on click', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<Controlled onChange={onChange} />);
    await user.click(segment(/Mobile/));
    expect(onChange).toHaveBeenCalledWith('mobile');
    expect(segment(/Mobile/)).toHaveAttribute('aria-checked', 'true');
  });

  it('moves and chooses with the arrow keys, skipping a disabled segment, and is one tab stop', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <>
        <Controlled onChange={onChange} />
        <button type="button">After</button>
      </>,
    );
    await user.tab();
    expect(segment(/Desktop/)).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(segment(/Mobile/)).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('mobile');
    await user.keyboard('{ArrowRight}');
    expect(segment(/Desktop/)).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('never lets a disabled segment be chosen', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<Controlled onChange={onChange} />);
    await user.click(segment(/Both/));
    expect(onChange).not.toHaveBeenCalled();
    expect(segment(/Both/)).toHaveAttribute('aria-disabled', 'true');
  });

  it('marks the chosen segment with tint, outline and weight, and joins the segments with single borders', () => {
    renderWithProviders(<Controlled />);
    expect(segment(/Desktop/)).toHaveClass(
      'border',
      'border-border',
      'not-first:-ml-px',
      'first-of-type:rounded-l-md',
      'last-of-type:rounded-r-md',
      'data-checked:relative',
      'data-checked:border-primary-border',
      'data-checked:bg-primary-subtle',
      'data-checked:type-body-strong',
      'data-checked:text-primary-text',
      'focus-visible:focus-ring-inset',
    );
    expect(segment(/Desktop/)).toHaveAttribute('data-checked');
  });

  it('finds its outer corners by type, because a hidden input follows every segment', () => {
    renderWithProviders(<Controlled />);
    const radios = screen.getAllByRole('radio');
    // Why `last:` would never match: the last segment is not the last child of the group
    expect(radios[2]?.nextElementSibling?.tagName).toBe('INPUT');
    expect(radios[2]?.matches(':last-of-type')).toBe(true);
    expect(radios[0]?.matches(':first-of-type')).toBe(true);
  });

  it.each([
    ['sm', 'h-control-sm', 'px-2', 'size-icon-sm'],
    ['md', 'h-control', 'px-3', 'size-icon'],
  ] as const)('size %s is %s with %s and a %s icon', (size, height, padding, icon) => {
    renderWithProviders(<Controlled size={size} />);
    expect(segment(/Desktop/)).toHaveClass(height, padding);
    expect(segment(/Desktop/).querySelector('svg')).toHaveClass(icon);
  });

  it('shows a count in tabular figures at the regular weight, so it keeps its width when chosen', () => {
    renderWithProviders(<Controlled />);
    expect(screen.getByText('412')).toHaveClass('num', 'type-body');
  });

  it('lets a form move focus to the chosen segment', () => {
    const focusRef = { current: null as FocusHandle | null };
    renderWithProviders(
      <SegmentedControl
        semantics="radio"
        label="Device"
        value="mobile"
        items={ITEMS}
        onValueChange={vi.fn()}
        focusRef={focusRef}
      />,
    );
    focusRef.current?.focus();
    expect(segment(/Mobile/)).toHaveFocus();
  });

  it('has no accessibility violations in either form', async () => {
    const { container } = renderWithProviders(
      <div>
        <Controlled />
        <Controlled semantics="view" size="sm" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
