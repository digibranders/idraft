'use client';

import type { LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface StatusChipProps {
  /** Short label for the status: "Schedules paused", "Collecting answers". */
  label: string;
  /** Optional icon displayed before the label. */
  icon?: LucideIcon | undefined;
  /** Explanatory text displayed in a tooltip. */
  tooltip?: string | undefined;
  /** Link destination (for example, settings page to resume schedules). */
  href?: Route | string | undefined;
  /** Optional accessible name for the link. */
  ariaLabel?: string | undefined;
  /** Semantic tone for the status. */
  tone?: 'neutral' | 'info' | 'warning' | 'positive' | undefined;
  className?: string | undefined;
}

/**
 * Small inline status chip for page toolbars (14-badges-status.md, 18-notifications-alerts.md).
 * Replaces full-width notice banners with a compact inline chip.
 */
export function StatusChip({
  label,
  icon,
  tooltip,
  href,
  ariaLabel,
  tone = 'neutral',
  className,
}: StatusChipProps): ReactElement {
  const badge = (
    <Badge tone={tone} variant="subtle" icon={icon} className={className}>
      {label}
    </Badge>
  );

  const tipped = tooltip !== undefined && tooltip !== '';

  const interactive =
    href !== undefined ? (
      <Link
        href={href as Route}
        aria-label={ariaLabel}
        className={cn('inline-flex shrink-0 rounded-sm outline-none focus-visible:focus-ring')}
      >
        {badge}
      </Link>
    ) : (
      badge
    );

  if (tipped) {
    return (
      <Tooltip content={tooltip} disabled={!tipped}>
        {interactive}
      </Tooltip>
    );
  }

  return interactive;
}
