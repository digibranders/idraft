'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { Truncate } from '@/components/ui/truncate';
import { cn } from '@/lib/utils';

/** A cell is at least this wide before a page strip wraps to two rows (23 section 2.3). */
const MIN_CELL = 140;
/** Ends of the ids that tie an inline chip's value to its label, after the strip's own id and the item's. */
const TERM_SUFFIX = '-term';
const VALUE_SUFFIX = '-value';

export interface MetricStripItem {
  id: string;
  /** From the metric registry, short form allowed: "Search volume". */
  label: string;
  /** Next to the label: an `Estimate` badge, a `MetricInfo` trigger, a stale warning. */
  labelAddon?: ReactNode;
  /** The formatted value: "48,210". */
  value: string;
  /**
   * The value is not a number: "Insufficient data", "Not collected yet". It reads in the tertiary colour,
   * and `insufficient` puts the hatching behind it (17 section 8).
   */
  unknown?: { kind: 'insufficient' | 'not-applicable' | 'pending' } | null | undefined;
  /** The value is a word that is an answer ("Present, not cited"), not a figure: body type at full contrast, not the metric size. */
  text?: boolean | undefined;
  /** A `Delta` or `RankDelta`, left out when there is no comparison (never a zero in its place). */
  delta?: ReactNode;
  /** The denominator, sample or variant: "of 986 keywords". */
  context?: string | null | undefined;
  /** A `BudgetMeter` or similar bar under the value, in the context position (23 section 11.1). */
  meter?: ReactNode;
  /**
   * The counts behind the value, in a tooltip and as the cell's description (23 section 2.1: "the full context is
   * in the value tooltip"). The cell becomes a tab stop that opens the tooltip on focus (20 section 6.2 rule 6),
   * and its context line wraps instead of truncating, so a touch screen, which has no tooltip, still reads it
   * whole. `size="inline"` makes the chip's value the tab stop and leaves its context out, since the tooltip
   * is read in its place.
   */
  tip?: string | undefined;
  /**
   * Where the item leads inside the app. The label (with its addon) becomes the link, stretched over the whole
   * cell, so the addon must not be a control of its own. `md` and `sm` strips only; an `inline` chip ignores it.
   * A cell with both `href` and `tip` has its tooltip reachable by keyboard only: the link's `::after` covers the
   * value, so a pointer never reaches it.
   */
  href?: Route | undefined;
}

export interface MetricStripGroup {
  /** The channel the items belong to; a group starts after a stronger divider. */
  id: string;
  items: readonly MetricStripItem[];
}

export interface MetricStripProps {
  /**
   * `md`: the page strip, one panel in a row. `sm`: the key-value grid of the inspector. `inline`: label and
   * value side by side without a panel, for a page toolbar; the context stays for screen readers and the tooltip.
   */
  size: 'md' | 'sm' | 'inline';
  /** Names the list: "Summary for the filtered keywords". */
  label: string;
  groups: readonly MetricStripGroup[];
  /** Loading keeps the labels and draws the values as bars; refetching keeps the values as they are. */
  status: 'loading' | 'ready' | 'refetching';
  /** `inline` only: the chips stay on one line, for a toolbar that scrolls them sideways instead of wrapping. */
  nowrap?: boolean | undefined;
}

/**
 * Columns of the strip: one row when every cell gets 140 px, else two rows (23 section 2.3). On a phone two rows of
 * three would leave cells under 140 px, so the columns are as many as fit, and two at the least (the preview's phone
 * strip). Above about 420 px, for six items, that is the two rows of three it always was. Two items that do not fit
 * side by side stack in one column, as two cells of under 140 px would be worse.
 */
function columnsFor(count: number, width: number | null, size: 'md' | 'sm' | 'inline'): number {
  if (size === 'sm') return count === 4 ? 2 : Math.min(count, 3);
  if (width === null || width >= count * MIN_CELL + (count - 1)) return count;
  const least = count === 2 ? 1 : 2;
  return Math.min(count, Math.max(least, Math.min(Math.ceil(count / 2), Math.floor(width / MIN_CELL))));
}

/**
 * The summary of a scope (23-application-patterns.md section 2, 25 section 9.1): 3 to 6 metrics in one
 * panel, never a row of cards. Each item reads label, value, delta and context, as a `dt` and a `dd`.
 * Between channel groups the divider is the stronger border.
 */
