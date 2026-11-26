/* global document, window, echarts, ResizeObserver, MutationObserver */
/**
 * Internal links, Link map tab: every live page of the crawl in one graph. A dot is a page, an arrow is a link in
 * the body of one page to another. Pages are placed by their links, so pages that link to each other sit together;
 * pages with no such link stand in a block of their own, by tier. Menu and footer links are not drawn (nearly every
 * page has the same ones): a page they point to carries that as a property, shown on the page's card and as a
 * highlight.
 *
 * Finding and reading a page:
 * - Every page carries its name. Names that would overlap give way to the page with more links, and come back as
 *   the reader zooms in.
 * - The search box lights the pages that match and dims the rest; Enter zooms to them.
 * - Pointing at a page shows its name and links without hiding the map. A click keeps the page and the pages it
 *   links with lit, links in and links out in two colours, and opens its card, until another click or Escape.
 *
 * The Pages tab is the accessible version of the same pages. Graph and layout: il-map-layout.js.
 */
import { BUTTON_SM, FIELD, icon, popoverOpen } from './perf-ui.js';
import { el } from './prompts-parts.js';
import { HOST } from './il-data-source.js';
import { activePages, isActiveLink, links, number, pageById, plural, refresh, setFocus, state, tierIdOf, tierLabel, tierPosition, tiers } from './il-model.js';
import { menuSelect } from './il-pages.js';
import { openInspector } from './il-drawer.js';
import { buildGraph, layoutGraph, summarise } from './il-map-layout.js';

const FOCUS_RING = 'focus-visible:focus-ring';
const CONTROL = `flex size-7 items-center justify-center rounded-sm text-foreground-secondary hover:bg-surface-hover aria-pressed:bg-primary-subtle aria-pressed:text-primary-text disabled:text-foreground-disabled disabled:hover:bg-transparent ${FOCUS_RING}`;
// Tiers must be told apart on a dot a few pixels wide, so the map gives each a hue of its own instead of the
// one-hue scale of the tier badges: the brand colour for T1, a neutral for the many content pages, a pale one for
// utility pages. `outline` keeps a pale dot visible on the canvas.
const TIER_STYLE = [
  { token: 'chart-1' },
  { token: 'chart-2' },
  { token: 'chart-other' },
  { token: 'chart-bar-neutral', outline: 'border-strong' },
  { token: 'chart-3' },
  { token: 'chart-4' },
  { token: 'chart-5' },
  { token: 'chart-6' },
];
const UNTIERED_STYLE = { token: 'surface', outline: 'border-strong' };
const SECTION_TOKEN = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'];
// Links into the selected page and links out of it
const IN_TOKEN = 'chart-3';
const OUT_TOKEN = 'chart-1';
const LINKS_MENU = [['editorial', 'Editorial'], ['auto', 'Editorial and auto-generated']];
const COLOUR_MENU = [['tier', 'Tier'], ['section', 'Section']];
const LENSES = [
  ['', 'Nothing', () => true],
  ['noIn', 'No links in', (node) => node.in === 0],
  ['deadEnd', 'Dead ends', (node) => node.in > 0 && node.out === 0],
  ['sitewide', 'In the menu or footer', (node) => node.sitewide > 0],
];
const ZOOM = { min: 0.4, max: 12 };
const HEADER = 'h:';
// Pixels of canvas per unit of the layout at which a dot has its plain size; a bigger canvas grows the dots
const PLAIN_SCALE = 0.8;

const m = () => state.map;
const token = (name, alpha) => window.PreviewCharts.token(name, alpha);
const escape = (text) => echarts.format.encodeHTML(String(text));
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// What survives a redraw of the page: the chart in view, where the reader looked and what they dragged
let chart = null;
let cleanup = () => {};
let view = { zoom: 1, center: null };
let viewKey = '';
const moved = new Map();
let maximised = false;

/** The name a page carries on the map: the last part of its address, which is what tells pages apart. */
function nameOf(page) {
  const parts = page.path.split('/').filter(Boolean);
  if (parts.length === 0) return 'Home page';
  const last = parts[parts.length - 1];
  return last.length > 30 ? `${last.slice(0, 29)}...` : last;
}

function sectionOf(page) {
  const parts = page.path.split('/').filter(Boolean);
  if (parts.length === 0) return 'Home page';
  return parts.length === 1 ? 'Top level pages' : `/${parts[0]}`;
}

