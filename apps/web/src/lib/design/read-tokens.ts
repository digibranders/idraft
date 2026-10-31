/**
 * Colour tokens as ECharts can use them (15-data-visualization.md section 3, "Theme"). The tokens are
 * oklch, which a canvas draws but ECharts cannot blend (bands, hover shades), so each is drawn on a 1 px
 * canvas and read back as sRGB. Read on the client only, after the theme class is on `<html>`.
 */

export interface ChartTokens {
  /** `chart-1` to `chart-6`, in order: series 1 is always the own brand. */
  palette: readonly string[];
  other: string;
  reference: string;
  grid: string;
  axis: string;
  label: string;
  band: string;
  rankBandNone: string;
  surfaceElevated: string;
  border: string;
  borderStrong: string;
  foreground: string;
  foregroundSecondary: string;
  /** The page's font stack: a canvas cannot inherit it. */
  fontFamily: string;
}

const PALETTE = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'] as const;

/** A 2D context for the conversion, or `null` where there is none (a test environment). */
function canvasContext(): CanvasRenderingContext2D | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.getContext('2d', { willReadFrequently: true });
  } catch {
    return null;
  }
}

const hexByte = (value: number): string => value.toString(16).padStart(2, '0');

/**
 * One custom property of `<html>` as an opaque sRGB hex colour; the raw value where no canvas can convert
 * it. The chart tokens are opaque, and the chart adds its own opacity where a band needs one.
 */
export function readColorToken(name: string, root: Element = document.documentElement): string {
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  const context = raw === '' ? null : canvasContext();
  if (context === null) return raw;
  context.fillStyle = raw;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
  return `#${hexByte(red)}${hexByte(green)}${hexByte(blue)}`;
}

export function readChartTokens(root: Element = document.documentElement): ChartTokens {
  const read = (name: string): string => readColorToken(name, root);
  return {
    palette: PALETTE.map(read),
    other: read('--chart-other'),
    reference: read('--chart-reference'),
    grid: read('--chart-grid'),
    axis: read('--chart-axis'),
    label: read('--chart-label'),
    band: read('--chart-band'),
    rankBandNone: read('--rank-band-none'),
    surfaceElevated: read('--surface-elevated'),
    border: read('--border'),
    borderStrong: read('--border-strong'),
    foreground: read('--foreground'),
    foregroundSecondary: read('--foreground-secondary'),
    fontFamily: getComputedStyle(document.body).fontFamily,
  };
}
