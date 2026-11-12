// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { echartBody, renderChartPng } from './chart-png';
import type { LightChartColors } from '@/lib/charts/light-tokens';
import { PNG_DEFAULT_WIDTH, PNG_PADDING } from '@/lib/charts/png-layout';
import type { ChartTokens } from '@/lib/design/read-tokens';

const echarts = vi.hoisted(() => ({ init: vi.fn(), use: vi.fn() }));
vi.mock('echarts/core', () => echarts);
// The registration of chart types is a side effect of `./echart`; the stand-in below is not drawn
vi.mock('./echart', () => ({}));

// Names stand in for colours: the test reads which value went where, not how it looks
const TOKENS: ChartTokens = {
  palette: ['palette-1'],
  other: 'other',
  reference: 'reference',
  grid: 'grid',
  axis: 'axis',
  label: 'label',
  band: 'band',
  rankBandNone: 'rank-band-none',
  surfaceElevated: 'surface-elevated',
  border: 'border',
  borderStrong: 'border-strong',
  foreground: 'foreground',
  foregroundSecondary: 'foreground-secondary',
  foregroundMuted: 'foreground-muted',
  fontFamily: 'Inter, sans-serif',
};
const COLORS: LightChartColors = { chart: TOKENS, surface: 'surface' };

/** An image that loads as soon as it has an address, which jsdom does not do. */
class LoadingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

describe('echartBody', () => {
  const instance = { setOption: vi.fn(), getDataURL: vi.fn(), dispose: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Image', LoadingImage);
    instance.getDataURL.mockReturnValue('data:image/png;base64,AAAA');
    echarts.init.mockReturnValue(instance);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws the option with the light colours into an offscreen instance and hands back the image', async () => {
    const option = vi.fn(() => ({ series: [] }));
    const result = await echartBody(option, 180)(COLORS, 368);
    expect(option).toHaveBeenCalledWith(TOKENS);
    expect(echarts.init).toHaveBeenCalledWith(expect.any(HTMLElement), null, {
      renderer: 'canvas',
      width: 368,
      height: 180,
    });
    expect(instance.setOption).toHaveBeenCalledWith({ series: [] }, { notMerge: true });
    expect(instance.getDataURL).toHaveBeenCalledWith({ type: 'png', pixelRatio: 2, backgroundColor: 'surface' });
    expect(result.height).toBe(180);
    expect(result.image).toBeInstanceOf(LoadingImage);
  });

  it('disposes the instance and removes its element once the image is made', async () => {
    await echartBody(() => ({}), 180)(COLORS, 368);
    expect(instance.dispose).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('div')).toBeNull();
  });

  it('disposes the instance and removes its element when the image cannot be made', async () => {
    instance.getDataURL.mockImplementation(() => {
      throw new Error('no canvas');
    });
    await expect(echartBody(() => ({}), 180)(COLORS, 368)).rejects.toThrow('no canvas');
    expect(instance.dispose).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('div')).toBeNull();
  });

  it('removes its element when the instance cannot be made', async () => {
    echarts.init.mockImplementation(() => {
      throw new Error('no canvas context');
    });
    await expect(echartBody(() => ({}), 180)(COLORS, 368)).rejects.toThrow('no canvas context');
    expect(instance.dispose).not.toHaveBeenCalled();
    expect(document.body.querySelector('div')).toBeNull();
  });
});

describe('renderChartPng', () => {
  const frame = { title: 'Mention rate', meta: null, legend: [], footnote: null };
  const log: string[] = [];
  let fillStyle = '';
  const context = {
    font: '',
    textBaseline: '',
    lineWidth: 0,
    strokeStyle: '',
    get fillStyle(): string {
      return fillStyle;
    },
    set fillStyle(value: string) {
      fillStyle = value;
    },
    measureText: (text: string) => ({ width: text.length * 7 }),
    scale: vi.fn((x: number, y: number) => log.push(`scale ${String(x)} ${String(y)}`)),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) =>
      log.push(`fillRect ${fillStyle} ${String(x)} ${String(y)} ${String(w)} ${String(h)}`),
    ),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    drawImage: vi.fn(),
  };
  /** The size of the canvas when it was encoded. */
  let encodedSize: [number, number] | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    log.length = 0;
    encodedSize = null;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((contextId: string) =>
      contextId === '2d' ? context : null) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const encode = (blob: Blob | null): void => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
      encodedSize = [this.width, this.height];
      callback(blob);
    });
  };

  it('sizes the canvas at twice the layout, fills the light surface first and draws the body in its place', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    encode(blob);
    const image = document.createElement('canvas');
    const body = vi.fn(() => Promise.resolve({ image, height: 100 }));
    const result = await renderChartPng({ frame, colors: COLORS, width: 400, body });
    expect(result).toBe(blob);
    expect(body).toHaveBeenCalledWith(COLORS, 368);
    // Title 24 + 12 gap + body 100, with 16 padding either side
    expect(encodedSize).toEqual([800, 336]);
    expect(log.slice(0, 2)).toEqual(['scale 2 2', 'fillRect surface 0 0 400 168']);
    expect(context.fillText).toHaveBeenCalledWith('Mention rate', 16, 28);
    expect(context.drawImage).toHaveBeenCalledWith(image, 16, 52, 368, 100);
    expect(context.font).toContain('Inter, sans-serif');
  });

  it('rejects when the canvas gives no image', async () => {
    encode(null);
    const body = vi.fn(() => Promise.resolve({ image: document.createElement('canvas'), height: 100 }));
    await expect(renderChartPng({ frame, colors: COLORS, width: 400, body })).rejects.toThrow(
      'The chart image could not be encoded',
    );
  });

  it.each([0, Number.NaN, 20])('falls back to the default width when the frame measured %s', async (measured) => {
    encode(new Blob(['png'], { type: 'image/png' }));
    const body = vi.fn(() => Promise.resolve({ image: document.createElement('canvas'), height: 100 }));
    await renderChartPng({ frame, colors: COLORS, width: measured, body });
    expect(body).toHaveBeenCalledWith(COLORS, PNG_DEFAULT_WIDTH - 2 * PNG_PADDING);
    expect(encodedSize?.[0]).toBe(PNG_DEFAULT_WIDTH * 2);
  });
});
