import type { ComponentProps, ReactElement } from 'react';

import { cn } from '@/lib/utils';

/** `text-14`: body and controls. `text-13`: table cells and meta lines. `text-12`: labels. */
export type SkeletonShape = 'text-14' | 'text-13' | 'text-12' | 'block' | 'badge' | 'sparkline';
/** Widths follow a fixed pattern per row, never a random one, so a re-render does not flicker (17 section 3.1). */
export type SkeletonWidth = 48 | 56 | 64 | 72 | 80 | 100;
export type SkeletonHeight = 'row' | 'chart-140' | 'chart-180' | 'chart-240' | 'chart-280';

export interface SkeletonProps extends Omit<ComponentProps<'span'>, 'children'> {
  shape: SkeletonShape;
  widthPct?: SkeletonWidth | undefined;
  /** For `block` only: the height of what it stands for. */
  height?: SkeletonHeight | undefined;
}

const WIDTH_CLASS: Readonly<Record<SkeletonWidth, string>> = {
  48: cn('w-[48%]'),
  56: cn('w-[56%]'),
  64: cn('w-[64%]'),
  72: cn('w-[72%]'),
  80: cn('w-4/5'),
  100: cn('w-full'),
};
const HEIGHT_CLASS: Readonly<Record<SkeletonHeight, string>> = {
  row: cn('h-row'),
  'chart-140': cn('h-35'),
  'chart-180': cn('h-45'),
  'chart-240': cn('h-60'),
  'chart-280': cn('h-70'),
};
type TextShape = Extract<SkeletonShape, `text-${string}`>;
/** The box keeps the line height of the text it stands for, so nothing shifts when the text arrives. */
const LINE_CLASS: Readonly<Record<TextShape, string>> = {
  'text-14': cn('h-5'),
  'text-13': cn('h-5'),
  'text-12': cn('h-4'),
};
/** The bar is shorter than its line and centered in it, the way the letters are. */
const BAR_CLASS: Readonly<Record<TextShape, string>> = {
  'text-14': cn('h-3'),
  'text-13': cn('h-3'),
  'text-12': cn('h-2.5'),
};
const BAR = cn('block animate-skeleton-pulse rounded-sm bg-surface-subtle');

const isText = (shape: SkeletonShape): shape is TextShape => shape.startsWith('text-');

/**
 * A placeholder shaped like the content it stands for (17-empty-loading-error-states.md section 3). It
 * pulses and never shimmers, and is hidden from assistive technology: the region around it says "Loading".
 */
export function Skeleton({ shape, widthPct = 100, height = 'row', className, ...props }: SkeletonProps): ReactElement {
  if (isText(shape)) {
    return (
      <span
        data-slot="skeleton"
        {...props}
        aria-hidden="true"
        className={cn('flex items-center', LINE_CLASS[shape], WIDTH_CLASS[widthPct], className)}
      >
        <span className={cn(BAR, 'w-full', BAR_CLASS[shape])} />
      </span>
    );
  }
  const shapeClass =
    shape === 'badge'
      ? cn('h-badge w-16')
      : shape === 'sparkline'
        ? cn('h-6 w-24')
        : cn(HEIGHT_CLASS[height], WIDTH_CLASS[widthPct]);
  // A placeholder is never content, so nothing a caller passes can expose it to assistive technology
  return <span data-slot="skeleton" {...props} aria-hidden="true" className={cn(BAR, shapeClass, className)} />;
}
