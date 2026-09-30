'use client';

import { CircleX } from 'lucide-react';
import type { ComponentProps, MouseEvent, ReactElement, Ref } from 'react';

import { Icon } from './icon';
import { cn } from '@/lib/utils';

export interface ErrorSummaryItem {
  /** The id of the control, which the link focuses. */
  fieldId: string;
  label: string;
  message: string;
}

export interface ErrorSummaryProps extends Omit<ComponentProps<'div'>, 'children' | 'title'> {
  /** "Fix 2 fields to save". */
  title: string;
  errors: readonly ErrorSummaryItem[];
  /** The heading. The form moves focus here after a failed submit, which is what makes it read. */
  headingRef?: Ref<HTMLHeadingElement> | undefined;
}

/**
 * Every error of a long form, listed at its top after a failed submit (10-forms.md section 18). It is not
 * a live region: focus moves to its heading, and announcing it as well would read it twice. Each error is
 * a link that puts focus in its field. It renders nothing once every error is fixed. Short forms do not
 * use it; focus goes to the first invalid field.
 */
export function ErrorSummary({
  title,
  errors,
  headingRef,
  className,
  ...props
}: ErrorSummaryProps): ReactElement | null {
  if (errors.length === 0) return null;
  const focusField = (event: MouseEvent<HTMLAnchorElement>, fieldId: string): void => {
    const field = document.getElementById(fieldId);
    field?.focus();
    // When the field took focus the jump is done. When it could not, the href still scrolls to it.
    if (field && document.activeElement === field) event.preventDefault();
  };
  return (
    <div
      data-slot="error-summary"
      {...props}
      className={cn(
        'flex items-start gap-2 rounded-md border border-negative-border bg-negative-subtle px-3 py-2',
        className,
      )}
    >
      <Icon icon={CircleX} className="mt-0.5 text-negative-text" />
      <div className="flex min-w-0 flex-col gap-1">
        <h2 ref={headingRef} tabIndex={-1} className="rounded-xs type-subsection-title focus-visible:focus-ring">
          {title}
        </h2>
        <ul className="flex flex-col gap-0.5">
          {errors.map((error) => (
            <li key={error.fieldId} className="type-body text-foreground">
              {/* The whole line is the link. The label is heavier, so no punctuation has to separate the two. */}
              <a
                href={`#${error.fieldId}`}
                onClick={(event) => focusField(event, error.fieldId)}
                className="rounded-xs underline-offset-2 hover:underline focus-visible:focus-ring"
              >
                <span className="type-body-strong text-link underline underline-offset-2">{error.label}</span>{' '}
                <span>{error.message}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
