/* global document, window, echarts, ResizeObserver, MutationObserver */
/**
 * Page Performance charts (docs/32-page-performance.md section 5.7, docs/design-system/15-data-visualization.md).
 *
 * One metric draws one chart. Two metrics draw stacked small multiples with a shared crosshair, or one chart
 * with two axes when "Overlay" is chosen. Three or four metrics draw small multiples only. The current period is
 * a solid line, the previous one a dashed reference line, aligned by day number. Colors come from the tokens at
 * draw time, so the charts follow the light and dark themes.
 */
import { METRICS, SOURCES, formatCompact, formatDay, formatMetric, monthName, reduceRange } from './perf-calc.js';
import { el } from './prompts-parts.js';

const charts = window.PreviewCharts;

// -------------------------------------------------------------------------------------------------
// Buckets: day, week (7 days from the start of the range) or month, the same cut for both periods

export function granularityFor(days) {
  if (days <= 31) return 'day';
  return days <= 112 ? 'week' : 'month';
}

function cutsFor(days, granularity) {
  const cuts = [];
  if (granularity === 'day') days.forEach((_, index) => cuts.push([index, index + 1]));
  else if (granularity === 'week') for (let start = 0; start < days.length; start += 7) cuts.push([start, Math.min(days.length, start + 7)]);
  else {
    let start = 0;
    for (let index = 1; index <= days.length; index += 1) {
      if (index === days.length || days[index].slice(0, 7) !== days[start].slice(0, 7)) {
        cuts.push([start, index]);
        start = index;
      }
    }
  }
  return cuts;
}

/** Series values per bucket for the current range and, aligned by index, the comparison range. */
export function bucketSeries(key, current, compare, granularity, provisionalDays = []) {
  const cuts = cutsFor(current.days, granularity);
  const labels = cuts.map(([start]) => (granularity === 'month' ? monthName(current.days[start].slice(0, 7)).replace(/^(\w{3})\w*/, '$1') : formatDay(current.days[start])));
  const bucket = {
    labels,
    curDates: cuts.map(([start]) => formatDay(current.days[start])),
    prevDates: cuts.map(([start]) => (compare && start < compare.days.length ? formatDay(compare.days[start]) : '')),
    cur: cuts.map(([start, end]) => reduceRange(key, current.num, current.den, start, end)),
    prev: compare ? cuts.map(([start, end]) => (start < compare.days.length ? reduceRange(key, compare.num, compare.den, start, Math.min(end, compare.days.length)) : null)) : null,
    partial: cuts.map(([start, end]) => current.days.slice(start, end).some((iso) => provisionalDays.includes(iso))),
    granularity,
  };
  return bucket;
}

// -------------------------------------------------------------------------------------------------
// Options

const axisText = (key, value) => {
  if (key === 'ctr' || key === 'share') return `${(value * 100).toFixed(1)}%`;
  if (key === 'position' || key === 'rank') return value.toFixed(0);
  return formatCompact(value);
};

function safeToken(name, alpha = 1, fallback = 'border-subtle') {
  try {
    return charts.token(name, alpha);
  } catch {
    return charts.token(fallback, alpha);
  }
}

function lineSeries(key, bucket, color, { yAxisIndex = 0, markArea } = {}) {
  const label = METRICS[key].label;
  const base = { type: 'line', showSymbol: false, symbol: 'circle', symbolSize: 6, smooth: false, connectNulls: false, yAxisIndex };
  const list = [
    { ...base, name: label, data: bucket.cur, z: 3, lineStyle: { width: 2, color: color.current }, itemStyle: { color: color.current }, ...(markArea ? { markArea } : {}) },
  ];
  if (bucket.prev) {
    list.push({ ...base, name: `${label} before`, data: bucket.prev, z: 2, lineStyle: { width: 2, type: [4, 4], color: color.previous }, itemStyle: { color: color.previous } });
  }
  return list;
}

function provisionalArea(bucket) {
  const indexes = bucket.partial.map((flag, index) => (flag ? index : -1)).filter((index) => index >= 0);
  if (indexes.length === 0) return undefined;
  return {
    silent: true,
    itemStyle: { color: safeToken('chart-band', 0.9) },
    label: { show: true, position: 'insideTop', color: charts.token('chart-label'), fontFamily: charts.fontFamily(), fontSize: 11, formatter: 'Provisional' },
    data: [[{ xAxis: bucket.labels[indexes[0]] }, { xAxis: bucket.labels[indexes[indexes.length - 1]] }]],
  };
}

function valueRow(key, param, bucket) {
  const isPrevious = param.seriesName.endsWith(' before');
  const when = isPrevious ? bucket.prevDates[param.dataIndex] : bucket.curDates[param.dataIndex];
  const value = param.value === null || param.value === undefined ? 'No data' : formatMetric(key, param.value);
  return { color: param.color, name: isPrevious ? `Before (${when})` : `${METRICS[key].label} (${when})`, value };
}

