import { OTPField as OTPFieldPrimitive } from '@base-ui/react/otp-field';
import type { ReactElement, Ref } from 'react';

import { cn } from '@/lib/utils';

export interface OtpFieldProps extends Omit<
  OTPFieldPrimitive.Root.Props,
  'className' | 'render' | 'children' | 'length'
> {
  /** The number of digits. An authenticator code has 6. */
  length?: number | undefined;
  /** The first cell, which is where a failed submit puts focus. */
  inputRef?: Ref<HTMLInputElement> | undefined;
  /**
   * The name of every cell after the first, which the field's label names: "Digit 2 of 6". Without it a
   * screen reader hears the field's label on each cell and cannot tell where it is.
   */
  digitLabel?: ((position: number, length: number) => string) | undefined;
  className?: string | undefined;
}

/**
 * A one-time code, one digit per cell (10-forms.md section 21). Pasting a code fills every cell, the
 * browser can offer the code from a message (`autocomplete="one-time-code"`), and only digits are taken.
 * It is named by the `FieldLabel` of the `Field` around it.
 */
export function OtpField({ length = 6, inputRef, digitLabel, className, ...props }: OtpFieldProps): ReactElement {
  return (
    <OTPFieldPrimitive.Root
      data-slot="otp-field"
      {...props}
      length={length}
      className={cn('flex items-center gap-2', className)}
    >
      {Array.from({ length }, (_, index) => (
        <OTPFieldPrimitive.Input
          key={index}
          {...(index === 0 ? { ref: inputRef } : {})}
          {...(index > 0 && digitLabel ? { 'aria-label': digitLabel(index + 1, length) } : {})}
          className="size-control-lg rounded-md border border-border bg-surface text-center num type-input-touch text-foreground focus-visible:focus-ring data-disabled:cursor-not-allowed data-disabled:bg-surface-disabled data-disabled:text-foreground-disabled data-invalid:border-negative-solid md:type-body"
        />
      ))}
    </OTPFieldPrimitive.Root>
  );
}