/** The groups the colour stands for, in legend order: `{ key, label, token, outline, count }`, and the key of a page. */
function colourGroups(nodes) {
  if (m().colour === 'tier') {
    const keyOf = (id) => tierIdOf(pageById(id)) ?? '';
    const list = [...tiers.map((tier) => tier.id), ''].map((key) => ({ key, label: tierLabel(key || null), ...(key ? TIER_STYLE[tierPosition(key) - 1] : UNTIERED_STYLE), count: 0 }));
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

/** Everything a draw needs, from the crawl in view and the controls. `below` puts the block of unlinked pages under the map. */
function model(below) {
  const graph = buildGraph({ pages: activePages(), links: links.filter((link) => isActiveLink(link)), host: HOST, withAuto: m().links === 'auto' });
  const layout = layoutGraph(graph, (id) => tierPosition(tierIdOf(pageById(id))) || 99, { below });
  return { graph, layout, below, summary: summarise(graph), colour: colourGroups(graph.nodes), byId: new Map(graph.nodes.map((node) => [node.id, node])) };
}

const linkWord = () => (m().links === 'auto' ? 'editorial or auto-generated link' : 'editorial link');

function sentence(data) {
  const { summary } = data;
  const word = linkWord();
  const parts = [`${plural(summary.pages, 'page')} and ${plural(summary.links, word)}.`];
  if (summary.largest > 1) parts.push(`${number(summary.largest)} pages hang together in the largest group.`);
  if (summary.unlinked > 0) parts.push(`${plural(summary.unlinked, 'page')} ${summary.unlinked === 1 ? 'has' : 'have'} no ${word} in or out: the block ${data.below ? 'below' : 'on the right'}.`);
  return parts.join(' ');
}

/**
 * The pages in the light: the selected page with the pages it links with, or the pages the search and the
 * highlight leave. `lit` is null when nothing narrows the map.
 */
function focusOf(data) {
  const { graph, byId } = data;
  const selected = byId.has(m().selected) ? m().selected : null;
  if (selected) {
    const sources = new Set(graph.edges.filter((edge) => edge.to === selected).map((edge) => edge.from));
    const targets = new Set(graph.edges.filter((edge) => edge.from === selected).map((edge) => edge.to));
    return { selected, sources, targets, lit: new Set([selected, ...sources, ...targets]) };
  }
  const query = m().query.trim().toLowerCase();
  const lens = LENSES.find(([key]) => key === m().lens)[2];
  if (!query && !m().lens) return { selected: null, lit: null };
  const matches = (node) => {
    if (!query) return true;
    const page = pageById(node.id);
    return page.path.toLowerCase().includes(query) || page.title.toLowerCase().includes(query);
  };
  return { selected: null, searching: Boolean(query), lit: new Set(graph.nodes.filter((node) => lens(node) && matches(node)).map((node) => node.id)) };
}

// With everything in view the minimap would only repeat the map (and cover a corner of it)
const minimapShown = () => m().minimap && view.zoom > 1.05;
const blockNamed = () => view.zoom >= 2;

// -------------------------------------------------------------------------------------------------
// The chart

/** Short on purpose: it sits beside the pointer, and the card of a clicked page has the rest. */
function tooltip(params, data) {
  const box = (inner) => `<div class="max-w-72 rounded-md border border-border bg-surface-elevated px-2.5 py-1.5 shadow-popover whitespace-normal">${inner}</div>`;
  if (params.dataType === 'edge') {
    const edge = data.graph.edges[params.data.edge];
    return box(`<div class="type-meta text-foreground-secondary">${escape(pageById(edge.from).path)}</div><div class="type-table text-foreground [overflow-wrap:anywhere]">links to ${escape(pageById(edge.to).path)}</div>`);
  }
  const node = data.byId.get(params.name);
  if (!node) return '';
  const page = pageById(node.id);
  return box(`<div class="type-table text-foreground [overflow-wrap:anywhere]">${escape(page.path)}</div><div class="type-meta text-foreground-secondary">${escape(tierLabel(tierIdOf(page)))}, ${plural(node.in, 'link')} in, ${number(node.out)} out</div>`);
}

function option(data, width, height) {
  const { graph, layout, colour } = data;
  const focus = focusOf(data);
  const hidden = m().hidden;
  const styleOf = new Map(colour.list.map((group) => [group.key, group]));
  const shown = new Set(graph.nodes.filter((node) => !hidden.has(colour.keyOf(node.id))).map((node) => node.id));
  const surface = token('surface');
  const spot = (id) => moved.get(id) ?? layout.positions.get(id);

  // A line of the block counts the pages of its tier that are on the map now, and goes with them when a legend
  // group is off. The second header is empty: it keeps room for the text when the block is only a few pages wide.
  const inBlock = new Map();
  graph.nodes.forEach((node) => {
    if (node.in + node.out > 0 || !shown.has(node.id)) return;
    const key = tierPosition(tierIdOf(pageById(node.id))) || 99;
    inBlock.set(key, (inBlock.get(key) ?? 0) + 1);
  });
  const lines = layout.groups.filter((group) => inBlock.has(group.key));
  const first = lines[0];
  const headers = first ? [{ key: 'title', x: first.x, y: first.y - 30, text: `No ${linkWord()} in or out`, strong: true }, { key: 'room', x: first.x + 240, y: first.y, text: '' }, ...lines.map((group) => ({ key: group.key, x: group.x, y: group.y, text: `${tierLabel(tiers[group.key - 1]?.id ?? null)}: ${plural(inBlock.get(group.key), 'page')}` }))] : [];

  // The map keeps its shape in any canvas: the largest box of the map's own proportions, centred, with room
  // below for the zoom controls. A box given by its four edges would stretch the map to the canvas.
  const points = [...[...shown].map(spot), ...headers.map((header) => [header.x, header.y])];
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const span = { width: Math.max(1, Math.max(...xs) - Math.min(...xs)), height: Math.max(1, Math.max(...ys) - Math.min(...ys)) };
  const shape = span.width / span.height;
  const room = { width: Math.max(1, width - 72), height: Math.max(1, height - 96) };
  const fitted = room.width / room.height > shape ? { width: room.height * shape, height: room.height } : { width: room.width, height: room.width / shape };
  const box = { left: 36 + (room.width - fitted.width) / 2, top: 28 + (room.height - fitted.height) / 2, ...fitted };
  // On a big canvas the pages lie further apart, so the dots and the names grow with it
  // and on a small one they shrink, so they do not run into each other
  const grow = Math.min(1.7, Math.max(0.55, fitted.width / span.width / PLAIN_SCALE));

  const nodes = graph.nodes.filter((node) => shown.has(node.id)).map((node) => {
    const [x, y] = spot(node.id);
    const page = pageById(node.id);
    const style = styleOf.get(colour.keyOf(node.id));
    const lit = !focus.lit || focus.lit.has(node.id);
    const selected = focus.selected === node.id;
    return {
      name: node.id,
      x,
      y,
      // Bigger with more links, in or out, so the page a group gathers around stands out
      symbolSize: (7 + 2.6 * Math.sqrt(node.in + node.out)) * grow * (selected ? 1.3 : 1),
      z: selected ? 5 : lit && focus.lit ? 4 : 2,
      itemStyle: { color: token(style.token), opacity: lit ? 1 : 0.13, borderColor: selected ? token('foreground') : style.outline ? token(style.outline) : surface, borderWidth: selected ? 2.5 : 1 },
      // In the block the dots stand too close for names: they come with a zoom, a search or a selection
      label: { show: lit && (node.in + node.out > 0 || Boolean(focus.lit) || blockNamed()), formatter: nameOf(page), color: token(selected || focus.lit ? 'foreground' : 'foreground-secondary'), fontWeight: selected ? 600 : 400 },
    };
  });
  headers.forEach((header) => nodes.push({
    name: `${HEADER}${header.key}`,
    x: header.x - 5,
    y: header.y,
    symbolSize: 0.01,
    draggable: false,
    cursor: 'default',
    tooltip: { show: false },
    emphasis: { disabled: true },
    label: { show: true, formatter: header.text, color: token(header.strong ? 'foreground' : 'foreground-secondary'), fontWeight: header.strong ? 600 : 400 },
  }));

  const line = token('foreground-tertiary');
  const edges = graph.edges.flatMap((edge, index) => {
    if (!shown.has(edge.from) || !shown.has(edge.to)) return [];
    let lineStyle = { color: line, opacity: 0.32, width: 1 };
    if (focus.selected) {
      if (edge.to === focus.selected) lineStyle = { color: token(IN_TOKEN), opacity: 0.95, width: 1.75 };
      else if (edge.from === focus.selected) lineStyle = { color: token(OUT_TOKEN), opacity: 0.95, width: 1.75 };
      else lineStyle = { color: line, opacity: 0.05, width: 1 };
    } else if (focus.lit && !(focus.lit.has(edge.from) && focus.lit.has(edge.to))) lineStyle = { color: line, opacity: 0.05, width: 1 };
    return [{ source: edge.from, target: edge.to, edge: index, lineStyle }];
  });
  // Pointing at a page lights its links only while nothing else narrows the map, and never hides the rest
  const adjacency = !focus.lit;
  return {
    animation: !reducedMotion(),
    animationDuration: 0,
    animationDurationUpdate: 0,
    stateAnimation: { duration: 140, easing: 'cubicOut' },
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      confine: true,
      showDelay: 120,
      hideDelay: 0,
      transitionDuration: 0,
      backgroundColor: 'transparent',
      borderWidth: 0,
      padding: 0,
      extraCssText: 'box-shadow: none; pointer-events: none;',
      // Above the pointer, so the pages a page links with stay in sight
      position: (point, _params, _dom, _rect, size) => [point[0] + 14, point[1] - size.contentSize[1] - 12],
      formatter: (params) => tooltip(params, data),
    },
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
      nodeScaleRatio: 0.45,
      ...box,
      edgeSymbol: ['none', 'arrow'],
      edgeSymbolSize: 6 * grow,
      // A slight curve keeps a link and its return link apart
      lineStyle: { curveness: 0.14 },
      label: { position: 'right', distance: 4, textBorderColor: token('surface-subtle'), textBorderWidth: 3, fontFamily: window.PreviewCharts.fontFamily(), fontSize: grow > 1.25 ? 12 : grow < 0.8 ? 10 : 11 },
      // Names that would overlap give way to the bigger dot; zooming in makes room for more
      labelLayout: { hideOverlap: true },
      emphasis: { focus: adjacency ? 'adjacency' : 'none', scale: 1.2, label: { show: true, color: token('foreground') }, lineStyle: adjacency ? { width: 1.75, opacity: 0.95, color: token('primary') } : {} },
      blur: { itemStyle: { opacity: 0.4 }, lineStyle: { opacity: 0.1 }, label: { opacity: 0.35 } },
      data: nodes,
      links: edges,
    }],
  };
}

