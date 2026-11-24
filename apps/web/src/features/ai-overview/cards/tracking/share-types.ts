import type { ReactNode } from 'react';

/** The tokens of the segments: the sequential steps, the neutral bar, and the tone and category tokens. */
export type ShareToken =
  'seq-6' | 'seq-4' | 'seq-3' | 'chart-bar-neutral' | 'chart-positive' | 'chart-negative' | 'chart-other';

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
