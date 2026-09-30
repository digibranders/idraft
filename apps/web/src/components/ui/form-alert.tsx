import { CircleCheck, CircleX, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactElement } from 'react';

import { Icon } from './icon';
import { cn } from '@/lib/utils';

type FormAlertTone = 'negative' | 'warning' | 'positive';

export interface FormAlertProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Names the limit and the way out (10-forms.md section 19). */
  message: string;
  /** `positive` reports the outcome of the step before, such as a password that was just changed. */
  tone?: FormAlertTone | undefined;
  /**
   * Whether the alert announces itself when it appears (`role="alert"` or `"status"`). `false` for an alert
   * that takes focus when it appears: focus already has it read, and a live region would read it twice
   * (10-forms.md section 18).
   */
  live?: boolean | undefined;
}

const TONE_CLASS: Readonly<Record<FormAlertTone, string>> = {
  negative: cn('border-negative-border bg-negative-subtle'),
  warning: cn('border-warning-border bg-warning-subtle'),
  positive: cn('border-positive-border bg-positive-subtle'),
};
const ICON_CLASS: Readonly<Record<FormAlertTone, string>> = {
  negative: cn('text-negative-text'),
  warning: cn('text-warning-text'),
  positive: cn('text-positive-text'),
};
const ICON: Readonly<Record<FormAlertTone, LucideIcon>> = {
  negative: CircleX,
  warning: TriangleAlert,
  positive: CircleCheck,
};

/**
 * A message about the whole form that belongs to no field: a quota, a permission, a limit (10-forms.md
 * section 23), or with `positive`, the outcome of the step before. It sits above the footer or the save bar
 * and is announced when it appears. A field's own error is a `FieldError`.
 */
export function FormAlert({
  message,
  tone = 'negative',
  live = true,
  className,
  ...props
}: FormAlertProps): ReactElement {
  return (
    <div
      data-slot="form-alert"
      role={live ? (tone === 'negative' ? 'alert' : 'status') : undefined}
      {...props}
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 type-body text-foreground',
        TONE_CLASS[tone],
        className,
      )}
    >
      {/* 16 px icon centered on the 20 px first line */}
      <Icon icon={ICON[tone]} className={cn('mt-0.5', ICON_CLASS[tone])} />
      <span className="min-w-0">{message}</span>
    </div>
  );
}
