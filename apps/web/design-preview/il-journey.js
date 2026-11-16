/* global document, window, requestAnimationFrame, setTimeout */
/**
 * Internal links, Journey tab (spec 7.5): the link journey as a canvas of cards and as a tree list. Both share
 * state.journey. Which cards and rows exist is decided in il-journey-layout.js; this file draws them.
 */
import { el } from './prompts-parts.js';
import { BUTTON_SM, FIELD, icon, iconButton, popover, selectField, toast } from './perf-ui.js';
import {
  PLACEMENT_LABEL, SCOPE_WORD, depthWithoutAuto, equity, flags, ins, isLive, pageById, pages, pct, plural, refresh, scopeOf,
  setFocus, state, statusBadge, tierBadge, tierCode, tierEdge, tierIdOf, tierLabel, tierPosition,
} from './il-model.js';
import { openInspector } from './il-drawer.js';
import { MAX_CARDS, backsOf, buildJourney, canOpen, depthText, linksOf, markerScope, treeRows } from './il-journey-layout.js';

const ZOOMS = [0.6, 0.8, 1, 1.2];
const CANVAS_LABEL = 'Link journey canvas. The tree list shows the same journey as a table.';
const GROUP_LABEL = { auto: 'Previous, next and related', template: 'Menu and footer' };
const SMALL_BUTTON = 'h-badge px-1.5 rounded-sm border border-border bg-surface type-label text-foreground-secondary hover:bg-surface-hover flex items-center gap-1 whitespace-nowrap';
const BACK_BUTTON = 'h-badge px-1.5 rounded-sm border border-primary-border bg-surface type-label text-primary-text hover:bg-primary-subtle aria-pressed:bg-primary-subtle flex items-center gap-1 whitespace-nowrap';
const BOTH_BADGE = 'inline-flex h-badge items-center rounded-sm bg-primary-subtle px-1.5 type-label text-primary-text whitespace-nowrap';
const FOCUS_RING = 'focus-visible:focus-ring';

let zoom = 1;
let active = null;
let hoverLoop = null;
let tip = null;

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const j = () => state.journey;
const live = (node) => node?.isConnected;

// -------------------------------------------------------------------------------------------------
// Tooltip (house look: a floating panel beside the card, fixed so scrolling the canvas does not clip it)

