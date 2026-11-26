/* global window, echarts, Node */
/**
 * Rich charts of the AI visibility Overview. The owner overrode the quiet chart rules of
 * docs/design-system/15-data-visualization.md for charts on 2026-11-23 (gradients, depth, glow, donuts and entrance
 * motion are allowed here). Everything still comes from the tokens, so light and dark both work, and every chart keeps
 * its text alternative (the card's Table view, or the exact numbers printed beside it).
 *
 * Builders return ECharts options. They take sizes in px, so a card mounts them with `redrawOnResize`.
 */
import { formatInteger } from './vendor/format/number.js';
import { MARKER_SHAPES, mountChart } from './aiov-charts.js';
import { el, icon, pct0 } from './aiov-parts.js';

const charts = window.PreviewCharts;
const encode = (text) => echarts.format.encodeHTML(String(text));

/** The words of a label that may be a node (`platformLabel` returns the name with its logo), for chart text. */
export const plain = (label) => (label instanceof Node ? label.textContent.trim() : label);
const pctAxis = (value) => `${Math.round(value * 100)}%`;

/** Entrance and update motion, switched off for people who ask the system for less motion. */
const motion = () => ({
  animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  animationDuration: 800,
  animationDurationUpdate: 400,
  animationEasing: 'cubicOut',
});

/** A vertical (or, with `horizontal`, left to right) fade of a token from `from` to `to` opacity. */
const fade = (token, from, to, horizontal = false) =>
  new echarts.graphic.LinearGradient(0, 0, horizontal ? 1 : 0, horizontal ? 0 : 1, [
    { offset: 0, color: charts.token(token, from) },
    { offset: 1, color: charts.token(token, to) },
  ]);

/** The popover of the shared tooltip anatomy, for charts whose tooltip names one mark instead of an axis position. */
function itemTooltip(rowOf) {
  return {
    trigger: 'item',
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    extraCssText: 'box-shadow: none;',
    confine: true,
    appendToBody: true,
    formatter: (param) => {
      const { title, color, name, value, detail } = rowOf(param);
      return (
        `<div class="min-w-48 rounded-lg border border-border bg-surface-elevated shadow-popover px-3 py-2">` +
        (title ? `<div class="type-subsection-title text-foreground mb-1">${encode(title)}</div>` : '') +
        `<div class="flex items-center gap-2 h-6"><span class="size-2 rounded-full" style="background:${color}"></span>` +
        `<span class="type-table text-foreground-secondary">${encode(name)}</span>` +
        `<span class="ml-auto pl-6 type-table num text-foreground">${encode(value)}</span></div>` +
        (detail ? `<div class="type-meta text-foreground-secondary pl-4 pb-1 whitespace-normal">${encode(detail)}</div>` : '') +
        `</div>`
      );
    },
  };
}

// -------------------------------------------------------------------------------------------------
// Lines: smooth, with a fade under each line and the latest value at its end

/**
 * Lines over the weekly runs, as `lineOption` of aiov-charts.js takes them (`{ name, token, values, dashed, width }`, an
 * optional 95% `band`, the `boundary` week of a comparison) with smooth curves, a fade under each line, no glow
 * and the latest value written at the end of every line.
 */
