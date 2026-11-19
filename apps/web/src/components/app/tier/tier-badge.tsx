'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { tierFill } from './tier-colors';
import { tierLabel, type TierNameLike } from '@/lib/internal-links/tiers';
import { cn } from '@/lib/utils';

export interface TierBadgeProps {
  /** `null` is Untiered. */
  tier: TierNameLike | null;
  /** "T1 Money pages" where names show (filters, tooltips, the inspector); the code alone in tables and cards. */
  withName?: boolean | undefined;
  className?: string | undefined;
}

/**
 * A page's tier (spec 7.9, 25 section 14.15): an outline badge with a square in the tier color and the code, so
 * the color never carries the meaning alone. The full name is the title of a code-only badge.
 */
export function TierBadge({ tier, withName = false, className }: TierBadgeProps): ReactElement {
  const t = useTranslations('tierBadge');
  const label = tierLabel(tier, t('untiered'));
  return (
    <span
      data-slot="tier-badge"
      title={tier !== null && !withName ? label : undefined}
      className={cn(
        'inline-flex h-badge shrink-0 items-center gap-1.5 rounded-sm border border-border bg-surface px-1.5 type-label whitespace-nowrap text-foreground',
        className,
      )}
    >
      <span data-tier-square="" aria-hidden="true" className={cn('size-2 shrink-0 rounded-xs', tierFill(tier))} />
      {withName || tier === null ? label : tier.code}
      {/* The title is a mouse hint only: keyboard and screen reader users get the name from this text */}
      {tier !== null && !withName ? <span className="sr-only"> {tier.name}</span> : null}
    </span>
  );
}