function hideTip() {
  tip?.remove();
  tip = null;
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
    ['Equity share', isLive(page) ? pct(equity[item.id]) : 'n/a'],
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

// -------------------------------------------------------------------------------------------------
// Cards

const linkedAs = (edge) => (edge ? `${scopeOf(edge) === 'editorial' ? '' : `${SCOPE_WORD[scopeOf(edge)]}: `}${edge.anchor}` : '');

function metaLine(item, scope, backs, both) {
  const page = pageById(item.id);
  const line = el('span', 'flex flex-wrap items-center gap-x-1.5 gap-y-0.5 type-meta text-foreground-tertiary');
  line.append(el('span', 'text-foreground-secondary', tierCode(tierIdOf(page))), el('span', 'num', `${plural(ins(item.id, scope).length, 'linking page')}`));
  if (isLive(page)) line.append(el('span', 'num', pct(equity[item.id])));
  if (page.status !== 200) line.append(statusBadge(page));
  if (both) line.append(el('span', BOTH_BADGE, 'Both ways'));
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
  const look = isFocus ? 'border-primary-border ring-1 ring-primary-border' : 'border-border-strong';
  const node = el('button', `node relative w-full text-left rounded-md border border-l-4 ${tierEdge(tierIdOf(page))} ${look} ${isOpen ? 'bg-primary-subtle' : 'bg-surface hover:bg-surface-hover'} px-2.5 py-2 flex flex-col gap-0.5 ${FOCUS_RING}`);
  node.type = 'button';
  Object.assign(node.dataset, { key: item.key, id: item.id, kind: 'card' });
  if (item.parentKey) node.dataset.parent = item.parentKey;
  if (item.dir) node.dataset.dir = item.dir;
  if (openable) node.setAttribute('aria-expanded', String(isOpen));
  node.setAttribute('aria-label', `${page.path}, ${tierLabel(tierIdOf(page))}, ${plural(ins(item.id, scope).length, 'linking page')}${item.edge ? `, linked as ${linkedAs(item.edge)}, ${PLACEMENT_LABEL[item.edge.placement].toLowerCase()}` : ', focus page'}`);
  const top = el('span', 'flex items-center gap-1 min-w-0');
  if (openable) top.append(icon(isOpen ? 'chevron-down' : 'chevron-right', 'size-icon-xs shrink-0 text-foreground-tertiary'));
  top.append(el('span', 'type-table text-foreground truncate', page.path));
  node.append(top, el('span', 'type-label text-foreground-secondary truncate', item.edge ? linkedAs(item.edge) : page.title), metaLine(item, scope, backs, both));
  return { node, backs };
}

function stubButton(item) {
  const page = pageById(item.id);
  const node = el('button', `node relative w-full text-left rounded-md border border-dashed border-l-4 border-border-strong ${tierEdge(tierIdOf(page))} bg-surface px-2.5 py-2 flex flex-col gap-0.5 hover:bg-surface-hover ${FOCUS_RING}`);
  node.type = 'button';
  Object.assign(node.dataset, { key: item.key, id: item.id, kind: 'stub', parent: item.parentKey, dir: item.dir });
  node.setAttribute('aria-label', `${page.path}, already on the canvas at ${item.at}. Select to find it.`);
  node.append(el('span', 'type-table text-foreground truncate', page.path), el('span', 'type-label text-foreground-secondary truncate', linkedAs(item.edge)), el('span', 'type-meta text-foreground-tertiary', `Already on the canvas at ${item.at}. Select to find it.`));
  return node;
}

function groupButton(item) {
  const node = el('button', `node relative w-full text-left rounded-md border border-border-strong bg-surface-subtle px-2.5 py-2 flex flex-col gap-0.5 hover:bg-surface-hover ${FOCUS_RING}`);
  node.type = 'button';
  Object.assign(node.dataset, { key: item.key, kind: 'group', parent: item.parentKey, dir: item.dir, scope: item.scope });
  node.setAttribute('aria-expanded', String(item.open));
  node.append(
    el('span', 'flex items-center gap-1'),
    el('span', 'type-meta text-foreground-tertiary', `${plural(item.count, 'link')}, ${item.open ? 'shown as cards' : 'select to show'}`),
  );
  node.firstChild.append(icon(item.open ? 'chevron-down' : 'chevron-right', 'size-icon-xs shrink-0 text-foreground-tertiary'), el('span', 'type-label text-foreground', `${GROUP_LABEL[item.scope]}: ${plural(item.count, 'link')}`));
  node.lastChild.textContent = item.open ? 'Shown as cards. Select to hide.' : 'Select to show them as cards.';
  node.setAttribute('aria-label', `${GROUP_LABEL[item.scope]}: ${plural(item.count, 'link')}`);
  return node;
}

function cardBar(item, backs) {
  const bar = el('div', 'flex flex-wrap items-center gap-1.5');
  const focus = el('button', `${SMALL_BUTTON} ${FOCUS_RING}`);
  focus.type = 'button';
  focus.dataset.focusId = item.id;
  focus.setAttribute('aria-label', `Focus on ${pageById(item.id).path}`);
  focus.append(icon('crosshair', 'size-icon-xs'), el('span', '', 'Focus'));
  bar.append(focus);
  if (backs.length > 0) {
    const pinned = j().pinned.has(item.key);
    const loop = el('button', `${BACK_BUTTON} ${FOCUS_RING}`, `${item.dir === 'out' ? 'Links back' : 'Gets links back'}: ${backs.length}`);
    loop.type = 'button';
    loop.dataset.loop = item.key;
    loop.setAttribute('aria-pressed', String(pinned));
    bar.append(loop);
  }
  const details = el('button', `${SMALL_BUTTON} ${FOCUS_RING}`);
  details.type = 'button';
  details.dataset.details = item.id;
  details.setAttribute('aria-label', `Details of ${pageById(item.id).path}`);
  details.append(icon('panel-right-open', 'size-icon-xs'), el('span', '', 'Details'));
  bar.append(details);
  return bar;
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

const box = (node) => ({ l: node.offsetLeft, r: node.offsetLeft + node.offsetWidth, m: node.offsetTop + node.offsetHeight / 2, b: node.offsetTop + node.offsetHeight, c: node.offsetLeft + node.offsetWidth / 2 });

function drawEdges() {
  if (!active || !live(active.inner)) return;
  const { inner, svg, items, loops } = active;
  const byKey = (key) => inner.querySelector(`button.node[data-key="${CSS.escape(key)}"]`);
  svg.setAttribute('width', String(inner.scrollWidth));
  svg.setAttribute('height', String(inner.scrollHeight));
  let paths = '<defs><marker id="il-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1L9 5L1 9z" style="fill: var(--color-primary)"/></marker></defs>';
  inner.querySelectorAll('button.node[data-parent]').forEach((node) => {
    const parent = byKey(node.dataset.parent);
    if (!parent) return;
    const isIn = node.dataset.dir === 'in';
    const a = box(parent);
    const b = box(node);
    const from = isIn ? b : a;
    const to = isIn ? a : b;
    const item = items.get(node.dataset.key);
    const link = item?.edge ?? { placement: node.dataset.scope === 'auto' ? 'auto_generated' : 'navigation' };
    const target = item?.edge ? (isIn ? parent.dataset.id : node.dataset.id) : null;
    const { colour, dash } = edgeLook(link, target);
    const dx = Math.max(30, (to.l - from.r) / 2);
    paths += `<path d="M${from.r},${from.m} C${from.r + dx},${from.m} ${to.l - dx},${to.m} ${to.l},${to.m}" fill="none" stroke-width="1.5"${dash} style="stroke: ${colour}"/>`;
  });
  inner.querySelectorAll('button.node.outline-dashed').forEach((node) => node.classList.remove('outline-2', 'outline-dashed', 'outline-primary', 'outline-offset-2'));
  const shown = new Set(j().pinned);
  if (hoverLoop) shown.add(hoverLoop);
  shown.forEach((key) => {
    const info = loops.get(key);
    const node = byKey(key);
    if (!info || !node) return;
    const a = box(node);
    info.backs.forEach((back) => {
      const target = byKey(back.key);
      if (!target) return;
      target.classList.add('outline-2', 'outline-dashed', 'outline-primary', 'outline-offset-2');
      const b = box(target);
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
  const lines = [`Depth ${depthText(id)} from home.${isLive(page) ? ` ${plural(editorial, 'editorial link')} in.` : ''}`];
  if (page.status >= 400) lines.push('Not found: this page has no links out.');
  else if (page.redirect) lines.push('Redirect: it passes visitors and equity to its target.');
  if (flags(page).some((flag) => flag.key === 'orphan')) lines.push('Orphan: no page links here.');
  else if (flags(page).some((flag) => flag.key === 'editorialOrphan')) lines.push(`Editorial orphan: no editorial links in.${scope === 'editorial' ? ' Choose All links as cards to see the menu and automatic links that reach it.' : ''}`);
  else if (linksOf(id, 'out', 'all').length === 0 && page.status < 400) lines.push('This page has no links out.');
  return el('p', 'type-meta text-foreground-tertiary', lines.join(' '));
}

function column(label, nodes) {
  const col = el('div', 'flex w-60 shrink-0 flex-col gap-2');
  col.append(el('h3', 'type-label text-foreground-tertiary', label), ...nodes);
  return col;
}

function buildCanvas() {
  const scope = markerScope(j().cards);
  const scroller = el('div', 'overflow-auto bg-surface-subtle');
  scroller.style.height = '560px';
  scroller.setAttribute('role', 'group');
  scroller.setAttribute('aria-label', CANVAS_LABEL);
  const sizer = el('div', 'relative');
  const inner = el('div', 'relative flex w-max items-start gap-16 p-4');
  inner.style.transformOrigin = '0 0';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'pointer-events-none absolute left-0 top-0');
  svg.setAttribute('aria-hidden', 'true');
  sizer.append(inner);
  scroller.append(sizer);
  const ctx = { scroller, sizer, inner, svg, items: new Map(), loops: new Map(), graph: null };

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

  function sizeAndFit() {
    inner.style.transform = `scale(${zoom})`;
    sizer.style.width = `${inner.offsetWidth * zoom}px`;
    sizer.style.height = `${inner.offsetHeight * zoom}px`;
  }

  function rebuild(refocusKey) {
    hideTip();
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
          if (heads > 1) nodes.push(el('p', 'type-meta text-foreground-tertiary truncate', `${side === graph.out ? 'From' : 'Into'} ${pageById(item.parentId).path}`));
          return;
        }
        if (item.kind === 'tierhead') {
          nodes.push(el('p', 'type-label text-foreground-tertiary', item.label));
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
        const wrap = el('div', 'flex flex-col gap-1');
        if (item.kind === 'group') wrap.append(groupButton(item));
        else if (item.kind === 'stub') wrap.append(stubButton(item));
        else {
          const { node, backs } = cardButton(item, scope, ctx);
          wrap.append(node, cardBar(item, backs));
        }
        nodes.push(wrap);
      });
      return column(label(index), nodes);
    });
    const left = render(graph.in, (index) => `Step ${index + 1} in`).reverse();
    const right = render(graph.out, (index) => `Step ${index + 1} out`);
    const focusItem = { kind: 'card', id: j().focus, key: 'f', path: [j().focus], keys: ['f'], dir: null, edge: null };
    ctx.items.set('f', focusItem);
    const focusWrap = el('div', 'flex flex-col gap-1');
    focusWrap.append(cardButton(focusItem, scope, ctx).node, focusNote(j().cards));
    const columns = [...left, column('Focus page', [focusWrap]), ...right];
    inner.replaceChildren(svg, ...columns);
    columns.forEach((col, index) => col.querySelectorAll('button.node').forEach((node) => {
      node.dataset.col = String(index);
    }));
    sizeAndFit();
    requestAnimationFrame(drawEdges);
    if (refocusKey) inner.querySelector(`button.node[data-key="${CSS.escape(refocusKey)}"]`)?.focus({ preventScroll: true });
  }

  function refit() {
    sizeAndFit();
    requestAnimationFrame(drawEdges);
  }

  function reveal(node, inline = 'center') {
    node.scrollIntoView({ block: 'nearest', inline, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }

  function toggle(key, kind) {
    const set = kind === 'group' ? j().groups : j().opened;
    if (!set.has(key) && ctx.graph.cardCount >= MAX_CARDS) {
      toast({ title: 'The canvas is full', description: `It holds at most ${MAX_CARDS} cards. Close a card, or use the tree list to follow the rest.`, tone: 'warning' });
      return;
    }
    if (set.has(key)) set.delete(key);
    else set.add(key);
    rebuild(key);
  }

  function findOriginal(id) {
    return inner.querySelector(`button.node[data-kind="card"][data-id="${CSS.escape(id)}"]`);
  }

  inner.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.focusId) {
      setFocus(target.dataset.focusId);
    } else if (target.dataset.details) openInspector(target.dataset.details);
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
        const original = findOriginal(target.dataset.id);
        if (!original) return;
        reveal(original);
        original.classList.add('outline-2', 'outline-primary');
        setTimeout(() => original.classList.remove('outline-2', 'outline-primary'), 1500);
        original.focus({ preventScroll: true });
      } else if (target.hasAttribute('aria-expanded')) toggle(target.dataset.key, target.dataset.kind);
    }
  });

  const hoverOn = (event) => {
    const loop = event.target.closest?.('[data-loop]');
    const node = event.target.closest?.('button.node');
    const key = loop ? loop.dataset.loop : null;
    if (key !== hoverLoop) {
      hoverLoop = key;
      drawEdges();
    }
    if (loop) loopTip(loop, key);
    else if (node && node.dataset.id) cardTip(node, ctx.items.get(node.dataset.key));
  };
  const hoverOff = () => {
    hideTip();
    if (hoverLoop) {
      hoverLoop = null;
      drawEdges();
    }
  };
  ['mouseover', 'focusin'].forEach((name) => inner.addEventListener(name, hoverOn));
  ['mouseout', 'focusout'].forEach((name) => inner.addEventListener(name, hoverOff));
  scroller.addEventListener('scroll', hideTip);

  inner.addEventListener('keydown', (event) => {
    const current = event.target.closest?.('button.node');
    if (!current) return;
    const nodes = [...inner.querySelectorAll('button.node')];
    const col = Number(current.dataset.col);
    const go = (node) => {
      if (!node) return;
      event.preventDefault();
      node.focus();
    };
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const columns = nodes.map((node) => Number(node.dataset.col));
      for (let next = col + step; next >= Math.min(...columns) && next <= Math.max(...columns); next += step) {
        const here = nodes.filter((node) => Number(node.dataset.col) === next);
        if (here.length > 0) {
          go(here.reduce((best, node) => (Math.abs(node.offsetTop - current.offsetTop) < Math.abs(best.offsetTop - current.offsetTop) ? node : best)));
          return;
        }
      }
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const same = nodes.filter((node) => Number(node.dataset.col) === col).sort((a, b) => a.offsetTop - b.offsetTop);
      go(same[same.indexOf(current) + (event.key === 'ArrowDown' ? 1 : -1)]);
    } else if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      if (current.dataset.id && current.dataset.id !== j().focus) setFocus(current.dataset.id);
      else current.scrollIntoView({ block: 'center', inline: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    } else if (event.key === 'Escape') go(inner.querySelector('button.node[data-key="f"]'));
  });

  ctx.rebuild = rebuild;
  ctx.refit = refit;
  ctx.fit = () => {
    const room = scroller.clientWidth;
    zoom = [...ZOOMS].reverse().find((step) => inner.offsetWidth * step <= room) ?? ZOOMS[0];
    refit();
  };
  rebuild(null);
  return ctx;
}

