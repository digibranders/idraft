'use client';

import type { ReactElement } from 'react';

import { Tooltip } from '@/components/ui/tooltip';

export interface FanoutTableRow {
  id: string;
  /** The query as the platform ran it: provider text, drawn as text. */
  query: string;
  answers: string;
  prompts: string;
  /** The domain cited most in the answers that ran it; empty when none. */
  topCited: string;
  /** The hover of the query: the platform, the prompts and the domains cited. */
  tip: string;
}

export interface FanoutTableProps {
  rows: readonly FanoutTableRow[];
  caption: string;
  headers: { query: string; answers: string; prompts: string; topCited: string };
}

const HEAD = 'px-3 type-table-header whitespace-nowrap';

/**
 * The fan-out queries of the card as a table, as the preview draws it: the query (one line, cut where it is long), the
 * answers that ran it and its prompts to the right, and the domain cited most beside it from 768 px. The header row is
 * a quiet band across the card.
 */
export function FanoutTable({ rows, caption, headers }: FanoutTableProps): ReactElement {
  return (
    <div className="-mx-4 overflow-x-auto">
      <table aria-label={caption} className="w-full type-table">
        <thead>
          <tr className="h-row-header border-t border-border-subtle bg-surface-subtle">
            <th scope="col" className={`${HEAD} pl-4 text-left`}>
              {headers.query}
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              {headers.answers}
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              {headers.prompts}
            </th>
            <th scope="col" className={`${HEAD} hidden pr-4 text-right md:table-cell`}>
              {headers.topCited}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="h-row-compact border-t border-border-subtle">
              <th scope="row" className="w-full max-w-0 pr-3 pl-4 text-left font-normal text-foreground">
                <Tooltip content={row.query} detail={row.tip} purpose="label">
                  <span className="block truncate">{row.query}</span>
                </Tooltip>
              </th>
              <td className="px-3 text-right num">{row.answers}</td>
              <td className="px-3 text-right num">{row.prompts}</td>
              <td className="hidden px-3 pr-4 text-right text-foreground-secondary md:table-cell">{row.topCited}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
