'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type MouseEvent, type ReactElement, useRef } from 'react';

import { DomainCell, type DomainRole, type FaviconMode } from './domain-cell';
import { Popover } from '@/components/ui/popover';
import { TextLink } from '@/components/ui/text-link';
import { formatInteger } from '@/lib/format';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';

/** The most domains the popover lists; the rest are "and N more". */
export const COUNT_POPOVER_MAX = 5;

const stop = (event: MouseEvent): void => event.stopPropagation();

export interface CountPopoverDomain {
  id: string;
  /** As the API sent it. Untrusted: text only. */
  host: string;
  registrable: string;
  role?: DomainRole | undefined;
  /** Preformatted ("12"), short: the count column is `w-16` (64 px), about 9 characters. Required: a share is never shown without its count. */
  countText: string;
  /** "8.1%", shown after the count, never alone. */
  shareText?: string | undefined;
  href?: Route | undefined;
}

export interface CountPopoverProps {
  /** What the cell shows: "5". Preformatted; "n/a" for an unknown count, which is never "0". */
  countText: string;
  /** The trigger's accessible name, with the count and the noun: "5 domains cited instead, show them". */
  label: string;
  /** The popover's visible heading, which names it: "Cited instead". */
  title: string;
  /** Most first; the first `COUNT_POPOVER_MAX` are listed, each a `DomainCell` (`context="list"`) and its count. */
  domains: readonly CountPopoverDomain[];
  /** Every domain behind the count; `null` when unknown. Unknown or 0: the count is plain text, no popover. */
  total: number | null;
  /** The full list: "and 7 more" becomes a link to it. Without it, plain text. */
  moreHref?: Route | undefined;
  favicon?: FaviconMode | undefined;
  /** `grid` (default): the trigger is a cell control and its click does not open the row. */
  context?: 'grid' | 'list' | undefined;
}

/**
 * A count that opens the domains behind it (12-tables.md section 6): up to five, each with its own count and, when
 * given, its share after it, then "and N more". A real 0, an unknown count and a count with nothing to list are
 * plain text: there is nothing to open.
 */
export function CountPopover({
  countText,
  label,
  title,
  domains,
  total,
  moreHref,
  favicon,
  context = 'grid',
}: CountPopoverProps): ReactElement {
  const t = useTranslations('common.countPopover');
  // Focus lands on the popup (named by its title), not the first link: a link's tooltip would open on that focus
  const popup = useRef<HTMLDivElement>(null);
  const shown = domains.slice(0, COUNT_POPOVER_MAX);
  if (total === null || total <= 0 || shown.length === 0) return <span className="num">{countText}</span>;
  const remaining = total - shown.length;
  // One share column for every row, so a row without a share does not move the counts
  const hasShare = shown.some((entry) => entry.shareText !== undefined);
  const grid = context === 'grid';
  return (
    <Popover
      title={title}
      ref={popup}
      initialFocus={popup}
      // The popup renders in a portal, but a React click still bubbles to the row that holds the cell
      {...(grid ? { onClick: stop } : {})}
      trigger={
        <button
          type="button"
          aria-label={label}
          {...(grid ? { ...CELL_CONTROL, onClick: stop } : {})}
          className="inline-flex min-h-6 min-w-6 cursor-pointer items-center justify-center rounded-xs num text-link underline-offset-2 hover:underline focus-visible:underline focus-visible:focus-ring"
        >
          {countText}
        </button>
      }
    >
      <ul className="flex flex-col gap-2">
        {shown.map((entry) => (
          <li key={entry.id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <DomainCell
                host={entry.host}
                registrable={entry.registrable}
                context="list"
                {...(entry.role === undefined ? {} : { role: entry.role })}
                {...(entry.href === undefined ? {} : { href: entry.href })}
                {...(favicon === undefined ? {} : { favicon })}
              />
            </div>
            <span className="flex shrink-0 items-baseline gap-2 num type-meta">
              <span className="w-16 shrink-0 text-right">{entry.countText}</span>
              {hasShare ? (
                <span className="w-14 shrink-0 text-right text-foreground-secondary">{entry.shareText}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {remaining > 0 ? <More text={t('more', { count: formatInteger(remaining) })} href={moreHref} /> : null}
    </Popover>
  );
}

function More({ text, href }: Readonly<{ text: string; href: Route | undefined }>): ReactElement {
  return href === undefined ? (
    <p className="type-meta text-foreground-secondary">{text}</p>
  ) : (
    <TextLink render={<Link href={href} />} className="type-meta">
      {text}
    </TextLink>
  );
}
