/* global CSS, ResizeObserver, document, window, requestAnimationFrame, setTimeout, performance */
/**
 * Internal links, Journey tab (spec 7.5): the link journey as a canvas of cards, as a tree list and as a path finder. All share
 * state.journey. Which cards and rows exist is decided in il-journey-layout.js; this file draws them.
 */
import { el } from './prompts-parts.js';
import { BUTTON_SM, FIELD, icon, popover, segmented, selectField, toast } from './perf-ui.js';
import {
  PLACEMENT_LABEL, SCOPE_WORD, activePages, depthWithoutAuto, findPaths, flags, ins, isLive, outs, pageById, plural, refresh, routeFromHome, scopeOf,
  setFocus, setTier, suggestedLinks, state, statusBadge, tierBadge, tierBg, tierCode, tierEdge, tierIdOf, tierLabel, tierPosition, tiers,
} from './il-model.js';
import { openInspector } from './il-drawer.js';
import { HOST } from './il-data.js';
import { MAX_K, MIN_K, createMinimap, createViewport } from './il-canvas.js';
import { MAX_CARDS, backsOf, buildJourney, canOpen, depthText, linksOf, markerScope, treeRows } from './il-journey-layout.js';

const CANVAS_LABEL = 'Link journey canvas. The tree list shows the same journey as a table.';
const GROUP_LABEL = { auto: 'Previous, next and related', template: 'Menu and footer' };
const ICON_BUTTON = 'flex size-6 items-center justify-center rounded-sm border border-border bg-surface text-foreground-secondary hover:bg-surface-hover hover:text-foreground';
const SMALL_BUTTON = 'h-badge px-1.5 rounded-sm border border-border bg-surface type-label text-foreground-secondary hover:bg-surface-hover flex items-center gap-1 whitespace-nowrap';
const BACK_BUTTON = 'absolute bottom-2 right-2.5 flex items-center gap-1 rounded-sm px-1 type-label text-primary-text hover:underline aria-pressed:bg-primary-subtle whitespace-nowrap';
const BOTH_BADGE = 'inline-flex h-badge items-center rounded-sm bg-primary-subtle px-1.5 type-label text-primary-text whitespace-nowrap';
const FOCUS_RING = 'focus-visible:focus-ring';

let zoom = 1;
let active = null;
let hoverLoop = null;
// Key of the card under the pointer or keyboard focus; its path to the focus page is lit
let hoverKey = null;
let tip = null;
// Key of the card whose info panel the user opened with its "i" button; it stays until a click elsewhere, Escape or a pan
let pinnedTip = null;
// Cards the user selected on the canvas (keys), and where the user moved cards, kept for the session
const selection = new Set();
const offsets = new Map();
// Whether the minimap is shown; it is off until asked for, because it sits over the cards and few journeys need it
let minimapOn = false;
// The last view of the canvas, so a re-render of the same journey does not jump
let savedView = null;
// A data-restore value to focus after the next render (the control that caused it was rebuilt)
let restore = null;

const j = () => state.journey;
const live = (node) => node?.isConnected;

// -------------------------------------------------------------------------------------------------
// Tooltip (house look: a floating panel beside the card, fixed so scrolling the canvas does not clip it)

function hideTip() {
  tip?.remove();
  tip = null;
  pinnedTip = null;
}

function showTip(anchor, rows, title, subtitle) {
  hideTip();
  tip = el('div', 'fixed z-(--z-dialog) w-72 pointer-events-none rounded-lg border border-border bg-surface-elevated p-3 shadow-popover type-meta text-foreground-secondary');
  tip.setAttribute('role', 'tooltip');
  tip.append(el('p', 'type-table text-foreground break-all', title));
  if (subtitle) tip.append(el('p', 'type-meta text-foreground-tertiary', subtitle));
  const list = el('dl', 'mt-2 grid grid-cols-2 gap-x-3 gap-y-1');
  rows.forEach(([label, value]) => list.append(el('dt', 'text-foreground-tertiary', label), el('dd', 'text-foreground num', value)));
  tip.append(list);
  document.body.append(tip);
  const box = anchor.getBoundingClientRect();
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  const left = box.right + 10 + width > window.innerWidth ? Math.max(8, box.left - width - 10) : box.right + 10;
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(8, Math.min(box.top, window.innerHeight - height - 8))}px`;
}

function cardTip(node, item) {
  const page = pageById(item.id);
  const edge = item.edge;
  const rows = [
    ['Tier', tierLabel(tierIdOf(page))],
    ['Status', page.redirect ? `301 to ${pageById(page.redirect).path}` : String(page.status)],
    ['Depth from home', depthText(item.id)],
    ['Without previous and next', depthWithoutAuto[item.id] === undefined ? 'Not reachable' : String(depthWithoutAuto[item.id])],
    ['Linking pages, editorial', String(ins(item.id, 'editorial').length)],
    ['Linking pages, all', String(ins(item.id, 'all').length)],
  ];
  if (edge) rows.push(['This link', `${PLACEMENT_LABEL[edge.placement]}, ${edge.rel}`]);
  showTip(node, rows, page.path, page.title);
}

function loopTip(node, key) {
  const info = active?.loops.get(key);
  if (!info) return;
  const body = info.backs.map((back) => `${tierCode(tierIdOf(pageById(back.id)))} ${pageById(back.id).path}: "${back.link.anchor}", ${SCOPE_WORD[scopeOf(back.link)]}`);
  showTip(node, body.map((text, index) => [String(index + 1), text]), info.dir === 'out' ? 'Links back to earlier pages' : 'Earlier pages that link here', 'Hover shows the return arrows. Select to keep them.');
}

/** Tooltip for a link line: where it goes and what the link is (anchor text, kind, attribute). */
function edgeTip(event, path) {
  const info = active?.edgeInfo[Number(path.dataset.edge)];
  if (!info) return;
  const { link, from, to } = info;
  const rows = [['Anchor text', link.anchor ? `"${link.anchor}"` : 'None'], ['Link type', PLACEMENT_LABEL[link.placement]], ['Attribute', link.rel]];
  const target = pageById(to);
  if (target.status !== 200) rows.push(['Target', target.redirect ? '301 redirect' : String(target.status)]);
  const point = { getBoundingClientRect: () => ({ left: event.clientX, right: event.clientX, top: event.clientY }) };
  showTip(point, rows, `${pageById(from).path} to ${pageById(to).path}`, 'This link');
}

// -------------------------------------------------------------------------------------------------
// Cards

const linkedAs = (edge) => (edge ? `${scopeOf(edge) === 'editorial' ? '' : `${SCOPE_WORD[scopeOf(edge)]}: `}${edge.anchor}` : '');

/** The second line of a card: the anchor (or the title) on the left, the facts on the right (tier, links in, status, both ways). */
function subLine(item, scope, backs, both) {
  const page = pageById(item.id);
  // Room for the back-link marker, which sits in the bottom right corner
  const line = el('span', `flex min-w-0 items-center gap-2 ${backs.length === 0 ? '' : 'pr-10'}`);
  const facts = el('span', 'flex shrink-0 items-center gap-1.5 type-meta text-foreground-tertiary');
  facts.append(el('span', 'text-foreground-secondary', tierCode(tierIdOf(page))), el('span', 'num', `${ins(item.id, scope).length} in`));
  if (page.status !== 200) facts.append(statusBadge(page));
  if (both) {
    // Icon only on the canvas, to leave the anchor its width; the card's name and the tip say it in words
    const mark = el('span', `${BOTH_BADGE} px-1`);
    mark.dataset.tip = 'Links both ways';
    mark.append(icon('arrow-left-right', 'size-icon-xs'));
    facts.append(mark);
  }
  line.append(el('span', 'min-w-0 flex-1 truncate type-label text-foreground-secondary', item.edge ? linkedAs(item.edge) : page.title), facts);
  return line;
}

function cardButton(item, scope, ctx) {
  const page = pageById(item.id);
  const isFocus = item.key === 'f';
  const backs = isFocus ? [] : backsOf(item, scope);
  if (backs.length > 0) ctx.loops.set(item.key, { dir: item.dir, backs });
  const both = !isFocus && backs.some((back) => back.id === item.path[item.path.length - 2]);
  const openable = !isFocus && !item.last && canOpen(item);
  const isOpen = j().opened.has(item.key);
  const look = isFocus ? 'border-2 border-primary' : 'border-border-strong';
  const node = el('button', `node relative w-full text-left rounded-md border border-l-4 ${tierEdge(tierIdOf(page))} ${look} ${isOpen ? 'bg-primary-subtle' : 'bg-surface hover:bg-surface-hover'} ${isFocus ? 'px-3 py-2' : 'px-2.5 py-1.5'} flex flex-col ${FOCUS_RING}`);
  node.type = 'button';
  Object.assign(node.dataset, { key: item.key, id: item.id, kind: 'card' });
  if (item.parentKey) node.dataset.parent = item.parentKey;
  if (item.dir) node.dataset.dir = item.dir;
  if (openable) node.setAttribute('aria-expanded', String(isOpen));
  node.setAttribute('aria-label', `${page.path}, ${tierLabel(tierIdOf(page))}, ${plural(ins(item.id, scope).length, 'linking page')}${item.edge ? `, linked as ${linkedAs(item.edge)}, ${PLACEMENT_LABEL[item.edge.placement].toLowerCase()}` : ', focus page'}${both ? ', links both ways' : ''}`);
  const top = el('span', 'flex items-center gap-1 min-w-0 pr-2');
  if (openable) top.append(icon(isOpen ? 'chevron-down' : 'chevron-right', 'size-icon-xs shrink-0 text-foreground-tertiary'));
  top.append(el('span', `${isFocus ? 'type-body-strong' : 'type-table'} text-foreground truncate`, page.path));
  node.append(top, subLine(item, scope, backs, both));
  if (isFocus) node.append(focusFacts(item, scope));
  return { node, backs };
}

/** The focus card's third line: how many links it has out and how far it is from the home page. */
function focusFacts(item, scope) {
  const steps = depthText(item.id);
  const where = steps === 'Not reachable' ? 'Not reachable from home' : steps === '0' ? 'This is the home page' : `${plural(Number(steps), 'click')} from home`;
  const line = el('span', 'mt-0.5 flex items-center gap-3 type-meta text-foreground-tertiary');
  line.append(el('span', 'num', `${outs(item.id, scope).length} out`), el('span', '', where));
  return line;
}

function stubButton(item) {
  const page = pageById(item.id);
  const node = el('button', `node relative w-full text-left rounded-md border border-dashed border-l-4 border-border-strong ${tierEdge(tierIdOf(page))} bg-surface px-2.5 py-1.5 flex flex-col hover:bg-surface-hover ${FOCUS_RING}`);
  node.type = 'button';
  Object.assign(node.dataset, { key: item.key, id: item.id, kind: 'stub', parent: item.parentKey, dir: item.dir });
  node.setAttribute('aria-label', `${page.path}, already on the canvas at ${item.at}. Select to find it.`);
  const sub = el('span', 'flex min-w-0 items-center gap-2');
  sub.append(el('span', 'min-w-0 flex-1 truncate type-label text-foreground-secondary', linkedAs(item.edge)), el('span', 'shrink-0 type-meta text-foreground-tertiary', `Also at ${item.at}`));
  node.append(el('span', 'type-table text-foreground truncate', page.path), sub);
  return node;
}

function groupButton(item) {
  const node = el('button', `node relative w-full text-left rounded-md border border-border-strong bg-surface-subtle px-2.5 py-1.5 flex flex-col hover:bg-surface-hover ${FOCUS_RING}`);
  node.type = 'button';
  Object.assign(node.dataset, { key: item.key, kind: 'group', parent: item.parentKey, dir: item.dir, scope: item.scope });
  node.setAttribute('aria-expanded', String(item.open));
  const label = item.scope === 'both' ? `Both ways: ${plural(item.count, 'page')}` : `${GROUP_LABEL[item.scope]}: ${plural(item.count, 'link')}`;
  const meta = item.scope === 'both' ? 'Also shown on the right, marked with a two-way arrow' : item.open ? 'Shown as cards. Select to hide.' : 'Select to show them as cards.';
  node.append(el('span', 'flex items-center gap-1'), el('span', 'type-meta text-foreground-tertiary', meta));
  node.firstChild.append(icon(item.open ? 'chevron-down' : 'chevron-right', 'size-icon-xs shrink-0 text-foreground-tertiary'), el('span', 'type-label text-foreground', label));
  node.setAttribute('aria-label', `${label}. ${meta}`);
  return node;
}

/** A link to the live page, in a new tab. As a card tool it is an icon; in the info panel it carries a label. */
function visitLink(id, className, withLabel) {
  const page = pageById(id);
  const link = el('a', className);
  link.href = `https://${HOST}${page.path}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.dataset.tip = `Visit ${page.path} in a new tab`;
  link.setAttribute('aria-label', `Visit ${page.path} in a new tab`);
  link.append(icon('external-link', 'size-icon-xs'));
  if (withLabel) link.append(el('span', '', 'Visit page'));
  return link;
}

