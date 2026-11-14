import { readChartTokens, readColorToken, type ChartTokens } from '@/lib/design/read-tokens';

/** The colours a chart image is drawn in: the chart tokens and the card's surface. */
export interface LightChartColors {
  chart: ChartTokens;
  surface: string;
}

/**
 * The light theme's colours whatever theme is on screen: an image is opened on a white page, so
 * dark-theme colours would put pale text on it. The `dark` class is lifted for the reads and put back
 * before the page is painted, so nothing flickers (the `readWorkbookColors` precedent).
 */
export function readLightChartColors(root: HTMLElement = document.documentElement): LightChartColors {
  const wasDark = root.classList.contains('dark');
  root.classList.remove('dark');
  try {
    return { chart: readChartTokens(root), surface: readColorToken('--surface', root) };
  } finally {
    if (wasDark) root.classList.add('dark');
  }
}
