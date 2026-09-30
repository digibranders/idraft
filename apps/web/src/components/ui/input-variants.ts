import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The look of a text control (10-forms.md section 4), shared by `Input`, the `Select` trigger and
 * `InputGroup`. An input does not change on hover, and its border keeps its color on focus: the ring says
 * where focus is.
 */
export const inputVariants = cva(
  'min-w-0 type-body text-foreground placeholder:text-foreground-tertiary data-disabled:cursor-not-allowed data-disabled:text-foreground-disabled',
  {
    variants: {
      variant: {
        outline:
          'w-full rounded-md border border-border bg-surface focus-visible:focus-ring data-disabled:bg-surface-disabled data-invalid:border-negative-solid',
        // Inside an InputGroup, which draws the border, the fill and the focus ring
        bare: 'h-full flex-1 bg-transparent outline-none',
      },
      size: { sm: '', md: '', lg: '' },
    },
    compoundVariants: [
      { variant: 'outline', size: 'sm', className: 'h-control-sm px-2' },
      { variant: 'outline', size: 'md', className: 'h-control px-3' },
      { variant: 'outline', size: 'lg', className: 'h-control-lg px-3' },
    ],
    defaultVariants: { variant: 'outline', size: 'md' },
  },
);

type InputVariantProps = VariantProps<typeof inputVariants>;
/** 32 px in inline forms, 36 px by default, 40 px in auth and onboarding only. */
export type InputSize = NonNullable<InputVariantProps['size']>;
export type InputVariant = NonNullable<InputVariantProps['variant']>;
