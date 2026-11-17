import type { Route } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';

import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface TabNavItem {
  /** Where the tab goes. */
  href: Route;
  /** A noun of one or two words. */
  label: string;
  /** A count after the label, already formatted. */
  count?: string | undefined;
  current: boolean;
  /**
   * A count after the label in the `segmented` variant (WP-77). `text` is what is drawn, already formatted;
   * `spoken` is what a screen reader hears in its place: ", 61 gaps".
   */
  badge?: { text: string; spoken: string } | undefined;
  /**
   * Why there is nothing to open yet ("Not available yet"). The tab is still listed, so the person sees what
   * the page will offer, but it is not a link. It stays reachable by keyboard and gives the reason in a tooltip.
   */
  unavailable?: string | undefined;
}

export interface TabNavProps {
  /** Names the navigation landmark: "Data sources". */
  label: string;
  items: readonly TabNavItem[];
  /**
   * `underline` (default): page tabs under a header. `segmented` (WP-77): two to four route tabs as a joined
   * pair at the start of a table's toolbar (Citations, C 263 to 285). It does not offer `unavailable`.
   */
  variant?: 'underline' | 'segmented' | undefined;
}

const SEGMENT = cn(
  'inline-flex h-control-sm shrink-0 items-center justify-center gap-1.5 border px-2 outline-none select-none not-first:-ml-px first:rounded-l-md last:rounded-r-md focus-visible:relative focus-visible:focus-ring-inset',
);

const TAB = cn(
  'inline-flex h-tab shrink-0 items-center gap-1.5 type-body text-foreground-secondary outline-none select-none focus-visible:focus-ring-inset',
);

/** The label with an unseen heavier copy under it, so the tab has the same width whether current or not. */
function ReservedLabel({ label }: { label: string }): ReactElement {
  return (
    <span className="grid">
      <span className="col-start-1 row-start-1">{label}</span>
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 type-body-strong">
        {label}
      </span>
    </span>
  );
}

/**
 * Route tabs (09-buttons-controls.md section 12, 25 section 3.39): a `<nav>` of links with the underline
 * styling of `Tabs`. It is not a tablist: each tab is a page of its own, so Tab and Enter move between them
 * and the current one is `aria-current="page"`. The underline sits under the current link itself, so it
 * needs no measuring.
 */
export function TabNav({ label, items, variant = 'underline' }: TabNavProps): ReactElement {
  if (variant === 'segmented') {
    return (
      <nav data-slot="tab-nav" aria-label={label} className="inline-flex shrink-0">
        {items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            aria-current={item.current ? 'page' : undefined}
            className={cn(
              SEGMENT,
              item.current
                ? 'relative border-primary-border bg-primary-subtle type-body-strong text-primary-text'
                : 'border-border bg-surface type-body text-foreground-secondary hover:bg-surface-hover hover:text-foreground',
            )}
          >
            <span>{item.label}</span>
            {item.badge === undefined ? null : (
              <>
                <span
                  aria-hidden="true"
                  className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-neutral-subtle px-1 num type-label text-neutral-text"
                >
                  {item.badge.text}
                </span>
                <span className="sr-only">{item.badge.spoken}</span>
              </>
            )}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav data-slot="tab-nav" aria-label={label} className="min-w-0 overflow-x-auto">
      <ul className="flex gap-6 border-b border-border">
        {items.map((item) => (
          <li key={item.label} className="flex shrink-0">
            {item.unavailable === undefined ? (
              <Link
                href={item.href}
                aria-current={item.current ? 'page' : undefined}
                className={cn(
                  TAB,
                  'relative cursor-pointer',
                  item.current
                    ? 'type-body-strong text-primary-text after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary'
                    : 'hover:text-foreground',
                )}
              >
                <ReservedLabel label={item.label} />
                {item.count === undefined ? null : (
                  <span className="num type-micro text-foreground-tertiary">{item.count}</span>
                )}
              </Link>
            ) : (
              <Tooltip content={item.unavailable}>
                {/* The pattern for a link that cannot be followed: a focusable stand-in with role link and aria-disabled */}
                <span
                  role="link"
                  aria-disabled="true"
                  tabIndex={0}
                  className={cn(TAB, 'cursor-not-allowed text-foreground-disabled')}
                >
                  <ReservedLabel label={item.label} />
                </span>
              </Tooltip>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