function toolButton(name, label, data) {
  const button = el('button', `${ICON_BUTTON} ${FOCUS_RING}`);
  button.type = 'button';
  Object.assign(button.dataset, data, { tip: label });
  button.setAttribute('aria-label', label);
  button.append(icon(name, 'size-icon-xs'));
  return button;
}

/** One card: the main button, a hover toolbar (Focus, Details) and the back-link marker, all siblings. */
function cardWrap(item, scope, ctx) {
  const { node, backs } = cardButton(item, scope, ctx);
  const path = pageById(item.id).path;
  const wrap = el('div', 'relative group');
  const tools = el('div', 'absolute right-1 top-1 flex gap-0.5 rounded-sm bg-surface opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100');
  if (item.key !== 'f') tools.append(toolButton('crosshair', `Make ${path} the focus`, { focusId: item.id }));
  tools.append(toolButton('info', `Info about ${path}`, { info: item.key }), toolButton('panel-right-open', `Details of ${path}`, { details: item.id }), visitLink(item.id, `${ICON_BUTTON} ${FOCUS_RING}`, false));
  if (item.key === 'f') {
    // A soft halo behind the focus card, so it reads as the centre of the canvas at any zoom
    const halo = el('span', 'pointer-events-none absolute -inset-1.5 rounded-lg');
    halo.style.background = 'color-mix(in srgb, var(--color-primary) 14%, transparent)';
    wrap.append(halo);
  }
  wrap.append(node, tools);
  if (backs.length > 0) {
    const loop = el('button', `${BACK_BUTTON} ${FOCUS_RING}`);
    loop.type = 'button';
    loop.dataset.loop = item.key;
    loop.setAttribute('aria-pressed', String(j().pinned.has(item.key)));
    // Icon and count only, so the card's text keeps its width; the full words are the name and the tip
    const words = item.dir === 'out' ? `Links back to ${plural(backs.length, 'earlier page')}` : `Gets links back from ${plural(backs.length, 'earlier page')}`;
    loop.setAttribute('aria-label', words);
    loop.dataset.tip = words;
    loop.append(icon('corner-up-left', 'size-icon-xs'), el('span', 'num', String(backs.length)));
    wrap.append(loop);
  }
  return wrap;
}

// -------------------------------------------------------------------------------------------------
// Edges

function edgeLook(link, targetId) {
  const scope = scopeOf(link);
  const status = targetId ? pageById(targetId).status : 200;
  let colour = scope === 'editorial' ? 'var(--color-foreground-tertiary)' : 'var(--color-border-strong)';
  if (status === 301) colour = 'var(--color-warning-text)';
  if (status >= 400) colour = 'var(--color-negative-text)';
  const dash = scope === 'auto' ? ' stroke-dasharray="2 4"' : scope === 'template' ? ' stroke-dasharray="6 4"' : '';
  return { colour, dash };
}

// Position inside the canvas in unscaled pixels (cards sit in positioned wrappers, so offsetLeft would be relative to those)
function boxIn(inner, node) {
  const origin = inner.getBoundingClientRect();
  const rect = node.getBoundingClientRect();
  const left = (rect.left - origin.left) / zoom;
  const top = (rect.top - origin.top) / zoom;
  const width = rect.width / zoom;
  const height = rect.height / zoom;
  return { l: left, r: left + width, m: top + height / 2, b: top + height, c: left + width / 2 };
}

/**
 * A smooth S curve from the right edge of the source to the left edge of the target, leaving and arriving level.
 * Each link has its own curve, so a card with many links fans out and every line can be told apart (a shared
 * vertical spine drew them on top of each other).
 */
function curve(from, to) {
  const reach = Math.max(48, Math.abs(to.l - from.r) * 0.5);
  return `M${from.r},${from.m} C${from.r + reach},${from.m} ${to.l - reach},${to.m} ${to.l},${to.m}`;
}

// One arrowhead per line colour, drawn at the target end so every line points the way the link goes
const HEADS = {
  'var(--color-foreground-tertiary)': 'il-head-editorial',
  'var(--color-border-strong)': 'il-head-menu',
  'var(--color-warning-text)': 'il-head-redirect',
  'var(--color-negative-text)': 'il-head-broken',
  'var(--color-positive-text)': 'il-head-up',
  'var(--color-info-text)': 'il-head-down',
};
const FLOW_UP = 'var(--color-positive-text)';
const FLOW_DOWN = 'var(--color-info-text)';
const headDefs = () => Object.entries(HEADS).map(([colour, id]) => `<marker id="${id}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 1.5L10 5L1 8.5z" style="fill: ${colour}"/></marker>`).join('');

/** Keys of the hovered card, the cards on its path back to the focus page, and its direct children; null when nothing is hovered. */
function litKeys() {
  if (!active || !hoverKey || hoverKey === 'f') return null;
  const item = active.items.get(hoverKey);
  if (!item?.keys) return null;
  const set = new Set(item.keys);
  active.inner.querySelectorAll(`button.node[data-parent="${CSS.escape(hoverKey)}"]`).forEach((child) => set.add(child.dataset.key));
  return set;
}

/** Tier of a page as a lane number: 1 is T1, a larger number is a lower tier, 99 is Untiered. */
const lanePos = (id) => tierPosition(tierIdOf(pageById(id))) || 99;

/**
 * The path of one line between two card boxes. Normally it leaves the right edge of the source and enters the left edge of
 * the target. A target in a lane to the left (a link down a tier) is entered from its right edge, and a target in the same
 * lane is reached around the right gutter, so a line never crosses the cards it passes.
 */
function route(from, to) {
  if (to.l >= from.r - 1) return { d: curve(from, to), sx: from.r, sy: from.m };
  if (to.r <= from.l + 1) {
    const reach = Math.max(48, Math.abs(from.l - to.r) * 0.5);
    return { d: `M${from.l},${from.m} C${from.l - reach},${from.m} ${to.r + reach},${to.m} ${to.r},${to.m}`, sx: from.l, sy: from.m };
  }
  // Lines to different cards in the lane swing out by different amounts, so they do not share one vertical stretch
  const bulge = Math.min(96, 28 + Math.abs(to.m - from.m) * 0.12);
  return { d: `M${from.r},${from.m} C${from.r + bulge},${from.m} ${to.r + bulge},${to.m} ${to.r},${to.m}`, sx: from.r, sy: from.m };
}

/** The lines to draw: every link between a card and its parent (By step), or the links collected for the lanes (By tier). */
function edgeSpecs(byKey) {
  const { inner, items } = active;
  const specs = [];
  if (active.tierEdges) {
    active.tierEdges.forEach((edge) => {
      const fromNode = byKey(edge.from);
      const toNode = byKey(edge.to);
      if (fromNode && toNode) specs.push({ ...edge, fromNode, toNode, fromKey: edge.from, toKey: edge.to });
    });
    return specs;
  }
  inner.querySelectorAll('button.node[data-parent]').forEach((node) => {
    const parent = byKey(node.dataset.parent);
    if (!parent) return;
    const isIn = node.dataset.dir === 'in';
    const item = items.get(node.dataset.key);
    const link = item?.edge ?? { placement: node.dataset.scope === 'auto' ? 'auto_generated' : node.dataset.scope === 'both' ? 'content' : 'navigation' };
    const [fromNode, toNode] = isIn ? [node, parent] : [parent, node];
    specs.push({ fromNode, toNode, fromKey: fromNode.dataset.key, toKey: toNode.dataset.key, link, fromId: fromNode.dataset.id, toId: toNode.dataset.id, real: Boolean(item?.edge) });
  });
  return specs;
}

function drawEdges() {
  if (!active || !live(active.inner)) return;
  const { inner, svg, loops } = active;
  const byKey = (key) => inner.querySelector(`button.node[data-key="${CSS.escape(key)}"]`);
  svg.setAttribute('width', String(inner.scrollWidth));
  svg.setAttribute('height', String(inner.scrollHeight));
  const edges = [];
  const hits = [];
  const lit = litKeys();
  const byTier = Boolean(active.tierEdges);
  active.edgeInfo = [];
  let paths = `<defs>${headDefs()}<marker id="il-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1L9 5L1 9z" style="fill: var(--color-primary)"/></marker></defs>`;
  edgeSpecs(byKey).forEach((spec) => {
    const from = boxIn(inner, spec.fromNode);
    const to = boxIn(inner, spec.toNode);
    let { colour, dash } = edgeLook(spec.link, spec.real ? spec.toId : null);
    const status = spec.real ? pageById(spec.toId).status : 200;
    if (byTier && spec.real && status === 200) {
      // By tier the colour says which way the link flows: up toward T1, down to a lower tier, or sideways
      const [a, b] = [lanePos(spec.fromId), lanePos(spec.toId)];
      colour = a > b ? FLOW_UP : a < b ? FLOW_DOWN : 'var(--color-foreground-tertiary)';
      if (a === b && !dash) dash = ' stroke-dasharray="4 4"';
    }
    // Template and auto edges first, editorial next, redirect and broken last, so a colour shows on its own last segment
    const rank = status === 301 || status >= 400 ? 2 : scopeOf(spec.link) === 'editorial' ? 1 : 0;
    // While a card is hovered, the path from the focus page to it stays bold and the rest fades
    const onPath = !lit || (lit.has(spec.fromKey) && lit.has(spec.toKey));
    const { d, sx, sy } = route(from, to);
    const look = `opacity: ${onPath ? 1 : 0.15}`;
    // The line, an arrowhead at the target and a small dot where it leaves the source
    edges.push({ rank, markup: `<path d="${d}" fill="none" stroke-width="${lit && onPath ? 2.5 : 1.5}"${dash} marker-end="url(#${HEADS[colour]})" style="stroke: ${colour}; ${look}"/><circle cx="${sx}" cy="${sy}" r="2.5" style="fill: ${colour}; ${look}"/>` });
    if (spec.real) {
      // A wide invisible stroke on top, so a thin line can be hovered for its anchor text
      hits.push(`<path data-edge="${active.edgeInfo.length}" d="${d}" fill="none" stroke="transparent" stroke-width="14" style="pointer-events: stroke"/>`);
      active.edgeInfo.push({ link: spec.link, from: spec.fromId, to: spec.toId });
    }
  });
  paths += edges.sort((x, y) => x.rank - y.rank).map((edge) => edge.markup).join('') + hits.join('');
  inner.querySelectorAll('button.node.outline-dashed').forEach((node) => node.classList.remove('outline-2', 'outline-dashed', 'outline-primary', 'outline-offset-2'));
  const shown = new Set(j().pinned);
  if (hoverLoop) shown.add(hoverLoop);
  shown.forEach((key) => {
    const info = loops.get(key);
    const node = byKey(key);
    if (!info || !node) return;
    const a = boxIn(inner, node);
    info.backs.forEach((back) => {
      const target = byKey(back.key);
      if (!target) return;
      target.classList.add('outline-2', 'outline-dashed', 'outline-primary', 'outline-offset-2');
      const b = boxIn(inner, target);
      const from = info.dir === 'out' ? a : b;
      const to = info.dir === 'out' ? b : a;
      const y = Math.max(from.b, to.b) + 40;
      paths += `<path d="M${from.c},${from.b} C${from.c},${y} ${to.c},${y} ${to.c},${to.b + 3}" fill="none" stroke-width="1.5" stroke-dasharray="6 4" marker-end="url(#il-arrow)" style="stroke: var(--color-primary)"/>`;
    });
  });
  svg.innerHTML = paths;
}