window.addEventListener('resize', () => requestAnimationFrame(drawEdges));

// -------------------------------------------------------------------------------------------------
// Tree list

const CELL = 'px-3 align-middle';

function treeTable() {
  const scroller = el('div', 'overflow-auto');
  scroller.style.maxHeight = '640px';
  const table = el('table', 'w-full border-collapse');
  const head = el('tr', 'h-row-header');
  [['Page', ''], ['Tier', ''], ['Anchor text', ''], ['Link type', ''], ['Linking pages', 'text-right'], ['Equity share', 'text-right'], ['Status', '']].forEach(([name, align]) => {
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
      const cell = el('td', 'px-3 py-6 type-body text-foreground-secondary', j().treeDir === 'out' ? 'This page has no links out in this scope. Choose All links as cards to include menu and automatic links.' : 'No page links here in this scope. Choose All links as cards to include menu and automatic links.');
      cell.colSpan = 7;
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
      const focus = el('button', `ml-auto ${SMALL_BUTTON} opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 ${FOCUS_RING}`);
      focus.type = 'button';
      focus.dataset.focusId = row.id;
      focus.setAttribute('aria-label', `Focus on ${page.path}`);
      focus.append(icon('crosshair', 'size-icon-xs'), el('span', '', 'Focus'));
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
    el('td', `${CELL} type-table num text-right text-foreground-secondary`, muted ? '' : isLive(page) ? pct(equity[row.id]) : 'n/a'),
    el('td', CELL),
  ];
  cells[1].append(tierBadge(tierIdOf(page)));
  if (!muted) cells[6].append(statusBadge(page));
  tr.append(...cells);
  return tr;
}

// -------------------------------------------------------------------------------------------------
// Toolbar and footer

function viewSwitch() {
  const group = el('div', 'inline-flex h-control-sm p-0.5 rounded-md border border-border bg-surface-subtle gap-0.5');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'View');
  [['canvas', 'Canvas', 'workflow'], ['tree', 'Tree list', 'list-tree']].forEach(([value, label, name]) => {
    const on = j().view === value;
    const node = el('button', `px-2.5 rounded-sm flex items-center gap-1.5 whitespace-nowrap type-body ${FOCUS_RING} ${on ? 'bg-surface border border-border-strong type-body-strong text-foreground' : 'text-foreground-secondary hover:text-foreground'}`);
    node.type = 'button';
    node.setAttribute('aria-pressed', String(on));
    node.append(icon(name, 'size-icon-sm'), el('span', '', label));
    node.addEventListener('click', () => {
      if (j().view === value) return;
      j().view = value;
      refresh();
    });
    group.append(node);
  });
  return group;
}