// -------------------------------------------------------------------------------------------------
// Controls

function toolbar(actions) {
  const bar = el('div', 'flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle px-3 py-2');
  const field = el('label', 'relative block min-w-0 max-w-80 flex-[1_1_12rem]');
  const search = el('input', `${FIELD} w-full pl-8`);
  search.type = 'search';
  search.placeholder = 'Find a page';
  search.setAttribute('aria-label', 'Find a page on the map');
  search.value = m().query;
  search.dataset.restore = 'map-search';
  const glass = icon('search', 'pointer-events-none absolute left-2.5 top-1/2 size-icon-sm -translate-y-1/2 text-foreground-tertiary');
  field.append(glass, search);
  const found = el('span', 'type-meta text-foreground-secondary whitespace-nowrap');
  found.setAttribute('role', 'status');
  actions.found = (text) => {
    found.textContent = text;
  };
  search.addEventListener('input', () => {
    m().query = search.value;
    // A search starts from the whole map: the page clicked before is let go
    m().selected = null;
    actions.changed();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') actions.zoomToLit();
  });
  const set = (key) => (value) => {
    m()[key] = value;
    if (key === 'colour') m().hidden.clear();
    refresh();
  };
  const controls = el('div', 'ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2');
  const full = el('button', `${BUTTON_SM} ${FOCUS_RING}`);
  full.type = 'button';
  full.dataset.restore = 'map-full';
  full.append(icon(maximised ? 'minimize' : 'maximize', 'size-icon-sm text-foreground-tertiary'), el('span', '', maximised ? 'Leave full screen' : 'Full screen'));
  full.addEventListener('click', toggleFull);
  controls.append(
    menuSelect('Links', LINKS_MENU, m().links, set('links'), 'Links drawn'),
    menuSelect('Colour', COLOUR_MENU, m().colour, set('colour'), 'Colour pages by'),
    menuSelect('Highlight', LENSES.map(([key, label]) => [key, label]), m().lens, set('lens'), 'Highlight pages'),
    full,
  );
  bar.append(field, found, controls);
  return bar;
}

