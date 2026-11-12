import { init } from 'echarts/core';

import type { ChartPngBody } from './chart-frame';
// The chart types and components of the instance below are registered here, once, for the whole app
import './echart';
import {
  PNG_DASH_WIDTH,
  PNG_DEFAULT_WIDTH,
  PNG_DOT_SIZE,
  PNG_FONTS,
  PNG_PADDING,
  PNG_SCALE,
  pngLayout,
  type PngFont,
  type PngFrameText,
} from '@/lib/charts/png-layout';
import type { LightChartColors } from '@/lib/charts/light-tokens';
import type { ChartTokens } from '@/lib/design/read-tokens';

/**
 * The chart image of the overflow menu (15-data-visualization.md section 11). Client only, and loaded with
 * `import()` when the person picks Download PNG, so ECharts and this code stay out of the page's first chunk.
 */
export interface RenderChartPngInput {
  frame: PngFrameText;
  /** The light colours the legend was coloured with, read once by the caller. */
  colors: LightChartColors;
  /** The frame's width on screen, in CSS px; 0 when it has none, which falls back to `PNG_DEFAULT_WIDTH`. */
  width: number;
  body: ChartPngBody;
}

const fontOf = (font: PngFont, family: string): string =>
  `${String(PNG_FONTS[font].weight)} ${String(PNG_FONTS[font].size)}px ${family}`;

const textColor = (font: PngFont, tokens: ChartTokens): string =>
  font === 'title' ? tokens.foreground : font === 'legend' ? tokens.foregroundSecondary : tokens.label;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The chart image could not be read'));
    image.src = url;
  });
}

/** The body of a line or bar chart: an offscreen ECharts instance fed the frame's own option with light tokens. */
export function echartBody(option: (tokens: ChartTokens) => Record<string, unknown>, height: number): ChartPngBody {
  return async (colors, width) => {
    const element = document.createElement('div');
    Object.assign(element.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: `${width}px`,
      height: `${height}px`,
    });
    document.body.append(element);
    let instance: ReturnType<typeof init> | undefined;
    try {
      instance = init(element, null, { renderer: 'canvas', width, height });
      instance.setOption(option(colors.chart), { notMerge: true });
      const url = instance.getDataURL({ type: 'png', pixelRatio: PNG_SCALE, backgroundColor: colors.surface });
      return { image: await loadImage(url), height };
    } finally {
      instance?.dispose();
      element.remove();
    }
  };
}

/** Title, meta, legend, the body and the footnote on the light surface, at twice the size on screen. */
export async function renderChartPng({ frame, colors, width: measured, body }: RenderChartPngInput): Promise<Blob> {
  const { chart: tokens } = colors;
  // A frame that is not laid out (0), or too narrow for its padding, would give the body a negative width
  const width = measured > 2 * PNG_PADDING ? measured : PNG_DEFAULT_WIDTH;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('The chart image could not be drawn');

  const measure = (text: string, font: PngFont): number => {
    context.font = fontOf(font, tokens.fontFamily);
    return context.measureText(text).width;
  };
  const { image, height: bodyHeight } = await body(colors, width - 2 * PNG_PADDING);
  const layout = pngLayout({ ...frame, width, bodyHeight }, measure);

  // Resizing resets the context, so everything is set after it
  canvas.width = layout.width * PNG_SCALE;
  canvas.height = layout.height * PNG_SCALE;
  context.scale(PNG_SCALE, PNG_SCALE);
  context.fillStyle = colors.surface;
  context.fillRect(0, 0, layout.width, layout.height);

  context.textBaseline = 'middle';
  for (const run of layout.texts) {
    context.font = fontOf(run.font, tokens.fontFamily);
    context.fillStyle = textColor(run.font, tokens);
    context.fillText(run.text, run.x, run.y + PNG_FONTS[run.font].lineHeight / 2);
  }
  for (const swatch of layout.swatches) {
    if (swatch.dash === 'dashed') {
      context.strokeStyle = swatch.color;
      context.lineWidth = 2;
      context.setLineDash([3, 3]);
      context.beginPath();
      context.moveTo(swatch.x, swatch.y);
      context.lineTo(swatch.x + PNG_DASH_WIDTH, swatch.y);
      context.stroke();
      context.setLineDash([]);
    } else {
      context.fillStyle = swatch.color;
      context.beginPath();
      context.arc(swatch.x + PNG_DOT_SIZE / 2, swatch.y, PNG_DOT_SIZE / 2, 0, 2 * Math.PI);
      context.fill();
    }
  }
  context.drawImage(image, layout.body.x, layout.body.y, layout.body.width, layout.body.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('The chart image could not be encoded'));
      else resolve(blob);
    }, 'image/png');
  });
}
