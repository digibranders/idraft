import { screen } from '@testing-library/react';
import { Download } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';
import type { ButtonSize, ButtonVariant } from './button-variants';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

describe('Button', () => {
  it('is a button that does not submit a form unless asked to', () => {
    renderWithProviders(<Button>Export CSV</Button>);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toHaveAttribute('type', 'button');
  });

  it('submits when it is the form’s submit button', () => {
    renderWithProviders(<Button type="submit">Save changes</Button>);
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveAttribute('type', 'submit');
  });

  it('is secondary at 36 px by default', () => {
    renderWithProviders(<Button>Import</Button>);
    expect(screen.getByRole('button')).toHaveClass(
      'bg-surface',
      'border-border',
      'h-control',
      'px-3',
      'type-body-strong',
    );
  });

  it.each<[ButtonVariant, string[]]>([
    ['primary', ['bg-primary', 'text-primary-foreground', 'border-transparent']],
    ['secondary', ['bg-surface', 'text-foreground', 'border-border']],
    ['subtle', ['bg-surface-subtle', 'text-foreground', 'border-transparent']],
    ['ghost', ['bg-transparent', 'text-foreground-secondary', 'border-transparent']],
    ['destructive', ['bg-surface', 'text-negative-text', 'border-negative-border']],
    ['destructive-solid', ['bg-negative-button', 'text-negative-button-foreground']],
    ['link', ['text-link', 'h-auto', 'px-0']],
  ])('variant %s', (variant, classes) => {
    renderWithProviders(<Button variant={variant}>Run check</Button>);
    expect(screen.getByRole('button')).toHaveClass(...classes);
  });

  it.each<[ButtonSize, string[]]>([
    ['sm', ['h-control-sm', 'px-2']],
    ['md', ['h-control', 'px-3']],
    ['lg', ['h-control-lg', 'px-4']],
    ['icon-xs', ['size-6', 'px-0']],
    ['icon-sm', ['size-control-sm', 'px-0']],
    ['icon', ['size-control', 'px-0']],
  ])('size %s', (size, classes) => {
    renderWithProviders(<Button size={size}>Add</Button>);
    expect(screen.getByRole('button')).toHaveClass(...classes);
  });

  it('draws a 14 px icon in small sizes and a 16 px icon otherwise', () => {
    const { container, rerender } = renderWithProviders(
      <Button size="sm" icon={Download}>
        Export
      </Button>,
    );
    expect(container.querySelector('svg')).toHaveClass('size-icon-sm');
    rerender(<Button icon={Download}>Export</Button>);
    expect(container.querySelector('svg')).toHaveClass('size-icon');
  });

  it('calls the handler on click, Enter and Space', async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(<Button onClick={onClick}>Run check</Button>);
    await user.click(screen.getByRole('button'));
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('ignores clicks while loading, and keeps its name, its colors and its place in the tab order', async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <Button variant="primary" loading onClick={onClick}>
        Save changes
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveClass('bg-primary');
    expect(button).not.toHaveAttribute('disabled');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('stays in the tab order while loading and ignores Enter and Space', async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <>
        <Button loading onClick={onClick}>
          Save changes
        </Button>
        <Button>Cancel</Button>
      </>,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).not.toHaveBeenCalled();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('does not submit its form a second time while loading', async () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const { user, rerender } = renderWithProviders(
      <form ref={(form) => form?.addEventListener('submit', onSubmit)}>
        <Button type="submit">Save changes</Button>
      </form>,
    );
    await user.click(screen.getByRole('button'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    rerender(
      <form ref={(form) => form?.addEventListener('submit', onSubmit)}>
        <Button type="submit" loading>
          Save changes
        </Button>
      </form>,
    );
    await user.click(screen.getByRole('button'));
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  // jsdom applies no stylesheet, so this checks the class names only. That the selector is generated and
  // wins under a real pointer was measured in the browser and belongs to the Playwright run.
  it('keeps its resting fill under the pointer while loading or disabled', () => {
    renderWithProviders(<Button variant="primary">Save</Button>);
    const classes = screen.getByRole('button').className.split(' ');
    const hover = classes.filter((name) => name.includes('hover:') || name.includes('active:'));
    expect(hover.length).toBeGreaterThan(0);
    for (const name of hover) expect(name).toMatch(/^not-aria-busy:not-data-disabled:/);
  });

  it('passes other attributes on to the button', () => {
    renderWithProviders(
      <Button form="settings" name="intent" value="save" aria-describedby="hint">
        Save
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('form', 'settings');
    expect(button).toHaveAttribute('name', 'intent');
    expect(button).toHaveAttribute('aria-describedby', 'hint');
  });

  it('keeps the label in layout at zero opacity while loading without an icon, so the width holds', () => {
    const { container } = renderWithProviders(<Button loading>Save changes</Button>);
    expect(screen.getByText('Save changes')).toHaveClass('opacity-0');
    expect(container.querySelector('[data-slot="spinner"]')).toHaveClass('absolute');
  });

  it('replaces the leading icon by the spinner while loading and leaves the label visible', () => {
    const { container } = renderWithProviders(
      <Button loading icon={Download}>
        Export
      </Button>,
    );
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(container.querySelector('svg')).toHaveClass('animate-spin');
    expect(container.querySelector('.opacity-0')).toBeNull();
  });

  it('does not react when disabled', async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <Button disabled onClick={onClick}>
        Delete project
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('data-disabled');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('stays reachable by keyboard when it is disabled with a reason', async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <Button disabled focusableWhenDisabled onClick={onClick}>
        Archive
      </Button>,
    );
    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    expect(screen.getByRole('button')).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('lets the caller place it without changing its look', () => {
    renderWithProviders(<Button className="w-full">Sign in</Button>);
    expect(screen.getByRole('button')).toHaveClass('w-full', 'h-control');
  });

  it('has no accessibility violations in any variant', async () => {
    const { container } = renderWithProviders(
      <div>
        <Button variant="primary">Add keywords</Button>
        <Button>Export</Button>
        <Button variant="destructive">Remove competitor</Button>
        <Button loading>Save changes</Button>
        <Button disabled>Run check</Button>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
