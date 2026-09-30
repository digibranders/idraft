import { LoaderCircle } from 'lucide-react';
import type { ComponentProps, ReactElement } from 'react';

import { Icon } from './icon';
import { cn } from '@/lib/utils';

export interface SpinnerProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** 14 px in small controls, tables, toolbars and badges; 16 px elsewhere. Never larger (17 section 3.5). */
  size?: 'sm' | 'md' | undefined;
  /** The accessible label when no visible text sits beside the spinner. With visible text, leave it out. */
  label?: string | undefined;
}

/**
 * A running process (21-motion.md section 8.2). It turns once every 800 ms and stands still under reduced
 * motion, where the text beside it carries the state.
 */
export function Spinner({ size = 'md', label, className, ...props }: SpinnerProps): ReactElement {
  return (
    <span
      data-slot="spinner"
      {...(label === undefined ? {} : { role: 'status' })}
      {...props}
      className={cn('inline-flex shrink-0', className)}
    >
      <Icon icon={LoaderCircle} size={size === 'sm' ? 'sm' : 'default'} className="animate-spin" />
      {label === undefined ? null : <span className="sr-only">{label}</span>}
    </span>
  );
}
