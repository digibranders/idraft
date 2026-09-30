'use client';

import { useCallback, useId, useLayoutEffect, useRef, type ComponentProps, type ReactElement } from 'react';

import { Button } from './button';
import { cn } from '@/lib/utils';

const FIRST_FIELD =
  'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled), [role="combobox"]:not(:disabled), [role="checkbox"]:not([aria-disabled="true"]), [role="radio"][tabindex="0"], [role="switch"]:not([aria-disabled="true"])';

export interface SaveBarProps extends Omit<ComponentProps<'div'>, 'children' | 'ref'> {
  /** Whether the form has unsaved changes. The bar is not rendered otherwise. */
  visible: boolean;
  /** "2 unsaved changes": the caller counts and formats. */
  summary: string;
  /** What the changes would cost, when the form has a price: "+$42.10 per month, estimate". */
  estimate?: string | null | undefined;
  /** Set by the caller after the save has been pending for 400 ms. */
  saving?: boolean | undefined;
  /** Resets the form to its last saved values at once, without asking. */
  onDiscard: () => void;
  /** "Discard". */
  discardLabel: string;
  /** "Save changes". */
  saveLabel: string;
  /** The id of the form, when the bar is rendered outside the `<form>` element. */
  form?: string | undefined;
}

/**
 * The bar at the bottom of a settings form with unsaved changes (10-forms.md section 13.2). "Save changes"
 * is the submit button of the form, so Enter in a field and a click on it do the same thing. The form
 * reserves the height of the bar, so the bar never covers the field that has focus. When the bar leaves
 * while one of its buttons has focus (after a save or a discard), focus goes to the first field of the
 * form instead of being lost. Dialogs do not use it: their footer holds the actions.
 */
export function SaveBar({
  visible,
  summary,
  estimate,
  saving = false,
  onDiscard,
  discardLabel,
  saveLabel,
  form,
  className,
  ...props
}: SaveBarProps): ReactElement | null {
  // Whether focus is in the bar, and the form to return it to. A removed element fires no blur, so the
  // flag is still set when the bar is gone.
  const summaryId = useId();
  const focus = useRef<{ held: boolean; owner: HTMLFormElement | null }>({ held: false, owner: null });
  useLayoutEffect(() => {
    if (visible || !focus.current.held) return;
    focus.current.held = false;
    focus.current.owner?.querySelector<HTMLElement>(FIRST_FIELD)?.focus();
  }, [visible]);
  // Focus is followed on the document: every move says whether it is in the bar now
  const follow = useCallback(
    (node: HTMLDivElement | null): (() => void) | undefined => {
      if (!node) return undefined;
      const onFocusIn = (event: FocusEvent): void => {
        const held = event.target instanceof Node && node.contains(event.target);
        const named = form === undefined ? null : document.getElementById(form);
        const owner = node.closest('form') ?? (named instanceof HTMLFormElement ? named : null);
        focus.current = { held, owner };
      };
      document.addEventListener('focusin', onFocusIn);
      return () => document.removeEventListener('focusin', onFocusIn);
    },
    [form],
  );
  if (!visible) return null;
  return (
    <div
      data-slot="save-bar"
      // A group named by its summary: entering it, a screen reader says what the two buttons are about
      role="group"
      aria-labelledby={summaryId}
      {...props}
      ref={follow}
      className={cn(
        'sticky bottom-0 z-(--z-sticky) flex min-h-save-bar items-center border-t border-border bg-surface px-5 py-2 transition-opacity duration-(--duration-base) ease-standard starting:opacity-0',
        className,
      )}
    >
      <div className="flex w-full max-w-form items-center justify-between gap-3">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 type-body text-foreground-secondary">
          <span id={summaryId}>{summary}</span>
          {estimate ? <span className="num type-meta">{estimate}</span> : null}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" disabled={saving} onClick={onDiscard}>
            {discardLabel}
          </Button>
          <Button variant="primary" type="submit" form={form} loading={saving}>
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
