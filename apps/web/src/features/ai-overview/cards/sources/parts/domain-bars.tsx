'use client';

import type { Route } from 'next';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';

import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface DomainBarRow {
  id: string;
  /** The domain as shown. */
  label: string;
  /** The project's own domain: a strong label and a `chart-1` bar; every other bar is neutral. */
  own: boolean;
  /** The role badge beside the label. */
  badge: ReactNode;
  /** 0 to 1; `null` has no bar (a share that cannot be told is never a 0). */
  value: number | null;
  /** The share as text, or the words that stand in for it. */
  valueText: string;
  /** The second line of the hover: the units, answers and prompts behind the share. */
  tip: string;
  /** The Citations page for the domain. */
  href?: Route | undefined;
}

export interface DomainBarsProps {
  rows: readonly DomainBarRow[];
  caption: string;
}

/**
 * The domains of a card as one line each, as the design preview draws them: the domain and its role badge, a bar on one
 * scale from 0, and the share. The bar column is hidden under 20 rem of card width, where the share stays.
 */
export function DomainBars({ rows, caption }: DomainBarsProps): ReactElement {
  const top = Math.max(0.0001, ...rows.map((row) => row.value ?? 0));
  return (
    <div className="@container">
      <ul
        aria-label={caption}
        className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 @xs:grid-cols-[minmax(0,max-content)_minmax(0,1fr)_auto]"
      >
        {rows.map((row) => (
          <li key={row.id} className="col-span-full grid grid-cols-subgrid">
            <Tooltip content={row.label} detail={row.tip} purpose="description">
              <div className="col-span-full grid h-10 grid-cols-subgrid items-center">
                <div className="flex min-w-0 items-center gap-2">
                  {row.href === undefined ? (
                    <span
                      className={cn('min-w-0 truncate text-foreground', row.own ? 'type-body-strong' : 'type-body')}
                    >
                      {row.label}
                    </span>
                  ) : (
                    <Link
                      href={row.href}
                      className={cn(
                        'min-w-0 truncate rounded-sm text-foreground outline-none hover:underline focus-visible:focus-ring',
                        row.own ? 'type-body-strong' : 'type-body',
                      )}
                    >
                      {row.label}
                    </Link>
                  )}
                  {row.badge}
                </div>
                <div className="hidden min-w-0 @xs:block">
                  <div
                    aria-hidden="true"
                    data-slot="domain-bar"
                    className={cn('h-5 rounded-2xs', row.own ? 'bg-chart-1' : 'bg-chart-bar-neutral')}
                    style={{
                      width: row.value === null ? '0%' : `${String(Math.max(1, Math.round((row.value / top) * 100)))}%`,
                    }}
                  />
                </div>
                <span
                  className={cn(
                    'text-right num type-label whitespace-nowrap',
                    row.value === null && 'text-foreground-tertiary',
                  )}
                >
                  {row.valueText}
                </span>
              </div>
            </Tooltip>
          </li>
        ))}
      </ul>
    </div>
  );
}
