import { screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SettingRow } from './setting-row';
import { Switch } from './switch';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

function Controlled({
  busy = false,
  onChange,
}: {
  busy?: boolean;
  onChange?: (checked: boolean) => void;
}): ReactElement {
  const [checked, setChecked] = useState(false);
  return (
    <Switch
      aria-label="Weekly digest"
      checked={checked}
      busy={busy}
      onCheckedChange={(next) => {
        setChecked(next);
        onChange?.(next);
      }}
    />
  );
}

describe('Switch', () => {
  it('is a switch that says whether it is on', () => {
    renderWithProviders(<Switch aria-label="Weekly digest" checked={false} />);
    expect(screen.getByRole('switch', { name: 'Weekly digest' })).toHaveAttribute('aria-checked', 'false');
  });

  it('flips on click, Space and Enter', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<Controlled onChange={onChange} />);
    const control = screen.getByRole('switch');
    await user.click(control);
    expect(control).toHaveAttribute('aria-checked', 'true');
    await user.keyboard(' ');
    expect(control).toHaveAttribute('aria-checked', 'false');
    await user.keyboard('{Enter}');
    expect(control).toHaveAttribute('aria-checked', 'true');
    expect(onChange.mock.calls.map(([value]) => value as boolean)).toEqual([true, false, true]);
  });

  it('is a 36 by 20 px track with a 16 px thumb and a 24 px target', () => {
    const { container } = renderWithProviders(<Switch aria-label="Weekly digest" checked />);
    const control = screen.getByRole('switch');
    expect(control).toHaveClass('h-5', 'w-9', 'rounded-full', 'data-checked:bg-primary', 'after:-inset-y-0.5');
    expect(container.querySelector('[data-slot="switch"] > span')).toHaveClass('size-4', 'data-checked:translate-x-4');
  });

  it('ignores toggles while its save is pending, and says it is busy', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<Controlled busy onChange={onChange} />);
    const control = screen.getByRole('switch');
    expect(control).toHaveAttribute('aria-busy', 'true');
    await user.click(control);
    await user.keyboard(' ');
    expect(onChange).not.toHaveBeenCalled();
    expect(control).toHaveAttribute('aria-checked', 'false');
  });

  it('does not react when disabled', async () => {
    const onCheckedChange = vi.fn();
    const { user } = renderWithProviders(
      <Switch aria-label="Weekly digest" checked={false} disabled onCheckedChange={onCheckedChange} />,
    );
    await user.click(screen.getByRole('switch'));
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true');
  });

  it('passes other attributes and its ref on', () => {
    const ref = { current: null as HTMLElement | null };
    renderWithProviders(
      <Switch aria-label="Weekly digest" checked={false} data-testid="digest" className="ml-auto" ref={ref} />,
    );
    expect(ref.current).toBe(screen.getByRole('switch'));
    expect(screen.getByRole('switch')).toHaveAttribute('data-testid', 'digest');
    expect(screen.getByRole('switch')).toHaveClass('ml-auto', 'h-5');
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<Switch aria-label="Weekly digest" checked />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('SettingRow', () => {
  it('names the switch with its label and describes it with its description', () => {
    renderWithProviders(
      <SettingRow
        label="Weekly digest"
        description="A summary of rank and visibility changes every Monday"
        control={<Switch checked={false} />}
      />,
    );
    const control = screen.getByRole('switch', { name: 'Weekly digest' });
    expect(control).toHaveAccessibleDescription('A summary of rank and visibility changes every Monday');
  });

  it('flips the switch when its label is clicked', async () => {
    const onCheckedChange = vi.fn();
    const { user } = renderWithProviders(
      <SettingRow label="Weekly digest" control={<Switch checked={false} onCheckedChange={onCheckedChange} />} />,
    );
    await user.click(screen.getByText('Weekly digest'));
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it('shows why the last change was not saved, under the row', () => {
    renderWithProviders(
      <SettingRow
        label="Weekly digest"
        control={<Switch checked={false} />}
        error="Could not turn on weekly digest. Try again."
      />,
    );
    expect(screen.getByText('Could not turn on weekly digest. Try again.')).toHaveClass(
      'type-meta',
      'text-negative-text',
    );
    expect(screen.getByRole('switch')).toHaveAccessibleDescription('Could not turn on weekly digest. Try again.');
  });

  it('puts the name on the left and the switch on the right', () => {
    const { container } = renderWithProviders(
      <SettingRow label="Weekly digest" control={<Switch checked={false} />} />,
    );
    const row = container.querySelector('[data-slot="setting-row"]');
    expect(row?.firstElementChild).toHaveClass('flex', 'justify-between', 'gap-4');
    expect(screen.getByText('Weekly digest')).toHaveClass('type-body', 'text-foreground');
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(
      <SettingRow
        label="Weekly digest"
        description="Every Monday"
        control={<Switch checked />}
        error="Could not save."
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