function focusPicker() {
  const page = pageById(j().focus);
  const trigger = el('button', `${BUTTON_SM} max-w-80 ${FOCUS_RING}`);
  trigger.type = 'button';
  trigger.setAttribute('aria-label', `Focus page: ${page.path}. Change it.`);
  trigger.append(icon('crosshair', 'size-icon text-foreground-tertiary'), el('span', 'truncate type-table', page.path), icon('chevron-down', 'size-icon-sm text-foreground-tertiary'));
  popover(trigger, (panel, api) => {
    const search = el('input', `${FIELD} w-full`);
    search.type = 'search';
    search.placeholder = 'Search pages';
    search.setAttribute('aria-label', 'Search pages');
    const list = el('div', 'flex max-h-72 flex-col gap-0.5 overflow-auto');
    const sorted = [...pages].sort((a, b) => (tierPosition(tierIdOf(a)) || 99) - (tierPosition(tierIdOf(b)) || 99) || a.path.localeCompare(b.path));
    const fill = () => {
      const query = search.value.trim().toLowerCase();
      const found = sorted.filter((candidate) => !query || candidate.path.toLowerCase().includes(query) || candidate.title.toLowerCase().includes(query));
      list.replaceChildren(...(found.length === 0 ? [el('p', 'px-2 py-3 type-body text-foreground-secondary', 'No crawled page matches. Check the spelling or search for part of the path.')] : found.map((candidate) => {
        const item = el('button', `flex h-row-compact w-full items-center gap-2 rounded-sm px-2 text-left hover:bg-surface-hover ${FOCUS_RING} ${candidate.id === j().focus ? 'bg-surface-selected' : ''}`);
        item.type = 'button';
        if (candidate.id === j().focus) item.setAttribute('aria-current', 'true');
        item.append(el('span', 'type-table text-foreground truncate flex-1', candidate.path), tierBadge(tierIdOf(candidate)));
        item.addEventListener('click', () => {
          api.close();
          setFocus(candidate.id);
        });
        return item;
      })));
    };
    search.addEventListener('input', fill);
    panel.append(search, list);
    fill();
    search.focus();
  }, { label: 'Choose the focus page' });
  return trigger;
}

