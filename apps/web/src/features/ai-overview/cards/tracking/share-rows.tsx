'use client';

import type { ReactElement, ReactNode } from 'react';

import { Tooltip } from '@/components/ui/tooltip';

/** The tokens of the segments: the sequential steps, the neutral bar, and the tone and category tokens. */
export type ShareToken =
  'seq-6' | 'seq-4' | 'seq-3' | 'chart-bar-neutral' | 'chart-positive' | 'chart-negative' | 'chart-other';

/** The fill of a segment as its custom property: the token is the only place the colour is named. */
const fillOf = (token: ShareToken): { backgroundColor: string } => ({ backgroundColor: `var(--${token})` });

export interface ShareSegment {
  id: string;
  name: string;
  token: ShareToken;
}

export interface ShareCell {
  /** 0 to 1; a segment with no share is not drawn. */
  share: number;
  shareText: string;
  /** The hover of the segment: "Mentioned first: 51%, 12 of 24 answers that give your brand a place". */
  tip: string;
}

export type ShareRowBody =
  | { kind: 'shares'; cells: readonly ShareCell[] }
  /** No bar: the reason in a chip, "Too few mentions". An unknown is never drawn as a share. */
  | { kind: 'chip'; text: string };

export interface ShareRow {
  id: string;
  label: string;
  /** The platform mark, decorative. */
  icon: ReactNode;
  /** The note at the end of the label line: "mean 1.7", "too few mentions". */
  note: string;
  body: ShareRowBody;
}

export interface ShareRowsProps {
  segments: readonly ShareSegment[];
  rows: readonly ShareRow[];
  caption: string;
}

/**
 * One 100% bar per platform with a legend and the exact shares under each bar, as the preview's position and sentiment
 * cards draw them. The shares sit in text next to a dot of their colour, so colour never carries a number alone. A
 * platform with nothing to show keeps its line and says why in a chip instead of a bar.
 */
export function ShareRows({ segments, rows, caption }: ShareRowsProps): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label={caption} className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((segment) => (
          <li key={segment.id} className="inline-flex items-center gap-1.5 type-meta">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-2xs" style={fillOf(segment.token)} />
            {segment.name}
          </li>
        ))}
      </ul>
      {rows.map((row) => (
        <div key={row.id} className="flex flex-col gap-1" data-slot="share-row">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="inline-flex min-w-0 items-center gap-2 type-body text-foreground">
              {row.icon}
              <span className="truncate">{row.label}</span>
            </span>
            <span className="ml-auto num type-meta whitespace-nowrap">{row.note}</span>
          </div>
          {row.body.kind === 'chip' ? (
            <span className="inline-flex h-6 w-fit items-center rounded-xs bg-insufficient px-1.5 type-label whitespace-nowrap text-foreground-tertiary">
              {row.body.text}
            </span>
          ) : (
            <>
              <div
                role="img"
                aria-label={segments
                  .map(
                    (segment, index) =>
                      `${segment.name} ${row.body.kind === 'shares' ? (row.body.cells[index]?.shareText ?? '') : ''}`,
                  )
                  .join(', ')}
                className="flex h-5 gap-0.5 overflow-hidden rounded-xs"
              >
                {segments.map((segment, index) => {
                  const cell = row.body.kind === 'shares' ? row.body.cells[index] : undefined;
                  if (cell === undefined || cell.share <= 0) return null;
                  return (
                    <Tooltip key={segment.id} content={cell.tip} purpose="label">
                      <div
                        aria-hidden="true"
                        data-slot="share-segment"
                        className="h-full min-w-0"
                        style={{ ...fillOf(segment.token), width: `${String(cell.share * 100)}%` }}
                      />
                    </Tooltip>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 num type-table text-foreground-secondary">
                {segments.map((segment, index) => (
                  <span key={segment.id} title={segment.name} className="inline-flex items-center gap-1">
                    <span aria-hidden="true" className="size-1.5 rounded-full" style={fillOf(segment.token)} />
                    {row.body.kind === 'shares' ? row.body.cells[index]?.shareText : null}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
