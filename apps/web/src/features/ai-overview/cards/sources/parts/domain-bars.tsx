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
  /** The label is in the strong weight; left out, it follows `own`. */
  strong?: boolean | undefined;
  /** The role badge beside the label. */
  badge?: ReactNode;
  /** After the share, in the meta style: "24 units". */
  note?: string | undefined;
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
  /** The bars show at any card width; left out they are hidden under 20 rem, where the share stays. */
  alwaysBars?: boolean | undefined;
}

/**
 * The domains of a card as one line each, as the design preview draws them: the domain and its role badge, a bar on one
 * scale from 0, and the share. The bar column is hidden under 20 rem of card width, where the share stays.
 */
export function DomainBars({ rows, caption, alwaysBars = false }: DomainBarsProps): ReactElement {
  const top = Math.max(0.0001, ...rows.map((row) => row.value ?? 0));
  return (
    <div className="@container">
      <table aria-label={caption} className="w-full">
        <tbody>
          {rows.map((row) => {
            // The tooltip is on the content of each cell: a table row cannot hold the hidden description it adds
            const tip = (node: ReactElement<{ 'aria-describedby'?: string }>): ReactElement => (
              <Tooltip content={row.label} detail={row.tip} purpose="label">
                {node}
              </Tooltip>
            );
            return (
              <tr key={row.id} className="h-10">
                <th scope="row" className={cn('pr-3 text-left font-normal', alwaysBars && 'w-1/2 max-w-0')}>
                  {tip(
                    <span className="inline-flex max-w-full min-w-0 items-center gap-2">
                      {row.href === undefined ? (
                        <span
                          className={cn(
                            'min-w-0 truncate text-foreground',
                            (row.strong ?? row.own) ? 'type-body-strong' : 'type-body',
                          )}
                        >
                          {row.label}
                        </span>
                      ) : (
                        <Link
                          href={row.href}
                          className={cn(
                            'min-w-0 truncate rounded-sm text-foreground outline-none hover:underline focus-visible:focus-ring',
                            (row.strong ?? row.own) ? 'type-body-strong' : 'type-body',
                          )}
                        >
                          {row.label}
                        </Link>
                      )}
                      {row.badge}
                    </span>,
                  )}
                </th>
                <td className={cn('w-full pr-3', !alwaysBars && 'hidden @xs:table-cell')}>
                  {tip(
                    <div
                      aria-hidden="true"
                      data-slot="domain-bar"
                      className={cn('h-5 rounded-2xs', row.own ? 'bg-chart-1' : 'bg-chart-bar-neutral')}
                      style={{
                        width:
                          row.value === null ? '0%' : `${String(Math.max(1, Math.round((row.value / top) * 100)))}%`,
                      }}
                    />,
                  )}
                </td>
                <td
                  className={cn(
                    'text-right num type-label whitespace-nowrap',
                    row.value === null && 'text-foreground-tertiary',
                  )}
                >
                  {tip(
                    <span>
                      {row.valueText}
                      {row.note === undefined ? null : <span className="ml-1.5 type-meta">{row.note}</span>}
                    </span>,
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
