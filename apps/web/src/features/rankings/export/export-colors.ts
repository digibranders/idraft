import { readColorToken } from '@/lib/design/read-tokens';

/**
 * The colors of the workbook, each as a hex color, or an empty string where the page has no tokens to read
 * (a test environment). A workbook has no stylesheet, so the tokens are resolved here, once per export.
 */
export interface WorkbookColors {
  /** Text, and the fill behind the header row. */
  ink: string;
  /** Secondary text: the line of facts, the counts' names, ranks beyond the top 20, the time of a check. */
  muted: string;
  /** Text on the header row. */
  onInk: string;
  /** The accent: the counts, the ranking address and the top 10. */
  brand: string;
  brandSubtle: string;
  /** Every second row of the table. */
  stripe: string;
  /** The line under the last row. */
  line: string;
  /** The sheet itself: the gap between the count tiles is drawn in it. */
  surface: string;
  positive: string;
  positiveSubtle: string;
  warning: string;
  warningSubtle: string;
}

/**
 * The tokens as the light theme gives them, whatever theme is on screen: a workbook opens on a white sheet,
 * so dark-theme colors would put pale text on it. The theme class is lifted for the reads and put back
 * before the page is painted, so nothing flickers.
 */
export function readWorkbookColors(root: HTMLElement = document.documentElement): WorkbookColors {
  const wasDark = root.classList.contains('dark');
  root.classList.remove('dark');
  try {
    const read = (name: string): string => readColorToken(`--${name}`, root);
    return {
      ink: read('foreground'),
      muted: read('foreground-secondary'),
      onInk: read('foreground-inverse'),
      brand: read('primary-text'),
      brandSubtle: read('primary-subtle'),
      stripe: read('surface-subtle'),
      line: read('border'),
      surface: read('surface'),
      positive: read('positive-text'),
      positiveSubtle: read('positive-subtle'),
      warning: read('warning-text'),
      warningSubtle: read('warning-subtle'),
    };
  } finally {
    if (wasDark) root.classList.add('dark');
  }
}
