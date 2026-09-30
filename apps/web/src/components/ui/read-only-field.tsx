import type { ComponentProps, ReactElement } from 'react';

import { cn } from '@/lib/utils';

export interface ReadOnlyFieldProps extends Omit<ComponentProps<'div'>, 'children'> {
  label: string;
  value: string;
  /** `mono` for identifiers, slugs and tokens. */
  font?: 'sans' | 'mono' | undefined;
  /** Why it cannot change here, when that is not obvious. */
  reason?: string | undefined;
}

/**
 * A fact shown for reference and not editable here (10-forms.md section 20): an identifier, a value that
 * is fixed after creation, or a setting the viewer may not change. The text can be selected and it is not
 * a tab stop. Place it inside `ReadOnlyList`.
 */
export function ReadOnlyField({
  label,
  value,
  font = 'sans',
  reason,
  className,
  ...props
}: ReadOnlyFieldProps): ReactElement {
  return (
    <div data-slot="read-only-field" {...props} className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <dt className="type-label">{label}</dt>
      <dd className="flex flex-col gap-1.5">
        <span
          className={cn(
            'flex min-h-control items-center rounded-md bg-surface-subtle px-3 py-1.5 wrap-anywhere text-foreground select-text',
            font === 'mono' ? 'type-mono' : 'type-body',
          )}
        >
          {value}
        </span>
        {reason === undefined ? null : <span className="type-meta">{reason}</span>}
      </dd>
    </div>
  );
}

/** The description list that holds read-only fields, spaced like the fields of a form. */
export function ReadOnlyList({ className, ...props }: ComponentProps<'dl'>): ReactElement {
  return <dl data-slot="read-only-list" {...props} className={cn('flex flex-col gap-4', className)} />;
}