// -------------------------------------------------------------------------------------------------
// Canvas

function focusNote(scope) {
  const id = j().focus;
  const page = pageById(id);
  const editorial = ins(id, 'editorial').length;
  const box = el('div', 'flex flex-col gap-1 bg-surface-subtle');
  const route = routeFromHome(id);
  const line = el('div', 'flex flex-wrap items-center gap-x-1 gap-y-0.5 type-meta text-foreground-tertiary');
  if (!route) line.append('Not reachable from the home page.');
  else if (route.length === 1) line.append('This is the home page.');
  else {
    line.append(el('span', '', 'Route from home'));
    route.forEach((step, index) => {
      line.append(icon('chevron-right', 'size-icon-xs shrink-0'));
      const path = pageById(step.id).path;
      if (index === route.length - 1) line.append(el('span', 'text-foreground', path));
      else {
        const button = el('button', `rounded-sm px-0.5 text-link hover:underline ${FOCUS_RING}`, path);
        button.type = 'button';
        button.dataset.focusId = step.id;
        line.append(button);
      }
    });
    line.append(el('span', 'num ml-1 text-foreground-tertiary', plural(route.length - 1, 'click')));
  }
  box.append(line);
  const suggested = suggestedLinks(id, 50).length;
  if (suggested > 0) {
    const button = el('button', `${SMALL_BUTTON} self-start ${FOCUS_RING}`, `Suggested links: ${suggested}`);
    button.type = 'button';
    button.dataset.details = id;
    box.append(button);
  }
  const lines = [];
  if (isLive(page)) lines.push(`${plural(editorial, 'editorial link')} in.`);
  if (page.status >= 400) lines.push('Not found: this page has no links out.');
  else if (page.redirect) lines.push('Redirect: it passes visitors to its target.');
  if (flags(page).some((flag) => flag.key === 'orphan')) lines.push('Orphan: no page links here.');
  else if (flags(page).some((flag) => flag.key === 'editorialOrphan')) lines.push(`Editorial orphan: no editorial links in.${scope === 'editorial' ? ' Choose All links to see the menu and automatic links that reach it.' : ''}`);
  else if (linksOf(id, 'out', 'all').length === 0 && page.status < 400) lines.push('This page has no links out.');
  if (lines.length > 0) box.append(el('p', 'type-meta text-foreground-tertiary', lines.join(' ')));
  return box;
}

function column(label, nodes, focus = false) {
  const col = el('div', `flex ${focus ? 'w-72' : 'w-60'} shrink-0 flex-col gap-1.5`);
  const heading = focus
    ? el('h3', 'inline-flex h-badge w-fit items-center rounded-sm bg-primary-subtle px-1.5 type-label text-primary-text', label)
    : el('h3', 'w-fit bg-surface-subtle pr-1 type-label text-foreground-tertiary', label);
  col.append(heading, ...nodes);
  return col;
}

const MENU_ROW = 'flex h-row-compact w-full items-center gap-2 rounded-sm px-2 text-left hover:bg-surface-hover';
const CONTROL = 'flex size-7 items-center justify-center rounded-sm text-foreground-secondary hover:bg-surface-hover disabled:text-foreground-disabled disabled:hover:bg-transparent';
const SHORTCUTS = [
  ['Drag the background, or scroll', 'Pan'],
  ['Pinch, or Ctrl or Cmd and scroll', 'Zoom toward the cursor'],
  ['Shift and drag', 'Select several cards'],
  ['Shift or Cmd and click', 'Add a card to the selection'],
  ['Drag a card', 'Move it (kept for this page)'],
  ['Click a card', 'Show or hide its links'],
  ['Arrow keys', 'Move between cards'],
  ['F', 'Make the focused card the focus page'],
  ['+ and -', 'Zoom'],
  ['0 and 1', 'Fit everything, or 100%'],
  ['Home', 'Centre on the focus page'],
];

const keyed = (inner, key) => inner.querySelector(`button.node[data-key="${CSS.escape(key)}"]`);
const movable = (node) => (node.parentElement?.classList.contains('group') ? node.parentElement : node);
const nodeOf = (target) => target.closest?.('button.node') ?? target.closest?.('.group')?.querySelector('button.node') ?? null;
const offsetPrefix = () => `${j().focus}|${j().cards}|${j().layout}|`;
const offsetKey = (key) => `${offsetPrefix()}${key}`;
const hasOffsets = () => [...offsets.keys()].some((key) => key.startsWith(offsetPrefix()));

function menuRow(panel, api, label, run) {
  const node = el('button', `${MENU_ROW} ${FOCUS_RING}`, label);
  node.type = 'button';
  node.setAttribute('role', 'menuitem');
  node.addEventListener('click', () => {
    api.close();
    run();
  });
  panel.append(node);
}