export function MetricStrip({ size, label, groups, status, nowrap = false }: MetricStripProps): ReactElement {
  const ids = useId();
  const panel = useRef<HTMLDListElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = panel.current;
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const items = groups.flatMap((group, groupIndex) =>
    group.items.map((item, index) => ({ item, groupStart: groupIndex > 0 && index === 0 })),
  );
  const columns = columnsFor(items.length, width, size);
  const md = size === 'md';
  if (size === 'inline') {
    return (
      <div role="group" aria-label={label} aria-busy={status === 'ready' ? undefined : true}>
        <dl className={cn('flex items-baseline gap-x-5 gap-y-1', nowrap ? 'flex-nowrap' : 'flex-wrap')}>
          {items.map(({ item }) => {
            const tipped = item.tip !== undefined && status !== 'loading';
            const termId = ids + item.id + TERM_SUFFIX;
            const valueId = ids + item.id + VALUE_SUFFIX;
            return (
              <div
                key={item.id}
                title={tipped ? undefined : (item.context ?? undefined)}
                className={cn('flex min-w-0 items-baseline gap-1.5', nowrap && 'shrink-0')}
              >
                <dt id={termId} className="type-meta text-foreground-tertiary">
                  {item.label}
                </dt>
                <Tooltip content={item.tip ?? ''} disabled={!tipped}>
                  <dd
                    id={valueId}
                    // A chip with counts in its tooltip is a tab stop that opens it (20 section 6.2 rule 6), named by
                    // its label and its value
                    {...(tipped ? { tabIndex: 0, 'aria-labelledby': `${termId} ${valueId}` } : {})}
                    className={cn(
                      'flex items-baseline gap-1.5',
                      tipped && '-mx-1 rounded-sm px-1 outline-none focus-visible:focus-ring-inset',
                    )}
                  >
                    {status === 'loading' ? (
                      <span className="flex w-6 items-center">
                        <Skeleton shape="text-14" widthPct={100} />
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'num type-body-strong',
                          item.unknown === null || item.unknown === undefined
                            ? 'text-foreground'
                            : 'text-foreground-tertiary',
                          item.unknown?.kind === 'insufficient' && 'bg-insufficient',
                        )}
                      >
                        {item.value}
                      </span>
                    )}
                    {item.delta === undefined || item.delta === null ? null : (
                      <span className="num type-body-strong">{item.delta}</span>
                    )}
                    {/* The tooltip carries the counts, so the context is read once */}
                    {item.context === undefined || item.context === null || tipped ? null : (
                      <span className="sr-only">{item.context}</span>
                    )}
                  </dd>
                </Tooltip>
              </div>
            );
          })}
        </dl>
      </div>
    );
  }
  // A list of terms has no role that takes a name, so a group around it carries the name and the busy state
  return (
    <div role="group" aria-label={label} aria-busy={status === 'ready' ? undefined : true}>
      <dl
        ref={panel}
        style={{ gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))` }}
        className={cn(
          'grid overflow-hidden rounded-lg border bg-surface',
          md ? 'border-border' : 'border-border-subtle',
        )}
      >
        {items.map(({ item, groupStart }, index) => {
          const firstInRow = index % columns === 0;
          const unknown = item.unknown ?? null;
          const tipped = item.tip !== undefined && status !== 'loading';
          const name = (
            <>
              <Truncate text={item.label} className="text-foreground-tertiary" />
              {item.labelAddon}
            </>
          );
          return (
            <div
              key={item.id}
              className={cn(
                'flex min-w-0 flex-col',
                md ? 'px-5 py-3' : 'p-3',
                !firstInRow && (groupStart ? 'border-l border-border' : 'border-l border-border-subtle'),
                index >= columns && 'border-t border-border-subtle',
                // the link's ::after covers the cell, so the cell is its box, and it shows hover and focus
                item.href !== undefined && 'relative hover:bg-surface-hover has-focus-visible:focus-ring-inset',
              )}
            >
              <dt className={cn('flex min-w-0 items-center gap-1', md ? 'type-meta' : 'type-label')}>
                {item.href === undefined ? (
                  name
                ) : (
                  <Link
                    href={item.href}
                    className="flex min-w-0 items-center gap-1 outline-none after:absolute after:inset-0"
                  >
                    {name}
                  </Link>
                )}
              </dt>
              <Tooltip content={item.tip ?? ''} disabled={!tipped}>
                <dd
                  // A cell with counts in its tooltip is a tab stop that opens it (20 section 6.2 rule 6: a
                  // tooltip on an element nothing focuses reaches no keyboard user); the lint rule cannot see why
                  {...(tipped ? { tabIndex: 0 } : {})}
                  className={cn('flex min-w-0 flex-col', tipped && 'outline-none focus-visible:focus-ring-inset')}
                >
                  {status === 'loading' ? (
                    <span className={cn('flex items-center', md ? 'h-8 w-16' : 'h-6 w-14')}>
                      <Skeleton shape="text-14" widthPct={100} />
                    </span>
                  ) : (
                    <span className="flex min-w-0 items-baseline gap-2">
                      {unknown === null && item.text === true ? (
                        <span
                          className={cn(
                            'flex min-w-0 items-center type-body-strong text-foreground',
                            md ? 'h-8' : 'h-6',
                          )}
                        >
                          {item.value}
                        </span>
                      ) : unknown === null ? (
                        <span className={cn('shrink-0 num text-foreground', md ? 'type-metric' : 'type-metric-sm')}>
                          {item.value}
                        </span>
                      ) : (
                        <span
                          className={cn(
                            'flex shrink-0 items-center type-body text-foreground-tertiary',
                            md ? 'h-8' : 'h-6',
                            unknown.kind === 'insufficient' && 'bg-insufficient',
                          )}
                        >
                          {item.value}
                        </span>
                      )}
                      {item.delta === undefined || item.delta === null ? null : (
                        <span className="shrink-0 num type-body-strong">{item.delta}</span>
                      )}
                    </span>
                  )}
                  {item.context === undefined || item.context === null ? null : item.tip === undefined ? (
                    <Truncate text={item.context} className="type-meta text-foreground-tertiary" />
                  ) : (
                    <span className="type-meta text-foreground-tertiary">{item.context}</span>
                  )}
                  {item.meter === undefined || item.meter === null || status === 'loading' ? null : (
                    <span className="mt-1.5 flex">{item.meter}</span>
                  )}
                </dd>
              </Tooltip>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
