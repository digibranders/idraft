import { CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

export type BannerTone = 'info' | 'warning' | 'negative';

export interface BannerProps {
  tone: BannerTone;
  /** `page`: full width under the page header, no radius. `region`: inside a section, dialog or panel. */
  placement: 'page' | 'region';
  /** An optional lead phrase in the strong weight: "Read only:". */
  lead?: string | undefined;
  /** One or two sentences. */
  message: string;
  /** Up to two actions, right-aligned: text links or small secondary buttons. */
  actions?: ReactNode;
  /**
   * Whether the banner announces itself: `true` for one that appears while the person works (`role="status"`,
   * or `"alert"` for `negative`). A banner present at first render is read with the page and has no role.
   */
  live?: boolean | undefined;
  className?: string | undefined;
}

const TONE_CLASS: Readonly<Record<BannerTone, string>> = {
  info: cn('border-info-border bg-info-subtle'),
  warning: cn('border-warning-border bg-warning-subtle'),
  negative: cn('border-negative-border bg-negative-subtle'),
};
const ICON_CLASS: Readonly<Record<BannerTone, string>> = {
  info: cn('text-info-text'),
  warning: cn('text-warning-text'),
  negative: cn('text-negative-text'),
};
// Banners describe conditions, not events, so `negative` is a cross (18-notifications-alerts.md section 4)
const ICON: Readonly<Record<BannerTone, LucideIcon>> = { info: Info, warning: TriangleAlert, negative: CircleX };
const PLACEMENT_CLASS = {
  page: cn('border-b px-5 py-2'),
  region: cn('rounded-md border px-3 py-2'),
} as const;

/**
 * A condition of the page, a section, a dialog or a panel (18-notifications-alerts.md section 4, 25 section
 * 11.10): read-only access, a consequence of a change, data that is partial. Never a form, a chart or more
 * than two sentences; confirmations are toasts and field errors stay on their fields.
 */
export function Banner({
  tone,
  placement,
  lead,
  message,
  actions,
  live = false,
  className,
}: BannerProps): ReactElement {
  return (
    <div
      data-slot="banner"
      role={live ? (tone === 'negative' ? 'alert' : 'status') : undefined}
      className={cn('flex items-start gap-2', PLACEMENT_CLASS[placement], TONE_CLASS[tone], className)}
    >
      <Icon icon={ICON[tone]} className={cn('mt-0.5 shrink-0', ICON_CLASS[tone])} />
      <p className="min-w-0 flex-1 type-body text-foreground">
        {lead === undefined ? null : <span className="type-body-strong">{lead} </span>}
        {message}
      </p>
      {actions === undefined ? null : <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