function buildCanvas() {
  const scope = markerScope(j().cards);
  const stage = el('div', 'relative isolate overflow-hidden bg-surface-subtle');
  stage.style.height = '560px'; // until fitHeight() has measured the window
  const scroller = el('div', `absolute inset-0 touch-none select-none outline-none ${FOCUS_RING}`);
  scroller.tabIndex = 0;
  scroller.setAttribute('role', 'group');
  scroller.setAttribute('aria-label', CANVAS_LABEL);
  scroller.style.cursor = 'grab';
  scroller.style.backgroundImage = 'radial-gradient(circle, color-mix(in srgb, var(--color-border-strong) 35%, transparent) 1px, transparent 1.2px)';
  const inner = el('div', 'relative flex w-max items-start gap-28 p-4');
  inner.style.transformOrigin = '0 0';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'pointer-events-none absolute left-0 top-0 overflow-visible');
  svg.setAttribute('aria-hidden', 'true');
  scroller.append(inner);
  stage.append(scroller);
  const ctx = { stage, scroller, inner, svg, items: new Map(), loops: new Map(), graph: null, edgeInfo: [], boxes: [], bounds: { l: 0, t: 0, r: 1, b: 1 } };

  const viewport = createViewport({
    host: scroller,
    content: inner,
    canPan: (event) => event.button === 0 && !event.shiftKey && !event.target.closest('button'),
    onView: (view) => {
      zoom = view.k;
      savedView = { focus: j().focus, cards: j().cards, layout: j().layout, x: view.x, y: view.y, k: view.k };
      minimap.update();
      syncControls();
      hideTip();
    },
  });
  const minimap = createMinimap(viewport);
  let suppress = false;
  let edgeFrame = 0;

  // ---- Geometry helpers (world pixels)
  const nodeBox = (node) => {
    const b = boxIn(inner, node);
    return { l: b.l, r: b.r, t: 2 * b.m - b.b, b: b.b };
  };
  const unionOf = (boxes) => boxes.reduce((all, box) => ({ l: Math.min(all.l, box.l), t: Math.min(all.t, box.t), r: Math.max(all.r, box.r), b: Math.max(all.b, box.b) }));
  function refreshBoxes() {
    const boxes = [...inner.querySelectorAll('button.node')].map((node) => ({ ...nodeBox(node), focus: node.dataset.key === 'f', key: node.dataset.key }));
    ctx.boxes = boxes;
    if (boxes.length > 0) ctx.bounds = unionOf(boxes);
    minimap.setBoxes(boxes);
    syncControls();
  }
  function scheduleEdges() {
    if (edgeFrame) return;
    edgeFrame = requestAnimationFrame(() => {
      edgeFrame = 0;
      if (!live(inner)) return;
      refreshBoxes();
      drawEdges();
    });
  }
  function bringIntoView(boxes, ms = 220) {
    const target = viewport.visibleTarget(unionOf(boxes), 40);
    if (target) viewport.animate(target, ms);
  }
  function centreOn(node, k = Math.max(viewport.v.k, 0.7)) {
    const b = nodeBox(node);
    viewport.animate(viewport.centreTarget((b.l + b.r) / 2, (b.t + b.b) / 2, k), 320);
  }
  // ---- View controls
  const fitView = () => viewport.animate(viewport.fitTarget(ctx.bounds, { pad: 56, maxK: 1 }), 320);
  const centreOnFocus = () => {
    const node = keyed(inner, 'f');
    if (node) centreOn(node);
  };
  const zoomBy = (factor) => {
    const { w, h } = viewport.size();
    viewport.animate(viewport.viewAt(w / 2, h / 2, viewport.v.k * factor), 160);
  };
  const actualSize = () => {
    const { w, h } = viewport.size();
    viewport.animate(viewport.viewAt(w / 2, h / 2, 1), 200);
  };
  function initialTarget() {
    const fitted = viewport.fitTarget(ctx.bounds, { pad: 56, maxK: 1 });
    if (j().layout === 'tier') {
      // The lanes are the point, so show as many as stay readable, with the focus lane (the last one, or near it) in view
      if (fitted.k >= 0.5) return fitted;
      return { k: 0.5, x: Math.min(56, viewport.size().w - 56 - ctx.bounds.r * 0.5), y: 56 - ctx.bounds.t * 0.5 };
    }
    if (fitted.k >= 0.7) return fitted;
    // Too big to read at once: start at a readable size on the focus page rather than on a blur of cards
    const focus = ctx.boxes.find((box) => box.focus) ?? ctx.bounds;
    return { k: 0.85, x: viewport.size().w / 2 - ((focus.l + focus.r) / 2) * 0.85, y: 56 - focus.t * 0.85 };
  }

  const control = (name, label, run) => {
    const button = el('button', `${CONTROL} ${FOCUS_RING}`);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.dataset.tip = label;
    button.append(icon(name, 'size-icon-sm'));
    button.addEventListener('click', run);
    return button;
  };
  const controls = el('div', 'absolute bottom-3 left-3 flex items-center gap-0.5 rounded-md border border-border bg-surface-elevated p-0.5 shadow-popover');
  controls.setAttribute('role', 'toolbar');
  controls.setAttribute('aria-label', 'Canvas view');
  const zoomOut = control('zoom-out', 'Zoom out', () => zoomBy(0.8));
  const zoomIn = control('zoom-in', 'Zoom in', () => zoomBy(1.25));
  const percent = el('button', `h-7 w-12 rounded-sm type-meta num text-foreground-secondary hover:bg-surface-hover ${FOCUS_RING}`);
  percent.type = 'button';
  percent.setAttribute('aria-label', 'Zoom to 100%');
  percent.dataset.tip = 'Zoom to 100%';
  percent.addEventListener('click', actualSize);
  const resetLayout = control('undo-2', 'Reset card positions', () => {
    [...offsets.keys()].filter((key) => key.startsWith(offsetPrefix())).forEach((key) => offsets.delete(key));
    paintOffsets();
    scheduleEdges();
    syncControls();
    toast({ title: 'Card positions reset', description: 'The cards are back where the layout puts them.', tone: 'success' });
  });
  const help = el('div', 'absolute bottom-14 left-3 hidden max-h-[calc(100%-5rem)] w-[28rem] max-w-[calc(100%-1.5rem)] overflow-auto rounded-lg border border-border bg-surface-elevated p-3 shadow-popover');
  help.setAttribute('role', 'region');
  help.setAttribute('aria-label', 'Legend and controls');
  const helpList = el('dl', 'grid grid-cols-[minmax(0,12rem)_1fr] gap-x-4 gap-y-1.5 type-meta');
  SHORTCUTS.forEach(([keys, what]) => helpList.append(el('dt', 'text-foreground', keys), el('dd', 'text-foreground-secondary', what)));
  help.append(el('p', 'mb-2 type-body-strong text-foreground', 'Moving around the canvas'), helpList, el('p', 'mb-2 mt-3 type-body-strong text-foreground', 'What the lines and boxes mean'), legend());
  const helpButton = control('circle-help', 'Legend and controls', () => {
    const open = help.classList.toggle('hidden') === false;
    helpButton.setAttribute('aria-expanded', String(open));
    help.classList.toggle('block', open);
  });
  helpButton.setAttribute('aria-expanded', 'false');
  const mapButton = control('square-dashed', 'Show the minimap', () => {
    minimapOn = !minimapOn;
    minimap.root.style.display = minimapOn ? '' : 'none';
    mapButton.setAttribute('aria-pressed', String(minimapOn));
    mapButton.setAttribute('aria-label', minimapOn ? 'Hide the minimap' : 'Show the minimap');
    mapButton.dataset.tip = mapButton.getAttribute('aria-label');
    mapButton.classList.toggle('bg-primary-subtle', minimapOn);
    if (minimapOn) minimap.update();
  });
  mapButton.setAttribute('aria-pressed', String(minimapOn));
  mapButton.classList.toggle('bg-primary-subtle', minimapOn);
  minimap.root.style.display = minimapOn ? '' : 'none';
  controls.append(zoomOut, percent, zoomIn, el('span', 'mx-0.5 h-4 w-px bg-border'), control('scan', 'Fit everything', fitView), control('crosshair', 'Centre on the focus page', centreOnFocus), resetLayout, mapButton, helpButton);
  function syncControls() {
    percent.textContent = `${Math.round(viewport.v.k * 100)}%`;
    zoomOut.disabled = viewport.v.k <= MIN_K + 0.001;
    zoomIn.disabled = viewport.v.k >= MAX_K - 0.001;
    resetLayout.disabled = !hasOffsets();
    const f = ctx.boxes.find((box) => box.focus);
    const { w, h } = viewport.size();
    const { x, y, k } = viewport.v;
    const seen = !f || (f.r * k + x > 0 && f.l * k + x < w && f.b * k + y > 0 && f.t * k + y < h);
    focusChip.style.display = seen ? 'none' : 'inline-flex';
  }

  // ---- A way back to the focus page whenever it is out of view
  const focusChip = el('button', `${BUTTON_SM} absolute left-3 top-3 bg-surface-elevated shadow-popover ${FOCUS_RING}`);
  focusChip.type = 'button';
  focusChip.style.display = 'none';
  focusChip.append(icon('crosshair', 'size-icon-sm text-primary-text'), el('span', '', 'Back to the focus page'));
  focusChip.addEventListener('click', centreOnFocus);

  // ---- Selection
  const bar = el('div', 'absolute left-1/2 top-3 hidden -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-surface-elevated p-1 pl-3 shadow-popover');
  const selectedIds = () => [...new Set([...selection].map((key) => ctx.items.get(key)?.id).filter(Boolean))];
  function paintSelection() {
    inner.querySelectorAll('button.node').forEach((node) => {
      node.style.boxShadow = selection.has(node.dataset.key) ? '0 0 0 2px var(--color-primary)' : '';
    });
  }
  function renderBar() {
    bar.classList.toggle('hidden', selection.size === 0);
    bar.classList.toggle('flex', selection.size > 0);
    if (selection.size === 0) {
      bar.replaceChildren();
      return;
    }
    const ids = selectedIds();
    const status = el('span', 'type-body-strong text-primary-text whitespace-nowrap', `${plural(selection.size, 'card')} selected`);
    status.setAttribute('role', 'status');
    const tier = el('button', `${BUTTON_SM} ${FOCUS_RING}`);
    tier.type = 'button';
    tier.append(icon('layers', 'size-icon-sm text-foreground-tertiary'), el('span', '', 'Set tier'));
    popover(tier, (panel, api) => {
      panel.classList.add('p-1');
      const done = (text) => {
        refresh();
        toast({ title: 'Tier set', description: text, tone: 'success' });
      };
      tiers.forEach((candidate) => menuRow(panel, api, tierLabel(candidate.id), () => {
        setTier(ids, candidate.id);
        done(`${plural(ids.length, 'page')} ${ids.length === 1 ? 'is' : 'are'} now ${tierLabel(candidate.id)}.`);
      }));
      menuRow(panel, api, 'Untiered', () => {
        setTier(ids, null);
        done(`${plural(ids.length, 'page')} ${ids.length === 1 ? 'is' : 'are'} now untiered.`);
      });
    }, { label: 'Set tier' });
    const open = el('button', `${BUTTON_SM} ${FOCUS_RING}`);
    open.type = 'button';
    open.append(icon('chevron-right', 'size-icon-sm text-foreground-tertiary'), el('span', '', 'Show their links'));
    open.addEventListener('click', () => {
      const keys = [...selection].filter((key) => ctx.items.get(key)?.kind === 'card' && key !== 'f' && canOpen(ctx.items.get(key)) && !ctx.items.get(key).last);
      if (keys.length === 0) {
        toast({ title: 'Nothing to show', description: 'The selected cards have no further links to open.', tone: 'warning' });
        return;
      }
      if (ctx.graph.cardCount >= MAX_CARDS) {
        toast({ title: 'The canvas is full', description: `It holds at most ${MAX_CARDS} cards. Close a card, or use the tree list to follow the rest.`, tone: 'warning' });
        return;
      }
      keys.forEach((key) => j().opened.add(key));
      rebuild(null);
    });
    const clear = el('button', `${BUTTON_SM} ${FOCUS_RING}`, 'Clear');
    clear.type = 'button';
    clear.addEventListener('click', clearSelection);
    bar.replaceChildren(status, tier, open, clear);
  }
  function clearSelection() {
    if (selection.size === 0) return;
    selection.clear();
    paintSelection();
    renderBar();
  }
  function toggleSelected(key) {
    if (selection.has(key)) selection.delete(key);
    else selection.add(key);
    paintSelection();
    renderBar();
  }

  // ---- Info panel: opened by a card's "i" button, closed by the button again, a click elsewhere, Escape or a pan
  function toggleCardTip(key) {
    if (pinnedTip === key) {
      hideTip();
      return;
    }
    const node = keyed(inner, key);
    const item = ctx.items.get(key);
    if (!node || !item) return;
    cardTip(node, item);
    pinnedTip = key;
    // Pinned, the panel can be used: it offers the live page in a new tab
    tip.classList.remove('pointer-events-none');
    tip.append(visitLink(item.id, 'mt-2 inline-flex h-control-sm items-center gap-1.5 rounded-md border border-border bg-surface px-2 type-body text-foreground hover:bg-surface-hover', true));
    const away = (event) => {
      if (event.target.closest?.(`[data-info="${CSS.escape(key)}"]`) || event.target.closest?.('[role=tooltip]')) return;
      hideTip();
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape, true);
    };
    // Escape closes it from anywhere, also when focus has moved away from the canvas (for example after the Visit link)
    const escape = (event) => {
      if (event.key !== 'Escape') return;
      hideTip();
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape, true);
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape, true);
  }

  // ---- Card positions (kept per focus page for the session)
  function paintOffsets() {
    inner.querySelectorAll('button.node').forEach((node) => {
      const at = offsets.get(offsetKey(node.dataset.key));
      movable(node).style.transform = at ? `translate(${at.x}px, ${at.y}px)` : '';
    });
  }

  // ---- Hover: light the path from the focus page to the hovered card
  function paintFocusMode() {
    const lit = litKeys();
    inner.querySelectorAll('button.node').forEach((node) => {
      const target = movable(node);
      target.style.transition = 'opacity 120ms';
      target.style.opacity = !lit || lit.has(node.dataset.key) ? '' : '0.5';
    });
  }

  // The canvas takes the rest of the window below its toolbar, so a tall window shows more of the journey and
  // the page does not end in an empty band. The page's bottom
  // padding stay in view. A small window keeps a usable minimum and the page scrolls.
  ctx.fitHeight = () => {
    if (!stage.isConnected) return;
    const room = window.innerHeight - stage.getBoundingClientRect().top - 24;
    stage.style.height = `${Math.max(440, Math.round(room))}px`;
  };

  // Keys of opened cards, more buttons and groups that no longer exist (the parent closed) are dropped
  function prune(graph) {
    const valid = new Set(['f']);
    [...graph.out, ...graph.in].forEach((col) => col.forEach((item) => item.key && valid.add(item.key)));
    let changed = false;
    [j().opened, j().groups, j().pinned].forEach((set) => set.forEach((key) => {
      if (!valid.has(key)) {
        set.delete(key);
        changed = true;
      }
    }));
    j().more.forEach((count, key) => {
      if (!graph.moreKeys.has(key)) {
        j().more.delete(key);
        changed = true;
      }
    });
    return changed;
  }

  const moreButton = (item) => {
    const more = el('button', `h-control-sm rounded-md border border-border bg-surface type-body-strong text-foreground hover:bg-surface-hover ${FOCUS_RING}`, `+${item.count} more`);
    more.type = 'button';
    more.dataset.more = item.moreKey;
    return more;
  };

  /**
   * By tier: one lane per tier, lowest on the left and T1 on the right, so a link that runs left to right is a link up
   * toward the money pages. A page is one card however many links reach it; every link between cards on the canvas is a
   * line. An empty lane is a finding: no page of that tier is linked in the part of the site in view.
   */
  function buildTierColumns(graph, scope, focusWrap) {
    const focus = j().focus;
    const focusLane = lanePos(focus);
    const lanes = [{ pos: 99, label: 'Untiered' }, ...tiers.slice().reverse().map((tier) => ({ pos: tierPosition(tier.id), label: tierLabel(tier.id) }))];
    const order = [];
    for (let step = 0; step < Math.max(graph.out.length, graph.in.length); step += 1) [graph.in[step], graph.out[step]].forEach((col) => col && order.push(...col));
    const inView = new Set(order.filter((item) => item.kind === 'card').map((item) => lanePos(item.id)));
    const shownLanes = lanes.filter((lane) => lane.pos === focusLane || (lane.pos === 99 ? inView.has(99) && !j().laneHide.has(99) : !j().laneHide.has(lane.pos)));
    const nodes = new Map(shownLanes.map((lane) => [lane.pos, []]));
    const counts = new Map(shownLanes.map((lane) => [lane.pos, 0]));
    const idByKey = new Map([['f', focus]]);
    const placed = new Map([[focus, 'f']]);
    const alias = new Map();
    nodes.get(focusLane).push(focusWrap);
    counts.set(focusLane, 1);
    order.forEach((item) => {
      if (item.kind !== 'card') return;
      idByKey.set(item.key, item.id);
      if (placed.has(item.id)) {
        alias.set(item.key, placed.get(item.id));
        return;
      }
      placed.set(item.id, item.key);
      const lane = nodes.get(lanePos(item.id));
      if (!lane) return;
      ctx.items.set(item.key, item);
      lane.push(cardWrap(item, scope, ctx));
      counts.set(lanePos(item.id), counts.get(lanePos(item.id)) + 1);
    });
    const resolve = (key) => alias.get(key) ?? key;
    const edges = [];
    const seen = new Set();
    const add = (from, to, link, fromId, toId, real) => {
      if (seen.has(`${from}>${to}`)) return;
      seen.add(`${from}>${to}`);
      edges.push({ from, to, link, fromId, toId, real });
    };
    order.forEach((item) => {
      const parentKey = resolve(item.parentKey ?? 'f');
      const parentId = idByKey.get(item.parentKey ?? 'f');
      if (item.kind === 'card' || item.kind === 'stub') {
        const target = item.kind === 'stub' ? placed.get(item.id) : resolve(item.key);
        if (!target) return;
        if (item.dir === 'in') add(target, parentKey, item.edge, item.id, parentId, true);
        else add(parentKey, target, item.edge, parentId, item.id, true);
      } else if (item.kind === 'group') {
        const lane = nodes.get(lanePos(parentId));
        if (!lane) return;
        ctx.items.set(item.key, item);
        lane.push(groupButton(item));
        const link = { placement: item.scope === 'auto' ? 'auto_generated' : item.scope === 'both' ? 'content' : 'navigation' };
        if (item.dir === 'in') add(item.key, parentKey, link, null, null, false);
        else add(parentKey, item.key, link, null, null, false);
      } else if (item.kind === 'more') {
        const tierOfMore = /^in:f:t(\d+)$/.exec(item.moreKey);
        const lane = nodes.get(tierOfMore ? Number(tierOfMore[1]) : lanePos(parentId));
        if (lane) lane.push(moreButton(item));
      }
    });
    ctx.tierEdges = edges;
    return shownLanes.map((lane) => {
      const mine = lane.pos === focusLane;
      const col = el('div', `flex ${mine ? 'w-72' : 'w-60'} shrink-0 flex-col gap-1.5 rounded-lg border border-dashed p-2 ${mine ? 'border-primary-border' : 'border-border'}`);
      if (mine) col.style.background = 'color-mix(in srgb, var(--color-primary) 5%, transparent)';
      const head = el('div', 'flex items-baseline gap-1.5');
      head.append(el('h3', `type-label ${mine ? 'text-primary-text' : 'text-foreground-secondary'}`, lane.label), el('span', 'num type-meta text-foreground-tertiary', plural(counts.get(lane.pos), 'page')));
      const list = nodes.get(lane.pos);
      col.append(head, ...(counts.get(lane.pos) === 0 ? [el('p', 'type-meta text-foreground-tertiary', `No ${lane.pos === 99 ? 'untiered' : lane.label.split(' ')[0]} page in view`)] : list));
      return col;
    });
  }

  // World position of every card, by key
  function snapshot() {
    const map = new Map();
    inner.querySelectorAll('button.node').forEach((node) => map.set(node.dataset.key, nodeBox(node)));
    return map;
  }

  /** Redraws the lines on every frame for `ms`, so they follow cards that are gliding to their new places. */
  function followEdges(ms) {
    const end = performance.now() + ms;
    const tick = () => {
      if (!live(inner)) return;
      drawEdges();
      if (performance.now() < end) requestAnimationFrame(tick);
      else refreshBoxes();
    };
    drawEdges();
    requestAnimationFrame(tick);
  }

  /**
   * After the cards are rebuilt: keep the card the user pressed exactly where it was on screen, let every other card glide
   * from its old place to its new one, fade the new cards in, and pan only as far as it takes to show the new links.
   * (Rebuilding moves things: a new column on the left pushes everything right, and children land between siblings.)
   */
  function settle(before, anchorKey, oldNodes) {
    const after = snapshot();
    const k = viewport.v.k;
    let ax = 0;
    let ay = 0;
    const from = anchorKey ? before.get(anchorKey) : null;
    const to = anchorKey ? after.get(anchorKey) : null;
    if (from && to) {
      ax = to.l - from.l;
      ay = to.t - from.t;
      if (ax !== 0 || ay !== 0) viewport.set(viewport.v.x - ax * k, viewport.v.y - ay * k);
    }
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!calm) {
      // Cards that are gone fade out where they stood, instead of vanishing: the old element is put back for a moment
      before.forEach((box, key) => {
        const ghost = oldNodes?.get(key);
        if (after.has(key) || !ghost) return;
        Object.assign(ghost.style, { position: 'absolute', left: `${box.l + ax}px`, top: `${box.t + ay}px`, width: `${box.r - box.l}px`, margin: '0', transform: '', pointerEvents: 'none', opacity: '' });
        ghost.dataset.ghost = '';
        ghost.setAttribute('aria-hidden', 'true');
        ghost.querySelectorAll('button').forEach((button) => {
          button.tabIndex = -1;
        });
        inner.append(ghost);
        ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-in', fill: 'forwards' }).finished.then(() => ghost.remove());
      });
      inner.querySelectorAll('button.node').forEach((node) => {
        // The fading ghosts above are not part of the new layout
        if (node.closest('[data-ghost]')) return;
        const key = node.dataset.key;
        const target = movable(node);
        const was = before.get(key);
        const now = after.get(key);
        if (!was) {
          target.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: 80, easing: 'ease-out', fill: 'backwards' });
          return;
        }
        const dx = was.l - now.l + ax;
        const dy = was.t - now.t + ay;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        target.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], { duration: 300, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' });
      });
    }
    followEdges(calm ? 0 : 340);
    if (anchorKey && after.has(anchorKey)) {
      const kids = [...inner.querySelectorAll(`button.node[data-parent="${CSS.escape(anchorKey)}"]`)].map((node) => after.get(node.dataset.key));
      bringIntoView([after.get(anchorKey), ...kids].filter(Boolean), 300);
    }
  }

  function rebuild(refocusKey) {
    hideTip();
    hoverKey = null;
    // Finish any glide still running, so the "before" positions are the settled ones
    inner.getAnimations?.({ subtree: true }).forEach((animation) => animation.finish());
    inner.querySelectorAll('[data-ghost]').forEach((ghost) => ghost.remove());
    const before = inner.querySelector('button.node') ? snapshot() : null;
    const oldNodes = before ? new Map([...inner.querySelectorAll('button.node')].map((node) => [node.dataset.key, movable(node)])) : null;
    ctx.loops = new Map();
    ctx.items = new Map();
    let graph = buildJourney({ focus: j().focus, cards: j().cards, opened: j().opened, more: j().more, groups: j().groups });
    while (prune(graph)) graph = buildJourney({ focus: j().focus, cards: j().cards, opened: j().opened, more: j().more, groups: j().groups });
    ctx.graph = graph;
    active = ctx;
    const render = (side, label) => side.map((items, index) => {
      const heads = items.filter((item) => item.kind === 'head').length;
      const nodes = [];
      items.forEach((item) => {
        if (item.kind === 'head') {
          if (heads > 1) nodes.push(el('p', 'w-fit max-w-full bg-surface-subtle pr-1 type-meta text-foreground-tertiary truncate', `${side === graph.out ? 'From' : 'Into'} ${pageById(item.parentId).path}`));
          return;
        }
        if (item.kind === 'tierhead') {
          nodes.push(el('p', 'w-fit bg-surface-subtle pr-1 type-label text-foreground-tertiary', item.label));
          return;
        }
        if (item.kind === 'more') {
          const more = el('button', `h-control-sm rounded-md border border-border bg-surface type-body-strong text-foreground hover:bg-surface-hover ${FOCUS_RING}`, `+${item.count} more`);
          more.type = 'button';
          more.dataset.more = item.moreKey;
          nodes.push(more);
          return;
        }
        ctx.items.set(item.key, item);
        nodes.push(item.kind === 'group' ? groupButton(item) : item.kind === 'stub' ? stubButton(item) : cardWrap(item, scope, ctx));
      });
      return column(label(index), nodes);
    });
    const byTier = j().layout === 'tier';
    const left = byTier ? [] : render(graph.in, (index) => `Step ${index + 1} in`).reverse();
    const right = byTier ? [] : render(graph.out, (index) => `Step ${index + 1} out`);
    ctx.tierEdges = null;
    const focusItem = { kind: 'card', id: j().focus, key: 'f', path: [j().focus], keys: ['f'], dir: null, edge: null };
    ctx.items.set('f', focusItem);
    const focusWrap = el('div', 'flex flex-col gap-2');
    focusWrap.append(cardWrap(focusItem, scope, ctx), focusNote(j().cards));
    const columns = byTier ? buildTierColumns(graph, scope, focusWrap) : [...left, column('Focus page', [focusWrap], true), ...right];
    // Lanes share one height, so each reads as a band; columns of steps start at the top
    inner.classList.toggle('items-stretch', byTier);
    inner.classList.toggle('items-start', !byTier);
    inner.replaceChildren(svg, ...columns);
    columns.forEach((col, index) => col.querySelectorAll('button.node').forEach((node) => {
      node.dataset.col = String(index);
    }));
    [...selection].forEach((key) => {
      if (!ctx.items.has(key)) selection.delete(key);
    });
    paintOffsets();
    paintSelection();
    renderBar();
    syncControls();
    if (before && live(inner)) settle(before, refocusKey, oldNodes);
    else {
      requestAnimationFrame(() => {
        if (!live(inner)) return;
        refreshBoxes();
        drawEdges();
      });
    }
    if (refocusKey) keyed(inner, refocusKey)?.focus({ preventScroll: true });
  }

  /** Called once the canvas is in the page: sizes it, then restores or chooses the first view. */
  ctx.mounted = () => {
    ctx.fitHeight();
    refreshBoxes();
    const saved = savedView;
    if (saved && saved.focus === j().focus && saved.cards === j().cards && saved.layout === j().layout) viewport.set(saved.x, saved.y, saved.k);
    else {
      const target = initialTarget();
      viewport.set(target.x, target.y, target.k);
    }
    drawEdges();
    new ResizeObserver(() => minimap.update()).observe(stage);
  };

  function toggle(key, kind) {
    const set = kind === 'group' ? j().groups : j().opened;
    if (!set.has(key) && ctx.graph.cardCount >= MAX_CARDS) {
      toast({ title: 'The canvas is full', description: `It holds at most ${MAX_CARDS} cards. Close a card, or use the tree list to follow the rest.`, tone: 'warning' });
      return;
    }
    if (set.has(key)) set.delete(key);
    else {
      set.add(key);
      // One journey at a time: opening a card closes every other opened card on its side, except the ones on its own
      // path from the focus page. Select a second page and the first one's links go away.
      const item = ctx.items.get(key);
      if (kind !== 'group' && item?.keys) {
        const path = new Set(item.keys);
        [...j().opened].forEach((other) => {
          if (ctx.items.get(other)?.dir === item.dir && !path.has(other)) j().opened.delete(other);
        });
      }
    }
    rebuild(key);
  }

  inner.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (suppress || viewport.wasDragged()) {
      suppress = false;
      return;
    }
    if (target.classList.contains('node') && (event.shiftKey || event.metaKey || event.ctrlKey)) {
      toggleSelected(target.dataset.key);
      return;
    }
    if (target.classList.contains('node')) clearSelection();
    if (target.dataset.focusId) {
      setFocus(target.dataset.focusId);
    } else if (target.dataset.info) toggleCardTip(target.dataset.info);
    else if (target.dataset.details) openInspector(target.dataset.details);
    else if (target.dataset.loop) {
      const key = target.dataset.loop;
      if (j().pinned.has(key)) j().pinned.delete(key);
      else j().pinned.add(key);
      target.setAttribute('aria-pressed', String(j().pinned.has(key)));
      drawEdges();
    } else if (target.dataset.more) {
      if (ctx.graph.cardCount >= MAX_CARDS) {
        toast({ title: 'The canvas is full', description: `It holds at most ${MAX_CARDS} cards. Close a card, or use the tree list to follow the rest.`, tone: 'warning' });
        return;
      }
      j().more.set(target.dataset.more, (j().more.get(target.dataset.more) ?? 0) + 1);
      rebuild(null);
    } else if (target.classList.contains('node')) {
      if (target.dataset.kind === 'stub') {
        const original = inner.querySelector(`button.node[data-kind="card"][data-id="${CSS.escape(target.dataset.id)}"]`);
        if (!original) return;
        centreOn(original);
        original.style.boxShadow = '0 0 0 2px var(--color-primary)';
        setTimeout(() => paintSelection(), 1500);
        original.focus({ preventScroll: true });
      } else if (target.hasAttribute('aria-expanded')) toggle(target.dataset.key, target.dataset.kind);
    }
  });

  // A press on the empty canvas that did not move clears the selection
  scroller.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    if (suppress || viewport.wasDragged()) {
      suppress = false;
      return;
    }
    clearSelection();
    scroller.focus({ preventScroll: true });
  });

  // ---- Moving a card: press, move past a few pixels, and the card (or the whole selection) follows the pointer
  let drag = null;
  inner.addEventListener('pointerdown', (event) => {
    suppress = false;
    if (event.button !== 0 || event.pointerType === 'touch' || event.shiftKey || event.metaKey || event.ctrlKey || viewport.spaceHeld()) return;
    const node = event.target.closest('button.node');
    if (!node) return;
    const keys = selection.has(node.dataset.key) && selection.size > 1 ? [...selection] : [node.dataset.key];
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, node, keys, started: false, base: new Map(keys.map((key) => [key, { ...(offsets.get(offsetKey(key)) ?? { x: 0, y: 0 }) }])) };
  });
  inner.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.started) {
      if (Math.hypot(dx, dy) < 5) return;
      drag.started = true;
      hideTip();
      drag.node.setPointerCapture(event.pointerId);
      drag.keys.forEach((key) => {
        const node = keyed(inner, key);
        if (node) movable(node).style.zIndex = '20';
      });
    }
    drag.keys.forEach((key) => {
      const node = keyed(inner, key);
      if (!node) return;
      const base = drag.base.get(key);
      const at = { x: base.x + dx / zoom, y: base.y + dy / zoom };
      offsets.set(offsetKey(key), at);
      movable(node).style.transform = `translate(${at.x}px, ${at.y}px)`;
    });
    scheduleEdges();
  });
  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const moved = drag.started;
    drag.keys.forEach((key) => {
      const node = keyed(inner, key);
      if (node) movable(node).style.zIndex = '';
    });
    drag = null;
    if (!moved) return;
    suppress = true;
    refreshBoxes();
    drawEdges();
    syncControls();
  };
  inner.addEventListener('pointerup', endDrag);
  inner.addEventListener('pointercancel', endDrag);

  // ---- Box select: Shift and drag on the empty canvas
  let marquee = null;
  scroller.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.shiftKey || event.target.closest('button')) return;
    event.preventDefault();
    scroller.setPointerCapture(event.pointerId);
    const box = el('div', 'pointer-events-none absolute rounded-sm border border-primary');
    box.style.background = 'color-mix(in srgb, var(--color-primary) 12%, transparent)';
    stage.append(box);
    marquee = { id: event.pointerId, x: event.clientX, y: event.clientY, box };
  });
  scroller.addEventListener('pointermove', (event) => {
    if (!marquee || event.pointerId !== marquee.id) return;
    const origin = stage.getBoundingClientRect();
    marquee.box.style.left = `${Math.min(marquee.x, event.clientX) - origin.left}px`;
    marquee.box.style.top = `${Math.min(marquee.y, event.clientY) - origin.top}px`;
    marquee.box.style.width = `${Math.abs(event.clientX - marquee.x)}px`;
    marquee.box.style.height = `${Math.abs(event.clientY - marquee.y)}px`;
  });
  const endMarquee = (event) => {
    if (!marquee || event.pointerId !== marquee.id) return;
    const area = marquee.box.getBoundingClientRect();
    marquee.box.remove();
    marquee = null;
    suppress = true;
    if (area.width < 3 && area.height < 3) return;
    inner.querySelectorAll('button.node').forEach((node) => {
      const rect = node.getBoundingClientRect();
      if (rect.right >= area.left && rect.left <= area.right && rect.bottom >= area.top && rect.top <= area.bottom) selection.add(node.dataset.key);
    });
    paintSelection();
    renderBar();
  };
  scroller.addEventListener('pointerup', endMarquee);
  scroller.addEventListener('pointercancel', endMarquee);

  // ---- Hover and focus: tooltips, return arrows and the lit path
  const hoverOn = (event) => {
    if (drag?.started) return;
    const loop = event.target.closest?.('[data-loop]');
    const edge = event.target.closest?.('path[data-edge]');
    const node = nodeOf(event.target);
    const loopKey = loop ? loop.dataset.loop : null;
    const lit = node ? node.dataset.key : null;
    let redraw = false;
    if (loopKey !== hoverLoop) {
      hoverLoop = loopKey;
      redraw = true;
    }
    if (lit !== hoverKey) {
      hoverKey = lit;
      redraw = true;
    }
    if (redraw) {
      drawEdges();
      paintFocusMode();
    }
    if (event.type === 'focusin' && node) bringIntoView([nodeBox(node)], 180);
    // A card's info panel opens from its "i" button, never on hover, so moving over the canvas stays calm
    if (pinnedTip) return;
    if (loop) loopTip(loop, loopKey);
    else if (edge) edgeTip(event, edge);
  };
  const hoverOff = () => {
    if (!pinnedTip) hideTip();
    if (hoverLoop || hoverKey) {
      hoverLoop = null;
      hoverKey = null;
      drawEdges();
      paintFocusMode();
    }
  };
  ['mouseover', 'focusin'].forEach((name) => inner.addEventListener(name, hoverOn));
  ['mouseout', 'focusout'].forEach((name) => inner.addEventListener(name, hoverOff));
  // Focus moving to an off-screen card must not scroll the clipped surface itself
  scroller.addEventListener('scroll', () => {
    scroller.scrollLeft = 0;
    scroller.scrollTop = 0;
  });

  inner.addEventListener('keydown', (event) => {
    const current = event.target.closest?.('button.node');
    if (!current) return;
    const nodes = [...inner.querySelectorAll('button.node')];
    const col = Number(current.dataset.col);
    const go = (node) => {
      if (!node) return;
      event.preventDefault();
      node.focus({ preventScroll: true });
    };
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const columns = nodes.map((node) => Number(node.dataset.col));
      for (let next = col + step; next >= Math.min(...columns) && next <= Math.max(...columns); next += step) {
        const here = nodes.filter((node) => Number(node.dataset.col) === next);
        if (here.length > 0) {
          go(here.reduce((best, node) => (Math.abs(node.getBoundingClientRect().top - current.getBoundingClientRect().top) < Math.abs(best.getBoundingClientRect().top - current.getBoundingClientRect().top) ? node : best)));
          return;
        }
      }
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const same = nodes.filter((node) => Number(node.dataset.col) === col).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      go(same[same.indexOf(current) + (event.key === 'ArrowDown' ? 1 : -1)]);
    } else if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      if (current.dataset.id && current.dataset.id !== j().focus) setFocus(current.dataset.id);
      else centreOn(current);
    } else if (event.key === 'Escape') {
      if (selection.size > 0) clearSelection();
      else go(keyed(inner, 'f'));
    }
  });

  // View keys work from anywhere on the canvas; arrows pan only when the empty canvas itself has focus
  stage.addEventListener('keydown', (event) => {
    if (event.target.closest('input, select, textarea') || event.altKey || event.ctrlKey || event.metaKey) return;
    const pan = event.shiftKey ? 240 : 80;
    if (event.key === '+' || event.key === '=') zoomBy(1.25);
    else if (event.key === '-' || event.key === '_') zoomBy(0.8);
    else if (event.key === '0') fitView();
    else if (event.key === '1') actualSize();
    else if (event.key === 'Home') centreOnFocus();
    else if (event.key === 'Escape' && pinnedTip) hideTip();
    else if (event.key === 'Escape' && !help.classList.contains('hidden')) {
      help.classList.add('hidden');
      help.classList.remove('block');
      helpButton.setAttribute('aria-expanded', 'false');
    } else if (event.target === scroller && event.key.startsWith('Arrow')) {
      const { x, y, k } = viewport.v;
      viewport.set(x + (event.key === 'ArrowLeft' ? pan : event.key === 'ArrowRight' ? -pan : 0), y + (event.key === 'ArrowUp' ? pan : event.key === 'ArrowDown' ? -pan : 0), k);
    } else return;
    event.preventDefault();
  });

  stage.append(controls, help, minimap.root, bar, focusChip);
  ctx.rebuild = rebuild;
  rebuild(null);
  return ctx;
}

