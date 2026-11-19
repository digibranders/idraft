import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /**
   * `inline` for inspector sections, strip slots and panels under 200 px: no icon, left-aligned. `table` (WP-77) for
   * the body of a table panel with nothing to show: no icon, centred, 48 px above and below, the reason in meta type
   * at reading width and the one button 16 px under it (an 8 px gap and an 8 px margin, as in the preview's table empty
   * state, C 381 to 394). `card` (WP-77) for the body of a card that cannot be drawn (aiov-parts.js `emptyBody`):
   * no icon, centred, at least 96 px, the title in body strong and the reason in meta type.
   */
  variant?: 'region' | 'inline' | 'table' | 'card' | undefined;
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
  const table = variant === 'table';
  const card = variant === 'card';
  const actions = primaryAction !== undefined || secondaryAction !== undefined;
  let layout = 'mx-auto max-w-dialog-sm items-center p-8 text-center';
  if (inline) layout = 'items-start p-4 text-left';
  else if (table) layout = 'items-center gap-2 px-4 py-12 text-center';
  else if (card) layout = 'min-h-24 items-center justify-center gap-1 py-6 text-center';
  return (
    <div data-slot="empty-state" className={cn('flex flex-col', layout)}>
      {icon === undefined || inline || table || card ? null : (
        <Icon icon={icon} size="lg" className="mb-3 text-foreground-tertiary" />
      )}
      <Heading
        tabIndex={headingLevel === 1 ? -1 : undefined}
        className={cn(card ? 'type-body-strong' : 'type-subsection-title', 'text-foreground outline-none')}
      >
        {title}
      </Heading>
      <p className={table || card ? 'max-w-reading type-meta' : 'mt-1 type-body text-foreground-secondary'}>{reason}</p>
      {details === undefined ? null : <div className="mt-3">{details}</div>}
      {actions ? (
        <div className={cn('flex flex-wrap items-center justify-center gap-3', table ? 'mt-2' : 'mt-4')}>
          {primaryAction}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
