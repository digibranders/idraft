import { Input as InputPrimitive } from '@base-ui/react/input';
import type { ReactElement } from 'react';

import { inputVariants, type InputSize, type InputVariant } from './input-variants';
import { cn } from '@/lib/utils';

export interface InputProps extends Omit<InputPrimitive.Props, 'size' | 'className' | 'render'> {
  size?: InputSize | undefined;
  /** `bare` inside an `InputGroup`, which draws the border. */
  variant?: InputVariant | undefined;
  /** Layout only. The width of a field is set on `Field`. */
  className?: string | undefined;
}

/**
 * Single-line text entry (10-forms.md section 4). Inside a `Field` it takes its id, its description and
 * its invalid state from there. It always has a label: visible, or visually hidden with a placeholder
 * that shows the format. `autoComplete` follows 10-forms.md section 21.
 */
export function Input({ size = 'md', variant = 'outline', className, ...props }: InputProps): ReactElement {
  return <InputPrimitive data-slot="input" {...props} className={cn(inputVariants({ variant, size }), className)} />;
}
