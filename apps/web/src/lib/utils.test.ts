import { describe, expect, it } from 'vitest';

import { NAMED_SIZES } from './design/class-names';
import { cn } from './utils';

describe('cn', () => {
  it('joins classes and drops falsy inputs', () => {
    expect(cn('flex', false, null, undefined, '', ['items-center', { 'gap-2': true, hidden: false }])).toBe(
      'flex items-center gap-2',
    );
  });

  it('lets the later of two Tailwind classes win', () => {
    expect(cn('px-3', 'px-4')).toBe('px-4');
    expect(cn('bg-surface', 'bg-surface-hover')).toBe('bg-surface-hover');
  });

  it('lets the later type utility win', () => {
    expect(cn('type-body', 'type-table')).toBe('type-table');
    expect(cn('type-metric', 'type-metric-sm')).toBe('type-metric-sm');
  });

  it('keeps a text color beside a type utility, in either order', () => {
    // Some type utilities set a color too (type-meta is tertiary). The text-* color utilities come later
    // in the stylesheet, so the explicit color wins whichever is written first: keeping both is the override.
    expect(cn('text-foreground', 'type-body')).toBe('text-foreground type-body');
    expect(cn('type-meta', 'text-foreground')).toBe('type-meta text-foreground');
  });

  it.each(NAMED_SIZES)('resolves the named size %s against another height, width and size', (name) => {
    expect(cn('h-4', `h-${name}`)).toBe(`h-${name}`);
    expect(cn(`w-${name}`, 'w-full')).toBe('w-full');
    expect(cn('size-4', `size-${name}`)).toBe(`size-${name}`);
  });

  it('resolves named sizes against each other', () => {
    expect(cn('h-control', 'h-control-sm')).toBe('h-control-sm');
    expect(cn('h-row', 'h-row-compact')).toBe('h-row-compact');
    expect(cn('max-w-popover-max', 'max-w-tooltip-max')).toBe('max-w-tooltip-max');
  });

  it('resolves the named container widths, which dialogs and forms use', () => {
    expect(cn('max-w-dialog-sm', 'max-w-dialog-md')).toBe('max-w-dialog-md');
    expect(cn('w-dialog-lg', 'w-dialog-sm')).toBe('w-dialog-sm');
    expect(cn('max-w-form', 'max-w-reading')).toBe('max-w-reading');
  });

  it('lets the later focus ring win, and lets a ring replace an outline class before it', () => {
    expect(cn('focus-ring', 'focus-ring-inset')).toBe('focus-ring-inset');
    expect(cn('focus-visible:outline-none', 'focus-visible:focus-ring')).toBe('focus-visible:focus-ring');
  });

  it('does not confuse a named size on one axis with the other axis', () => {
    expect(cn('h-control', 'w-sidebar')).toBe('h-control w-sidebar');
  });

  it('resolves the design system radii, shadows, easings and animations', () => {
    expect(cn('rounded-md', 'rounded-2xs')).toBe('rounded-2xs');
    expect(cn('shadow-popover', 'shadow-dialog')).toBe('shadow-dialog');
    expect(cn('ease-standard', 'ease-exit')).toBe('ease-exit');
    expect(cn('animate-spin', 'animate-skeleton-pulse')).toBe('animate-skeleton-pulse');
  });

  it('resolves classes with variants only within the same variant', () => {
    expect(cn('hover:bg-surface', 'hover:bg-surface-hover', 'bg-surface')).toBe('hover:bg-surface-hover bg-surface');
    expect(cn('rail:w-sidebar-collapsed', 'rail:w-sidebar')).toBe('rail:w-sidebar');
  });

  it('keeps the z-index token form and lets the later one win', () => {
    expect(cn('z-(--z-dropdown)', 'z-(--z-dialog)')).toBe('z-(--z-dialog)');
  });
});
