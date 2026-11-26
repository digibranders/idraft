/* global document, window, echarts, ResizeObserver, MutationObserver */
/**
 * Internal links, Link map tab: every live page of the crawl in one graph. A dot is a page, an arrow is a link in
 * the body of one page to another. Pages are placed by their links, so pages that link to each other sit together;
 * pages with no such link stand in a block of their own, by tier. Menu and footer links are not drawn (nearly every
 * page has the same ones): a page they point to carries that as a property, shown on hover and as a highlight.
 *
 * The canvas zooms, pans and lets a page be dragged; hovering a page shows its links in and out, a click opens the
 * page inspector. The Pages tab is the accessible version of the same pages. Graph and layout: il-map-layout.js.
 */
import { BUTTON_SM, icon, popover, popoverOpen } from './perf-ui.js';
import { el } from './prompts-parts.js';
import { HOST } from './il-data-source.js';
import { activePages, isActiveLink, links, number, pageById, plural, refresh, state, tierIdOf, tierLabel, tierPosition, tiers } from './il-model.js';
import { menuSelect } from './il-pages.js';
import { openInspector } from './il-drawer.js';
import { pagePicker } from './il-journey.js';
import { buildGraph, layoutGraph, summarise } from './il-map-layout.js';

const FOCUS_RING = 'focus-visible:focus-ring';
const CONTROL = `flex size-7 items-center justify-center rounded-sm text-foreground-secondary hover:bg-surface-hover aria-pressed:bg-primary-subtle aria-pressed:text-primary-text disabled:text-foreground-disabled disabled:hover:bg-transparent ${FOCUS_RING}`;
// One sequential scale, most contrast for T1, as the tier badges
const TIER_TOKEN = ['seq-7', 'seq-6', 'seq-5', 'seq-4', 'seq-3', 'seq-3', 'seq-2', 'seq-2'];
const SECTION_TOKEN = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'];
const LINKS_MENU = [['editorial', 'Editorial'], ['auto', 'Editorial and auto-generated']];
const COLOUR_MENU = [['tier', 'Tier'], ['section', 'Section']];
const LENSES = [
  ['', 'Nothing', () => true],
  ['noIn', 'No links in', (node) => node.in === 0],
  ['deadEnd', 'Dead ends', (node) => node.in > 0 && node.out === 0],
  ['sitewide', 'In the menu or footer', (node) => node.sitewide > 0],
];
// A page shows its path without hovering from this many links in
const LABEL_FROM = 6;
const ZOOM = { min: 0.4, max: 12 };
const HEADER = 'h:';

const m = () => state.map;
const token = (name, alpha) => window.PreviewCharts.token(name, alpha);
const escape = (text) => echarts.format.encodeHTML(String(text));
const short = (path) => (path.length > 34 ? `${path.slice(0, 33)}...` : path);

// What survives a redraw of the page: the chart in view, where the reader looked and what they dragged
let chart = null;
let cleanup = () => {};
let view = { zoom: 1, center: null };
let viewKey = '';
const moved = new Map();
let maximised = false;

function sectionOf(page) {
  const parts = page.path.split('/').filter(Boolean);
  if (parts.length === 0) return 'Home page';
  return parts.length === 1 ? 'Top level pages' : `/${parts[0]}`;
}

/** The groups the colour stands for, in legend order: `{ key, label, token, count }`, and the key of a page. */
function colourGroups(nodes) {
  if (m().colour === 'tier') {
    const keyOf = (id) => tierIdOf(pageById(id)) ?? '';
    const list = [...tiers.map((tier) => tier.id), ''].map((key) => ({ key, label: tierLabel(key || null), token: key ? TIER_TOKEN[tierPosition(key) - 1] : 'border-strong', count: 0 }));
    nodes.forEach((node) => {
      list.find((group) => group.key === keyOf(node.id)).count += 1;
    });
    return { keyOf, list: list.filter((group) => group.count > 0) };
  }
  const counts = new Map();
  nodes.forEach((node) => {
    const section = sectionOf(pageById(node.id));
    counts.set(section, (counts.get(section) ?? 0) + 1);
  });
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, SECTION_TOKEN.length);
  const named = new Set(top.map(([section]) => section));
  const keyOf = (id) => {
    const section = sectionOf(pageById(id));
    return named.has(section) ? section : 'other';
  };
  const list = top.map(([section, count], i) => ({ key: section, label: section, token: SECTION_TOKEN[i], count }));
  const rest = nodes.length - top.reduce((sum, [, count]) => sum + count, 0);
  if (rest > 0) list.push({ key: 'other', label: 'Other sections', token: 'chart-other', count: rest });
  return { keyOf, list };
}

