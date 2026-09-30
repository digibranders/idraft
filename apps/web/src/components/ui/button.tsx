'use client';

import { Button as ButtonPrimitive } from '@base-ui/react/button';
import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { buttonVariants, isSmallButton, type ButtonSize, type ButtonVariant } from './button-variants';
import { Icon } from './icon';
import { Spinner } from './spinner';
import { cn } from '@/lib/utils';

export interface ButtonProps extends Omit<ButtonPrimitive.Props, 'className'> {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  /** Leading icon. Replaced by the spinner while loading. */
  icon?: LucideIcon | undefined;
  /** Set by the caller after the action has been pending for 400 ms: the label and width stay, clicks are ignored. */
  loading?: boolean | undefined;
  /** Layout only: margin, width, grid placement. Color, height, padding and radius belong to `variant` and `size`. */
  className?: string | undefined;
}

/** The one clickable action element (09-buttons-controls.md section 2). An action that navigates is a `LinkButton`. */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  className,
  children,
  onClick,
  type = 'button',
  ...props
}: ButtonProps): ReactElement {
  const small = isSmallButton(size);
  const handleClick: NonNullable<ButtonPrimitive.Props['onClick']> = (event) => {
    // A loading button is not disabled: it keeps its colors, its place in the tab order and its name.
    // Preventing the default also stops a submit button from submitting its form a second time.
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <ButtonPrimitive
      data-slot="button"
      type={type}
      // Set only while loading: Base UI writes aria-disabled itself for a disabled button that stays focusable
      {...(loading ? { 'aria-busy': true, 'aria-disabled': true } : {})}
      {...props}
      onClick={handleClick}
      className={cn(buttonVariants({ variant, size }), className)}
    >
      {loading ? (
        // Without a leading icon the spinner sits over the label, which stays in layout so the width holds
        <Spinner size={small ? 'sm' : 'md'} className={icon ? undefined : 'absolute inset-0 m-auto size-fit'} />
      ) : icon ? (
        <Icon icon={icon} size={small ? 'sm' : 'default'} />
      ) : null}
      {/* The label stays in the document while loading, so the accessible name and the width do not change */}
      {loading && !icon ? <span className="opacity-0">{children}</span> : children}
    </ButtonPrimitive>
  );
}
