import type { ReactElement } from 'react';

/**
 * The first focusable element of every shell page (20-accessibility.md section 4.5, 25 section 5.2):
 * hidden until it has focus, then shown at the top left over the top bar.
 */
export function SkipLink({ label, targetId }: { label: string; targetId: string }): ReactElement {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only rounded-md bg-surface-elevated px-3 py-2 type-body-strong text-foreground shadow-popover focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-(--z-toast) focus-visible:focus-ring"
    >
      {label}
    </a>
  );
}
