import type { ReactElement } from 'react';

/**
 * A project's first letter in a 28 px square (11-navigation.md section 8): the project switcher and the
 * workspace's project list show the same mark. Decorative; the project's name is always beside it or in a
 * tooltip.
 */
export function ProjectMonogram({ name }: Readonly<{ name: string }>): ReactElement {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground type-subsection-title text-foreground-inverse dark:bg-primary dark:text-primary-foreground"
    >
      {[...name.trim()][0]?.toUpperCase() ?? ''}
    </span>
  );
}
