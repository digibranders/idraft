import { Separator as SeparatorPrimitive } from '@base-ui/react/separator';
import type { ComponentProps, ReactElement } from 'react';

import { cn } from '@/lib/utils';

export interface SeparatorProps extends Omit<ComponentProps<'div'>, 'children'> {
  orientation?: 'horizontal' | 'vertical' | undefined;
  /** `subtle` between regions and toolbar groups; `default` for the stronger divider between channel groups of a metric strip. */
  tone?: 'subtle' | 'default' | undefined;
  /** `separator` exposes the role to assistive technology. Most dividers only repeat what spacing already shows. */
  semantics?: 'decorative' | 'separator' | undefined;
}

/** A 1 px divider (06-surfaces-borders-radius.md section 5). A vertical one takes the height of its row unless `className` sets one. */
export function Separator({
  orientation = 'horizontal',
  tone = 'subtle',
  semantics = 'decorative',
  className,
  ...props
}: SeparatorProps): ReactElement {
  const classes = cn(
    'shrink-0',
    tone === 'subtle' ? 'bg-border-subtle' : 'bg-border',
    orientation === 'horizontal' ? 'h-px w-full' : 'w-px self-stretch',
    className,
  );
  if (semantics === 'decorative')
    return <div data-slot="separator" {...props} aria-hidden="true" className={classes} />;
  return <SeparatorPrimitive data-slot="separator" orientation={orientation} {...props} className={classes} />;
}