/** Everything a draw needs, from the crawl in view and the controls. */
function model() {
  const graph = buildGraph({ pages: activePages(), links: links.filter((link) => isActiveLink(link)), host: HOST, withAuto: m().links === 'auto' });
  const layout = layoutGraph(graph, (id) => tierPosition(tierIdOf(pageById(id))) || 99);
  return { graph, layout, summary: summarise(graph), colour: colourGroups(graph.nodes), lens: LENSES.find(([key]) => key === m().lens)[2] };
}

// With everything in view the minimap would only repeat the map (and cover a corner of it)
const minimapShown = () => m().minimap && view.zoom > 1.05;

const linkWord = () => (m().links === 'auto' ? 'editorial or auto-generated link' : 'editorial link');

function sentence(summary) {
  const word = linkWord();
  const parts = [`${plural(summary.pages, 'page')} and ${plural(summary.links, word)}.`];
  if (summary.largest > 1) parts.push(`${number(summary.largest)} pages hang together in the largest group.`);
  if (summary.unlinked > 0) parts.push(`${plural(summary.unlinked, 'page')} ${summary.unlinked === 1 ? 'has' : 'have'} no ${word} in or out: the block on the right.`);
  return parts.join(' ');
}

// -------------------------------------------------------------------------------------------------
// The chart

function tooltip(params, data) {
  const box = (inner) => `<div class="max-w-80 rounded-lg border border-border bg-surface-elevated px-3 py-2 shadow-popover whitespace-normal">${inner}</div>`;
  if (params.dataType === 'edge') {
    const edge = data.graph.edges[params.data.edge];
    const times = edge.count === 1 ? '' : ` (${number(edge.count)} links)`;
    return box(`<div class="type-meta text-foreground-secondary">Links to</div><div class="type-table text-foreground break-all">${escape(pageById(edge.to).path)}</div><div class="mt-1 type-meta text-foreground-secondary">from ${escape(pageById(edge.from).path)}${times}</div>`);
  }
  const node = data.graph.nodes.find((candidate) => candidate.id === params.name);
  if (!node) return '';
  const page = pageById(node.id);
  const row = (label, value) => `<div class="flex justify-between gap-6 type-meta"><span class="text-foreground-secondary">${label}</span><span class="num text-foreground">${escape(value)}</span></div>`;
  return box(
    `<div class="type-table text-foreground break-all">${escape(page.path)}</div>` +
    (page.title ? `<div class="mb-1.5 type-meta text-foreground-secondary">${escape(page.title)}</div>` : '<div class="mb-1.5"></div>') +
    row('Tier', tierLabel(tierIdOf(page))) +
    row('Links in', number(node.in)) +
    row('Links out', number(node.out)) +
    (node.sitewide > 0 ? `<div class="mt-1.5 type-meta text-foreground-secondary">In the menu or footer of ${number(node.sitewide)} pages</div>` : ''),
  );
}

