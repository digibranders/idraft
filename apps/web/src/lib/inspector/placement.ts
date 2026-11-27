/**
 * Where the inspector goes and how wide it is (16-drawers-dialogs-popovers.md sections 2.2, 2.6 and 2.7):
 * the object types it opens, its one width range, and the rule that lays it over the page as a card or makes it
 * a full-width sheet.
 */

/** The objects the inspector opens, as `inspect=<type>:<id>` names them (16 section 2.7, 25 deviation 36). */
export const INSPECTOR_TYPES = [
  'keyword',
  // A keyword group; "Not grouped" is the id `__none`
  'group',
  'prompt',
  // A topic of Topics & Prompts; the prompts without a topic are the id `__none`
  'topic',
  'citation',
  'answer',
  'page',
  'competitor',
  'domain',
  'source',
  // The Citations page's drawers (WP-77): a cited page by its url_id, a prompt of the gap analysis
  'cited-page',
  'gap-prompt',
  // The Cannibalization page's keyword drawer (docs/33 section 7.2), by tracked keyword id
  'cann-keyword',
  'run',
  'candidate',
] as const;

export type InspectorType = (typeof INSPECTOR_TYPES)[number];

export interface InspectorTarget {
  type: InspectorType;
  id: string;
}

/** Widths in pixels: 640 by default, resizable from 480 to 960 and never past 60% of the viewport. */
export const INSPECTOR_WIDTH = { min: 480, max: 960, default: 640 } as const;
/** The most of the viewport, or of a boxed preview, the drawer may cover. */
export const INSPECTOR_VIEWPORT_SHARE = 0.6;
/** The card's distance from the window's right and bottom edges and from the top bar. */
export const INSPECTOR_EDGE = 12;
/** Below this viewport width the inspector is a full-width sheet. */
export const SHEET_BELOW = 900;
/** Dragged widths snap to this many pixels. */
const SNAP = 8;
/** An id is an opaque token of the API: no spaces, and not longer than this. */
const MAX_ID_LENGTH = 200;

const TYPES: ReadonlySet<string> = new Set(INSPECTOR_TYPES);

const isInspectorType = (value: string): value is InspectorType => TYPES.has(value);

/** `keyword:0192f0a1-...` as a target; `null` for anything else, so a hand-edited URL opens nothing. */
export function parseInspectTarget(value: string | null | undefined): InspectorTarget | null {
  if (value === null || value === undefined) return null;
  const at = value.indexOf(':');
  if (at === -1) return null;
  const type = value.slice(0, at);
  const id = value.slice(at + 1);
  if (!isInspectorType(type) || id === '' || id.length > MAX_ID_LENGTH || /\s/.test(id)) return null;
  return { type, id };
}

export const formatInspectTarget = ({ type, id }: InspectorTarget): string => `${type}:${id}`;

/** A width kept between the minimum and `max`, on the 8 px grid. */
export function fitInspectorWidth(width: number, max: number): number {
  const snapped = Math.round(width / SNAP) * SNAP;
  return Math.min(Math.max(snapped, INSPECTOR_WIDTH.min), Math.max(max, INSPECTOR_WIDTH.min));
}

/** The widest the drawer may be in a frame this wide, on the 8 px grid. */
export function inspectorMaxWidth(frameWidth: number): number {
  const share = Math.min(INSPECTOR_WIDTH.max, frameWidth * INSPECTOR_VIEWPORT_SHARE);
  return Math.max(INSPECTOR_WIDTH.min, Math.floor(share / SNAP) * SNAP);
}

export type InspectorMode = 'overlay' | 'sheet';

export interface InspectorPlacement {
  mode: InspectorMode;
  /** The width to draw, in pixels. */
  width: number;
  /** The widest the resize handle may go. */
  maxWidth: number;
}

/**
 * Where the inspector goes: a sheet below 900 px, otherwise a card over the page at the preferred width, kept to
 * what the frame allows. `frameWidth` is the viewport unless the inspector sits in a boxed preview.
 */
export function inspectorPlacement({
  viewportWidth,
  frameWidth = viewportWidth,
  preferred,
}: {
  viewportWidth: number;
  frameWidth?: number;
  preferred: number;
}): InspectorPlacement {
  if (viewportWidth < SHEET_BELOW) return { mode: 'sheet', width: viewportWidth, maxWidth: viewportWidth };
  const maxWidth = inspectorMaxWidth(frameWidth);
  return { mode: 'overlay', width: fitInspectorWidth(preferred, maxWidth), maxWidth };
}
