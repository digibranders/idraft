import { screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from './checkbox';
import { Field } from './field';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

function Controlled({ onChange }: { onChange?: (checked: boolean) => void }): ReactElement {
  const [checked, setChecked] = useState(false);
  return (
    <Checkbox
      checked={checked}
      label="Track AI visibility"
      onCheckedChange={(next) => {
        setChecked(next);
        onChange?.(next);
      }}
    />
  );
}

describe('Checkbox', () => {
  it('is a checkbox named by its label', () => {
    renderWithProviders(<Checkbox checked={false} label="Track AI visibility" />);
    expect(screen.getByRole('checkbox', { name: 'Track AI visibility' })).toHaveAttribute('aria-checked', 'false');
  });

  it('toggles on a click on the box, on a click on the label and on Space', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<Controlled onChange={onChange} />);
    const box = screen.getByRole('checkbox');
    await user.click(box);
    expect(box).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByText('Track AI visibility'));
    expect(box).toHaveAttribute('aria-checked', 'false');
    box.focus();
    await user.keyboard(' ');
    expect(box).toHaveAttribute('aria-checked', 'true');
    expect(onChange.mock.calls.map(([value]) => value as boolean)).toEqual([true, false, true]);
  });

  it('is a 16 px box in a 24 px target, solid primary with a check when checked', () => {
    const { container } = renderWithProviders(<Checkbox checked label="Track AI visibility" />);
    const box = screen.getByRole('checkbox');
    expect(box).toHaveClass('size-4', 'rounded-sm', 'border-border-strong', 'data-checked:bg-primary');
    expect(box.parentElement).toHaveClass('size-6');
    expect(box).toHaveAttribute('data-checked');
    expect(container.querySelector('svg')).toHaveClass('size-icon-xs');
  });

  it('is mixed for a parent of which some children are checked', () => {
    renderWithProviders(<Checkbox checked="indeterminate" label="Select all" />);
    const box = screen.getByRole('checkbox', { name: 'Select all' });
    expect(box).toHaveAttribute('aria-checked', 'mixed');
    expect(box).toHaveAttribute('data-indeterminate');
  });

  it('is described by the line under its label, which is not part of its name', () => {
    renderWithProviders(
      <Checkbox checked={false} label="Both devices" description="Adds two tracked keywords for each keyword" />,
    );
    const box = screen.getByRole('checkbox', { name: 'Both devices' });
    expect(box).toHaveAccessibleDescription('Adds two tracked keywords for each keyword');
    expect(screen.getByText('Adds two tracked keywords for each keyword')).toHaveClass('pl-8', 'type-meta');
  });

  it('keeps its name when the label is not shown, as in a table cell', () => {
    renderWithProviders(<Checkbox checked={false} label="Select crm pricing" labelDisplay="visually-hidden" />);
    expect(screen.getByRole('checkbox', { name: 'Select crm pricing' })).toBeInTheDocument();
    expect(screen.getByText('Select crm pricing')).toHaveClass('sr-only');
  });

  it('does not react when disabled, and dims its label', async () => {
    const onCheckedChange = vi.fn();
    const { user } = renderWithProviders(
      <Checkbox checked={false} label="Track AI visibility" disabled onCheckedChange={onCheckedChange} />,
    );
    await user.click(screen.getByText('Track AI visibility'));
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Track AI visibility')).toHaveClass('text-foreground-disabled');
  });

  it('shows the invalid state of its field', () => {
    renderWithProviders(
      <Field invalid>
        <Checkbox checked={false} label="I accept the terms" />
      </Field>,
    );
    expect(screen.getByRole('checkbox')).toHaveAttribute('data-invalid');
  });

  it('passes other attributes and its ref on to the box', () => {
    const ref = { current: null as HTMLElement | null };
    renderWithProviders(<Checkbox checked={false} label="Terms" name="terms" data-testid="terms" ref={ref} />);
    expect(ref.current).toBe(screen.getByRole('checkbox'));
    expect(screen.getByRole('checkbox')).toHaveAttribute('data-testid', 'terms');
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(
      <div>
        <Checkbox checked label="Desktop" />
        <Checkbox checked="indeterminate" label="Select all" description="3 of 8 selected" />
        <Checkbox checked={false} label="Select crm pricing" labelDisplay="visually-hidden" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