function option(data, width, height) {
  const { graph, layout, colour, lens } = data;
  const hidden = m().hidden;
  const colourOf = new Map(colour.list.map((group) => [group.key, token(group.token)]));
  const shown = new Set(graph.nodes.filter((node) => !hidden.has(colour.keyOf(node.id))).map((node) => node.id));
  const surface = token('surface');
  const nodes = graph.nodes.filter((node) => shown.has(node.id)).map((node) => {
    const [x, y] = moved.get(node.id) ?? layout.positions.get(node.id);
    const match = lens(node);
    const open = state.open === node.id;
    return {
      name: node.id,
      x,
      y,
      symbolSize: 6 + 3.4 * Math.sqrt(node.in),
      itemStyle: { color: colourOf.get(colour.keyOf(node.id)), opacity: match ? 1 : 0.14, borderColor: open ? token('primary') : surface, borderWidth: open ? 3 : 1 },
      label: { show: match && (open || node.in >= LABEL_FROM) },
    };
  });
  // The block of pages with no drawn link: a title, then one line per tier. Text only, nothing to hover or drag.
  // A line counts the pages of its tier that are on the map now, and goes with them when a legend group is off
  const inBlock = new Map();
  graph.nodes.forEach((node) => {
    if (node.in + node.out > 0 || !shown.has(node.id)) return;
    const key = tierPosition(tierIdOf(pageById(node.id))) || 99;
    inBlock.set(key, (inBlock.get(key) ?? 0) + 1);
  });
  const lines = layout.groups.filter((group) => inBlock.has(group.key));
  const first = lines[0];
  // The second one is empty: it keeps room for the lines of text when the block is only a few pages wide
  const headers = first ? [{ key: 'title', x: first.x, y: first.y - 30, text: `No ${linkWord()} in or out`, strong: true }, { key: 'room', x: first.x + 300, y: first.y, text: '' }, ...lines.map((group) => ({ key: group.key, x: group.x, y: group.y, text: `${tierLabel(tiers[group.key - 1]?.id ?? null)}: ${plural(inBlock.get(group.key), 'page')}` }))] : [];
  headers.forEach((header) => nodes.push({
    name: `${HEADER}${header.key}`,
    x: header.x - 5,
    y: header.y,
    symbolSize: 0.01,
    draggable: false,
    cursor: 'default',
    tooltip: { show: false },
    emphasis: { disabled: true },
    label: { show: true, formatter: header.text, color: token(header.strong ? 'foreground' : 'foreground-secondary'), fontWeight: header.strong ? 600 : 400, fontSize: header.strong ? 12 : 11 },
  }));
  // The map keeps its shape in any canvas: the largest box of the map's own proportions, centred, with room
  // below for the zoom controls. A box given by its four edges would stretch the map to the canvas.
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const shape = Math.max(1, Math.max(...xs) - Math.min(...xs)) / Math.max(1, Math.max(...ys) - Math.min(...ys));
  const room = { width: Math.max(1, width - 48), height: Math.max(1, height - 80) };
  const fitted = room.width / room.height > shape ? { width: room.height * shape, height: room.height } : { width: room.width, height: room.width / shape };
  const box = { left: 24 + (room.width - fitted.width) / 2, top: 24 + (room.height - fitted.height) / 2, ...fitted };
  const matched = new Set(graph.nodes.filter((node) => lens(node)).map((node) => node.id));
  const edges = graph.edges.flatMap((edge, index) => (shown.has(edge.from) && shown.has(edge.to) ? [{ source: edge.from, target: edge.to, edge: index, lineStyle: { opacity: matched.has(edge.from) && matched.has(edge.to) ? 0.5 : 0.05 } }] : []));
  return {
    animation: false,
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', confine: true, backgroundColor: 'transparent', borderWidth: 0, padding: 0, extraCssText: 'box-shadow: none;', formatter: (params) => tooltip(params, data) },
    thumbnail: { show: minimapShown(), width: 176, height: 116, right: 12, bottom: 12, itemStyle: { color: token('surface-subtle'), borderColor: token('border'), borderWidth: 1 }, windowStyle: { color: token('primary', 0.14), borderColor: token('primary'), borderWidth: 1, opacity: 1 } },
    series: [{
      type: 'graph',
      layout: 'none',
      roam: true,
      draggable: true,
      zoom: view.zoom,
      ...(view.center ? { center: view.center } : {}),
      scaleLimit: ZOOM,
      // Dots grow slower than the map when zooming in, so a dense group opens up
      nodeScaleRatio: 0.35,
      ...box,
      edgeSymbol: ['none', 'arrow'],
      edgeSymbolSize: 5,
      // A slight curve keeps a link and its return link apart
      lineStyle: { color: token('border-strong'), width: 1, curveness: 0.14 },
      label: { position: 'right', distance: 4, color: token('foreground-secondary'), textBorderColor: surface, textBorderWidth: 2, fontFamily: window.PreviewCharts.fontFamily(), fontSize: 11, formatter: (params) => short(pageById(params.name)?.path ?? '') },
      labelLayout: { hideOverlap: true },
      emphasis: { focus: 'adjacency', scale: 1.15, label: { show: true, color: token('foreground') }, lineStyle: { width: 1.75, opacity: 0.95, color: token('primary') } },
      blur: { itemStyle: { opacity: 0.1 }, lineStyle: { opacity: 0.03 }, label: { show: false } },
      data: nodes,
      links: edges,
    }],
  };
}

