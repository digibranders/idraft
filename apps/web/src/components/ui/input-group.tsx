'use client';

import type { LucideIcon } from 'lucide-react';
import type { ComponentProps, PointerEvent, ReactElement, ReactNode } from 'react';

import { Icon } from './icon';
import type { InputSize } from './input-variants';
import { cn } from '@/lib/utils';

export interface InputGroupProps extends Omit<ComponentProps<'div'>, 'prefix' | 'children'> {
  /** Text before the value, such as a currency sign. It is not part of the value. */
  prefix?: string | undefined;
  /** A unit after the value: "%", "days", "keywords". */
  suffix?: string | undefined;
  leadingIcon?: LucideIcon | undefined;
  /** Buttons at the end: `IconButton size="icon-xs"`, 4 px from the edge, each with its own name. */
  trailing?: ReactNode | undefined;
  size?: InputSize | undefined;
  /** The control: `<Input variant="bare" />`. */
  children: ReactElement;
}

const SIZE_CLASS: Readonly<Record<InputSize, string>> = {
  sm: cn('h-control-sm pl-2'),
  md: cn('h-control pl-3'),
  lg: cn('h-control-lg pl-3'),
};
/** Without buttons the end padding equals the start padding. */
const END_CLASS: Readonly<Record<InputSize, string>> = { sm: cn('pr-2'), md: cn('pr-3'), lg: cn('pr-3') };

/**
 * One border around an input and its adornments (10-forms.md section 4). The group shows the focus ring
 * while the input has focus, the invalid border and the disabled fill, all read from the input inside it
 * and never from a button beside it.
 */
export function InputGroup({
  prefix,
  suffix,
  leadingIcon,
  trailing,
  size = 'md',
  children,
  className,
  onPointerDown,
  ...props
}: InputGroupProps): ReactElement {
  // A press on the padding, the icon or the unit puts the caret in the input, as a press on a plain input
  // would. It adds nothing for the keyboard, which reaches the input directly.
  const focusInput = (event: PointerEvent<HTMLDivElement>): void => {
    onPointerDown?.(event);
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    if (event.target.closest('input, textarea, button, a, [role="button"]')) return;
    const input = event.currentTarget.querySelector('input');
    if (!input || input.disabled) return;
    // Without this the press would move focus to the page right after it was given to the input
    event.preventDefault();
    input.focus();
  };
  return (
    <div
      data-slot="input-group"
      {...props}
      onPointerDown={focusInput}
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded-md border border-border bg-surface has-[input:focus-visible]:focus-ring has-[input[data-disabled]]:bg-surface-disabled has-[input[data-invalid]]:border-negative-solid',
        SIZE_CLASS[size],
        trailing === undefined ? END_CLASS[size] : 'pr-1',
        className,
      )}
    >
      {leadingIcon ? <Icon icon={leadingIcon} className="text-foreground-tertiary" /> : null}
      {/* The label names the unit when it matters, so the adornment is decoration for assistive technology */}
      {prefix === undefined ? null : (
        <span aria-hidden="true" className="type-body text-foreground-tertiary">
          {prefix}
        </span>
      )}
      {children}
      {suffix === undefined ? null : (
        <span aria-hidden="true" className="type-body text-foreground-tertiary">
          {suffix}
        </span>
      )}
      {trailing === undefined ? null : <span className="flex shrink-0 items-center gap-1">{trailing}</span>}
    </div>
  );
}
