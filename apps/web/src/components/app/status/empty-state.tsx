import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /** `inline` for inspector sections, strip slots and panels under 200 px: no icon, left-aligned. */
  variant?: 'region' | 'inline' | undefined;
  /** The object's glyph, 20 px (07-icons.md section 6). Left out when it adds nothing, and inline. */
  icon?: LucideIcon | undefined;
  /** What is missing, as a fact: "No keywords tracked yet". */
  title: string;
  /** Exactly one sentence: why, or what will change it, with the real number, time or name. */
  reason: string;
  /** One primary button; left out when the person cannot act. */
  primaryAction?: ReactNode | undefined;
  /** One text link. */
  secondaryAction?: ReactNode | undefined;
  /** Below the reason: what caused the state, such as the active filters as read-only chips (17 section 2). */
  details?: ReactNode | undefined;
  /** `h1` only where the state is the whole page (a 404, a route error). */
  headingLevel: 1 | 2 | 3;
}

/**
 * Says what is missing, why, and the one action that changes it (17-empty-loading-error-states.md section
 * 2, 25 section 11.1): at most 400 px wide, centered, no border, no background, no illustration.
 */
export function EmptyState({
  variant = 'region',
  icon,
  title,
  reason,
  primaryAction,
  secondaryAction,
  details,
  headingLevel,
}: EmptyStateProps): ReactElement {
  const Heading = `h${String(headingLevel)}` as 'h1' | 'h2' | 'h3';
  const inline = variant === 'inline';
  const actions = primaryAction !== undefined || secondaryAction !== undefined;
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col',
        inline ? 'items-start p-4 text-left' : 'mx-auto max-w-dialog-sm items-center p-8 text-center',
      )}
    >
      {icon === undefined || inline ? null : <Icon icon={icon} size="lg" className="mb-3 text-foreground-tertiary" />}
      <Heading
        tabIndex={headingLevel === 1 ? -1 : undefined}
        className="type-subsection-title text-foreground outline-none"
      >
        {title}
      </Heading>
      <p className="mt-1 type-body text-foreground-secondary">{reason}</p>
      {details === undefined ? null : <div className="mt-3">{details}</div>}
      {actions ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          {primaryAction}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
