'use client';

import type { CSSProperties, ReactElement } from 'react';

import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** The dot of a brand: its palette slot (`chart-1` is the own brand), or none for a brand past the palette. */
const DOT: Readonly<Record<number, string>> = {
  1: cn('bg-chart-1'),
  2: cn('bg-chart-2'),
  3: cn('bg-chart-3'),
  4: cn('bg-chart-4'),
  5: cn('bg-chart-5'),
  6: cn('bg-chart-6'),
};

/** The 8 px dot of a brand in its palette slot; `chart-other` for a brand past the palette. */
export function CompetitorDot({ slot }: { slot: number | null }): ReactElement {
  const color = slot === null ? undefined : DOT[slot];
  return (
    <span
      aria-hidden="true"
      className={cn('size-2 shrink-0 rounded-full', color ?? 'bg-chart-other')}
      data-slot="competitor-dot"
    />
  );
}

export interface CompetitorBarRow {
  id: string;
  /** "Northwind (you)" or "HubSpot". */
  label: string;
  own: boolean;
  /** 0 to 1; `null` is a brand with no share, drawn as no bar and no number (never 0). */
  value: number | null;
  valueText: string;
  /** What the share is of, in small type after it ("29 of 65 brand mentions"); `null` when there is no count to say. */
  note?: string | null;
  /** The palette slot of the brand; `null` when it has none. */
  slot: number | null;
  /** The sentence of the hover: the figure and what it is of. */
  tip: string;
  /** What the button of a competitor row is called: "Open HubSpot". */
  openLabel: string;
}

export interface CompetitorBarsProps {
  rows: readonly CompetitorBarRow[];
  caption: string;
  /** Opens the competitor drawer; `opener` gets the focus back when it closes. */
  onOpen: (id: string, opener: HTMLElement | null) => void;
}

/**
 * The brands of a card as a list: a dot, the name, a bar and the share. A competitor's name is a button that opens its
 * drawer; your own row is text. Bars are cylinders (DS 15 section 1a) on one scale from 0, your bar in `chart-1` and each
 * other brand in its own colour. The bar column is hidden under 24 rem of card width, where the share stays.
 */
export function CompetitorBars({ rows, caption, onOpen }: CompetitorBarsProps): ReactElement {
  const top = Math.max(0.0001, ...rows.map((row) => row.value ?? 0));
  // One note column for the whole list, so the shares keep their place whichever rows have a count
  const hasNotes = rows.some((row) => row.note !== undefined && row.note !== null);
  return (
    <ul aria-label={caption} className="@container flex flex-col">
      {rows.map((row) => {
        return (
          <li key={row.id}>
            <Tooltip content={row.label} detail={row.tip} purpose="description">
              <div className="flex h-10 items-center gap-3">
                <div className="flex min-w-0 shrink-0 items-center gap-2 @sm:w-44">
                  <CompetitorDot slot={row.slot} />
                  {row.own ? (
                    <span className="min-w-0 truncate type-body-strong text-foreground">{row.label}</span>
                  ) : (
                    <button
                      type="button"
                      aria-label={row.openLabel}
                      onClick={(event) => onOpen(row.id, event.currentTarget)}
                      className="min-w-0 truncate rounded-sm text-left type-body text-foreground-secondary outline-none hover:underline focus-visible:focus-ring"
                    >
                      {row.label}
                    </button>
                  )}
                </div>
                <div className="hidden min-w-0 flex-1 @sm:block">
                  <div
                    aria-hidden="true"
                    data-slot="competitor-bar"
                    className={cn('bar-cylinder', (row.value === null || row.value === 0) && 'invisible')}
                    style={{
                      // The brand's own colour; `chart-other` for a brand past the palette
                      '--bar-color': row.own ? 'var(--chart-1)' : `var(--chart-${row.slot === null ? 'other' : String(row.slot)})`,
                      // A share too small to show as a cylinder is still a round dot, never a sliver
                      minWidth: row.value === null || row.value === 0 ? undefined : '0.875rem',
                      width: row.value === null ? '0%' : `${String(Math.max(1, Math.round((row.value / top) * 100)))}%`,
                    } as CSSProperties}
                  />
                </div>
                <span
                  className={cn(
                    'ml-auto shrink-0 text-right num type-label whitespace-nowrap',
                    hasNotes ? 'flex items-baseline gap-1.5' : 'w-24',
                    row.value === null && 'text-foreground-tertiary',
                  )}
                >
                  <span className={cn(hasNotes && 'w-10 text-right')}>{row.valueText}</span>
                  {hasNotes ? (
                    <span className="w-28 text-left type-meta font-normal text-foreground-tertiary">
                      {row.note ?? ''}
                    </span>
                  ) : null}
                </span>
              </div>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