function buildOption(spec, metrics, { overlay = false }) {
  const theme = charts.axisTheme();
  const bucketOf = (key) => spec.buckets[key];
  const first = bucketOf(metrics[0].key);
  const series = [];
  const yAxis = [];
  metrics.forEach((metric, index) => {
    const bucket = bucketOf(metric.key);
    const current = charts.token(metric.color);
    const color = { current, previous: overlay ? charts.token(metric.color, 0.5) : charts.token('chart-reference') };
    series.push(...lineSeries(metric.key, bucket, color, { yAxisIndex: overlay ? index : 0, markArea: index === 0 ? provisionalArea(bucket) : undefined }));
    const info = METRICS[metric.key];
    yAxis.push({
      type: 'value',
      ...theme.y,
      position: overlay && index === 1 ? 'right' : 'left',
      scale: info.kind === 'position',
      inverse: info.better === 'down',
      splitLine: index === 0 ? theme.y.splitLine : { show: false },
      axisLabel: { ...theme.y.axisLabel, formatter: (value) => axisText(metric.key, value) },
    });
  });
  const tooltip = charts.tooltipTheme((list) =>
    list.map((param) => {
      const owner = metrics.find((metric) => param.seriesName.startsWith(METRICS[metric.key].label));
      return valueRow(owner.key, param, bucketOf(owner.key));
    }),
  );
  return {
    animation: false,
    grid: { left: 48, right: overlay ? 48 : 16, top: 8, bottom: 24, outerBoundsMode: 'none' },
    tooltip,
    xAxis: { type: 'category', data: first.labels, boundaryGap: false, ...theme.x },
    yAxis,
    series,
  };
}

// -------------------------------------------------------------------------------------------------
// Mounting

const GROUP = 'perf-connected';

/**
 * Draws the chart area into `root` and returns `{ dispose }`.
 * @param {HTMLElement} root
 * @param {{layout:'single'|'overlay'|'stack', metrics:Array<{key:string,color:string}>, buckets:object, view:'chart'|'table'}} spec
 */
export function renderChartArea(root, spec) {
  root.replaceChildren();
  const instances = [];
  const redraws = [];

  if (spec.view === 'table') {
    root.append(seriesTable(spec));
    return { dispose() {} };
  }

  const place = (metrics, height, options) => {
    const holder = el('div', 'w-full');
    holder.style.height = `${height}px`;
    root.append(holder);
    const chart = echarts.init(holder, null, { renderer: 'canvas' });
    if (options.connect) chart.group = GROUP;
    instances.push(chart);
    const draw = () => chart.setOption(buildOption(spec, metrics, options), true);
    redraws.push(draw);
    draw();
  };

  if (spec.layout === 'stack') {
    spec.metrics.forEach((metric) => {
      const info = METRICS[metric.key];
      const head = el('div', 'flex items-center gap-2 pt-2');
      head.append(el('span', 'type-subsection-title text-foreground', info.label));
      if (info.source !== 'gsc') head.append(el('span', 'h-badge inline-flex items-center px-2 rounded-sm border border-neutral-border bg-neutral-subtle text-neutral-text type-micro whitespace-nowrap', SOURCES[info.source]));
      root.append(head);
      place([metric], 140, { connect: true });
    });
    echarts.connect(GROUP);
  } else {
    place(spec.metrics, spec.layout === 'overlay' ? 260 : 240, { overlay: spec.layout === 'overlay' });
  }

  const resize = new ResizeObserver(() => instances.forEach((chart) => chart.resize()));
  resize.observe(root);
  const themeWatch = new MutationObserver(() => redraws.forEach((draw) => draw()));
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  return {
    dispose() {
      resize.disconnect();
      themeWatch.disconnect();
      instances.forEach((chart) => chart.dispose());
    },
  };
}

/** The same series as a table: for screen readers, and the way to read exact values (docs/32 section 5.7). */
function seriesTable(spec) {
  const first = spec.buckets[spec.metrics[0].key];
  const wrap = el('div', 'max-h-80 overflow-auto rounded-md border border-border');
  const table = el('table', 'w-full border-collapse type-table');
  const head = el('tr', 'h-row-header text-left bg-surface-subtle');
  head.append(el('th', 'px-3 type-label', first.granularity === 'day' ? 'Date' : 'From'));
  spec.metrics.forEach((metric) => {
    head.append(el('th', 'px-3 type-label text-right', METRICS[metric.key].label));
    if (first.prev) head.append(el('th', 'px-3 type-label text-right text-foreground-tertiary', 'Before'));
  });
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  first.labels.forEach((label, index) => {
    const row = el('tr', 'h-row-compact border-t border-border-subtle');
    row.append(el('td', 'px-3 whitespace-nowrap', label));
    spec.metrics.forEach((metric) => {
      const bucket = spec.buckets[metric.key];
      row.append(el('td', 'px-3 text-right num', bucket.cur[index] === null ? 'No data' : formatMetric(metric.key, bucket.cur[index])));
      if (bucket.prev) row.append(el('td', 'px-3 text-right num text-foreground-tertiary', bucket.prev[index] === null ? 'No data' : formatMetric(metric.key, bucket.prev[index])));
    });
    body.append(row);
  });
  table.append(thead, body);
  wrap.append(table);
  return wrap;
}

// -------------------------------------------------------------------------------------------------
// Sparkline for the list: the current period only, no axes (15 section 8)

export function sparkline(values, { width = 84, height = 24 } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'shrink-0 text-chart-1');
  const known = values.filter((value) => value !== null);
  if (known.length < 2) return svg;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  let path = '';
  values.forEach((value, index) => {
    if (value === null) return;
    const x = (index * step).toFixed(1);
    const y = (height - 2 - ((value - min) / range) * (height - 4)).toFixed(1);
    path += `${path === '' ? 'M' : 'L'}${x} ${y}`;
  });
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', path);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(line);
  return svg;
}
