/* global document, window, echarts, getComputedStyle, MutationObserver, ResizeObserver, requestAnimationFrame */
/**
 * Charts, sparklines and table selection for the static design-system preview.
 *
 * Every color is read from the CSS tokens at runtime (lib/design/read-tokens.ts does the same in the app),
 * so the charts follow the light and dark themes. Chart rules: docs/design-system/15-data-visualization.md
 * sections 3, 4, 5, 7 and 9. The data is illustrative and generated from a fixed seed so it does not change
 * between reloads.
 */
(() => {
  'use strict';

  const root = document.documentElement;

  // ---------------------------------------------------------------------------------------------
  // Tokens

  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });

  /** Resolves a CSS custom property (any CSS color syntax, including oklch and color-mix) to an sRGB color string. */
  function token(name, alpha = 1) {
    const value = getComputedStyle(root).getPropertyValue(`--${name}`).trim();
    if (!value) throw new Error(`Unknown token --${name}`);
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = value;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * alpha * 1000) / 1000})`;
  }

  function channels(color) {
    return color.match(/[\d.]+/g).slice(0, 3).map(Number);
  }

  /** WCAG 2.2 contrast ratio between two resolved colors. */
  function contrast(a, b) {
    const lum = (c) => {
      const [r, g, bl] = channels(c).map((v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  const fontFamily = () => getComputedStyle(document.body).fontFamily;

  // ---------------------------------------------------------------------------------------------
  // Formatting (the app uses @/lib/format; this preview keeps a minimal copy)

  function oneDecimal(value) {
    const tenths = Math.round(value * 10);
    return `${Math.trunc(tenths / 10)}.${Math.abs(tenths % 10)}`;
  }
  const percent = (value) => `${oneDecimal(value)}%`;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const shortDate = (date) => `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  const escape = (text) => echarts.format.encodeHTML(String(text));

  // ---------------------------------------------------------------------------------------------
  // Illustrative data (fixed seed)

  function seeded(seed) {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }

  function days(count, end = new Date(2026, 8, 29)) {
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(end);
      d.setDate(end.getDate() - (count - 1 - i));
      return d;
    });
  }

  function walk(random, count, start, end, noise) {
    return Array.from({ length: count }, (_, i) => start + ((end - start) * i) / (count - 1) + (random() - 0.5) * noise);
  }

  // ---------------------------------------------------------------------------------------------
  // Shared ECharts theme (15 section 4)

  const GRID = { left: 40, right: 16, top: 8, bottom: 24, outerBoundsMode: 'none' };

  /** Category label interval so x labels are at least 64 px apart for the element's current width. */
  function labelInterval(id, count, reserved = GRID.left + GRID.right) {
    const width = (document.getElementById(id)?.clientWidth ?? 600) - reserved;
    const perLabel = Math.max(1, Math.ceil((count * 64) / Math.max(width, 64)));
    return perLabel - 1;
  }

  function axisTheme() {
    const label = { color: token('chart-label'), fontFamily: fontFamily(), fontSize: 12, fontWeight: 400 };
    return {
      x: {
        axisLine: { show: true, lineStyle: { color: token('chart-axis'), width: 1 } },
        axisTick: { show: false },
        axisLabel: { ...label, margin: 8, hideOverlap: true },
        splitLine: { show: false },
      },
      y: {
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { ...label, margin: 8 },
        splitLine: { show: true, lineStyle: { color: token('chart-grid'), width: 1, type: 'dashed' } },
      },
    };
  }

  /** Tooltip styled as 15 section 4: surface-elevated, border, popover shadow, radius 8, date title, dot rows. */
  function tooltipTheme(renderRows) {
    return {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: token('border-strong'), width: 1, type: 'solid' }, z: 0 },
      backgroundColor: 'transparent',
      borderWidth: 0,
      padding: 0,
      extraCssText: 'box-shadow: none;',
      confine: true,
      formatter: (params) => {
        const list = Array.isArray(params) ? params : [params];
        const rows = renderRows(list)
          .map(
            ({ color, name, value }) =>
              `<div class="flex items-center gap-2 h-6"><span class="size-2 rounded-full" style="background:${color}"></span>` +
              `<span class="type-table text-foreground-secondary">${escape(name)}</span>` +
              `<span class="ml-auto pl-6 type-table num text-foreground">${escape(value)}</span></div>`,
          )
          .join('');
        const title = escape(list[0]?.axisValueLabel ?? '');
        return (
          `<div class="min-w-48 rounded-lg border border-border bg-surface-elevated shadow-popover px-3 py-2">` +
          `<div class="type-subsection-title text-foreground mb-1">${title}</div>${rows}</div>`
        );
      },
    };
  }

  /** 45 degree hatching on the rank-band-none token, for depth bands and unranked bars (15 sections 4 and 7). */
  function hatch() {
    const size = 8;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = token('rank-band-none');
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = token('border-strong', 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, size);
    ctx.lineTo(size, 0);
    ctx.moveTo(-size / 2, size / 2);
    ctx.lineTo(size / 2, -size / 2);
    ctx.moveTo(size / 2, size * 1.5);
    ctx.lineTo(size * 1.5, size / 2);
    ctx.stroke();
    return { image: canvas, repeat: 'repeat' };
  }

  // ---------------------------------------------------------------------------------------------
  // Overview small multiples (24 section 9.2, S2): SEO visibility, then one row per engine with its 95% interval.
  // The four plots share one x axis (labels on the last visible row) and one axis pointer; the value beside each
  // row follows the hovered day, so no tooltip covers the neighbouring rows.

  const overviewDays = days(28, new Date(2026, 8, 30));
  const overviewRandom = seeded(41);
  const MULTIPLES = [
    { key: 'seo', token: 'chart-1', start: 30.2, end: 31.4, noise: 0.5, ci: 0 },
    { key: 'chatgpt', token: 'chart-2', start: 31.9, end: 34, noise: 1.8, ci: 3 },
    { key: 'gemini', token: 'chart-3', start: 29.8, end: 29, noise: 1.8, ci: 3.4 },
    { key: 'aimode', token: 'chart-4', start: 47, end: 41, noise: 2.2, ci: 4 },
    { key: 'aio', token: 'chart-5', start: 14.6, end: 16.1, noise: 1.4, ci: 3.2 },
  ].map((m) => {
    const values = walk(overviewRandom, 28, m.start, m.end, m.noise);
    values[values.length - 1] = m.end;
    return { ...m, id: `chart-ov-${m.key}`, values, half: values.map(() => (m.ci === 0 ? 0 : m.ci + overviewRandom() * 0.8)) };
  });
  const OVERVIEW_GROUP = 'overview-multiples';

  const multipleRow = (m) => document.querySelector(`[data-multiple="${m.key}"]`);
  const visibleMultiples = () => MULTIPLES.filter((m) => multipleRow(m) && !multipleRow(m).hidden);

  function multipleOption(m) {
    const axes = axisTheme();
    const dates = overviewDays.map(shortDate);
    const visible = visibleMultiples();
    const showAxis = visible[visible.length - 1] === m;
    const low = Math.floor(Math.min(...m.values.map((v, i) => v - m.half[i])));
    const high = Math.ceil(Math.max(...m.values.map((v, i) => v + m.half[i])));
    return {
      animation: false,
      grid: { left: 40, right: 8, top: 8, bottom: showAxis ? 24 : 8, outerBoundsMode: 'none' },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: false,
        ...axes.x,
        // The last label is right-aligned to its tick so it stays inside the plot
        axisLabel: { ...axes.x.axisLabel, show: showAxis, interval: labelInterval(m.id, dates.length, 48), alignMaxLabel: 'right' },
      },
      yAxis: { type: 'value', min: low, max: high, interval: high - low, ...axes.y, axisLabel: { ...axes.y.axisLabel, formatter: (v) => `${v}%` } },
      tooltip: { trigger: 'axis', showContent: false, axisPointer: { type: 'line', lineStyle: { color: token('border-strong'), width: 1, type: 'solid' } } },
      series: [
        ...(m.ci === 0
          ? []
          : [
              { id: 'ci-low', type: 'line', stack: 'ci', data: m.values.map((v, i) => v - m.half[i]), lineStyle: { opacity: 0 }, symbol: 'none', silent: true },
              { id: 'ci-band', type: 'line', stack: 'ci', data: m.half.map((w) => w * 2), lineStyle: { opacity: 0 }, areaStyle: { color: token(m.token, 0.14) }, symbol: 'none', silent: true },
            ]),
        { id: 'value', type: 'line', data: m.values, color: token(m.token), lineStyle: { width: 2, join: 'round' }, symbol: 'circle', symbolSize: 6, showSymbol: false, emphasis: { disabled: true } },
      ],
    };
  }

  /** Writes the value of day `index` beside each row (the last day when no day is hovered). */
  function showMultipleValues(index = overviewDays.length - 1) {
    MULTIPLES.forEach((m) => {
      const node = multipleRow(m)?.querySelector('[data-multiple-value]');
      if (node) node.textContent = percent(m.values[index]);
    });
    const date = document.querySelector('[data-multiple-date]');
    if (date) date.textContent = `values for ${shortDate(overviewDays[index])}`;
  }

  /** The last visible row carries the x axis labels and is 24 px taller. */
  function layoutMultiples() {
    const visible = visibleMultiples();
    MULTIPLES.forEach((m) => {
      const el = document.getElementById(m.id);
      if (!el) return;
      const last = visible[visible.length - 1] === m;
      el.classList.toggle('h-20', last);
      el.classList.toggle('h-14', !last);
    });
  }

  function renderOverviewTable() {
    const body = document.querySelector('[data-ov-table-body]');
    if (!body) return;
    const rows = [6, 13, 20, 27].map((index) => {
      const row = document.createElement('tr');
      row.className = 'h-row border-t border-border-subtle';
      const head = document.createElement('th');
      head.scope = 'row';
      head.className = 'px-3 text-left type-table font-normal text-foreground whitespace-nowrap';
      head.textContent = shortDate(overviewDays[index]);
      row.append(head);
      MULTIPLES.forEach((m) => {
        const cell = document.createElement('td');
        cell.className = 'px-3 text-right type-table num';
        cell.textContent = percent(m.values[index]);
        row.append(cell);
      });
      return row;
    });
    body.replaceChildren(...rows);
  }

  // ---------------------------------------------------------------------------------------------
  // Mounting and theme changes

  const charts = [
    ...MULTIPLES.map((m) => ({ id: m.id, option: () => multipleOption(m), group: OVERVIEW_GROUP })),
  ];

  const instances = new Map();

  function renderCharts() {
    for (const chart of charts) {
      const el = document.getElementById(chart.id);
      // A chart in a hidden view has no size yet; it mounts when the ResizeObserver reports one.
      if (!el || el.clientWidth === 0) continue;
      let instance = instances.get(chart.id);
      if (!instance) {
        instance = echarts.init(el, null, { renderer: 'canvas' });
        instances.set(chart.id, instance);
        if (chart.group) {
          instance.group = chart.group;
          instance.on('updateAxisPointer', (event) => {
            const index = event.axesInfo?.[0]?.value;
            if (Number.isInteger(index)) showMultipleValues(index);
          });
          instance.getZr().on('globalout', () => showMultipleValues());
        }
      }
      instance.setOption(chart.option(), true);
    }
  }

  /** Legend swatches rendered in HTML (15 section 2: the legend is not drawn by ECharts). */
  function renderLegends() {
    document.querySelectorAll('[data-legend-token]').forEach((swatch) => {
      const color = token(swatch.dataset.legendToken);
      if (swatch.dataset.legendShape === 'hatch') {
        const { image } = hatch();
        swatch.style.backgroundImage = `url(${image.toDataURL()})`;
        swatch.style.backgroundColor = '';
      } else if (swatch.tagName.toLowerCase() === 'svg') {
        swatch.style.color = color;
      } else {
        swatch.style.backgroundColor = color;
      }
    });
  }

  /** 100% stacked bar labels: foreground-inverse where it reaches 4.5:1 on the segment, else foreground, else omitted (15 section 5.2). */
  function renderStackedBar() {
    const inverse = token('foreground-inverse');
    const text = token('foreground');
    document.querySelectorAll('[data-segment-token]').forEach((segment) => {
      const fill = token(segment.dataset.segmentToken);
      segment.style.backgroundColor = fill;
      const label = segment.querySelector('[data-segment-label]');
      if (!label) return;
      const share = Number(segment.dataset.share);
      let color = null;
      if (contrast(inverse, fill) >= 4.5) color = inverse;
      else if (contrast(text, fill) >= 4.5) color = text;
      label.hidden = false;
      const fits = label.offsetWidth + 8 <= segment.clientWidth;
      label.hidden = share < 6 || color === null || !fits;
      if (color) label.style.color = color;
    });
  }

  /**
   * Sparklines: shared canvas renderer, 64 x 20, 1.5 px chart-reference, 3 px last point, ranks inverted
   * (15 section 9). An empty value is a gap: the line breaks there. Ranks share the scale 1 to 20; a rate
   * is drawn around its own values; other kinds scale to their own range.
   */
  function renderSparklines(scope = document) {
    const stroke = token('chart-reference');
    const own = token('chart-1');
    const ratio = window.devicePixelRatio || 1;
    scope.querySelectorAll('canvas[data-spark]').forEach((canvas) => {
      const values = canvas.dataset.spark.split(',').map((value) => (value.trim() === '' ? Number.NaN : Number(value)));
      const known = values.filter(Number.isFinite);
      const width = 64;
      const height = 20;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (known.length === 0) return;
      const rank = canvas.dataset.kind === 'rank';
      const share = canvas.dataset.kind === 'rate';
      // A rate is drawn in a window of at least 20 points around its own values: wide enough that noise of
      // a point or two stays flat, narrow enough that a real move shows
      const middle = (Math.min(...known) + Math.max(...known)) / 2;
      const half = Math.max(10, (Math.max(...known) - Math.min(...known)) / 2);
      const lo = rank ? 1 : share ? Math.max(0, middle - half) : Math.min(...known);
      const hi = rank ? 20 : share ? Math.min(100, middle + half) : Math.max(...known);
      const pad = 2.5;
      const x = (i) => pad + (i * (width - pad * 2)) / (values.length - 1);
      const y = (v) => {
        const t = (v - lo) / (hi - lo || 1);
        return rank ? pad + t * (height - pad * 2) : height - pad - t * (height - pad * 2);
      };
      ctx.strokeStyle = canvas.dataset.own === 'true' ? own : stroke;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let drawing = false;
      values.forEach((v, i) => {
        if (!Number.isFinite(v)) drawing = false;
        else if (drawing) ctx.lineTo(x(i), y(v));
        else {
          ctx.moveTo(x(i), y(v));
          drawing = true;
        }
      });
      ctx.stroke();
      // The point marks the latest value; a series that ends in a gap has none
      const last = values.length - 1;
      if (!Number.isFinite(values[last])) return;
      ctx.beginPath();
      ctx.arc(x(last), y(values[last]), 1.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function renderAll() {
    renderCharts();
    renderLegends();
    renderStackedBar();
    renderSparklines();
  }

  // ---------------------------------------------------------------------------------------------
  // Table selection (08 section 1, 12 section 3): checked rows use surface-selected and primary-text
  // key text; the row open in the inspector also shows a 2 px primary edge.

  function syncRow(row) {
    // A row without a key cell is not a record ("Show all 17 prompts"): it is never selected or active
    const key = row.querySelector('[data-key-cell]');
    if (!key) return;
    // Rows without a checkbox (prompts grouped under a topic) can still be the active record
    const box = row.querySelector('input[type="checkbox"]');
    const selected = box?.checked === true || row.dataset.active === 'true';
    row.setAttribute('aria-selected', String(selected));
    row.classList.toggle('bg-surface-selected', selected);
    row.classList.toggle('hover:bg-surface-hover', !selected);
    key.classList.toggle('text-primary-text', selected);
    key.classList.toggle('text-foreground', !selected);
  }

  function initSelection() {
    const table = document.querySelector('[data-selectable]');
    if (!table) return;
    const rows = [...table.querySelectorAll('tbody tr')];
    const all = table.querySelector('thead input[type="checkbox"]');
    // Prompts tables are built later with their own selection; this one only wires a table that has select-all.
    if (!all) return;
    // Rows without a checkbox (a topic's "Show all" row) are not selectable, so select-all counts only the others.
    const boxed = rows.filter((row) => row.querySelector('input'));
    const syncAll = () => {
      const checked = boxed.filter((row) => row.querySelector('input').checked).length;
      all.checked = checked === boxed.length;
      all.indeterminate = checked > 0 && checked < boxed.length;
      const count = document.getElementById('selection-count');
      if (count) count.textContent = checked ? `${checked} selected` : '';
    };
    boxed.forEach((row) => {
      row.querySelector('input').addEventListener('change', () => {
        syncRow(row);
        syncAll();
      });
    });
    rows.forEach((row) => syncRow(row));
    all.addEventListener('change', () => {
      boxed.forEach((row) => {
        row.querySelector('input').checked = all.checked;
        syncRow(row);
      });
      syncAll();
    });
    syncAll();
  }

  // ---------------------------------------------------------------------------------------------

  initSelection();
  layoutMultiples();
  renderOverviewTable();
  showMultipleValues();
  renderAll();
  echarts.connect(OVERVIEW_GROUP);

  /** Shared with interactions.js (overview series toggles). */
  // Mention rate trend cards (layout customization): one chart per card instance, mounted when the card is
  // placed and disposed when it is hidden. Each engine reuses its series from the small multiples.
  const TREND_SERIES = {
    chatgpt_web: MULTIPLES[1],
    gemini_web: MULTIPLES[2],
    google_ai_mode: MULTIPLES[3],
    google_ai_overview: MULTIPLES[4],
  };

  function trendOption(id, engine) {
    const series = TREND_SERIES[engine];
    const axes = axisTheme();
    const dates = overviewDays.map(shortDate);
    const low = Math.floor(Math.min(...series.values.map((v, i) => v - series.half[i])));
    const high = Math.ceil(Math.max(...series.values.map((v, i) => v + series.half[i])));
    return {
      animation: false,
      grid: { left: 40, right: 8, top: 8, bottom: 24, outerBoundsMode: 'none' },
      xAxis: { type: 'category', data: dates, boundaryGap: false, ...axes.x, axisLabel: { ...axes.x.axisLabel, interval: labelInterval(id, dates.length, 48), alignMaxLabel: 'right' } },
      yAxis: { type: 'value', min: low, max: high, interval: high - low, ...axes.y, axisLabel: { ...axes.y.axisLabel, formatter: (v) => `${v}%` } },
      tooltip: tooltipTheme((list) => list.filter((p) => p.seriesId === 'value').map((p) => ({ color: p.color, name: 'Mention rate', value: percent(p.value) }))),
      series: [
        { id: 'ci-low', type: 'line', stack: 'ci', data: series.values.map((v, i) => v - series.half[i]), lineStyle: { opacity: 0 }, symbol: 'none', silent: true, tooltip: { show: false } },
        { id: 'ci-band', type: 'line', stack: 'ci', data: series.half.map((w) => w * 2), lineStyle: { opacity: 0 }, areaStyle: { color: token(series.token, 0.14) }, symbol: 'none', silent: true, tooltip: { show: false } },
        { id: 'value', type: 'line', data: series.values, color: token(series.token), lineStyle: { width: 2, join: 'round' }, symbol: 'circle', symbolSize: 6, showSymbol: false, emphasis: { disabled: true } },
      ],
    };
  }

  window.PreviewCharts = {
    /** Re-renders every chart, legend swatch and stacked bar; call after cards are added or moved. */
    refresh: () => renderAll(),
    /** Mounts a mention rate trend chart in `el` (which needs an id). Returns a function that disposes it. */
    mountTrend: (el, engine) => {
      const entry = { id: el.id, option: () => trendOption(el.id, engine) };
      charts.push(entry);
      observer.observe(el);
      renderCharts();
      return () => {
        charts.splice(charts.indexOf(entry), 1);
        observer.unobserve(el);
        instances.get(entry.id)?.dispose();
        instances.delete(entry.id);
      };
    },
    /** Draws the sparklines inside `scope` only: for tables that render their own rows. */
    sparklines: (scope) => renderSparklines(scope),
    token,
    fontFamily,
    axisTheme,
    tooltipTheme,
    GRID,
    syncRows: () => document.querySelectorAll('[data-selectable] tbody tr').forEach(syncRow),
    /** Shows or hides one Overview small multiple; returns false when it is the last one and stays. */
    setMultipleVisible: (key, visible) => {
      const m = MULTIPLES.find((item) => item.key === key);
      if (!m || (!visible && visibleMultiples().length === 1 && !multipleRow(m).hidden)) return false;
      multipleRow(m).hidden = !visible;
      layoutMultiples();
      instances.forEach((instance) => instance.resize());
      renderCharts();
      return true;
    },
  };
  new MutationObserver(renderAll).observe(root, { attributes: true, attributeFilter: ['class'] });

  let frame = 0;
  const onResize = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      instances.forEach((instance) => instance.resize());
      renderCharts();
      renderStackedBar();
    });
  };
  const observer = new ResizeObserver(onResize);
  charts.forEach((chart) => {
    const el = document.getElementById(chart.id);
    if (el) observer.observe(el);
  });
  document.querySelectorAll('[data-segment-token]').forEach((segment) => observer.observe(segment));

  // -------------------------------------------------------------------------------------------
  // Shell interactions: segmented controls, account menu, navigation drawer (below 1024 px)

  // Segmented controls: each segment has its own border and corner radius (outer corners rounded, inner square);
  // the selected segment is positioned so its primary-border outline paints above the neighbouring borders.
  const SELECTED = ['relative', 'border-primary-border', 'bg-primary-subtle', 'type-body-strong', 'text-primary-text'];
  const UNSELECTED = ['border-border', 'bg-surface', 'type-body', 'text-foreground-secondary', 'hover:bg-surface-hover'];
  document.querySelectorAll('[data-segmented]').forEach((group) => {
    const segments = [...group.querySelectorAll('[role="radio"]')];
    segments.forEach((segment) =>
      segment.addEventListener('click', () => {
        segments.forEach((other) => {
          const on = other === segment;
          other.setAttribute('aria-checked', String(on));
          other.classList.remove(...(on ? UNSELECTED : SELECTED));
          other.classList.add(...(on ? SELECTED : UNSELECTED));
        });
      }),
    );
  });

  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('nav-scrim');
  const navOpen = document.getElementById('nav-open');
  const setNav = (open) => {
    sidebar.toggleAttribute('data-open', open);
    scrim.hidden = !open;
    navOpen.setAttribute('aria-expanded', String(open));
    if (open) sidebar.querySelector('a, button')?.focus();
    else navOpen.focus();
  };
  navOpen?.addEventListener('click', () => setNav(true));
  document.getElementById('nav-close')?.addEventListener('click', () => setNav(false));
  scrim?.addEventListener('click', () => setNav(false));

  // Collapsible sidebar (19 section 3.1). At 1280 px and up the toggle and `[` collapse the sidebar to the 56 px rail
  // and the choice persists (a cookie in the app; browser storage here). At 1024 to 1279 px the rail is the default
  // and the toggle expands it over the content (data-sidebar-peek) until navigation, Escape or a click outside.
  const SIDEBAR_KEY = 'preview-sidebar';
  const wideScreen = window.matchMedia('(width >= 80rem)');
  const railScreen = window.matchMedia('(width >= 64rem) and (width < 80rem)');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarToggleLabel = sidebarToggle?.querySelector('[data-sidebar-toggle-label]');

  const readSidebarPref = () => {
    try {
      return window.localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
    } catch {
      return false;
    }
  };
  const writeSidebarPref = (collapsed) => {
    try {
      window.localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded');
    } catch {
      // Storage can be unavailable (private windows, blocked site data); the choice then lasts for this page only.
    }
  };

  const isRail = () =>
    wideScreen.matches ? root.dataset.sidebar === 'collapsed' : railScreen.matches && !root.hasAttribute('data-sidebar-peek');

  function syncSidebarToggle() {
    if (!sidebarToggle) return;
    const rail = isRail();
    const label = rail ? 'Expand sidebar' : 'Collapse sidebar';
    sidebarToggle.setAttribute('aria-expanded', String(!rail));
    sidebarToggle.dataset.tip = label;
    sidebarToggleLabel.textContent = rail ? 'Expand' : 'Collapse';
    sidebarToggle.setAttribute('aria-label', label);
  }

  function setPeek(open) {
    root.toggleAttribute('data-sidebar-peek', open && railScreen.matches);
    syncSidebarToggle();
  }

  function toggleSidebar() {
    if (wideScreen.matches) {
      const collapsed = root.dataset.sidebar !== 'collapsed';
      root.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
      writeSidebarPref(collapsed);
      syncSidebarToggle();
    } else if (railScreen.matches) {
      setPeek(!root.hasAttribute('data-sidebar-peek'));
    }
  }

  root.dataset.sidebar = readSidebarPref() ? 'collapsed' : 'expanded';
  syncSidebarToggle();
  sidebarToggle?.addEventListener('click', toggleSidebar);
  railScreen.addEventListener('change', () => setPeek(false));
  wideScreen.addEventListener('change', syncSidebarToggle);
  sidebar.addEventListener('click', (event) => {
    if (event.target.closest('a[href]') && root.hasAttribute('data-sidebar-peek')) setPeek(false);
  });
  document.addEventListener('pointerdown', (event) => {
    if (root.hasAttribute('data-sidebar-peek') && !sidebar.contains(event.target)) setPeek(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== '[' || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    // Single-key shortcuts can be turned off in Settings > Preferences (20 section 14)
    if (root.dataset.singleKeys === 'off') return;
    const target = event.target;
    if (target instanceof window.HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="dialog"], [role="menu"]'))) return;
    event.preventDefault();
    toggleSidebar();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (sidebar.hasAttribute('data-open')) setNav(false);
    if (root.hasAttribute('data-sidebar-peek')) {
      setPeek(false);
      sidebarToggle?.focus();
    }
  });
})();
