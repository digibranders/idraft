'use client';

import { Field as FieldPrimitive } from '@base-ui/react/field';
import {
  useCallback,
  useEffect,
  useRef,
  type ComponentProps,
  type KeyboardEvent,
  type ReactElement,
  type Ref,
  type RefCallback,
} from 'react';

import { cn } from '@/lib/utils';

export interface TextareaProps extends Omit<ComponentProps<'textarea'>, 'className' | 'rows' | 'ref'> {
  /** "612 of 700", formatted by the caller and passed from 80% of the limit; `null` or absent hides it. */
  counter?: string | null | undefined;
  /** The counter is over the limit: it turns to the negative text color. */
  counterOver?: boolean | undefined;
  /** Cmd or Ctrl plus Enter submits the form, for the main field of a form. */
  submitOnModEnter?: boolean | undefined;
  ref?: Ref<HTMLTextAreaElement> | undefined;
  /** Layout only. The width of a field is set on `Field`. */
  className?: string | undefined;
}

/** Whether the browser sizes a text area to its content by itself (`field-sizing: content`). */
const sizesItself = (): boolean => typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

/** Sets the height to the content's; the CSS minimum and maximum still clamp it. */
function fitToContent(area: HTMLTextAreaElement): void {
  area.style.height = 'auto';
  area.style.height = `${String(area.scrollHeight + area.offsetHeight - area.clientHeight)}px`;
}

/**
 * Grows the text area to its content where the browser cannot (10-forms.md section 5): on every input, and
 * when a controlled value changes from outside.
 */
function useAutoGrow(value: TextareaProps['value']): RefCallback<HTMLTextAreaElement> {
  const element = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (element.current !== null && !sizesItself()) fitToContent(element.current);
  }, [value]);
  return useCallback((area: HTMLTextAreaElement | null) => {
    element.current = area;
    if (area === null || sizesItself()) return undefined;
    const fit = (): void => fitToContent(area);
    fit();
    area.addEventListener('input', fit);
    return () => {
      area.removeEventListener('input', fit);
      element.current = null;
    };
  }, []);
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
  ref,
  value,
  defaultValue,
  disabled,
  name,
  ...props
}: TextareaProps): ReactElement {
  const grow = useAutoGrow(value);
  const refs = useCallback(
    (area: HTMLTextAreaElement | null) => {
      const release = grow(area);
      if (typeof ref === 'function') ref(area);
      else if (ref) ref.current = area;
      return () => {
        release?.();
        if (typeof ref === 'function') ref(null);
        else if (ref) ref.current = null;
      };
    },
    [grow, ref],
  );
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
        // The field reads these to keep its disabled, filled and dirty states
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        name={name}
        render={<textarea {...props} ref={refs} onKeyDown={handleKeyDown} />}
        className={cn(
          // 3 lines at least and 8 at most, at the line height of the text, plus the padding and the border
          'field-sizing-content max-h-[calc(8lh+--spacing(4)+2px)] min-h-[calc(3lh+--spacing(4)+2px)] w-full resize-none rounded-md border border-border bg-surface px-3 py-2 type-input-touch text-foreground placeholder:text-foreground-tertiary focus-visible:focus-ring data-disabled:cursor-not-allowed data-disabled:bg-surface-disabled data-disabled:text-foreground-disabled data-invalid:border-negative-solid md:type-body',
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
