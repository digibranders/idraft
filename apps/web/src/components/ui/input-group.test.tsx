import { screen } from '@testing-library/react';
import { Globe, X } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { Field, FieldLabel } from './field';
import { IconButton } from './icon-button';
import { Input } from './input';
import { InputGroup } from './input-group';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const group = (container: HTMLElement): Element => {
  const node = container.querySelector('[data-slot="input-group"]');
  if (!node) throw new Error('No input group rendered');
  return node;
};

describe('InputGroup', () => {
  it('draws the border, the fill and the focus ring around the input and its adornments', () => {
    const { container } = renderWithProviders(
      <InputGroup prefix="$">
        <Input aria-label="Monthly limit" variant="bare" />
      </InputGroup>,
    );
    expect(group(container)).toHaveClass(
      'h-control',
      'rounded-md',
      'border',
      'border-border',
      'bg-surface',
      'has-[input:focus-visible]:focus-ring',
      'has-[input[data-invalid]]:border-negative-solid',
      'has-[input[data-disabled]]:bg-surface-disabled',
    );
  });

  it('shows a prefix and a unit that are not part of the value or of the name', async () => {
    const { user } = renderWithProviders(
      <InputGroup prefix="$" suffix="per month">
        <Input aria-label="Monthly limit" variant="bare" />
      </InputGroup>,
    );
    expect(screen.getByText('$')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('per month')).toHaveAttribute('aria-hidden', 'true');
    await user.type(screen.getByRole('textbox', { name: 'Monthly limit' }), '250');
    expect(screen.getByRole('textbox')).toHaveValue('250');
  });

  it('shows a leading icon in the tertiary color', () => {
    const { container } = renderWithProviders(
      <InputGroup leadingIcon={Globe}>
        <Input aria-label="Domain" variant="bare" />
      </InputGroup>,
    );
    expect(container.querySelector('svg')).toHaveClass('size-icon', 'text-foreground-tertiary');
  });

  it('puts buttons 4 px from the end, each with its own name', () => {
    const { container } = renderWithProviders(
      <InputGroup trailing={<IconButton icon={X} label="Clear" size="icon-xs" />}>
        <Input aria-label="Search" variant="bare" />
      </InputGroup>,
    );
    expect(screen.getByRole('button', { name: 'Clear' })).toHaveClass('size-6');
    expect(group(container)).toHaveClass('pr-1', 'pl-3');
  });

  it.each([
    ['sm', 'h-control-sm', 'pl-2', 'pr-2'],
    ['md', 'h-control', 'pl-3', 'pr-3'],
    ['lg', 'h-control-lg', 'pl-3', 'pr-3'],
  ] as const)('size %s is %s with equal padding at both ends', (size, height, start, end) => {
    const { container } = renderWithProviders(
      <InputGroup size={size}>
        <Input aria-label="Value" variant="bare" />
      </InputGroup>,
    );
    expect(group(container)).toHaveClass(height, start, end);
  });

  it('carries the invalid and disabled marks of its input, which the group styles read', () => {
    const { container } = renderWithProviders(
      <Field invalid disabled>
        <FieldLabel>Monthly limit</FieldLabel>
        <InputGroup prefix="$">
          <Input variant="bare" />
        </InputGroup>
      </Field>,
    );
    expect(group(container).querySelector('input[data-invalid][data-disabled]')).not.toBeNull();
  });

  it('reads the disabled look from its input only: a disabled button beside an enabled input marks nothing', () => {
    const { container } = renderWithProviders(
      <InputGroup trailing={<IconButton icon={X} label="Clear" size="icon-xs" disabled />}>
        <Input aria-label="Search" variant="bare" />
      </InputGroup>,
    );
    // The button carries data-disabled, which a selector on any descendant would match
    expect(screen.getByRole('button', { name: 'Clear' })).toHaveAttribute('data-disabled');
    expect(group(container).querySelector('input[data-disabled]')).toBeNull();
    expect(group(container).className).not.toContain('has-data-disabled');
  });

  it('puts the caret in the input when the unit or the padding is pressed, and leaves its buttons alone', async () => {
    const { user, container } = renderWithProviders(
      <InputGroup prefix="$" trailing={<IconButton icon={X} label="Clear" size="icon-xs" />}>
        <Input aria-label="Monthly limit" variant="bare" />
      </InputGroup>,
    );
    await user.pointer({ keys: '[MouseLeft>]', target: screen.getByText('$') });
    expect(screen.getByRole('textbox')).toHaveFocus();
    await user.pointer({ keys: '[/MouseLeft]' });
    screen.getByRole('textbox').blur();
    await user.pointer({ keys: '[MouseLeft]', target: group(container) });
    expect(screen.getByRole('textbox')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('button', { name: 'Clear' })).toHaveFocus();
  });

  it('passes other attributes on to its root', () => {
    const { container } = renderWithProviders(
      <InputGroup id="limit-group" className="max-w-form">
        <Input aria-label="Value" variant="bare" />
      </InputGroup>,
    );
    expect(group(container)).toHaveAttribute('id', 'limit-group');
    expect(group(container)).toHaveClass('max-w-form');
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(
      <Field>
        <FieldLabel>Monthly limit</FieldLabel>
        <InputGroup prefix="$" trailing={<IconButton icon={X} label="Clear" size="icon-xs" />}>
          <Input variant="bare" />
        </InputGroup>
      </Field>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
