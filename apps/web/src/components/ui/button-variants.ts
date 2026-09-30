import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The variants and sizes of 09-buttons-controls.md section 2. Every button-like primitive reuses them.
 * This module has no `'use client'`, so a Server Component can call it too.
 *
 * Hover and pressed fills are written for a button that is neither disabled nor loading: a loading button
 * keeps its resting look (08-interaction-states.md section 1 puts loading above hover). A button that has
 * opened a menu or a popover keeps the pressed fill while it is open (`data-popup-open`).
 */
export const buttonVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md border type-body-strong whitespace-nowrap transition-colors duration-(--duration-fast) ease-standard select-none focus-visible:focus-ring aria-busy:cursor-progress data-disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary:
          'border-transparent bg-primary text-primary-foreground not-aria-busy:not-data-disabled:hover:bg-primary-hover not-aria-busy:not-data-disabled:active:bg-primary-hover',
        secondary:
          'border-border bg-surface text-foreground not-aria-busy:not-data-disabled:hover:bg-surface-hover not-aria-busy:not-data-disabled:active:bg-surface-selected data-popup-open:bg-surface-selected not-aria-busy:not-data-disabled:data-popup-open:hover:bg-surface-selected',
        subtle:
          'border-transparent bg-surface-subtle text-foreground not-aria-busy:not-data-disabled:hover:bg-surface-hover not-aria-busy:not-data-disabled:active:bg-surface-selected data-popup-open:bg-surface-selected not-aria-busy:not-data-disabled:data-popup-open:hover:bg-surface-selected',
        ghost:
          'border-transparent bg-transparent text-foreground-secondary not-aria-busy:not-data-disabled:hover:bg-surface-hover not-aria-busy:not-data-disabled:hover:text-foreground not-aria-busy:not-data-disabled:active:bg-surface-selected not-aria-busy:not-data-disabled:active:text-foreground data-popup-open:bg-surface-selected data-popup-open:text-foreground not-aria-busy:not-data-disabled:data-popup-open:hover:bg-surface-selected',
        destructive:
          'border-negative-border bg-surface text-negative-text not-aria-busy:not-data-disabled:hover:bg-negative-subtle not-aria-busy:not-data-disabled:active:border-negative-solid not-aria-busy:not-data-disabled:active:bg-negative-subtle',
        'destructive-solid':
          'border-transparent bg-negative-button text-negative-button-foreground not-aria-busy:not-data-disabled:hover:bg-negative-button-hover not-aria-busy:not-data-disabled:active:bg-negative-button-hover',
        link: 'border-transparent bg-transparent text-link underline-offset-2 not-aria-busy:not-data-disabled:hover:underline not-aria-busy:not-data-disabled:active:underline',
      },
      size: {
        sm: 'h-control-sm px-2',
        md: 'h-control px-3',
        lg: 'h-control-lg px-4',
        'icon-xs': 'size-6 px-0',
        'icon-sm': 'size-control-sm px-0',
        icon: 'size-control px-0',
      },
    },
    compoundVariants: [
      { variant: 'link', className: 'h-auto px-0' },
      {
        variant: ['primary', 'secondary', 'subtle', 'destructive', 'destructive-solid'],
        className:
          'data-disabled:border-transparent data-disabled:bg-surface-disabled data-disabled:text-foreground-disabled',
      },
      { variant: ['ghost', 'link'], className: 'data-disabled:text-foreground-disabled' },
    ],
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;
export type ButtonVariant = NonNullable<ButtonVariantProps['variant']>;
export type ButtonSize = NonNullable<ButtonVariantProps['size']>;

/** Small buttons draw a 14 px icon and spinner, the others 16 px. */
export const isSmallButton = (size: ButtonSize): boolean => size === 'sm' || size === 'icon-xs' || size === 'icon-sm';
