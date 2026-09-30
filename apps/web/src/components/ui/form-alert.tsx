import { CircleX, TriangleAlert } from 'lucide-react';
import type { ComponentProps, ReactElement } from 'react';

import { Icon } from './icon';
import { cn } from '@/lib/utils';

export interface FormAlertProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Names the limit and the way out (10-forms.md section 19). */
  message: string;
  tone?: 'negative' | 'warning' | undefined;
}

const TONE_CLASS: Readonly<Record<'negative' | 'warning', string>> = {
  negative: cn('border-negative-border bg-negative-subtle'),
  warning: cn('border-warning-border bg-warning-subtle'),
};
const ICON_CLASS: Readonly<Record<'negative' | 'warning', string>> = {
  negative: cn('text-negative-text'),
  warning: cn('text-warning-text'),
};

/**
 * An error of the whole form that belongs to no field: a quota, a permission, a limit (10-forms.md
 * section 23). It sits above the footer or the save bar and is announced when it appears, because it
 * arrives after a submit. A field's own error is a `FieldError`.
 */
export function FormAlert({ message, tone = 'negative', className, ...props }: FormAlertProps): ReactElement {
  return (
    <div
      data-slot="form-alert"
      role={tone === 'negative' ? 'alert' : 'status'}
      {...props}
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 type-body text-foreground',
        TONE_CLASS[tone],
        className,
      )}
    >
      {/* 16 px icon centered on the 20 px first line */}
      <Icon icon={tone === 'negative' ? CircleX : TriangleAlert} className={cn('mt-0.5', ICON_CLASS[tone])} />
      <span className="min-w-0">{message}</span>
    </div>
  );
}