function toolbar() {
  const bar = el('div', 'flex flex-wrap items-center gap-3 border-b border-border-subtle px-3 py-2');
  bar.append(viewSwitch(), focusPicker(), selectField([['editorial', 'Editorial as cards, others grouped'], ['all', 'All links as cards']], j().cards, (value) => {
    j().cards = value;
    [j().opened, j().more, j().groups, j().pinned, j().treeOpen].forEach((set) => set.clear());
    refresh();
  }, 'Links shown as cards'));
  if (j().view === 'tree') {
    bar.append(selectField([['out', 'Links out'], ['in', 'Links in']], j().treeDir, (value) => {
      j().treeDir = value;
      j().treeOpen.clear();
      refresh();
    }, 'Follow'));
    return bar;
  }
  const right = el('div', 'ml-auto flex items-center gap-1.5');
  const label = el('span', 'type-meta num text-foreground-tertiary w-10 text-right');
  const out = iconButton('zoom-out', 'Zoom out', () => setZoom(-1));
  const into = iconButton('zoom-in', 'Zoom in', () => setZoom(1));
  const fit = iconButton('scan', 'Fit to view', () => {
    active?.fit();
    sync();
  });
  function sync() {
    out.disabled = zoom <= ZOOMS[0];
    into.disabled = zoom >= ZOOMS[ZOOMS.length - 1];
    label.textContent = `${Math.round(zoom * 100)}%`;
  }
  function setZoom(direction) {
    const index = ZOOMS.indexOf(zoom) + direction;
    if (index < 0 || index >= ZOOMS.length) return;
    zoom = ZOOMS[index];
    active?.refit();
    sync();
  }
  sync();
  right.append(label, out, into, fit);
  bar.append(right);
  return bar;
}