// -------------------------------------------------------------------------------------------------
// Controls

function toolbar(data) {
  const bar = el('div', 'flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle px-3 py-2');
  const home = data.graph.nodes.find((node) => node.id === 'home') ?? data.graph.nodes[0];
  const picker = pagePicker({
    prefix: 'Go to',
    current: data.layout.positions.has(state.open) ? state.open : home.id,
    ariaLabel: 'Go to a page on the map',
    popoverLabel: 'Choose the page to show on the map',
    onPick: (id) => {
      const spot = moved.get(id) ?? data.layout.positions.get(id);
      // A redirect or a page that is not live has no dot of its own: the inspector still opens
      if (spot) view = { zoom: 3, center: spot };
      state.open = id;
      refresh();
    },
  });
  picker.classList.add('w-full');
  const pickerBox = el('div', 'min-w-0 max-w-80 flex-[1_1_11rem]');
  pickerBox.append(picker);
  const set = (key) => (value) => {
    m()[key] = value;
    if (key === 'colour') m().hidden.clear();
    refresh();
  };
  const controls = el('div', 'ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2');
  controls.append(
    menuSelect('Links', LINKS_MENU, m().links, set('links'), 'Links drawn'),
    menuSelect('Colour', COLOUR_MENU, m().colour, set('colour'), 'Colour pages by'),
    menuSelect('Highlight', LENSES.map(([key, label]) => [key, label]), m().lens, set('lens'), 'Highlight pages'),
  );
  const full = el('button', `${BUTTON_SM} ${FOCUS_RING}`);
  full.type = 'button';
  full.dataset.restore = 'map-full';
  full.append(icon(maximised ? 'minimize' : 'maximize', 'size-icon-sm text-foreground-tertiary'), el('span', '', maximised ? 'Leave full screen' : 'Full screen'));
  full.addEventListener('click', toggleFull);
  controls.append(full);
  bar.append(pickerBox, controls);
  return bar;
}

/** The map takes the whole window, and the whole screen where the browser allows its own full screen. */
function toggleFull() {
  maximised = !maximised;
  if (maximised) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen();
  refresh();
}

/** The colours and what they stand for. A group is a switch: off takes its pages off the map. */
function legend(data) {
  const row = el('div', 'flex flex-wrap items-center gap-1.5 border-b border-border-subtle px-3 py-2');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', m().colour === 'tier' ? 'Tiers shown' : 'Sections shown');
  data.colour.list.forEach((group) => {
    const on = !m().hidden.has(group.key);
    const chip = el('button', `inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 type-meta whitespace-nowrap hover:bg-surface-hover ${FOCUS_RING} ${on ? 'bg-surface text-foreground' : 'bg-surface-subtle text-foreground-tertiary'}`);
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(on));
    chip.dataset.restore = `map-group:${group.key}`;
    const swatch = el('span', 'size-2.5 rounded-full border');
    swatch.style.borderColor = token(group.token);
    swatch.style.background = on ? token(group.token) : 'transparent';
    chip.append(swatch, el('span', '', group.label), el('span', 'num text-foreground-tertiary', number(group.count)));
    chip.addEventListener('click', () => {
      if (on) m().hidden.add(group.key);
      else m().hidden.delete(group.key);
      refresh();
    });
    row.append(chip);
  });
  row.append(el('span', 'ml-auto type-meta text-foreground-tertiary', 'Bigger dot: more links in'));
  return row;
}

