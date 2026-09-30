import type { LucideIcon, LucideProps } from 'lucide-react';
import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';

/** 12, 14, 16 (default), 18 and 20 px (07-icons.md section 2). */
export type IconSize = 'xs' | 'sm' | 'default' | 'md' | 'lg';

const SIZE_CLASS: Readonly<Record<IconSize, string>> = {
  xs: cn('size-icon-xs'),
  sm: cn('size-icon-sm'),
  default: cn('size-icon'),
  md: cn('size-icon-md'),
  lg: cn('size-icon-lg'),
};
/** The smallest and the largest glyph take a lighter stroke, so every size reads as the same weight. */
const STROKE_WIDTH: Readonly<Record<IconSize, number>> = { xs: 1.5, sm: 1.75, default: 1.75, md: 1.75, lg: 1.5 };

export interface IconProps extends Omit<
  LucideProps,
  'size' | 'strokeWidth' | 'absoluteStrokeWidth' | 'nonScalingStroke' | 'color'
> {
  icon: LucideIcon;
  size?: IconSize | undefined;
  /** Only for an icon that carries meaning on its own. Without it the icon is hidden from assistive technology. */
  label?: string | undefined;
}

/** The only way to render a Lucide glyph: it fixes size and stroke, so no caller sets them. Color is the text color. */
export function Icon({ icon: Glyph, size = 'default', label, className, ...props }: IconProps): ReactElement {
  return (
    <Glyph
      data-slot="icon"
      focusable={false}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label, 'aria-hidden': false })}
      {...props}
      className={cn('shrink-0', SIZE_CLASS[size], className)}
      strokeWidth={STROKE_WIDTH[size]}
      nonScalingStroke
    />
  );
}