function legend() {
  const foot = el('div', 'flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-subtle px-4 py-2 type-meta text-foreground-secondary');
  [
    ['Editorial', 'border-foreground-tertiary'],
    ['Auto-generated (previous, next, related)', 'border-border-strong border-dotted'],
    ['Menu and footer link', 'border-border-strong border-dashed'],
    ['Through a redirect', 'border-warning-text'],
    ['Broken target', 'border-negative-text'],
    ['Back link (shown on hover or when pinned)', 'border-primary border-dashed'],
  ].forEach(([text, line]) => {
    const item = el('span', 'inline-flex items-center gap-1.5');
    item.append(el('span', `w-6 border-t-2 ${line}`), text);
    foot.append(item);
  });
  return foot;
}

// -------------------------------------------------------------------------------------------------

export function render(host) {
  hideTip();
  hoverLoop = null;
  active = null;
  const panel = el('div', 'rounded-lg border border-border bg-surface overflow-hidden');
  panel.append(toolbar());
  if (j().view === 'canvas') panel.append(buildCanvas().scroller, legend());
  else {
    const table = treeTable();
    panel.append(table.scroller);
  }
  host.append(panel);
}

/** CSV rows of the tree list; null when the canvas is shown. */
export function exportRows() {
  if (j().view !== 'tree') return null;
  const scope = markerScope(j().cards);
  const rows = treeRows({ focus: j().focus, dir: j().treeDir, scope, treeOpen: j().treeOpen });
  return [
    ['Level', 'Page', 'Tier', 'Anchor text', 'Link type', 'Linking pages', 'Equity share', 'Status'],
    ...rows.map((row) => {
      const page = pageById(row.id);
      const muted = row.kind !== 'page';
      return [row.level, muted ? row.text : page.path, tierCode(tierIdOf(page)), row.edge ? row.edge.anchor : '', row.edge ? PLACEMENT_LABEL[row.edge.placement] : '', muted ? '' : ins(row.id, scope).length, muted ? '' : isLive(page) ? pct(equity[row.id]) : 'n/a', muted ? '' : page.status];
    }),
  ];
}