window.addEventListener('resize', () => requestAnimationFrame(() => {
  active?.fitHeight?.();
  drawEdges();
}));

// -------------------------------------------------------------------------------------------------
// Tree list

const CELL = 'px-3 align-middle';

function treeTable() {
  // No height cap: the tree list grows with the page, like the other tables
  const scroller = el('div', 'overflow-x-auto');
  const table = el('table', 'w-full border-collapse');
  const head = el('tr', 'h-row-header');
  [['Page', ''], ['Tier', ''], ['Anchor text', ''], ['Link type', ''], ['Linking pages', 'text-right'], ['Status', '']].forEach(([name, align]) => {
    const th = el('th', `sticky top-0 z-(--z-table-header) border-b border-border bg-surface-subtle ${CELL} type-table-header text-foreground-secondary text-left font-normal ${align}`, name);
    th.scope = 'col';
    head.append(th);
  });
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  table.append(thead, body);
  scroller.append(table);
  const scope = markerScope(j().cards);

  function rebuild(refocusKey) {
    const rows = treeRows({ focus: j().focus, dir: j().treeDir, scope, treeOpen: j().treeOpen });
    body.replaceChildren(...rows.map((row) => treeRow(row, scope)));
    if (rows.length === 1) {
      const empty = el('tr');
      const cell = el('td', 'px-3 py-6 type-body text-foreground-secondary', j().treeDir === 'out' ? 'This page has no links out in this scope. Choose All links to include menu and automatic links.' : 'No page links here in this scope. Choose All links to include menu and automatic links.');
      cell.colSpan = 6;
      empty.append(cell);
      body.append(empty);
    }
    if (refocusKey) body.querySelector(`button[data-key="${CSS.escape(refocusKey)}"]`)?.focus();
    return rows;
  }

  function toggle(key) {
    const open = j().treeOpen;
    if (open.has(key)) [...open].forEach((entry) => (entry === key || entry.startsWith(`${key}>`) || entry.startsWith(`${key}<`)) && open.delete(entry));
    else open.add(key);
    rebuild(key);
  }

  body.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.toggle) toggle(target.dataset.toggle);
    else if (target.dataset.focusId) {
      setFocus(target.dataset.focusId);
    }
  });
  body.addEventListener('keydown', (event) => {
    const target = event.target.closest('button[data-toggle]');
    if (!target || !['ArrowRight', 'ArrowLeft'].includes(event.key)) return;
    const open = target.getAttribute('aria-expanded') === 'true';
    if ((event.key === 'ArrowRight') === open) return;
    event.preventDefault();
    toggle(target.dataset.toggle);
  });
  const rows = rebuild(null);
  return { scroller, rows };
}

