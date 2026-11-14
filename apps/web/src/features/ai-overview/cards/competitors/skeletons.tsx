'use client';

import type { ComponentType, ReactElement } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * The stand-in of each card of the family while its code arrives (D-13): the panel of `pending-skeleton.tsx` as
 * tall as the card is once it has loaded, so nothing below it moves when the card replaces it.
 *
 * Two heights are kept apart. `SKELETON_HEIGHTS` is the body of the card's `ChartFrame` (140, 180, 240 or 280 px,
 * DS 15): the height the frame reserves for its own loading, empty and error states. `SKELETON_TOTALS` is the whole
 * panel of the loaded card at its default options: that body or the list it holds, plus the title and meta lines,
 * the footnotes and the padding. A skeleton is a component with no props, so it cannot know the `rows` option or the
 * width the card is drawn at; it takes the catalog defaults and the width where the card is usually shown.
 */
export const SKELETON_HEIGHTS: Readonly<Record<string, 240 | 280>> = {
  'ai.share_of_voice': 280,
  'ai.lost_to_competitor': 240,
  'ai.opportunities': 240,
  'ai.competitor_trend': 240,
  'ai.sov_over_time': 280,
  'ai.sov_rank': 240,
  'ai.co_mentions': 280,
  'ai.competitor_table': 280,
};

/** Border and padding of the panel (34 px), the title and meta lines (44 px) and the two gaps between the parts (24 px). */
const PANEL_CHROME = 102;
/** One line of a footnote (`type-meta`, 20 px). */
const NOTE_LINE = 20;
/** One row of a `BarList` (32 px), and the row of the engine mark and its caption above it (20 px and a 12 px gap). */
const LIST_ROW = 32;
const LIST_HEAD = 32;

interface PanelParts {
  /** The body: the frame's height, or the list it holds when that is taller. */
  body: number;
  /** Lines of footnote. */
  notes: number;
}

const panelHeight = ({ body, notes }: PanelParts): number => PANEL_CHROME + notes * NOTE_LINE + body;

/** A list card: the frame's body, or the engine row and the default rows when they are taller. */
const listBody = (frame: number, rows: number): number => Math.max(frame, LIST_HEAD + rows * LIST_ROW);

/**
 * The whole panel of each card once loaded, by catalog key. Share of voice, lost to a competitor and share of voice
 * over time are built from the parts above. The other five are measured, on the Eventus mock at 1280 px in the light
 * theme: their footnotes run to several lines (the rank note alone is about five), the opportunities rows and the
 * table cells wrap, and the co-mentions grid draws a square cell for each of the eight brands.
 */
export const SKELETON_TOTALS: Readonly<Record<string, number>> = {
  'ai.share_of_voice': panelHeight({ body: listBody(280, 10), notes: 3 }),
  'ai.lost_to_competitor': panelHeight({ body: listBody(240, 5), notes: 2 }),
  'ai.opportunities': 542,
  'ai.competitor_trend': 422,
  'ai.sov_over_time': panelHeight({ body: 280, notes: 4 }),
  'ai.sov_rank': 542,
  'ai.co_mentions': 966,
  'ai.competitor_table': 685,
};

function skeletonOf(height: number, total: number): ComponentType {
  function CompetitorCardSkeleton(): ReactElement {
    return (
      <div
        data-height={height}
        style={{ height: total }}
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
      >
        <Skeleton shape="text-14" widthPct={48} />
        <div className="min-h-0 flex-1">
          <Skeleton shape="block" className="h-full w-full" />
        </div>
      </div>
    );
  }
  return CompetitorCardSkeleton;
}

/** By catalog key, for `CardRegistration.skeleton` in `COMPETITOR_CARDS`. */
export const COMPETITOR_SKELETONS: Readonly<Record<string, ComponentType>> = Object.fromEntries(
  Object.entries(SKELETON_HEIGHTS).map(([key, height]) => [key, skeletonOf(height, SKELETON_TOTALS[key] ?? 0)]),
);
