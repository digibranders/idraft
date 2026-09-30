import { cva } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactElement } from 'react';

import { Icon } from './icon';
import { cn } from '@/lib/utils';

/** Tones and variants of 14-badges-status.md section 1. Warning and info exist as a tint or as text, not as an outline. */
const badgeVariants = cva('inline-flex shrink-0 items-center gap-1 type-micro whitespace-nowrap', {
  variants: {
    variant: {
      // The transparent border keeps the box visible when a forced-colors mode removes backgrounds
      subtle: 'h-badge rounded-sm border border-transparent px-2',
      outline: 'h-badge rounded-sm border bg-surface px-2',
      text: '',
    },
    tone: { neutral: '', positive: '', negative: '', warning: '', info: '' },
  },
  compoundVariants: [
    {
      variant: 'subtle',
      tone: 'neutral',
      // The neutral tint is close to the hover and selected fills of a row, so it always has its edge, and
      // inside a selected row (a `group` with aria-selected) the fill becomes the surface
      className: 'border-neutral-border bg-neutral-subtle text-neutral-text group-aria-selected:bg-surface',
    },
    { variant: 'subtle', tone: 'positive', className: 'bg-positive-subtle text-positive-text' },
    { variant: 'subtle', tone: 'negative', className: 'bg-negative-subtle text-negative-text' },
    { variant: 'subtle', tone: 'warning', className: 'bg-warning-subtle text-warning-text' },
    { variant: 'subtle', tone: 'info', className: 'bg-info-subtle text-info-text' },
    { variant: 'outline', tone: 'neutral', className: 'border-border text-foreground-secondary' },
    { variant: 'outline', tone: 'positive', className: 'border-positive-border text-positive-text' },
    { variant: 'outline', tone: 'negative', className: 'border-negative-border text-negative-text' },
    { variant: 'text', tone: 'neutral', className: 'text-neutral-text' },
    { variant: 'text', tone: 'positive', className: 'text-positive-text' },
    { variant: 'text', tone: 'negative', className: 'text-negative-text' },
    { variant: 'text', tone: 'warning', className: 'text-warning-text' },
    { variant: 'text', tone: 'info', className: 'text-info-text' },
  ],
});

type Look =
  | { tone?: 'neutral' | 'positive' | 'negative' | undefined; variant?: 'subtle' | 'outline' | 'text' | undefined }
  | { tone: 'warning' | 'info'; variant?: 'subtle' | 'text' | undefined };

export type BadgeProps = Look &
  Omit<ComponentProps<'span'>, 'children'> & {
    /** A 12 px leading icon, such as the check of "Cited". */
    icon?: LucideIcon | undefined;
    /** One or two words. The word carries the meaning; the color only supports it. */
    children: string;
  };

/** A non-interactive label for a category or a state: 22 px, never a pill, never wrapping. */
export function Badge({
  tone = 'neutral',
  variant = 'subtle',
  icon,
  className,
  children,
  ...props
}: BadgeProps): ReactElement {
  return (
    <span data-slot="badge" {...props} className={cn(badgeVariants({ tone, variant }), className)}>
      {icon ? <Icon icon={icon} size="xs" /> : null}
      {children}
    </span>
  );
}
