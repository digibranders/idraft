import type { ChartTokens } from '@/lib/design/read-tokens';
import { readColorToken } from '@/lib/design/read-tokens';

export interface TreemapTile {
  name: string;
  /** The area: citation units. */
  value: number;
  /** The colour of the tile: a slot of the chart palette (0 is `chart-1`, the own brand's) or the neutral `other`. */
  slot: number | 'other';
  /** What the tile says on itself: the name and the share. */
  label: string;
  /** The tooltip: the name, then the units of the total. */
  tip: { title: string; detail: string };
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);

/**
 * The ECharts option of the citation units treemap (OV-CIT-03): the areas partition the units, no breadcrumb and no
 * zoom, 2 px gaps and 3 px radius, each tile labelled with its name and share in the surface colour so it reads on the
 * tile in both themes. The tooltip is the page's own popover look.
 */
export function treemapOption(tiles: readonly TreemapTile[], tokens: ChartTokens): Record<string, unknown> {
  const surface = readColorToken('--surface');
  const colorOf = (slot: TreemapTile['slot']): string =>
    slot === 'other' ? tokens.other : (tokens.palette[slot] ?? tokens.other);
  const byName = new Map(tiles.map((tile) => [tile.name, tile.tip]));
  return {
    animation: false,
    tooltip: {
      backgroundColor: 'transparent',
      borderWidth: 0,
      padding: 0,
      extraCssText: 'box-shadow: none;',
      confine: true,
      formatter: (param: { name: string }): string => {
        const tip = byName.get(param.name);
        if (tip === undefined) return '';
        return (
          `<div class="rounded-lg border border-border bg-surface-elevated px-3 py-2 shadow-popover">` +
          `<div class="type-subsection-title text-foreground">${escapeHtml(tip.title)}</div>` +
          `<div class="type-table num text-foreground-secondary">${escapeHtml(tip.detail)}</div></div>`
        );
      },
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: '100%',
        height: '100%',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        itemStyle: { borderColor: surface, borderWidth: 2, gapWidth: 2, borderRadius: 3 },
        label: { show: true, fontFamily: tokens.fontFamily, fontSize: 12, color: surface, formatter: '{b}' },
        data: tiles.map((tile) => ({
          name: tile.name,
          value: tile.value,
          label: { formatter: tile.label },
          itemStyle: { color: colorOf(tile.slot) },
        })),
      },
    ],
  };
}
