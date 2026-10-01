'use client';

import { Field as FieldPrimitive } from '@base-ui/react/field';
import type { ComponentProps, KeyboardEvent, ReactElement } from 'react';

import { cn } from '@/lib/utils';

export interface TextareaProps extends Omit<ComponentProps<'textarea'>, 'className' | 'rows'> {
  /** "612 of 700", formatted by the caller and passed from 80% of the limit; `null` or absent hides it. */
  counter?: string | null | undefined;
  /** The counter is over the limit: it turns to the negative text color. */
  counterOver?: boolean | undefined;
  /** Cmd or Ctrl plus Enter submits the form, for the main field of a form. */
  submitOnModEnter?: boolean | undefined;
  /** Layout only. The width of a field is set on `Field`. */
  className?: string | undefined;
}

/**
 * Multi-line text: a keyword paste, a prompt, a sample answer (10-forms.md section 5). It grows with its
 * content from 3 to 8 lines, then scrolls. Inside a `Field` it takes the id, the description and the
 * invalid state from there; the counter is one more description of the field.
 */
export function Textarea({
  counter,
  counterOver = false,
  submitOnModEnter = false,
  className,
  onKeyDown,
  ...props
}: TextareaProps): ReactElement {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    onKeyDown?.(event);
    if (!submitOnModEnter || event.defaultPrevented) return;
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };
  return (
    <>
      <FieldPrimitive.Control
        data-slot="textarea"
        render={<textarea {...props} onKeyDown={handleKeyDown} />}
        className={cn(
          // 3 lines at least and 8 at most, at the line height of the text, plus the vertical padding
          'field-sizing-content max-h-[calc(8lh+--spacing(4))] min-h-[calc(3lh+--spacing(4))] w-full resize-none rounded-md border border-border bg-surface px-3 py-2 type-input-touch text-foreground placeholder:text-foreground-tertiary focus-visible:focus-ring data-disabled:cursor-not-allowed data-disabled:bg-surface-disabled data-disabled:text-foreground-disabled data-invalid:border-negative-solid md:type-body',
          className,
        )}
      />
      {counter === null || counter === undefined ? null : (
        <FieldPrimitive.Description
          data-slot="textarea-counter"
          className={cn('self-end num type-meta', counterOver ? 'text-negative-text' : '')}
        >
          {counter}
        </FieldPrimitive.Description>
      )}
    </>
  );
}
