/**
 * Where each part of a chart's PNG goes (15-data-visualization.md section 11): title, meta line, legend,
 * the chart, the footnote, in that order, on a 16 px padding. Pure: the caller measures text, so the
 * layout is tested without a canvas and drawn by `chart-png.ts`.
 */
export const PNG_PADDING = 16;
/** The PNG is drawn at twice the size on screen, so it stays sharp when it is zoomed. */
export const PNG_SCALE = 2;
/** The width in CSS px when the frame has none to give (not laid out yet): a common panel width. */
export const PNG_DEFAULT_WIDTH = 960;

export type PngFont = 'title' | 'meta' | 'legend';

/** Size, weight and line height of each text, in CSS px (the frame's own `type-*` sizes). */
export const PNG_FONTS: Readonly<Record<PngFont, { size: number; weight: number; lineHeight: number }>> = {
  title: { size: 16, weight: 600, lineHeight: 24 },
  meta: { size: 13, weight: 400, lineHeight: 20 },
  legend: { size: 12, weight: 400, lineHeight: 16 },
};

/** A dot swatch is 8 px across; a dashed swatch is a 12 px line. */
export const PNG_DOT_SIZE = 8;
export const PNG_DASH_WIDTH = 12;

const BLOCK_GAP = 12;
const LEGEND_ENTRY_GAP = 12;
const LEGEND_ROW_GAP = 8;
const SWATCH_TEXT_GAP = 6;

export interface PngLegendEntry {
  name: string;
  color: string;
  dash: 'solid' | 'dashed';
}

export interface PngFrameText {
  title: string;
  meta: string | null;
  legend: readonly PngLegendEntry[];
  footnote: string | null;
}

export interface PngLayoutInput extends PngFrameText {
  width: number;
  bodyHeight: number;
}

/** `y` is the top of the line's box. */
export interface PngTextRun {
  text: string;
  x: number;
  y: number;
  font: PngFont;
}

/** `x` is the left edge and `y` the vertical centre of the swatch. */
export interface PngSwatch {
  x: number;
  y: number;
  color: string;
  dash: 'solid' | 'dashed';
}

export interface PngLayout {
  width: number;
  height: number;
  texts: readonly PngTextRun[];
  swatches: readonly PngSwatch[];
  body: { x: number; y: number; width: number; height: number };
}

export type MeasureText = (text: string, font: PngFont) => number;

/** Greedy line breaks at spaces; a word wider than the line keeps a line of its own. */
function wrap(text: string, font: PngFont, maxWidth: number, measure: MeasureText): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter((part) => part !== '')) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (line !== '' && measure(candidate, font) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** Title (16/24, 600, wraps), meta (13/20, wraps), legend (12/16, wraps), body, footnote (13/20, wraps), 16 px padding. */
export function pngLayout(input: PngLayoutInput, measure: MeasureText): PngLayout {
  const { width, bodyHeight, title, meta, legend, footnote } = input;
  const inner = width - 2 * PNG_PADDING;
  const texts: PngTextRun[] = [];
  const swatches: PngSwatch[] = [];
  let y = PNG_PADDING;

  for (const line of wrap(title, 'title', inner, measure)) {
    texts.push({ text: line, x: PNG_PADDING, y, font: 'title' });
    y += PNG_FONTS.title.lineHeight;
  }
  if (meta !== null) {
    for (const line of wrap(meta, 'meta', inner, measure)) {
      texts.push({ text: line, x: PNG_PADDING, y, font: 'meta' });
      y += PNG_FONTS.meta.lineHeight;
    }
  }

  if (legend.length > 0) {
    y += BLOCK_GAP;
    const rowHeight = PNG_FONTS.legend.lineHeight;
    let x = 0;
    for (const entry of legend) {
      const swatchWidth = entry.dash === 'dashed' ? PNG_DASH_WIDTH : PNG_DOT_SIZE;
      const entryWidth = swatchWidth + SWATCH_TEXT_GAP + measure(entry.name, 'legend');
      if (x > 0 && x + entryWidth > inner) {
        x = 0;
        y += rowHeight + LEGEND_ROW_GAP;
      }
      swatches.push({ x: PNG_PADDING + x, y: y + rowHeight / 2, color: entry.color, dash: entry.dash });
      texts.push({ text: entry.name, x: PNG_PADDING + x + swatchWidth + SWATCH_TEXT_GAP, y, font: 'legend' });
      x += entryWidth + LEGEND_ENTRY_GAP;
    }
    y += rowHeight;
  }

  y += BLOCK_GAP;
  const body = { x: PNG_PADDING, y, width: inner, height: bodyHeight };
  y += bodyHeight;

  if (footnote !== null) {
    y += BLOCK_GAP;
    for (const line of wrap(footnote, 'meta', inner, measure)) {
      texts.push({ text: line, x: PNG_PADDING, y, font: 'meta' });
      y += PNG_FONTS.meta.lineHeight;
    }
  }

  return { width, height: y + PNG_PADDING, texts, swatches, body };
}
