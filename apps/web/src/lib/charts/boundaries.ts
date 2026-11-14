import type { ChartTokens } from '@/lib/design/read-tokens';

export interface ChartBoundary {
  /** The category the boundary sits on, exactly as on the x axis ("Oct 26"). */
  at: string;
  /** Short and plain: "Extractor v4", "hubspot.com added". */
  label: string;
}

/**
 * A line series with no data that carries one dashed vertical `markLine` per boundary (15-data-visualization.md
 * section 4, 20-frontend-specification.md section 4.6 rule 1): 1 px dashed in `tokens.foregroundMuted`, the label at
 * the top in 12 px weight 500 (`type-micro`) in `tokens.label`, silent, and not in the tooltip. A boundary whose `at`
 * is not in `categories` is dropped, so a line is never drawn in a wrong place; the result is `null` when none is left.
 * The label goes through a function formatter, so a `{a}` in a name is never read as an ECharts template.
 */
export function boundaryMarkLines(
  boundaries: readonly ChartBoundary[],
  categories: readonly string[],
  tokens: ChartTokens,
): Record<string, unknown> | null {
  const known = new Set(categories);
  const drawn = boundaries.filter((boundary) => known.has(boundary.at));
  if (drawn.length === 0) return null;
  return {
    id: 'boundaries',
    type: 'line',
    data: [],
    silent: true,
    tooltip: { show: false },
    markLine: {
      silent: true,
      symbol: 'none',
      animation: false,
      data: drawn.map(({ at, label }) => ({
        xAxis: at,
        lineStyle: { type: 'dashed', width: 1, color: tokens.foregroundMuted },
        label: {
          show: true,
          position: 'end',
          formatter: (): string => label,
          color: tokens.label,
          fontSize: 12,
          fontWeight: 500,
          fontFamily: tokens.fontFamily,
        },
      })),
    },
  };
}
