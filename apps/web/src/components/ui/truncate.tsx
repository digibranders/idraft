'use client';

import { useCallback, useRef, type ComponentProps, type ReactElement } from 'react';

import { Tooltip } from './tooltip';
import { cn } from '@/lib/utils';

export interface TruncateProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** The full value. It is what assistive technology reads and what the tooltip shows. */
  text: string;
  /** A value already shortened in the middle (`/blog/…/how-to-choose-a-crm`), shown instead of `text`. */
  display?: string | undefined;
}

/**
 * One line that ends in an ellipsis when it does not fit, with the full value in a tooltip. A value that
 * fits has no tooltip: the width is measured when the pointer arrives, so a table of a thousand cells
 * observes nothing and measures one. `data-truncate` tells the text-spacing test that the clipping is by
 * design (20-accessibility.md section 13.4). Pass `lang` when the content is not in the page language.
 */
export function Truncate({ text, display, className, ref, ...props }: TruncateProps): ReactElement {
  const node = useRef<HTMLSpanElement | null>(null);
  // The element is needed here for measuring and may be wanted by the caller too
  const setNode = useCallback(
    (element: HTMLSpanElement | null): void => {
      node.current = element;
      if (typeof ref === 'function') ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );
  const shortened = display !== undefined && display !== text;
  const isClipped = (): boolean =>
    shortened || (node.current !== null && node.current.scrollWidth > node.current.clientWidth);
  return (
    <Tooltip content={text} purpose="label" shouldOpen={isClipped}>
      <span
        data-slot="truncate"
        data-truncate=""
        {...props}
        ref={setNode}
        className={cn('block min-w-0 truncate', className)}
      >
        {shortened ? (
          <>
            <span aria-hidden="true">{display}</span>
            <span className="sr-only">{text}</span>
          </>
        ) : (
          text
        )}
      </span>
    </Tooltip>
  );
}
