'use client';

import type { ReactElement } from 'react';

import { trackPercent, type ChangeDomain } from '@/components/app/chart/interval-bar';
import { Tooltip } from '@/components/ui/tooltip';
import type { Density } from '@/lib/tables/table-state';
import { cn } from '@/lib/utils';

/*
 * The body of "What moved the rate" (CH-13): one row per step, each a track with a bar placed by percent `left` and
 * `width`, as `interval-bar.tsx` places its bars. It holds no string and no number format: the card passes finished
 * words, so a change of wording is a change to the card's messages and this file stays a drawing.
 * shortcut: local to this card (plan decision D8); it may move to `components/app/chart` when a second card needs it.
 */

/** The ends of the waterfall are the rate itself (the reference colour); a contribution is neutral unless the card says it is detectable. */
export type BarTone = 'reference' | 'positive' | 'negative' | 'neutral';

const FILL: Record<BarTone, string> = {
  reference: cn('bg-chart-reference'),
  positive: cn('bg-positive-solid'),
  negative: cn('bg-negative-solid'),
  neutral: cn('bg-chart-other'),
};

export interface WaterfallRow {
  id: string;
  /** "Prompts that rose". */
  label: string;
  /** "+12.5 pts" or "65.0%": the figure at the end of the row. */
  valueText: string;
  /** "1 prompt up": under the label. */
  detailText: string;
  /** The row's only accessible content: "Prompts that rose: +12.5 pts, 1 prompt up". */
  accessibleText: string;
  /** The tooltip's second line: "Largest change: Best CRM, +50.0 pts". */
  tip?: string | undefined;
  /** Where the bar starts and ends on the rate axis. */
  from: number;
  to: number;
  tone: BarTone;
}

export interface WaterfallBodyProps {
  /** Names the list: "What moved the rate". */
  caption: string;
  rows: readonly WaterfallRow[];
  /** The rate axis; it must hold every bar (`waterfallDomain`). */
  domain: ChangeDomain;
  density?: Density | undefined;
}

/** A percent of the track with two places, so that a tiny number is never written in exponent form. */
const percentText = (value: number): string => `${String(Math.round(value * 100) / 100)}%`;

function WaterfallRowView({
  row,
  domain,
  density,
}: {
  row: WaterfallRow;
  domain: ChangeDomain;
  density: Density;
}): ReactElement {
  const compact = density === 'compact';
  const from = trackPercent(row.from, domain);
  const to = trackPercent(row.to, domain);
  return (
    <li data-bar={row.id}>
      <Tooltip content={row.label} detail={row.tip} purpose="label">
        <div className={cn('flex flex-col', compact ? 'min-h-row-compact' : 'min-h-row')}>
          <span className="sr-only">{row.accessibleText}</span>
          <div
            aria-hidden="true"
            className="flex flex-1 flex-col gap-1 py-1 @md:flex-row @md:items-center @md:gap-3 @md:py-0"
          >
            <div className="flex min-w-0 flex-col @md:w-40 @md:shrink-0">
              <span className="truncate type-body text-foreground">{row.label}</span>
              {/* Wraps: the counts are only here (the tooltip names the label), so they are never cut */}
              <span className="type-meta text-foreground-tertiary">{row.detailText}</span>
            </div>
            <div className="flex items-center gap-2 @md:flex-1">
              <div className={cn('relative min-w-0 flex-1', compact ? 'h-4' : 'h-6')}>
                <div
                  data-slot="waterfall-zero"
                  className="absolute inset-y-0 w-px bg-border-strong"
                  style={{ left: percentText(trackPercent(0, domain)) }}
                />
                <div
                  data-slot="waterfall-bar"
                  className={cn('absolute inset-y-0 min-w-px rounded-2xs', FILL[row.tone])}
                  style={{ left: percentText(Math.min(from, to)), width: percentText(Math.abs(to - from)) }}
                />
              </div>
              <span className="w-20 shrink-0 text-right num type-table text-foreground">{row.valueText}</span>
            </div>
          </div>
        </div>
      </Tooltip>
    </li>
  );
}

/** The steps of a change as bars on one rate axis: the rate before, what moved it, and the rate now. */
export function WaterfallBody({ caption, rows, domain, density = 'default' }: WaterfallBodyProps): ReactElement {
  return (
    <div className="@container">
      <ul aria-label={caption} className="flex flex-col">
        {rows.map((row) => (
          <WaterfallRowView key={row.id} row={row} domain={domain} density={density} />
        ))}
      </ul>
    </div>
  );
}