/** The map takes the whole window, and the whole screen where the browser allows its own full screen. */
function toggleFull() {
  maximised = !maximised;
  if (maximised) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen();
  refresh();
}

function swatch(group, on = true) {
  const dot = el('span', 'size-2.5 shrink-0 rounded-full border');
  dot.style.borderColor = token(group.outline ?? group.token);
  dot.style.background = on ? token(group.token) : 'transparent';
  return dot;
}

/** The colours and what they stand for. A group is a switch: off takes its pages off the map. */
function legend(data) {
  const row = el('div', 'flex flex-wrap items-center gap-1.5 border-b border-border-subtle px-3 py-2');
  const chips = el('div', 'flex flex-wrap items-center gap-1.5');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', m().colour === 'tier' ? 'Tiers shown' : 'Sections shown');
  data.colour.list.forEach((group) => {
    const on = !m().hidden.has(group.key);
    const chip = el('button', `inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 type-meta whitespace-nowrap hover:bg-surface-hover ${FOCUS_RING} ${on ? 'bg-surface text-foreground' : 'bg-surface-subtle text-foreground-tertiary'}`);
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(on));
    chip.dataset.restore = `map-group:${group.key}`;
    chip.append(swatch(group, on), el('span', '', group.label), el('span', 'num text-foreground-tertiary', number(group.count)));
    chip.addEventListener('click', () => {
      if (on) m().hidden.add(group.key);
      else m().hidden.delete(group.key);
      refresh();
    });
    chips.append(chip);
  });
  row.append(chips, el('span', 'ml-auto type-meta text-foreground-tertiary', 'Bigger dot: more links'));
  return row;
}