function treeRow(row, scope) {
  const page = pageById(row.id);
  const tr = el('tr', 'group h-row-compact border-b border-border-subtle hover:bg-surface-hover');
  const first = el('td', `${CELL} min-w-72`);
  const lead = el('div', 'flex items-center gap-1.5');
  lead.style.paddingLeft = `${row.level * 20}px`;
  if (row.kind === 'page' && row.canOpen) {
    const toggle = el('button', `flex size-6 shrink-0 items-center justify-center rounded-sm text-foreground-tertiary hover:bg-surface-selected hover:text-foreground ${FOCUS_RING}`);
    toggle.type = 'button';
    toggle.dataset.toggle = row.key;
    toggle.dataset.key = row.key;
    toggle.setAttribute('aria-expanded', String(row.open));
    toggle.setAttribute('aria-label', `${row.open ? 'Collapse' : 'Expand'} ${page.path}`);
    toggle.append(icon(row.open ? 'chevron-down' : 'chevron-right', 'size-icon-sm'));
    lead.append(toggle);
  } else lead.append(el('span', 'size-6 shrink-0'));
  if (row.kind !== 'page') {
    lead.append(el('span', 'type-table text-foreground-tertiary', row.text));
  } else {
    lead.append(el('span', 'type-table text-foreground truncate', page.path));
    if (row.both) lead.append(el('span', BOTH_BADGE, 'Both ways'));
    if (row.level > 0) {
      const focus = toolButton('crosshair', `Make ${page.path} the focus`, { focusId: row.id });
      focus.classList.add('ml-auto', 'opacity-0', 'group-hover:opacity-100', 'focus-visible:opacity-100', 'group-focus-within:opacity-100');
      lead.append(focus);
    }
  }
  first.append(lead);
  const muted = row.kind !== 'page';
  const cells = [
    first,
    el('td', CELL),
    el('td', `${CELL} type-table ${muted ? 'text-foreground-tertiary' : 'text-foreground-secondary'}`, row.edge ? `"${row.edge.anchor}"` : 'Focus page'),
    el('td', `${CELL} type-table text-foreground-secondary`, row.edge ? PLACEMENT_LABEL[row.edge.placement] : ''),
    el('td', `${CELL} type-table num text-right text-foreground-secondary`, muted ? '' : String(ins(row.id, scope).length)),
    el('td', CELL),
  ];
  cells[1].append(tierBadge(tierIdOf(page)));
  if (!muted) cells[5].append(statusBadge(page));
  tr.append(...cells);
  return tr;
}

