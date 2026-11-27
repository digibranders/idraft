'use client';

import type { ReactElement, ReactNode } from 'react';

import { RingsChart } from '@/components/app/chart/rings-chart';
import { SharesTable } from '@/components/app/chart/shares-table';

/** The tokens of the outcomes: the sequential tokens `seq-6`, `seq-4`, `seq-3` and the neutral one. */
export type OutcomeToken = 'seq-6' | 'seq-4' | 'seq-3' | 'chart-bar-neutral';

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
  /** What the answers are, when that is not the plain count of valid answers: Google AI Overview's, one for each prompt. */
  answersTip?: string | undefined;
  /** The number in the middle of the platform's ring: its visibility rate, "42%". */
  center: string;
  /** The four outcomes in the order of the segments. */
  shares: readonly OutcomeShareText[];
}

export interface OutcomeRingsProps {
  segments: readonly OutcomeSegment[];
  rows: readonly OutcomeRow[];
  caption: string;
  /** What the rings show in words, for people who cannot see them. */
  label: string;
}

/** The ring is 176 px tall: room for the ring and its number, with the platform names below. */
const RING_HEIGHT = 176;

/**
 * The outcomes of the answers of each platform as one plain ring (OV-OUT, 15-data-visualization.md section 1a), with the
 * platform's visibility rate in the middle and its name below. Under the rings a table holds the exact shares of every
 * outcome with a dot each, so colour never carries a number alone, and the answers behind each platform (`SharesTable`).
 */
export function OutcomeRings({ segments, rows, caption, label }: OutcomeRingsProps): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <RingsChart
        height={RING_HEIGHT}
        label={label}
        segments={segments.map(({ id, name, token }) => ({ id, name, token }))}
        rows={rows.map((row) => ({
          id: row.id,
          label: row.label,
          center: row.center,
          shares: row.shares.map((entry) => entry.share),
          tips: row.shares.map((entry) => entry.tip),
        }))}
      />
      <SharesTable
        caption={caption}
        segments={segments.map(({ id, name, token }) => ({ id, name, token }))}
        columns={rows.map((row) => ({
          id: row.id,
          label: row.label,
          icon: row.icon,
          sub: row.answersText,
          subTip: row.answersTip,
          noneText: '',
          cells: row.shares.map((entry) => ({ text: entry.shareText, tip: entry.tip })),
        }))}
      />
    </div>
  );
}
