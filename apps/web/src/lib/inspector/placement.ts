/**
 * Where the inspector goes and how wide it is (16-drawers-dialogs-popovers.md sections 2.2, 2.6 and 2.7):
 * the object types it opens, their default widths, and the rule that docks it beside the list, lays it over
 * the list, or makes it a full-screen sheet.
 */

/** The objects the inspector opens, as `inspect=<type>:<id>` names them (16 section 2.7, 25 deviation 36). */
export const INSPECTOR_TYPES = [
  'keyword',
  'prompt',
  'citation',
  'answer',
  'page',
  'competitor',
  'domain',
  'source',
  'run',
  'candidate',
] as const;

export type InspectorType = (typeof INSPECTOR_TYPES)[number];

export interface InspectorTarget {
  type: InspectorType;
  id: string;
}

/** Widths in pixels: 400 by default, 440 for the wordier objects, resizable from 360 to 640. */
export const INSPECTOR_WIDTH = { min: 360, max: 640, default: 400, wide: 440 } as const;
/** The main column never gets narrower than this while the inspector docks. */
export const MIN_MAIN_COLUMN = 720;
/** The card's distance from the window's right and bottom edges and from the top bar. */
export const INSPECTOR_EDGE = 12;
/** Below this viewport width the inspector is a full-screen sheet. */
export const SHEET_BELOW = 768;
/** In overlay mode the inspector leaves at least this much of the page visible. */
const OVERLAY_GUTTER = 56;
/** Dragged widths snap to this many pixels. */
const SNAP = 8;
/** An id is an opaque token of the API: no spaces, and not longer than this. */
const MAX_ID_LENGTH = 200;

const WIDE_TYPES: ReadonlySet<InspectorType> = new Set(['prompt', 'citation', 'answer']);
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

export const defaultInspectorWidth = (type: InspectorType): number =>
  WIDE_TYPES.has(type) ? INSPECTOR_WIDTH.wide : INSPECTOR_WIDTH.default;

/** A width kept between the minimum and `max`, on the 8 px grid. */
export function fitInspectorWidth(width: number, max: number): number {
  const snapped = Math.round(width / SNAP) * SNAP;
  return Math.min(Math.max(snapped, INSPECTOR_WIDTH.min), Math.max(max, INSPECTOR_WIDTH.min));
}

export type InspectorMode = 'docked' | 'overlay' | 'sheet';

export interface InspectorPlacement {
  mode: InspectorMode;
  /** The width to draw, in pixels. */
  width: number;
  /** The widest the resize handle may go. */
  maxWidth: number;
}

/**
 * The docking rule of 16 section 2.6. `areaWidth` is the width beside the sidebar (the viewport less the
 * sidebar), which the layout measures; `preferred` is the remembered or default width. The inspector
 * docks when the main column keeps 720 px and the inspector gets at least its minimum, overlays the list
 * from 768 px otherwise, and is a sheet below that.
 */
export function inspectorPlacement({
  areaWidth,
  viewportWidth,
  preferred,
}: {
  areaWidth: number;
  viewportWidth: number;
  preferred: number;
}): InspectorPlacement {
  if (viewportWidth < SHEET_BELOW) return { mode: 'sheet', width: viewportWidth, maxWidth: viewportWidth };
  const available = areaWidth - MIN_MAIN_COLUMN - INSPECTOR_EDGE;
  if (available >= INSPECTOR_WIDTH.min) {
    const maxWidth = Math.min(INSPECTOR_WIDTH.max, available);
    return { mode: 'docked', width: fitInspectorWidth(Math.min(preferred, available), maxWidth), maxWidth };
  }
  const maxWidth = Math.min(INSPECTOR_WIDTH.max, viewportWidth - OVERLAY_GUTTER);
  return { mode: 'overlay', width: fitInspectorWidth(preferred, maxWidth), maxWidth };
}