// -------------------------------------------------------------------------------------------------
// Path finder: the shortest way from the home page to one page, over any link and over editorial links only

const BLOCKS = [
  { key: 'any', title: 'Over any link (menus and footer included)' },
  { key: 'editorial', title: 'Over editorial links only' },
];

function stepCard(step, last) {
  const page = pageById(step.id);
  const node = el('button', `flex w-56 shrink-0 flex-col items-start gap-1 rounded-md border border-l-4 ${tierEdge(tierIdOf(page))} ${last ? 'border-primary-border ring-1 ring-primary-border' : 'border-border-strong'} bg-surface px-2.5 py-2 text-left hover:bg-surface-hover ${FOCUS_RING}`);
  node.type = 'button';
  node.dataset.open = step.id;
  node.setAttribute('aria-label', `${page.path}, ${tierLabel(tierIdOf(page))}. Open details.`);
  node.append(el('span', 'type-table text-foreground w-full truncate', page.path), el('span', 'type-label text-foreground-secondary w-full truncate', page.title), tierBadge(tierIdOf(page)));
  return node;
}

function connector(link) {
  const box = el('div', 'flex w-28 shrink-0 flex-col items-center justify-center gap-0.5 text-center');
  const via = link.anchor === '301 redirect' ? 'via a 301 redirect' : `via "${link.anchor}"`;
  const text = el('span', 'type-meta text-foreground-secondary max-w-full truncate', via);
  text.title = `${via}, ${PLACEMENT_LABEL[link.placement]}`;
  box.append(text, icon('chevron-right', 'size-icon text-foreground-tertiary'));
  return box;
}

function pathBlock(block, route, id) {
  const section = el('section', 'flex flex-col gap-3 px-4 py-4');
  section.setAttribute('aria-label', block.title);
  const head = el('div', 'flex flex-wrap items-center gap-x-3 gap-y-1');
  head.append(el('h3', 'type-subsection-title text-foreground', block.title));
  if (route) head.append(el('span', 'type-meta num text-foreground-secondary', route.length === 1 ? 'This is the home page' : plural(route.length - 1, 'click')));
  const open = el('button', `${BUTTON_SM} ml-auto ${FOCUS_RING}`);
  open.type = 'button';
  open.dataset.canvas = id;
  open.append(icon('workflow', 'size-icon-sm text-foreground-tertiary'), el('span', '', 'Open in canvas'));
  head.append(open);
  section.append(head);
  if (!route) {
    const none = el('div', 'flex flex-wrap items-center gap-2');
    const reason = block.key === 'editorial' && findPaths(id).any
      ? 'Not reachable through editorial links: only menus, footers or auto-generated blocks lead here.'
      : 'Not reachable from the home page through followed links.';
    none.append(el('span', 'inline-flex h-badge items-center rounded-sm bg-negative-subtle px-1.5 type-label text-negative-text whitespace-nowrap', 'No route'), el('p', 'type-body text-foreground-secondary', reason));
    section.append(none);
    return section;
  }
  const chain = el('ol', 'flex flex-wrap items-stretch gap-y-3');
  route.forEach((step, index) => {
    if (index > 0) {
      const joint = el('li', 'flex');
      joint.append(connector(step.link));
      chain.append(joint);
    }
    const item = el('li', 'flex');
    item.append(stepCard(step, index === route.length - 1));
    chain.append(item);
  });
  section.append(chain);
  return section;
}

function pathFinder() {
  // The target is the focus page: the toolbar's one page picker says "Find the way to" in this view
  const id = j().focus;
  const routes = findPaths(id);
  const wrap = el('div', 'flex flex-col');
  const blocks = el('div', 'flex flex-col divide-y divide-border-subtle');
  BLOCKS.forEach((block) => blocks.append(pathBlock(block, routes[block.key], id)));
  wrap.append(blocks);
  if (routes.any && routes.editorial && id !== 'home') {
    const gap = routes.editorial.length - routes.any.length;
    wrap.append(el('p', 'border-t border-border-subtle px-4 py-3 type-body text-foreground-secondary', gap > 0 ? `Menus make this page ${plural(gap, 'click')} closer than editorial links do.` : 'Editorial links reach it in the same number of clicks.'));
  }
  wrap.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.open) openInspector(target.dataset.open);
    else if (target.dataset.canvas) {
      j().view = 'canvas';
      if (j().focus === target.dataset.canvas) refresh();
      else setFocus(target.dataset.canvas);
    }
  });
  return wrap;
}

// -------------------------------------------------------------------------------------------------
// Toolbar and footer

function viewSwitch() {
  const group = el('div', 'inline-flex h-control-sm p-0.5 rounded-md border border-border bg-surface-subtle gap-0.5');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'View');
  [['canvas', 'Canvas', 'workflow'], ['tree', 'Tree list', 'list-tree'], ['path', 'Path finder', 'route']].forEach(([value, label, name]) => {
    const on = j().view === value;
    const node = el('button', `px-2.5 rounded-sm flex items-center gap-1.5 whitespace-nowrap type-body ${FOCUS_RING} ${on ? 'bg-surface border border-border-strong type-body-strong text-foreground' : 'text-foreground-secondary hover:text-foreground'}`);
    node.type = 'button';
    node.setAttribute('aria-pressed', String(on));
    node.dataset.restore = `journey-view:${value}`;
    node.setAttribute('aria-label', label);
    node.dataset.tip = label;
    // Labels from xl; below that the icons carry the three views, which leaves room for the controls on one line
    node.append(icon(name, 'size-icon-sm'), el('span', 'hidden xl:inline', label));
    node.addEventListener('click', () => {
      if (j().view === value) return;
      j().view = value;
      restore = `journey-view:${value}`;
      refresh();
    });
    group.append(node);
  });
  return group;
}

