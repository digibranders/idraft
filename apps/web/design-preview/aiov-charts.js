/* global document, window, echarts, ResizeObserver, MutationObserver */
/**
 * Charts of the AI visibility Overview: ECharts options built from the tokens at draw time (so the light and dark
 * themes both work), with the rules of docs/design-system/15-data-visualization.md: no animation, dashed previous
 * period, bands at low opacity, tooltips in the shared anatomy, one table alternative per chart (the card's Table
 * toggle, in aiov-cards.js).
 */
import { formatInteger } from './vendor/format/number.js';

const charts = window.PreviewCharts;
const live = new Set();

/**
 * The pointer over a chart: a ring with a dot and four ticks, with a white edge so it reads on light and dark cards. It
 * points at a place on the chart rather than at a thing, which is what a chart reading is. It is the one cursor of a chart,
 * over empty canvas and over marks alike (no hand); `crosshair` is the fallback where an image cursor is refused.
 */
const RING_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'><g fill='none' stroke-linecap='round'><circle cx='14' cy='14' r='7' stroke='white' stroke-width='4'/><circle cx='14' cy='14' r='7' stroke='#1E65E3' stroke-width='2'/><path d='M14 2v4M14 22v4M2 14h4M22 14h4' stroke='white' stroke-width='4'/><path d='M14 2v4M14 22v4M2 14h4M22 14h4' stroke='#1E65E3' stroke-width='2'/></g><circle cx='14' cy='14' r='2.2' fill='#1E65E3' stroke='white' stroke-width='1.2'/></svg>",
)}") 14 14, crosshair`;

/** Makes the chart's pointer the ring: zrender sets `default` over empty canvas and `pointer` over marks that answer the pointer. */
function useChartCursor(chart) {
  const proxy = chart.getZr().handler?.proxy;
  if (!proxy?.setCursor) return;
  const set = proxy.setCursor.bind(proxy);
  proxy.setCursor = (cursor) => set(!cursor || cursor === 'default' || cursor === 'pointer' ? RING_CURSOR : cursor);
  proxy.setCursor('default');
}

/**
 * Mounts a chart and keeps it sized and themed. `build` returns the option. `redrawOnResize` draws the option again when
 * the host changes size, for charts whose option holds px sizes (rings, columns). `onChart` receives the instance, for events.
 */
export function mountChart(host, build, { redrawOnResize = false, onChart } = {}) {
  const chart = echarts.init(host, null, { renderer: 'canvas' });
  useChartCursor(chart);
  // A chart that draws px sizes waits until its host has a size, so it does not animate from a zero-width layout
  const draw = () => {
    if (redrawOnResize && host.clientWidth === 0) return;
    chart.setOption(build(), true);
  };
  draw();
  onChart?.(chart);
  const resize = new ResizeObserver(() => {
    chart.resize();
    if (redrawOnResize) draw();
  });
  resize.observe(host);
  const theme = new MutationObserver(draw);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  const dispose = () => {
    resize.disconnect();
    theme.disconnect();
    chart.dispose();
    live.delete(dispose);
  };
  live.add(dispose);
  return dispose;
}

/** Disposes every chart of the page, before it draws again. */
export function disposeCharts() {
  [...live].forEach((dispose) => dispose());
}

export function chartHost(height, label) {
  const host = document.createElement('div');
  host.className = 'w-full';
  host.style.height = `${height}px`;
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', label);
  return host;
}

const pctAxis = (value) => `${Math.round(value * 100)}%`;

/** The marker of a line by its place among the lines, as the real app's `lineSymbolOf` gives it. */
export const MARKER_SHAPES = ['circle', 'rect', 'triangle', 'diamond', 'roundRect', 'pin'];
// 8 px legend shapes in an 8 x 8 box, the paths of the real legend
export const MARKER_PATHS = {
  circle: 'M4 0a4 4 0 1 0 0 8a4 4 0 1 0 0-8z',
  rect: 'M0 0h8v8H0z',
  triangle: 'M4 0L8 8H0z',
  diamond: 'M4 0L8 4L4 8L0 4z',
  roundRect: 'M1.5 0h5A1.5 1.5 0 0 1 8 1.5v5A1.5 1.5 0 0 1 6.5 8h-5A1.5 1.5 0 0 1 0 6.5v-5A1.5 1.5 0 0 1 1.5 0z',
  pin: 'M4 8L1 3.5a3 3 0 1 1 6 0z',
};

/**
 * Lines over the eight weekly runs. `lines`: `{ name, token, values, dashed, width }`. `band` is a 95% interval
 * `{ low, high }` drawn behind the first line. Values are ratios unless `format` says otherwise.
 */
