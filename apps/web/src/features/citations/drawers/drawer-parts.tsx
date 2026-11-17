'use client';

import type { ReactElement, ReactNode } from 'react';

import { EngineLogo } from '@/components/app/engine/engine-logo';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { Tooltip } from '@/components/ui/tooltip';
import type { EngineCode } from '@/lib/api/types';
import { displayUrl } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The small tables and lists of the two Citations drawers (I 47 to 64, 218 to 238): compact 32 px rows inside a flush
 * card, 16 px at the outer edges, 8 px between columns. Feature-local, as the earlier source inspector's engine table
 * was (`domain-inspector/engine-table.tsx`): they are not record lists users sort or act on.
 */

export interface DrawerColumn {
  id: string;
  label: ReactNode;
  /** Width and alignment classes: `w-20 text-right`. */
  className?: string | undefined;
}

export function DrawerTable({
  caption,
  columns,
  children,
  wide = false,
}: {
  caption: string;
  columns: readonly DrawerColumn[];
  children: ReactNode;
  /** The By platform grid: as wide as its columns, scrolling sideways in its card (I 325 to 329). */
  wide?: boolean;
}): ReactElement {
  const table = (
    <table className={cn('table-fixed type-table', wide ? 'min-w-full' : 'w-full')}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="h-row-compact border-t border-border-subtle bg-surface-subtle">
          {columns.map((column) => (
            <th
              key={column.id}
              scope="col"
              className={cn(
                'px-2 text-left type-label font-normal whitespace-nowrap first:pl-4 last:pr-4',
                column.className,
              )}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
  return wide ? <div className="overflow-x-auto">{table}</div> : table;
}

export const DRAWER_ROW = 'h-row-compact border-t border-border-subtle';

export interface DrawerPage {
  urlId: number;
  url: string;
  citations: number;
  /** The mark's colour. */
  swatch: { own: boolean; colorIndex: number | null };
  /** A second line: the competitor's name, or why the page is listed. */
  note?: string | undefined;
  /** The engines that cite it, drawn as marks with a tooltip; left out for the closest page list (I 228). */
  engines?: readonly { code: EngineCode; label: string }[] | undefined;
  enginesTip?: string | undefined;
  countText: string;
}

/** A list of pages (I 219 to 238): dot, address, optional note, engine marks, "N×". */
export function PageList({ pages }: { pages: readonly DrawerPage[] }): ReactElement {
  return (
    <ul className="flex flex-col">
      {pages.map((page) => (
        <li key={page.urlId} className="flex min-h-9 items-center gap-2 border-t border-border-subtle px-4 py-1.5">
          <EntitySwatch shape="dot" own={page.swatch.own} colorIndex={page.swatch.colorIndex} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate type-body text-foreground">{displayUrl(page.url).display}</span>
            {page.note === undefined ? null : <span className="truncate type-meta">{page.note}</span>}
          </span>
          {page.engines === undefined ? null : (
            <Tooltip content={page.enginesTip ?? ''} purpose="label" disabled={page.enginesTip === undefined}>
              <span className="flex shrink-0 items-center gap-1">
                {page.engines.map((engine) => (
                  <EngineLogo
                    key={engine.code}
                    engine={engine.code}
                    name={engine.label}
                    nameDisplay="visually-hidden"
                  />
                ))}
              </span>
            </Tooltip>
          )}
          <span className="w-10 shrink-0 text-right num type-meta">{page.countText}</span>
        </li>
      ))}
    </ul>
  );
}

/** The owner mark and name of a badge (I 81 to 82, 186 to 187). */
export function BrandLabel({
  name,
  swatch,
}: {
  name: string;
  swatch: { own: boolean; colorIndex: number | null };
}): ReactElement {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <EntitySwatch shape="dot" own={swatch.own} colorIndex={swatch.colorIndex} />
      <span className="truncate">{name}</span>
    </span>
  );
}