/**
 * The help sits in the canvas, above the bar its button is in (as on the Journey canvas). A popover would open
 * downwards from a button at the foot of the page and fall off the screen.
 */
function helpPanel() {
  const panel = el('div', 'absolute bottom-14 left-3 max-h-[calc(100%-5rem)] w-[26rem] max-w-[calc(100%-1.5rem)] overflow-auto rounded-lg border border-border bg-surface-elevated p-3 shadow-popover');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Reading the map');
  const list = el('dl', 'grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 type-meta');
  [
    ['Dot', 'A live page. Redirects and duplicate addresses count as the page they point to. A bigger dot has more links.'],
    ['Arrow', 'A link in the body of one page to another, pointing at the page it opens.'],
    ['Not drawn', 'Menu and footer links. Nearly every page has the same ones, so they are a property of the page: its card says so, and Highlight shows them.'],
    ['Find a page', 'Type part of an address or title. Matching pages stay lit; Enter zooms to them.'],
    ['Click a page', 'Keeps the page and the pages it links with lit, and opens its card. Click the background or press Escape to let go.'],
    ['Scroll', 'Zooms in and out; more names appear as you zoom in. Drag the background to move the map.'],
    ['Drag a dot', 'Moves that page.'],
  ].forEach(([term, text]) => list.append(el('dt', 'text-foreground whitespace-nowrap', term), el('dd', 'text-foreground-secondary', text)));
  panel.append(el('p', 'mb-2 type-body-strong text-foreground', 'Reading the map'), list);
  return panel;
}

