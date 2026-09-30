import type { LucideIcon } from 'lucide-react';
import { cloneElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';

import { buttonVariants, type ButtonSize, type ButtonVariant } from './button-variants';
import { Icon } from './icon';
import { cn } from '@/lib/utils';

export interface LinkButtonProps extends Omit<ComponentProps<'a'>, 'href' | 'children' | 'className'> {
  /** The link to render: the router's `<Link href="..." />` from an application component, or an `<a>`. */
  render: ReactElement<{ className?: string | undefined; children?: ReactNode }>;
  variant?: ButtonVariant | undefined;
  size?: Extract<ButtonSize, 'sm' | 'md' | 'lg'> | undefined;
  icon?: LucideIcon | undefined;
  children: ReactNode;
  /** Layout only, as on `Button`. */
  className?: string | undefined;
}

/**
 * A link that looks like a button, for an action that navigates ("Open project"). It stays a link for
 * assistive technology and for the browser: Enter follows it and a middle click opens a tab. `Button`
 * cannot do this, because Base UI gives whatever it renders the button role. It has no `'use client'`, so
 * a Server Component can render it and give it an icon.
 */
export function LinkButton({
  render,
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className,
  ...props
}: LinkButtonProps): ReactElement {
  const merged = {
    'data-slot': 'link-button',
    ...props,
    className: cn(buttonVariants({ variant, size }), render.props.className, className),
  };
  return cloneElement(
    render,
    merged as object,
    icon ? <Icon icon={icon} size={size === 'sm' ? 'sm' : 'default'} /> : null,
    children,
  );
}