export function lineOption({ labels, lines, band, boundary, format = pctAxis, tooltipFormat, min, max, tooltipRows, markers = false }) {
  const axes = charts.axisTheme();
  const all = lines.flatMap((line) => line.values).filter((value) => value !== null);
  const low = min ?? Math.max(0, Math.floor((Math.min(...all) - 0.03) * 20) / 20);
  const high = max ?? Math.ceil((Math.max(...all) + 0.03) * 20) / 20;
  const series = [];
  if (band) {
    series.push(
      { id: 'band-low', type: 'line', stack: 'band', data: band.low, lineStyle: { opacity: 0 }, symbol: 'none', silent: true, tooltip: { show: false } },
      { id: 'band-width', type: 'line', stack: 'band', data: band.high.map((value, index) => (value === null ? null : value - band.low[index])), lineStyle: { opacity: 0 }, areaStyle: { color: charts.token(lines[0].token, 0.14) }, symbol: 'none', silent: true, tooltip: { show: false } },
    );
  }
  lines.forEach((line, position) =>
    series.push({
      id: `line-${line.name}`,
      name: line.name,
      type: 'line',
      data: line.values,
      color: charts.token(line.token),
      // Marker shapes tell the lines apart without colour (20-accessibility.md section 12.2): the first line is the circle
      showSymbol: markers,
      symbol: markers ? MARKER_SHAPES[position % MARKER_SHAPES.length] : 'circle',
      symbolSize: 6,
      connectNulls: false,
      z: line.dashed ? 2 : 3,
      lineStyle: { width: line.width ?? 2, join: 'round', ...(line.dashed ? { type: [4, 4], color: charts.token(line.token, line.dashedAlpha ?? 1) } : {}) },
      emphasis: { focus: 'none' },
      // Where the current window starts: weeks before it are the previous period
      ...(boundary && line === lines[0] ? { markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { type: [3, 3], color: charts.token('chart-reference'), width: 1 }, data: [{ xAxis: boundary }] } } : {}),
    }),
  );
  const tip = tooltipFormat ?? ((value) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`));
  return {
    animation: false,
    grid: { left: 44, right: 28, top: 8, bottom: 24, outerBoundsMode: 'none' },
    xAxis: { type: 'category', data: labels, boundaryGap: false, ...axes.x },
    yAxis: { type: 'value', min: low, max: high, ...axes.y, axisLabel: { ...axes.y.axisLabel, formatter: format } },
    tooltip: charts.tooltipTheme(
      (list) => tooltipRows?.(list) ?? list.filter((param) => param.seriesId?.startsWith('line-')).map((param) => ({ color: param.color, name: param.seriesName, value: tip(param.value) })),
    ),
    series,
  };
}

/**
 * A stacked 100% area: share of voice over the weekly runs. `layers`: `{ name, token, values, notes }` that add up to 1 per
 * week; `notes[week]` is `{ text, detail }`, the tooltip's words for the layer's week: the percent with its brand mentions
 * (D17), and for an average of platforms the counts of each platform as a line below.
 */
export function shareAreaOption({ labels, layers }) {
  const axes = charts.axisTheme();
  return {
    animation: false,
    grid: { left: 44, right: 28, top: 8, bottom: 24, outerBoundsMode: 'none' },
    xAxis: { type: 'category', data: labels, boundaryGap: false, ...axes.x },
    yAxis: { type: 'value', min: 0, max: 1, interval: 0.25, ...axes.y, axisLabel: { ...axes.y.axisLabel, formatter: pctAxis } },
    // Six brands with the counts of each platform are taller than the 240 px chart: the tooltip hangs on the page, not in the chart
    tooltip: {
      ...charts.tooltipTheme((list) =>
        list.map((param) => {
          const note = layers[param.seriesIndex]?.notes?.[param.dataIndex];
          return { color: param.color, name: param.seriesName, value: param.value === null ? 'n/a' : note?.text ?? `${(param.value * 100).toFixed(1)}%`, detail: note?.detail };
        }),
      ),
      // On the page and kept inside the window (the tooltip theme confines it to the chart otherwise)
      confine: true,
      appendToBody: true,
    },
    series: layers.map((layer) => ({
      name: layer.name,
      type: 'line',
      stack: 'share',
      data: layer.values,
      color: charts.token(layer.token, layer.alpha ?? 0.9),
      showSymbol: false,
      lineStyle: { width: 1, color: charts.token('surface') },
      areaStyle: { color: charts.token(layer.token, layer.alpha ?? 0.9) },
      emphasis: { focus: 'series' },
    })),
  };
}

/** Citation units by source type, as a treemap (CH-34): the areas partition the units. */
export function treemapOption({ types, total }) {
  // The own site is chart-1 everywhere; the other source types take the remaining chart colors in order
  const others = ['chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'chart-other'];
  let next = 0;
  const colorOf = (type) => (type === 'Your site' ? 'chart-1' : others[next++ % others.length]);
  return {
    animation: false,
    tooltip: {
      backgroundColor: 'transparent',
      borderWidth: 0,
      padding: 0,
      extraCssText: 'box-shadow: none;',
      confine: true,
      formatter: (param) =>
        `<div class="rounded-lg border border-border bg-surface-elevated shadow-popover px-3 py-2"><div class="type-subsection-title text-foreground">${param.name}</div>` +
        `<div class="type-table num text-foreground-secondary">${formatInteger(param.value)} of ${formatInteger(total)} citation units (${((param.value / total) * 100).toFixed(1)}%)</div></div>`,
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
        itemStyle: { borderColor: charts.token('surface'), borderWidth: 2, gapWidth: 2, borderRadius: 3 },
        label: { show: true, fontFamily: charts.fontFamily(), fontSize: 12, color: charts.token('surface'), formatter: (param) => `${param.name}\n${((param.value / total) * 100).toFixed(0)}%` },
        data: types.map((entry) => ({ name: entry.type, value: entry.units, itemStyle: { color: charts.token(colorOf(entry.type)) } })),
      },
    ],
  };
}