export function richLineOption({ labels, lines, band, boundary, format = pctAxis, tooltipFormat, min, max, tooltipRows }) {
  const axes = charts.axisTheme();
  const all = lines.flatMap((line) => line.values).filter((value) => value !== null);
  const low = min ?? Math.max(0, Math.floor((Math.min(...all) - 0.03) * 20) / 20);
  const high = max ?? Math.ceil((Math.max(...all) + 0.03) * 20) / 20;
  const solid = lines.filter((line) => !line.dashed).length;
  const series = [];
  if (band) {
    series.push(
      { id: 'band-low', type: 'line', stack: 'band', smooth: 0.3, data: band.low, lineStyle: { opacity: 0 }, symbol: 'none', silent: true, tooltip: { show: false } },
      { id: 'band-width', type: 'line', stack: 'band', smooth: 0.3, data: band.high.map((value, index) => (value === null ? null : value - band.low[index])), lineStyle: { opacity: 0 }, areaStyle: { color: fade(lines[0].token, 0.22, 0.06) }, symbol: 'none', silent: true, tooltip: { show: false } },
    );
  }
  lines.forEach((line, position) => {
    const color = charts.token(line.token);
    series.push({
      id: `line-${line.name}`,
      name: line.name,
      type: 'line',
      data: line.values,
      smooth: 0.3,
      color,
      showSymbol: !line.dashed,
      // Marker shapes tell the lines apart without colour (20-accessibility.md section 12.2); a ring in the card color lifts them off the line
      symbol: MARKER_SHAPES[position % MARKER_SHAPES.length],
      symbolSize: 9,
      itemStyle: { color, borderColor: charts.token('surface'), borderWidth: 2 },
      connectNulls: false,
      z: line.dashed ? 2 : 3,
      lineStyle: line.dashed
        ? { width: line.width ?? 2, join: 'round', type: [4, 4], color: charts.token(line.token, line.dashedAlpha ?? 1) }
        : { width: line.width ?? 3, join: 'round', cap: 'round', color },
      // One line gets a strong fade; several share a lighter one so they stay legible where they cross
      areaStyle: line.dashed ? undefined : { color: fade(line.token, solid > 1 ? 0.16 : 0.34, 0) },
      emphasis: { focus: 'none', scale: 1.3 },
      endLabel: line.dashed ? { show: false } : { show: true, color, fontFamily: charts.fontFamily(), fontSize: 12, fontWeight: 600, distance: 8, formatter: ({ value }) => (value === null || value === undefined ? '' : format(value)) },
      labelLayout: { moveOverlap: 'shiftY' },
      // Where the current window starts: weeks before it are the previous period
      ...(boundary && line === lines[0] ? { markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { type: [3, 3], color: charts.token('chart-reference'), width: 1 }, data: [{ xAxis: boundary }] } } : {}),
    });
  });
  const tip = tooltipFormat ?? ((value) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`));
  return {
    ...motion(),
    grid: { left: 44, right: 60, top: 12, bottom: 24, outerBoundsMode: 'none' },
    xAxis: { type: 'category', data: labels, boundaryGap: false, ...axes.x },
    yAxis: { type: 'value', min: low, max: high, ...axes.y, axisLabel: { ...axes.y.axisLabel, formatter: format } },
    tooltip: {
      ...charts.tooltipTheme(
      (list) => tooltipRows?.(list) ?? list.filter((param) => param.seriesId?.startsWith('line-')).map((param) => ({ color: charts.token(lines.find((line) => `line-${line.name}` === param.seriesId)?.token ?? 'chart-1'), name: param.seriesName, value: tip(param.value) })),
      ),
      axisPointer: pointerFade(),
    },
    series,
  };
}

/** The share of every brand over the weekly runs, stacked to 100%, as smooth bands that fade toward the axis. */
export function richShareAreaOption({ labels, layers }) {
  const axes = charts.axisTheme();
  return {
    ...motion(),
    grid: { left: 44, right: 28, top: 8, bottom: 24, outerBoundsMode: 'none' },
    xAxis: { type: 'category', data: labels, boundaryGap: false, ...axes.x },
    yAxis: { type: 'value', min: 0, max: 1, interval: 0.25, ...axes.y, axisLabel: { ...axes.y.axisLabel, formatter: pctAxis } },
    tooltip: {
      ...charts.tooltipTheme((list) =>
        list.map((param) => {
          const note = layers[param.seriesIndex]?.notes?.[param.dataIndex];
          return { color: charts.token(layers[param.seriesIndex].token), name: param.seriesName, value: param.value === null ? 'n/a' : note?.text ?? `${(param.value * 100).toFixed(1)}%`, detail: note?.detail };
        }),
      ),
      confine: true,
      appendToBody: true,
      axisPointer: pointerFade(),
    },
    series: layers.map((layer) => ({
      name: layer.name,
      type: 'line',
      stack: 'share',
      smooth: 0.25,
      data: layer.values,
      showSymbol: false,
      lineStyle: { width: 1.5, color: charts.token(layer.token) },
      areaStyle: { color: fade(layer.token, layer.alpha ?? 0.9, (layer.alpha ?? 0.9) * 0.55) },
      emphasis: { focus: 'series' },
    })),
  };
}

// -------------------------------------------------------------------------------------------------
// Rings: the parts of a whole, one ring per row

/**
 * One ring per row. `rows`: `{ label, shares | null, counts?, center }`; `segments`: `{ label, token }`; a row with no shares
 * draws an empty ring that says `center`. The number in the middle is the row's `center`; the exact shares of every segment
 * belong beside the chart (see `ringTable`), because a color never carries a number alone.
 */
export function ringsOption({ rows, segments, width, height, unit = 'answers', names = true }) {
  const count = rows.length;
  const slot = width / count;
  // With names, two lines under each ring say whose it is (a long name wraps); a lone ring (the headline) has no name and fills its box
  const outer = Math.max(30, Math.min(slot / 2 - (names ? 8 : 4), names ? 66 : 80, (height - (names ? 46 : 12)) / 2));
  const radius = outer;
  const inner = radius * 0.68;
  const centerY = names ? (height - 34) / 2 + 2 : height / 2;
  const centerXOf = (index) => slot * (index + 0.5);
  const font = charts.fontFamily();
  // Plain flat rings: solid token colors, a thin gap between the segments, no gradient, shadow or depth
  const series = rows.map((row, index) => {
    const base = { type: 'pie', name: row.label, center: [centerXOf(index), centerY], radius: [inner, radius], startAngle: 90, label: { show: false }, labelLine: { show: false } };
    if (row.shares === null) {
      return { ...base, silent: true, itemStyle: { color: charts.token('chart-bar-neutral', 0.55) }, data: [{ name: row.label, value: 1 }] };
    }
    return {
      ...base,
      padAngle: 2,
      itemStyle: { borderRadius: 3 },
      emphasis: { scale: true, scaleSize: 3 },
      data: segments.map((segment, at) => ({ name: segment.label, value: row.shares[at], itemStyle: { color: charts.token(segment.token) }, segment: at })).filter((datum) => datum.value > 0),
    };
  });
  const tokenOf = new Map(segments.map((segment) => [segment.label, segment.token]));
  return {
    ...motion(),
    tooltip: itemTooltip((param) => {
      const row = rows.find((candidate) => candidate.label === param.seriesName);
      const total = row?.counts ? row.counts.reduce((a, b) => a + b, 0) : 0;
      return {
        title: param.seriesName,
        color: charts.token(tokenOf.get(param.name) ?? 'chart-other'),
        name: param.name,
        value: pct0(param.value),
        detail: total ? `${formatInteger(row.counts[param.data.segment])} of ${formatInteger(total)} ${unit}` : undefined,
      };
    }),
    graphic: rows.flatMap((row, index) => {
      const centerX = centerXOf(index);
      const number = { type: 'text', silent: true, z: 10, style: { x: centerX, y: centerY, text: row.center, textAlign: 'center', textVerticalAlign: 'middle', fill: charts.token(row.shares === null ? 'chart-label' : 'foreground'), font: `600 ${Math.max(13, Math.round(radius * 0.38))}px ${font}` } };
      if (!names) return [number];
      return [number, { type: 'text', silent: true, z: 10, style: { x: centerX, y: centerY + radius + 8, text: row.label, width: slot - 8, overflow: 'break', lineHeight: 15, textAlign: 'center', textVerticalAlign: 'top', fill: charts.token('chart-label'), font: `400 12px ${font}` } }];
    }),
    series,
  };
}

/** The exact shares of every ring, with the legend dots in the row heads: the text alternative of the rings. */
export function ringTable({ rows, segments }) {
  // Fixed columns: a long platform name wraps in its column instead of pushing the table out of the card
  const table = el('table', 'w-full table-fixed type-table');
  const head = el('thead');
  const headRow = el('tr', 'align-bottom');
  const corner = el('th', 'w-[30%] text-left');
  corner.append(el('span', 'sr-only', 'Outcome'));
  headRow.append(
    corner,
    ...rows.map((row) => {
      const th = el('th', 'text-right type-micro font-normal break-words pl-1 pb-1', row.label.replace(/^Google /, ''));
      // The table head style of the page sets capitals and tracking, which break a short name apart in a narrow column
      th.style.textTransform = 'none';
      th.style.letterSpacing = 'normal';
      return th;
    }),
  );
  head.append(headRow);
  const body = el('tbody');
  segments.forEach((segment, at) => {
    const tr = el('tr', 'h-row-compact border-t border-border-subtle');
    const name = el('th', 'text-left font-normal text-foreground-secondary pr-2');
    const dot = el('span', 'inline-block size-2 rounded-2xs mr-1.5 align-middle');
    dot.style.background = `var(--${segment.token})`;
    dot.setAttribute('aria-hidden', 'true');
    name.append(dot, segment.label);
    tr.append(name, ...rows.map((row) => el('td', 'text-right num text-foreground pl-2', row.shares === null ? 'n/a' : pct0(row.shares[at]))));
    body.append(tr);
  });
  table.append(head, body);
  return table;
}

// -------------------------------------------------------------------------------------------------
// Columns: rounded and stacked, and a pseudo 3D column

/** One stacked 100% column per row, with rounded gradient segments. `rows`: `{ label, note, shares | null }`. */
export function stackedColumnsOption({ rows, segments }) {
  const axes = charts.axisTheme();
  return {
    ...motion(),
    grid: { left: 44, right: 16, top: 12, bottom: 44, outerBoundsMode: 'none' },
    xAxis: { type: 'category', data: rows.map((row) => (row.note ? `${row.label}\n${row.note}` : row.label)), ...axes.x, axisLabel: { ...axes.x.axisLabel, hideOverlap: false, lineHeight: 16 } },
    yAxis: { type: 'value', min: 0, max: 1, interval: 0.25, ...axes.y, axisLabel: { ...axes.y.axisLabel, formatter: pctAxis } },
    tooltip: charts.tooltipTheme((list) => list.map((param) => ({ color: charts.token(segments[param.seriesIndex].token), name: param.seriesName, value: param.value === null || param.value === undefined ? 'n/a' : pct0(param.value) }))),
    series: segments.map((segment, at) => ({
      name: segment.label,
      type: 'bar',
      stack: 'share',
      barWidth: '46%',
      barMaxWidth: 64,
      data: rows.map((row) => (row.shares === null ? null : row.shares[at])),
      itemStyle: { color: fade(segment.token, 1, 0.72), borderRadius: 6, borderColor: charts.token('surface'), borderWidth: 1.5 },
      emphasis: { focus: 'series' },
    })),
  };
}

/** The line that follows the pointer over a time chart: 2 px, bright at the top and fading out toward the axis. */
const pointerFade = (token = 'chart-1') => ({ type: 'line', z: 0, lineStyle: { width: 2, type: 'solid', color: fade(token, 0.7, 0) } });

// -------------------------------------------------------------------------------------------------
// A treemap with rounded, shaded tiles

export function richTreemapOption({ types, total }) {
  const others = ['chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'chart-other'];
  let next = 0;
  const tokenOf = (type) => (type === 'Your site' ? 'chart-1' : others[next++ % others.length]);
  return {
    ...motion(),
    tooltip: itemTooltip((param) => ({ title: param.name, color: param.data.itemStyle.borderColor, name: 'Citation units', value: formatInteger(param.value), detail: `${((param.value / total) * 100).toFixed(1)}% of ${formatInteger(total)} citation units` })),
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
        itemStyle: { borderColor: charts.token('surface'), borderWidth: 3, gapWidth: 3, borderRadius: 8 },
        label: { show: true, fontFamily: charts.fontFamily(), fontSize: 12, fontWeight: 600, color: charts.token('surface'), formatter: (param) => `${param.name}\n${((param.value / total) * 100).toFixed(0)}%` },
        data: types.map((entry) => {
          const token = tokenOf(entry.type);
          // The tooltip reads the tile's own color from `borderColor`, which the tile itself does not draw (width 0 on the series)
          return { name: entry.type, value: entry.units, itemStyle: { color: fade(token, 1, 0.74), borderColor: charts.token(token) } };
        }),
      },
    ],
  };
}

// -------------------------------------------------------------------------------------------------
// Empty states and the chart or table switch

/**
 * What an empty trend card shows: a faint dashed curve of how the line will look, with the reason over it. The curve is
 * a drawing, not data, and says so by being dashed and grey.
 */
export function ghostTrend({ title, text, height = 220 }) {
  const wrap = el('div', 'relative w-full');
  wrap.style.height = `${height}px`;
  const host = el('div', 'absolute inset-0');
  host.setAttribute('aria-hidden', 'true');
  wrap.append(host);
  // The message sits in the top half and the curve in the bottom half, so the line never runs through the words
  const message = el('div', 'absolute inset-x-0 top-0 flex flex-col items-center text-center gap-1 px-6 pt-8');
  message.append(el('span', 'type-subsection-title text-foreground', title), el('span', 'type-meta text-foreground-secondary max-w-prose', text));
  wrap.append(message);
  const sample = [0.32, 0.4, 0.37, 0.5, 0.46, 0.58, 0.55, 0.66];
  const build = () => ({
    ...motion(),
    grid: { left: 8, right: 8, top: '52%', bottom: 12 },
    xAxis: { type: 'category', show: false, boundaryGap: false, data: sample.map((_, index) => index) },
    yAxis: { type: 'value', show: false, min: 0, max: 1 },
    series: [{ type: 'line', smooth: 0.4, data: sample, silent: true, symbol: 'none', lineStyle: { width: 3, type: [6, 6], color: charts.token('chart-other', 0.5) }, areaStyle: { color: fade('chart-other', 0.16, 0) } }],
  });
  mountChart(host, build);
  return wrap;
}

const TOGGLE_CLASS = 'h-control-sm px-2.5 rounded-md border border-border bg-surface flex items-center gap-1.5 whitespace-nowrap type-body text-foreground hover:bg-surface-hover';

/**
 * A card body that switches between a chart and its table. `drawChart(body)` fills the body and returns a dispose function
 * (or nothing); `drawTable(body)` fills it with the text alternative. Returns `{ body, toggle }` for the card frame.
 */
export function chartWithTable({ drawChart, drawTable, className = 'flex flex-col' }) {
  const body = el('div', className);
  const state = { view: 'chart', dispose: null };
  const draw = () => {
    state.dispose?.();
    state.dispose = null;
    body.replaceChildren();
    if (state.view === 'table') drawTable(body);
    else state.dispose = drawChart(body) ?? null;
  };
  const toggle = el('button', TOGGLE_CLASS);
  toggle.type = 'button';
  toggle.setAttribute('aria-pressed', 'false');
  toggle.append(icon('table-2', 'size-icon-sm'), 'Table');
  toggle.addEventListener('click', () => {
    state.view = state.view === 'chart' ? 'table' : 'chart';
    toggle.setAttribute('aria-pressed', String(state.view === 'table'));
    draw();
  });
  draw();
  return { body, toggle };
}
