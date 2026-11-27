'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { TextLink } from '@/components/ui/text-link';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** One row of an Overview card, already in words: the chart, the legend and the table draw it alike. */
export interface CardRow {
  id: string;
  label: string;
  countText: string;
  /** "62.1%"; empty when the base is 0. */
  shareText: string;
  /** The hover line that names the base of the share; left out when there is no share. */
  tip: string | undefined;
  /** All pages on the view the backend counts; a row that opens nothing has none. */
  href: Route | undefined;
  /** Starts with the label; the row's only accessible content. */
  accessibleText: string;
  /** The `bg-*` class of the mark this row has in its chart, for a legend. */
  swatch?: string | undefined;
}

const linkClass = 'rounded-sm outline-none hover:bg-surface-hover focus-visible:focus-ring';

/** The Table view of a card: the same rows with their counts and shares, each row that opens a list a link. */
export function CardRowsTable({ caption, rows }: { caption: string; rows: readonly CardRow[] }): ReactElement {
  const t = useTranslations('pages.cards.table');
  const columns: PlainColumn<CardRow>[] = [
    {
      id: 'row',
      header: t('row'),
      cell: (row) =>
        row.href === undefined ? row.label : <TextLink render={<Link href={row.href} />}>{row.label}</TextLink>,
    },
    { id: 'pages', header: t('pages'), cell: (row) => row.countText },
    { id: 'share', header: t('share'), cell: (row) => row.shareText },
  ];
  return (
    <PlainTable<CardRow>
      caption={caption}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      status="ready"
      errorState={null}
      emptyText=""
    />
  );
}

/**
 * The rows of a ring or a stacked bar as a list of links: their marks are not focusable, so the legend is the way in.
 * One link is read once, from `accessibleText`.
 */
export function CardLegend({ caption, rows }: { caption: string; rows: readonly CardRow[] }): ReactElement {
  return (
    <ul aria-label={caption} className="flex flex-col">
      {rows.map((row) => {
        const content = (
          <>
            <span className="sr-only">{row.accessibleText}</span>
            <span aria-hidden="true" className="flex min-w-0 items-center gap-2">
              {row.swatch === undefined ? null : <span className={cn('size-2 shrink-0 rounded-2xs', row.swatch)} />}
              <span className="min-w-0 flex-1 truncate type-body text-foreground">{row.label}</span>
              <span className="num type-meta whitespace-nowrap text-foreground-tertiary">{row.countText}</span>
              {row.shareText === '' ? null : (
                <span className="num type-meta whitespace-nowrap text-foreground-tertiary">{row.shareText}</span>
              )}
            </span>
          </>
        );
        return (
          <li key={row.id}>
            {/* The accessible text already says what the tooltip says: it is for the eye */}
            <Tooltip content={row.label} detail={row.tip} purpose="label">
              {row.href === undefined ? (
                <div className="flex min-h-row-compact items-center">{content}</div>
              ) : (
                <Link href={row.href} className={cn('flex min-h-row-compact items-center px-1', linkClass)}>
                  {content}
                </Link>
              )}
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