/** The card of the selected page: what it is, its links by direction, and the ways on from here. */
function fillCard(card, data, actions) {
  const node = data.byId.get(m().selected);
  // Not the hidden attribute: the card's own display class would win over it
  card.style.display = node ? '' : 'none';
  if (!node) return;
  const page = pageById(node.id);
  const group = data.colour.list.find((candidate) => candidate.key === data.colour.keyOf(node.id));
  const head = el('div', 'flex items-start gap-2');
  const words = el('div', 'min-w-0 flex-1');
  words.append(el('p', 'type-body-strong text-foreground [overflow-wrap:anywhere]', page.path), el('p', 'type-meta text-foreground-secondary', page.title || 'No title'));
  const close = el('button', `${CONTROL} -mr-1 -mt-1 shrink-0`);
  close.type = 'button';
  close.setAttribute('aria-label', 'Close the card');
  close.append(icon('x', 'size-icon-sm'));
  close.addEventListener('click', actions.letGo);
  head.append(words, close);
  const tier = el('p', 'flex items-center gap-1.5 type-meta text-foreground');
  tier.append(swatch(group), tierLabel(tierIdOf(page)));
  const direction = (tokenName, count, word) => {
    const row = el('p', 'flex items-center gap-1.5 type-meta text-foreground');
    const mark = el('span', 'h-0.5 w-4 shrink-0 rounded-full');
    mark.style.background = token(tokenName);
    row.append(mark, el('span', 'num', number(count)), el('span', 'text-foreground-secondary', word));
    return row;
  };
  const facts = el('div', 'flex flex-col gap-1');
  facts.append(tier, direction(IN_TOKEN, node.in, node.in === 1 ? 'page links to it' : 'pages link to it'), direction(OUT_TOKEN, node.out, node.out === 1 ? 'page it links to' : 'pages it links to'));
  if (node.sitewide > 0) facts.append(el('p', 'type-meta text-foreground-secondary', `In the menu or footer of ${number(node.sitewide)} pages (not drawn).`));
  const details = el('button', `${BUTTON_SM} ${FOCUS_RING}`, 'Page details');
  details.type = 'button';
  details.addEventListener('click', () => openInspector(node.id));
  const journey = el('button', `${BUTTON_SM} ${FOCUS_RING}`);
  journey.type = 'button';
  journey.append(icon('workflow', 'size-icon-sm text-foreground-tertiary'), el('span', '', 'Open in Journey'));
  journey.addEventListener('click', () => setFocus(node.id));
  const foot = el('div', 'flex flex-wrap gap-2');
  foot.append(details, journey);
  card.replaceChildren(head, facts, foot);
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
  const actions = {};
  const panel = el('section', `flex flex-col overflow-hidden border-border bg-surface ${maximised ? 'fixed inset-0 z-(--z-inspector)' : 'rounded-lg border'}`);
  panel.setAttribute('aria-label', 'Link map');
  const stage = el('div', `relative isolate min-h-0 bg-surface-subtle ${maximised ? 'flex-1' : 'h-[max(32rem,calc(100dvh-19rem))]'}`);
  const canvas = el('div', 'absolute inset-0');
  canvas.setAttribute('role', 'img');
  stage.append(canvas);
  const bar = toolbar(actions);
  panel.append(bar, stage);
  host.append(panel);

  // A canvas taller than wide gets the block of unlinked pages under the map, not beside it
  const isBelow = () => canvas.clientWidth < canvas.clientHeight;
  const data = model(isBelow());
  if (data.graph.nodes.length === 0) {
    maximised = false;
    panel.replaceWith(el('p', 'rounded-lg border border-border bg-surface px-4 py-10 text-center type-body text-foreground-secondary', 'This crawl found no live page, so there is nothing to map yet.'));
    return;
  }
  canvas.setAttribute('aria-label', `Map of internal links. ${sentence(data)} The Pages tab lists every page with its links.`);
  bar.after(legend(data), el('p', 'border-b border-border-subtle px-3 py-2 type-meta text-foreground-secondary', sentence(data)));

  chart = echarts.init(canvas);
  // The series is replaced whole (so a view without a centre is the fitted one); the tooltip is kept, because a
  // repaint under the pointer must not take a tooltip that is about to show
  const paint = () => chart.setOption(option(data, chart.getWidth(), chart.getHeight()), { replaceMerge: ['series'] });

  const card = el('aside', 'absolute left-3 top-3 flex w-72 max-w-[calc(100%-1.5rem)] flex-col gap-2.5 rounded-lg border border-border bg-surface-elevated p-3 shadow-popover');
  card.setAttribute('aria-label', 'Selected page');
  stage.append(card);

  /** After the search, the highlight or the selection changed: the map, the card and the count follow. */
  const changed = () => {
    const focus = focusOf(data);
    actions.found(focus.searching ? `${number(focus.lit.size)} of ${plural(data.graph.nodes.length, 'page')}` : '');
    fillCard(card, data, actions);
    paint();
  };
  actions.changed = changed;
  actions.letGo = () => {
    m().selected = null;
    changed();
  };
  // Brings the lit pages into view: one page is selected, several are framed together
  actions.zoomToLit = () => {
    const focus = focusOf(data);
    if (!focus.lit || focus.lit.size === 0) return;
    const spots = [...focus.lit].map((id) => moved.get(id) ?? data.layout.positions.get(id));
    const all = [...data.layout.positions.values()];
    const span = (list, axis) => Math.max(...list.map((point) => point[axis])) - Math.min(...list.map((point) => point[axis]));
    const middle = (axis) => (Math.max(...spots.map((point) => point[axis])) + Math.min(...spots.map((point) => point[axis]))) / 2;
    const zoom = Math.min(span(all, 0) / (span(spots, 0) + 160), span(all, 1) / (span(spots, 1) + 160), 4);
    view = { zoom: Math.max(1, zoom), center: [middle(0), middle(1)] };
    if (focus.lit.size === 1) [m().selected] = focus.lit;
    changed();
    sync();
  };

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
  const helpBox = helpPanel();
  const showHelp = (open) => {
    helpBox.style.display = open ? '' : 'none';
    helpButton.setAttribute('aria-expanded', String(open));
    helpButton.setAttribute('aria-pressed', String(open));
  };
  const helpButton = control('circle-help', 'Reading the map', () => showHelp(helpBox.style.display === 'none'));
  showHelp(false);
  function sync() {
    percent.textContent = `${Math.round(view.zoom * 100)}%`;
    zoomOut.disabled = view.zoom <= ZOOM.min + 0.001;
    zoomIn.disabled = view.zoom >= ZOOM.max - 0.001;
    mapButton.setAttribute('aria-pressed', String(m().minimap));
  }
  const controls = el('div', 'absolute bottom-3 left-3 flex items-center gap-0.5 rounded-md border border-border bg-surface-elevated p-0.5 shadow-popover');
  controls.append(zoomOut, percent, zoomIn, el('span', 'mx-0.5 h-4 w-px bg-border'), control('scan', 'Fit everything', fit), mapButton, helpButton);
  stage.append(helpBox, controls);

  chart.on('graphroam', () => {
    const series = chart.getOption().series[0];
    const before = [minimapShown(), blockNamed()];
    view = { zoom: series.zoom, center: series.center ?? null };
    // The minimap and the names in the block come and go with the zoom
    if (minimapShown() !== before[0] || blockNamed() !== before[1]) paint();
    sync();
  });
  // A drag ends in a click too: only a press and release on the same spot selects
  let pressed = null;
  let held = null;
  const still = (event) => pressed && Math.hypot(event.offsetX - pressed[0], event.offsetY - pressed[1]) <= 4;
  chart.getZr().on('mousedown', (event) => {
    pressed = [event.offsetX, event.offsetY];
  });
  chart.on('mousedown', (params) => {
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
    if (params.dataType !== 'node' || params.name.startsWith(HEADER) || !still(params.event)) return;
    m().selected = m().selected === params.name ? null : params.name;
    changed();
  });
  // A click on the background lets the selected page go
  chart.getZr().on('click', (event) => {
    if (!event.target && m().selected && still(event)) actions.letGo();
  });

  const resizer = new ResizeObserver(() => {
    // The block of unlinked pages changes sides when the canvas turns from wide to tall
    if (isBelow() !== data.below) {
      moved.clear();
      refresh();
      return;
    }
    chart.resize();
    paint();
  });
  resizer.observe(canvas);
  // The colours are read from the theme: a theme switch repaints
  const theme = new MutationObserver(changed);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  const leftFull = () => {
    if (!document.fullscreenElement && maximised) {
      maximised = false;
      refresh();
    }
  };
  document.addEventListener('fullscreenchange', leftFull);
  // Escape lets the selected page go first, then leaves full screen where the browser's own is not in use;
  // an open inspector or menu takes it before either
  const onEscape = (event) => {
    if (event.key !== 'Escape' || state.open || popoverOpen()) return;
    if (helpBox.style.display !== 'none') showHelp(false);
    else if (m().selected) actions.letGo();
    else if (maximised && !document.fullscreenElement) {
      maximised = false;
      refresh();
    }
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
  changed();
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
  const { graph } = model(false);
  return [
    ['Page', 'Title', 'Tier', 'Links in', 'Links out', 'On the map', 'Menu or footer links from (pages)'],
    ...graph.nodes.map((node) => {
      const page = pageById(node.id);
      return [page.path, page.title, tierLabel(tierIdOf(page)), node.in, node.out, node.in + node.out > 0 ? 'Linked' : 'No link in or out', node.sitewide];
    }),
  ];
}
