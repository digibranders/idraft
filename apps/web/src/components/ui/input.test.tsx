import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Input } from './input';
import type { InputSize } from './input-variants';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

describe('Input', () => {
  it('is a 36 px text box on the surface with the body style, 16 px on phones', () => {
    renderWithProviders(<Input aria-label="Project name" />);
    expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveClass(
      'h-control',
      'px-3',
      'w-full',
      'rounded-md',
      'border',
      'border-border',
      'bg-surface',
      // 16 px in the mobile layout, so iOS does not zoom on focus (19 section 10)
      'type-input-touch',
      'md:type-body',
      'focus-visible:focus-ring',
    );
  });

  it.each<[InputSize, string[]]>([
    ['sm', ['h-control-sm', 'px-2']],
    ['md', ['h-control', 'px-3']],
    ['lg', ['h-control-lg', 'px-3']],
  ])('size %s', (size, classes) => {
    renderWithProviders(<Input aria-label="Name" size={size} />);
    expect(screen.getByRole('textbox')).toHaveClass(...classes);
  });

  it('does not change on hover: no hover class at all', () => {
    renderWithProviders(<Input aria-label="Name" />);
    expect(screen.getByRole('textbox').className).not.toContain('hover:');
  });

  it('reports what is typed', async () => {
    const onValueChange = vi.fn();
    const { user } = renderWithProviders(<Input aria-label="Name" onValueChange={onValueChange} />);
    await user.type(screen.getByRole('textbox'), 'crm');
    expect(onValueChange).toHaveBeenLastCalledWith('crm', expect.anything());
    expect(screen.getByRole('textbox')).toHaveValue('crm');
  });

  it('shows an example of the format as placeholder, in the tertiary color', () => {
    renderWithProviders(<Input aria-label="Domain" placeholder="example.com" />);
    expect(screen.getByPlaceholderText('example.com')).toHaveClass('placeholder:text-foreground-tertiary');
  });

  it('cannot be edited when disabled, and says so with its fill and its cursor', async () => {
    const { user } = renderWithProviders(<Input aria-label="Language" disabled />);
    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
    expect(input).toHaveClass('data-disabled:bg-surface-disabled', 'data-disabled:cursor-not-allowed');
    await user.type(input, 'en');
    expect(input).toHaveValue('');
  });

  it('draws no border of its own inside an input group', () => {
    renderWithProviders(<Input aria-label="Limit" variant="bare" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveClass('flex-1', 'bg-transparent', 'outline-none');
    expect(input).not.toHaveClass('border');
    expect(input).not.toHaveClass('h-control');
  });

  it('passes other attributes and its ref on', () => {
    const ref = { current: null as HTMLInputElement | null };
    renderWithProviders(
      <Input aria-label="Email" type="email" autoComplete="email" name="email" className="max-w-form" ref={ref} />,
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('autocomplete', 'email');
    expect(input).toHaveAttribute('name', 'email');
    expect(input).toHaveAttribute('data-slot', 'input');
    expect(input).toHaveClass('max-w-form', 'h-control');
    expect(ref.current).toBe(input);
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<Input aria-label="Project name" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
