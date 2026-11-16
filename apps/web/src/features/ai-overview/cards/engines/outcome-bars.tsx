'use client';

import type { ReactElement, ReactNode } from 'react';

import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** The fill of each outcome, by its token: the sequential tokens `seq-6`, `seq-4`, `seq-3` and the neutral one. */
export type OutcomeToken = 'seq-6' | 'seq-4' | 'seq-3' | 'chart-bar-neutral';

const FILL: Readonly<Record<OutcomeToken, string>> = {
  'seq-6': cn('bg-seq-6'),
  'seq-4': cn('bg-seq-4'),
  'seq-3': cn('bg-seq-3'),
  'chart-bar-neutral': cn('bg-chart-bar-neutral'),
};

export interface OutcomeSegment {
  id: string;
  name: string;
  token: OutcomeToken;
}

export interface OutcomeShareText {
  segmentId: string;
  share: number;
  shareText: string;
  /** The hover of the segment: "Mentioned only: 10%, 4 of 44 answers". */
  tip: string;
}

export interface OutcomeRow {
  id: string;
  label: string;
  /** The platform mark, decorative. */
  icon: ReactNode;
  /** "1,800 answers". */
  answersText: string;
  /** The four outcomes in the order of the segments. */
  shares: readonly OutcomeShareText[];
}

export interface OutcomeBarsProps {
  segments: readonly OutcomeSegment[];
  rows: readonly OutcomeRow[];
  caption: string;
}

/**
 * The outcomes of the answers of each platform as a 100% bar (OV-OUT): a legend, then for each platform its name and
 * answers, a bar with the four outcomes, and the exact shares under it with a dot each, so colour never carries the
 * number alone (DS 15). No pie, donut or gauge. A segment with no share is not drawn, and every row keeps its height.
 */
export function OutcomeBars({ segments, rows, caption }: OutcomeBarsProps): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label={caption} className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((segment) => (
          <li key={segment.id} className="inline-flex items-center gap-1.5 type-meta">
            <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-2xs', FILL[segment.token])} />
            {segment.name}
          </li>
        ))}
      </ul>
      {rows.map((row) => (
        <div key={row.id} className="flex flex-col gap-1" data-slot="outcome-row">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="inline-flex min-w-0 items-center gap-2 type-body text-foreground">
              {row.icon}
              <span className="truncate">{row.label}</span>
            </span>
            <span className="ml-auto num type-meta whitespace-nowrap">{row.answersText}</span>
          </div>
          <div
            role="img"
            aria-label={segments
              .map((segment, index) => `${segment.name} ${row.shares[index]?.shareText ?? ''}`)
              .join(', ')}
            className="flex h-5 gap-0.5 overflow-hidden rounded-xs"
          >
            {segments.map((segment, index) => {
              const entry = row.shares[index];
              if (entry === undefined || entry.share <= 0) return null;
              return (
                <Tooltip key={segment.id} content={entry.tip} purpose="label">
                  <div
                    aria-hidden="true"
                    data-slot="outcome-segment"
                    className={cn('h-full min-w-0', FILL[segment.token])}
                    style={{ width: `${String(entry.share * 100)}%` }}
                  />
                </Tooltip>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 num type-table text-foreground-secondary">
            {segments.map((segment, index) => (
              <span key={segment.id} title={segment.name} className="inline-flex items-center gap-1">
                <span aria-hidden="true" className={cn('size-1.5 rounded-full', FILL[segment.token])} />
                {row.shares[index]?.shareText}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