/** A button with a popover of every page (search, tier badge); `onPick(id)` runs after it closes. */
function pagePicker({ prefix, current, onPick, ariaLabel, popoverLabel }) {
  const page = pageById(current);
  const trigger = el('button', `${BUTTON_SM} max-w-80 ${FOCUS_RING}`);
  trigger.type = 'button';
  trigger.setAttribute('aria-label', `${ariaLabel}: ${page.path}. Change it.`);
  if (prefix) trigger.append(el('span', 'type-body text-foreground-secondary whitespace-nowrap', prefix));
  else trigger.append(icon('crosshair', 'size-icon text-foreground-tertiary'));
  trigger.append(el('span', 'truncate type-table', page.path), icon('chevron-down', 'size-icon-sm text-foreground-tertiary'));
  popover(trigger, (panel, api) => {
    const search = el('input', `${FIELD} w-full`);
    search.type = 'search';
    search.placeholder = 'Search pages';
    search.setAttribute('aria-label', 'Search pages');
    const list = el('div', 'flex max-h-72 flex-col gap-0.5 overflow-auto');
    // Redirect pages come after the real pages
    const isRedirect = (page) => page.status >= 300 && page.status < 400;
    const sorted = activePages().sort((a, b) => Number(isRedirect(a)) - Number(isRedirect(b)) || (tierPosition(tierIdOf(a)) || 99) - (tierPosition(tierIdOf(b)) || 99) || a.path.localeCompare(b.path));
    const fill = () => {
      const query = search.value.trim().toLowerCase();
      const found = sorted.filter((candidate) => !query || candidate.path.toLowerCase().includes(query) || candidate.title.toLowerCase().includes(query));
      list.replaceChildren(...(found.length === 0 ? [el('p', 'px-2 py-3 type-body text-foreground-secondary', 'No crawled page matches. Check the spelling or search for part of the path.')] : found.map((candidate) => {
        const item = el('button', `flex h-row-compact w-full items-center gap-2 rounded-sm px-2 text-left hover:bg-surface-hover ${FOCUS_RING} ${candidate.id === current ? 'bg-surface-selected' : ''}`);
        item.type = 'button';
        if (candidate.id === current) item.setAttribute('aria-current', 'true');
        if (isRedirect(candidate)) {
          // It shares its path with the page it leads to, so it says where it points
          const target = candidate.redirect ? pageById(candidate.redirect) : null;
          const words = el('span', 'flex min-w-0 flex-1 flex-col');
          words.append(el('span', 'type-table text-foreground truncate', candidate.path), el('span', 'type-meta text-foreground-secondary truncate', `Redirects to ${target ? target.path : '?'}`));
          item.classList.remove('h-row-compact');
          item.classList.add('py-1');
          item.append(words, el('span', 'inline-flex h-badge shrink-0 items-center rounded-sm border border-neutral-border bg-neutral-subtle px-2 type-micro text-neutral-text', 'Redirect'));
        } else item.append(el('span', 'type-table text-foreground truncate flex-1', candidate.path), tierBadge(tierIdOf(candidate)));
        item.addEventListener('click', () => {
          api.close();
          onPick(candidate.id);
        });
        return item;
      })));
    };
    search.addEventListener('input', fill);
    panel.append(search, list);
    fill();
    search.focus();
  }, { label: popoverLabel });
  return trigger;
}

const focusPicker = () => pagePicker({ current: j().focus, onPick: setFocus, ariaLabel: 'Focus page', popoverLabel: 'Choose the focus page' });

function cardsSwitch() {
  const group = segmented([['editorial', 'Editorial'], ['all', 'All links']], j().cards, (value) => {
    if (j().cards === value) return;
    j().cards = value;
    restore = `journey-cards:${value}`;
    [j().opened, j().more, j().groups, j().pinned, j().treeOpen].forEach((set) => set.clear());
    refresh();
  }, 'Links shown as cards');
  group.title = 'Links shown as cards';
  group.querySelectorAll('button').forEach((node, index) => {
    node.dataset.restore = `journey-cards:${['editorial', 'all'][index]}`;
  });
  return group;
}

function layoutSwitch() {
  const group = segmented([['step', 'By step'], ['tier', 'By tier']], j().layout, (value) => {
    if (j().layout === value) return;
    j().layout = value;
    restore = `journey-layout:${value}`;
    refresh();
  }, 'Canvas layout');
  group.title = 'By step: the click journey. By tier: lanes from T4 to T1, so links up toward the money pages read left to right.';
  group.querySelectorAll('button').forEach((node, index) => {
    node.dataset.restore = `journey-layout:${['step', 'tier'][index]}`;
  });
  return group;
}

/** By tier: which tier lanes are shown, as one menu with a count instead of a chip per tier. The focus page's own lane always is. */
function tiersMenu() {
  const focusLane = lanePos(j().focus);
  const lanes = [{ pos: 99, label: 'Untiered' }, ...tiers.slice().reverse().map((tier) => ({ pos: tierPosition(tier.id), label: tierLabel(tier.id) }))];
  const on = (lane) => lane.pos === focusLane || !j().laneHide.has(lane.pos);
  const trigger = el('button', `${BUTTON_SM} aria-expanded:bg-surface-selected ${FOCUS_RING}`);
  trigger.type = 'button';
  trigger.dataset.restore = 'journey-tiers';
  const count = el('span', 'num type-label text-foreground-tertiary', '');
  trigger.append(icon('layers', 'size-icon-sm text-foreground-tertiary'), el('span', '', 'Tiers'), count, icon('chevron-down', 'size-icon-sm text-foreground-tertiary'));
  const sync = () => {
    count.textContent = `${lanes.filter(on).length} of ${lanes.length}`;
    trigger.setAttribute('aria-label', `Tiers shown: ${count.textContent}`);
  };
  popover(trigger, (panel) => {
    panel.classList.add('p-1');
    lanes.forEach((lane) => {
      const row = el('button', `${MENU_ROW} ${FOCUS_RING}`);
      row.type = 'button';
      row.setAttribute('role', 'menuitemcheckbox');
      const mark = icon('check', 'size-icon-sm text-primary-text');
      row.append(el('span', 'flex-1 truncate', lane.label), mark);
      const paint = () => {
        mark.style.visibility = on(lane) ? 'visible' : 'hidden';
        row.setAttribute('aria-checked', String(on(lane)));
      };
      paint();
      if (lane.pos === focusLane) {
        row.disabled = true;
        row.title = 'The focus page is in this tier, so it stays';
      }
      // The menu stays open, so several tiers can be turned off in one go; the canvas redraws behind it
      row.addEventListener('click', () => {
        if (j().laneHide.has(lane.pos)) j().laneHide.delete(lane.pos);
        else j().laneHide.add(lane.pos);
        paint();
        sync();
        active?.rebuild(null);
      });
      panel.append(row);
    });
  }, { label: 'Tiers shown' });
  sync();
  return trigger;
}

/**
 * One line when it fits: the view switch and the focus page on the left, the controls for what the canvas shows on the
 * right. When it does not fit, the controls drop together to a second line, right aligned, instead of breaking apart.
 */
function toolbar() {
  const bar = el('div', 'flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle px-3 py-2');
  const picker = j().view === 'path'
    ? pagePicker({ prefix: 'Find the way to', current: j().focus, onPick: setFocus, ariaLabel: 'Find the way to', popoverLabel: 'Choose the page to find the way to' })
    : focusPicker();
  picker.classList.add('w-full');
  const pickerBox = el('div', 'min-w-0 max-w-80 flex-[1_1_11rem]');
  pickerBox.append(picker);
  bar.append(viewSwitch(), pickerBox);
  if (j().view === 'path') {
    bar.append(el('span', 'type-meta text-foreground-tertiary', 'from the home page'));
    return bar;
  }
  const controls = el('div', 'ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2');
  controls.append(cardsSwitch());
  if (j().view === 'canvas') {
    controls.append(layoutSwitch());
    if (j().layout === 'tier') controls.append(tiersMenu());
  }
  if (j().view === 'tree') {
    const follow = selectField([['out', 'Links out'], ['in', 'Links in']], j().treeDir, (value) => {
      j().treeDir = value;
      j().treeOpen.clear();
      restore = 'journey-follow';
      refresh();
    }, 'Follow');
    follow.dataset.restore = 'journey-follow';
    controls.append(follow);
  }
  bar.append(controls);
  return bar;
}

/** Two rows under the canvas: what the lines mean, then what the boxes mean. */
function legend() {
  const foot = el('div', 'flex flex-col gap-1.5 type-meta text-foreground-secondary');
  const row = (name) => {
    const node = el('div', 'flex flex-wrap items-center gap-x-4 gap-y-1');
    node.append(el('span', 'w-12 type-label text-foreground-tertiary', name));
    foot.append(node);
    return node;
  };
  const lines = row('Lines');
  [
    ...(j().layout === 'tier' ? [['Up a tier', 'border-positive-text'], ['Down a tier', 'border-info-text'], ['Same tier', 'border-foreground-tertiary border-dashed']] : []),
    ['Editorial', 'border-foreground-tertiary'],
    ['Auto-generated', 'border-border-strong border-dotted'],
    ['Menu and footer', 'border-border-strong border-dashed'],
    ['Redirect', 'border-warning-text'],
    ['Broken', 'border-negative-text'],
    ['Back link', 'border-primary border-dashed'],
  ].forEach(([text, line]) => {
    const item = el('span', 'inline-flex items-center gap-1.5');
    item.append(el('span', `w-6 border-t-2 ${line}`), text);
    lines.append(item);
  });
  const boxes = row('Boxes');
  [
    ['Focus page', 'border-primary-border ring-1 ring-primary-border bg-surface', ''],
    ['Page', 'border-border-strong bg-surface', ''],
    ['Opened', 'border-border-strong bg-primary-subtle', ''],
    ['Already shown (dashed)', 'border-dashed border-border-strong bg-surface', ''],
    ['Link group', 'border-border-strong bg-surface-subtle', ''],
    ['Selected', 'border-border-strong bg-surface', '0 0 0 2px var(--color-primary)'],
  ].forEach(([text, look, shadow]) => {
    const item = el('span', 'inline-flex items-center gap-1.5');
    const sample = el('span', `h-4 w-7 rounded-sm border ${look}`);
    if (shadow) sample.style.boxShadow = shadow;
    item.append(sample, text);
    boxes.append(item);
  });
  const edge = el('span', 'inline-flex items-center gap-1.5');
  edge.append(...tiers.map((tier) => el('span', `h-4 w-1 rounded-sm ${tierBg(tier.id)}`)), 'Left edge is the tier');
  boxes.append(edge);
  return foot;
}

// -------------------------------------------------------------------------------------------------

export function render(host) {
  hideTip();
  hoverLoop = null;
  hoverKey = null;
  active = null;
  const panel = el('div', 'rounded-lg border border-border bg-surface overflow-hidden');
  panel.append(toolbar());
  let canvas = null;
  if (j().view === 'canvas') {
    canvas = buildCanvas();
    panel.append(canvas.stage);
  }
  else if (j().view === 'path') panel.append(pathFinder());
  else {
    const table = treeTable();
    panel.append(table.scroller);
  }
  host.append(panel);
  canvas?.mounted();
  if (restore) host.querySelector(`[data-restore="${restore}"]`)?.focus();
  restore = null;
}

/** CSV rows of the tree list; null when the canvas is shown. */
export function exportRows() {
  if (j().view !== 'tree') return null;
  const scope = markerScope(j().cards);
  const rows = treeRows({ focus: j().focus, dir: j().treeDir, scope, treeOpen: j().treeOpen });
  return [
    ['Level', 'Page', 'Tier', 'Anchor text', 'Link type', 'Linking pages', 'Status'],
    ...rows.map((row) => {
      const page = pageById(row.id);
      const muted = row.kind !== 'page';
      return [row.level, muted ? row.text : page.path, tierCode(tierIdOf(page)), row.edge ? row.edge.anchor : '', row.edge ? PLACEMENT_LABEL[row.edge.placement] : '', muted ? '' : ins(row.id, scope).length, muted ? '' : page.status];
    }),
  ];
}