function help(trigger) {
  popover(trigger, (panel) => {
    panel.classList.add('w-80', 'p-3', 'flex', 'flex-col', 'gap-2');
    const list = el('dl', 'grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 type-meta');
    [
      ['Dot', 'A live page. Redirects and duplicate addresses count as the page they point to.'],
      ['Arrow', 'A link in the body of one page to another, pointing at the page it opens.'],
      ['Not drawn', 'Menu and footer links. Nearly every page has the same ones, so they are a property of the page: see it on hover, or pick it under Highlight.'],
      ['Scroll', 'Zooms in and out. Drag the background to move the map.'],
      ['Drag a dot', 'Moves that page. Fit everything keeps it there.'],
      ['Hover', 'Shows the pages a page links to and the pages that link to it.'],
      ['Click', 'Opens the page inspector.'],
    ].forEach(([term, text]) => list.append(el('dt', 'text-foreground whitespace-nowrap', term), el('dd', 'text-foreground-secondary', text)));
    panel.append(el('p', 'type-body-strong text-foreground', 'Reading the map'), list);
  }, { label: 'Reading the map' });
}

// -------------------------------------------------------------------------------------------------

export function render(host) {
  cleanup();
  // Another crawl or another set of links is another picture: the view and the dragged pages start over
  const key = `${state.crawl}|${m().links}`;
  if (key !== viewKey) {
    view = { zoom: 1, center: null };
    moved.clear();
    viewKey = key;
  }
  const data = model();
  if (data.graph.nodes.length === 0) {
    maximised = false;
    host.append(el('p', 'rounded-lg border border-border bg-surface px-4 py-10 text-center type-body text-foreground-secondary', 'This crawl found no live page, so there is nothing to map yet.'));
    return;
  }
  const panel = el('section', `flex flex-col overflow-hidden border-border bg-surface ${maximised ? 'fixed inset-0 z-(--z-inspector)' : 'rounded-lg border'}`);
  panel.setAttribute('aria-label', 'Link map');
  const stage = el('div', `relative isolate min-h-0 bg-surface-subtle ${maximised ? 'flex-1' : 'h-[max(30rem,calc(100dvh-21rem))]'}`);
  const canvas = el('div', 'absolute inset-0');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Map of internal links. ${sentence(data.summary)} The Pages tab lists every page with its links.`);
  stage.append(canvas);
  panel.append(toolbar(data), legend(data), el('p', 'border-b border-border-subtle px-3 py-2 type-meta text-foreground-secondary', sentence(data.summary)), stage);
  host.append(panel);

  chart = echarts.init(canvas);
  const paint = () => chart.setOption(option(data, chart.getWidth(), chart.getHeight()), { notMerge: true });

  const control = (name, label, run) => {
    const button = el('button', CONTROL);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.dataset.tip = label;
    button.append(icon(name, 'size-icon-sm'));
    button.addEventListener('click', run);
    return button;
  };
  const percent = el('button', `h-7 w-12 rounded-sm type-meta num text-foreground-secondary hover:bg-surface-hover ${FOCUS_RING}`);
  percent.type = 'button';
  percent.setAttribute('aria-label', 'Fit everything');
  percent.dataset.tip = 'Fit everything';
  const zoomTo = (zoom) => {
    view = { ...view, zoom: Math.min(ZOOM.max, Math.max(ZOOM.min, zoom)) };
    paint();
    sync();
  };
  const fit = () => {
    view = { zoom: 1, center: null };
    paint();
    sync();
  };
  const zoomOut = control('zoom-out', 'Zoom out', () => zoomTo(view.zoom / 1.4));
  const zoomIn = control('zoom-in', 'Zoom in', () => zoomTo(view.zoom * 1.4));
  percent.addEventListener('click', fit);
  const mapButton = control('square-dashed', 'Minimap', () => {
    m().minimap = !m().minimap;
    paint();
    sync();
  });
  const fullButton = control(maximised ? 'minimize' : 'maximize', maximised ? 'Leave full screen' : 'Full screen', toggleFull);
  const helpButton = control('circle-help', 'Reading the map', () => {});
  help(helpButton);
  function sync() {
    percent.textContent = `${Math.round(view.zoom * 100)}%`;
    zoomOut.disabled = view.zoom <= ZOOM.min + 0.001;
    zoomIn.disabled = view.zoom >= ZOOM.max - 0.001;
    mapButton.setAttribute('aria-pressed', String(m().minimap));
  }
  const controls = el('div', 'absolute bottom-3 left-3 flex items-center gap-0.5 rounded-md border border-border bg-surface-elevated p-0.5 shadow-popover');
  controls.append(zoomOut, percent, zoomIn, el('span', 'mx-0.5 h-4 w-px bg-border'), control('scan', 'Fit everything', fit), mapButton, fullButton, helpButton);
  stage.append(controls);

  chart.on('graphroam', () => {
    const series = chart.getOption().series[0];
    const before = minimapShown();
    view = { zoom: series.zoom, center: series.center ?? null };
    if (minimapShown() !== before) chart.setOption({ thumbnail: { show: minimapShown() } });
    sync();
  });
  // A drag ends in a click too: only a press and release on the same spot opens the page
  let pressed = null;
  let held = null;
  chart.on('mousedown', (params) => {
    pressed = [params.event.offsetX, params.event.offsetY];
    held = params.dataType === 'node' && !params.name.startsWith(HEADER) ? params.name : null;
  });
  // On the canvas, not the dot: a fast drag is released beside the dot it moves
  chart.getZr().on('mouseup', () => {
    if (!held) return;
    const points = chart.getModel().getSeriesByIndex(0).getData();
    const [x, y] = points.getItemLayout(points.indexOfName(held));
    const [startX, startY] = moved.get(held) ?? data.layout.positions.get(held);
    if (Math.hypot(x - startX, y - startY) > 0.01) moved.set(held, [x, y]);
    held = null;
  });
  chart.on('click', (params) => {
    if (params.dataType !== 'node' || params.name.startsWith(HEADER)) return;
    if (pressed && Math.hypot(params.event.offsetX - pressed[0], params.event.offsetY - pressed[1]) > 4) return;
    openInspector(params.name);
    paint();
  });

  const resizer = new ResizeObserver(() => {
    chart.resize();
    paint();
  });
  resizer.observe(canvas);
  // The colours are read from the theme: a theme switch repaints
  const theme = new MutationObserver(paint);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  const leftFull = () => {
    if (!document.fullscreenElement && maximised) {
      maximised = false;
      refresh();
    }
  };
  document.addEventListener('fullscreenchange', leftFull);
  // Where the browser's full screen is not allowed, Escape still leaves; an open inspector or menu takes it first
  const onEscape = (event) => {
    if (event.key !== 'Escape' || !maximised || document.fullscreenElement || state.open || popoverOpen()) return;
    maximised = false;
    refresh();
  };
  document.addEventListener('keydown', onEscape);
  cleanup = () => {
    resizer.disconnect();
    theme.disconnect();
    document.removeEventListener('fullscreenchange', leftFull);
    document.removeEventListener('keydown', onEscape);
    chart.dispose();
    chart = null;
    cleanup = () => {};
  };
  paint();
  sync();
}

/** The page shell calls this when another tab or page takes over: the chart goes, and so does full screen. */
export function leave() {
  cleanup();
  if (!maximised) return;
  maximised = false;
  if (document.fullscreenElement) document.exitFullscreen();
}

export function exportRows() {
  const { graph } = model();
  return [
    ['Page', 'Title', 'Tier', 'Links in', 'Links out', 'On the map', 'Menu or footer links from (pages)'],
    ...graph.nodes.map((node) => {
      const page = pageById(node.id);
      return [page.path, page.title, tierLabel(tierIdOf(page)), node.in, node.out, node.in + node.out > 0 ? 'Linked' : 'No link in or out', node.sitewide];
    }),
  ];
}
