/* global document, window */
/**
 * Internal links, page inspector (spec 7.4): the right drawer of the Pages and Links tabs. It shows one page's tier
 * (editable) with its source and tags, the metric strip, who links in by tier and placement, the top anchors, the
 * capped lists of linking pages and outlinks, and the flags with what they mean. It steps through the pages of the
 * Pages table in its order and closes with Escape. Exports `openInspector`, `closeInspector`, `redrawInspector`.
 */
import { BUTTON_SM, BUTTON_PRIMARY, copyText, downloadCsv, icon, iconButton, popover, selectField, toast } from './perf-ui.js';
import { el } from './prompts-parts.js';
import { PLACEMENT_LABEL, allTags, depth, equity, flagBadge, flags, ins, links, outs, pageById, pct, plural, refresh, resetToRule, routeFromHome, setFocus, setTier, sourceText, state, tierBg, tierCode, tierIdOf, tierKeys, tierLabel, tierOf, tiers, suggestedLinks, hasRelatedPages } from './il-model.js';
import { newTagForm, shownPageIds } from './il-pages.js';

const HOST_URL = 'https://eventussecurity.com';
const LIST_LIMIT = 8;

const FLAG_TEXT = {
  notfound: 'The page returns 404. Links to it lead visitors and crawlers nowhere.',
  redirect: 'The page redirects to another URL. Link to the final page instead.',
  nonindexable: 'Search engines are told not to index this page, so it cannot rank.',
  orphan: 'No page links here, so crawlers can only find it through the sitemap or Search Console.',
  editorialOrphan: 'No editorial link points here. Only menus, footers or auto-generated blocks reach it.',
  deepAuto: "The blog's previous and next links are the only short way here: without them this page is far deeper or cannot be reached.",
  broken: 'This page links to a page that returns an error.',
  toRedirect: 'This page links to a URL that redirects. Update the link to the final URL.',
  fewLinks: 'A T1 page with fewer than 3 editorial linking pages. Add links from related pages.',
};
const PLACEMENT_ORDER = ['content', 'auto_generated', 'navigation', 'footer', 'breadcrumb'];

let host = null;
// A data-restore value to focus after the next redraw of the same page (the control that caused it was rebuilt)
let restoreKey = null;

export function closeInspector() {
  state.open = null;
  host?.remove();
  host = null;
}

export function openInspector(id) {
  state.open = id;
  draw();
}

export const redrawInspector = () => {
  if (state.open) draw();
};

function section(title, ...children) {
  const wrap = el('section', 'flex flex-col gap-2');
  wrap.append(el('h3', 'type-label text-foreground-tertiary', title), ...children);
  return wrap;
}

const muted = (text) => el('p', 'type-body text-foreground-tertiary', text);

// -------------------------------------------------------------------------------------------------
// Sections

function tagChip(page, tag) {
  const chip = el('span', 'inline-flex h-badge items-center gap-1 rounded-sm border border-border pl-1.5 pr-0.5 type-label text-foreground-secondary');
  const remove = el('button', 'size-4 rounded-xs flex items-center justify-center text-foreground-tertiary hover:bg-surface-hover hover:text-foreground');
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove tag ${tag}`);
  remove.append(icon('x', 'size-icon-xs'));
  remove.addEventListener('click', () => {
    page.tags = page.tags.filter((candidate) => candidate !== tag);
    restoreKey = 'add-tag';
    refresh();
  });
  chip.append(tag, remove);
  return chip;
}

function tierSection(page) {
  const current = tierIdOf(page);
  const choose = selectField([...tiers.map((tier) => [tier.id, tierLabel(tier.id)]), ['none', 'Untiered']], current ?? 'none', (value) => {
    setTier([page.id], value === 'none' ? null : value);
    toast({ title: 'Tier set', description: `${page.path} is now ${value === 'none' ? 'untiered' : tierLabel(value)}.`, tone: 'success' });
    refresh();
  }, 'Tier', 'w-full h-control');
  const source = el('div', 'flex flex-wrap items-center gap-x-2');
  source.append(el('span', 'type-meta', sourceText(page)));
  if (tierOf(page).source === 'manual') {
    const reset = el('button', 'type-meta text-link hover:underline', 'Reset to rule');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      resetToRule([page.id]);
      toast({ title: 'Tier reset', description: `${page.path} follows its rule again.`, tone: 'success' });
      refresh();
    });
    source.append(reset);
  }
  const tags = el('div', 'flex flex-wrap items-center gap-1.5');
  page.tags.forEach((tag) => tags.append(tagChip(page, tag)));
  const add = el('button', `${BUTTON_SM} aria-expanded:bg-surface-selected`);
  add.type = 'button';
  add.dataset.restore = 'add-tag';
  add.append(icon('plus', 'size-icon-sm text-foreground-tertiary'), el('span', '', 'Add tag'));
  popover(add, (panel, api) => {
    panel.classList.add('p-1', 'flex', 'flex-col');
    const apply = (tag) => {
      api.close();
      page.tags = [...new Set([...page.tags, tag])];
      restoreKey = 'add-tag';
      refresh();
    };
    const free = allTags().filter((tag) => !page.tags.includes(tag));
    if (free.length === 0) panel.append(el('p', 'px-2 py-2 type-meta', 'Every tag is already on this page.'));
    free.forEach((tag) => {
      const item = el('button', 'w-full min-h-9 px-2 rounded-md flex items-center type-body text-foreground text-left hover:bg-surface-hover focus-visible:bg-surface-hover', tag);
      item.type = 'button';
      item.addEventListener('click', () => apply(tag));
      panel.append(item);
    });
    newTagForm(panel, apply);
  }, { label: 'Add tag' });
  tags.append(add);
  return section('Tier', choose, source, tags);
}

function metricStrip(page) {
  const editorial = ins(page.id, 'editorial').length;
  const all = ins(page.id, 'all').length;
  const items = [
    ['Depth', depth[page.id] === undefined ? 'Not reachable' : String(depth[page.id]), null],
    ['Links in', String(editorial), `editorial, ${all} in all`],
    ['Equity', pct(equity[page.id]), null],
    ['Links out', String(outs(page.id, 'editorial').length), `editorial, ${outs(page.id, 'all').length} in all`],
  ];
  const row = el('dl', 'grid grid-cols-4 rounded-md border border-border');
  items.forEach(([label, value, note], index) => {
    const item = el('div', `flex min-w-0 flex-col px-2 py-2 ${index < items.length - 1 ? 'border-r border-border' : ''}`);
    item.append(el('dt', 'type-label text-foreground-tertiary', label), el('dd', 'type-body-strong num text-foreground break-words', value));
    if (note) item.append(el('dd', 'type-micro text-foreground-tertiary', note));
    row.append(item);
  });
  return row;
}

function stepButton(id) {
  const node = el('button', 'rounded-md border border-border bg-surface px-1.5 py-0.5 type-table text-foreground hover:bg-surface-hover');
  node.type = 'button';
  node.textContent = pageById(id).path;
  node.addEventListener('click', () => openInspector(id));
  return node;
}

function routeSection(page) {
  const route = routeFromHome(page.id);
  if (!route) {
    const all = ins(page.id, 'all');
    const reason = all.length === 0 ? 'No page links to it.' : all.every((link) => link.rel === 'nofollow') ? 'Every link to it is nofollow.' : 'The pages that link to it cannot be reached from the home page either.';
    return section('Route from home', muted(`Not reachable from the home page through followed links. ${reason}`));
  }
  if (route.length === 1) return section('Route from home', muted('This is the home page.'));
  const line = el('div', 'flex flex-wrap items-center gap-1');
  route.forEach((step, index) => {
    if (index > 0) line.append(icon('chevron-right', 'size-icon-xs text-foreground-tertiary'));
    line.append(index === route.length - 1 ? el('span', 'px-1.5 py-0.5 type-table text-foreground', pageById(step.id).path) : stepButton(step.id));
  });
  line.append(el('span', 'ml-1 type-meta num', plural(route.length - 1, 'click')));
  return section('Route from home', line);
}

function suggestionsSection(page) {
  const all = suggestedLinks(page.id, 100);
  const shown = all.slice(0, 5);
  const target = `${HOST_URL}${page.path}`;
  const sentence = (item) => `Add a link on ${HOST_URL}${pageById(item.id).path} to ${target} with the anchor "${item.anchor}"`;
  if (shown.length === 0) {
    const live = page.status === 200 && page.indexable;
    const none = !live ? 'Suggestions need a live, indexable page.' : hasRelatedPages(page.id) ? 'No suggestion: every related page already links here.' : 'No related pages found yet.';
    return section('Suggested links', muted(none));
  }
  const list = el('ul', 'flex flex-col');
  shown.forEach((item) => {
    const row = el('li', 'flex items-start gap-2 py-1.5 border-b border-border-subtle');
    const text = el('div', 'min-w-0 flex-1 flex flex-col items-start');
    const open = el('button', 'max-w-full truncate type-table text-foreground text-left hover:text-primary-text');
    open.type = 'button';
    open.textContent = pageById(item.id).path;
    open.addEventListener('click', () => openInspector(item.id));
    text.append(open, el('span', 'type-meta', item.reasons.join('. ')), el('span', 'type-meta text-foreground', `Anchor: "${item.anchor}"`));
    const copy = el('button', BUTTON_SM, 'Copy');
    copy.type = 'button';
    copy.setAttribute('aria-label', `Copy suggestion for ${pageById(item.id).path}`);
    copy.addEventListener('click', () => copyText(sentence(item), 'Suggestion copied'));
    row.append(text, copy);
    list.append(row);
  });
  const exportButton = el('button', `${BUTTON_SM} self-start`);
  exportButton.type = 'button';
  exportButton.append(icon('download', 'size-icon-sm text-foreground-tertiary'), el('span', '', 'Export suggestions'));
  exportButton.addEventListener('click', () => downloadCsv(`internal-links-suggestions-${page.id}.csv`, [
    ['Source page', 'Target page', 'Anchor', 'Reasons'],
    ...all.map((item) => [`${HOST_URL}${pageById(item.id).path}`, target, item.anchor, item.reasons.join('; ')]),
  ]));
  return section('Suggested links', list, exportButton, el('p', 'type-meta text-foreground-tertiary', 'Suggestions match topics and tags. Reading page text arrives with link opportunities.'));
}

function barList(rows, total) {
  const list = el('ul', 'flex flex-col gap-1');
  rows.forEach(([label, count, color, key]) => {
    const row = el('li', 'flex items-center gap-2 type-body');
    const track = el('span', 'h-2 flex-1 overflow-hidden rounded-2xs bg-surface-subtle');
    const fill = el('span', `block h-full ${color}`);
    fill.style.width = total > 0 ? `${(count / total) * 100}%` : '0';
    track.append(fill);
    row.append(el('span', 'w-24 shrink-0 truncate text-foreground-secondary', label), track, el('span', 'w-6 text-right num', String(count)));
    if (key) row.dataset.key = key;
    list.append(row);
  });
  return list;
}

function linkingSection(page) {
  const editorial = ins(page.id, 'editorial');
  const byTier = tierKeys().map((key) => [tierCode(key), editorial.filter((link) => tierIdOf(pageById(link.from)) === key).length, tierBg(key)]);
  const byPlacement = PLACEMENT_ORDER.map((key) => [PLACEMENT_LABEL[key], new Set(links.filter((link) => link.to === page.id && link.from !== page.id && link.placement === key).map((link) => link.from)).size, 'bg-primary']);
  const maxPlacement = Math.max(1, ...byPlacement.map(([, count]) => count));
  return section('Linking pages by tier',
    editorial.length === 0 ? muted('No editorial links point here.') : barList(byTier, Math.max(1, ...byTier.map(([, count]) => count))),
    el('h3', 'type-label text-foreground-tertiary pt-2', 'Linking pages by placement'),
    barList(byPlacement, maxPlacement));
}

function anchorsSection(page) {
  const counts = new Map();
  links.filter((link) => link.to === page.id && link.placement === 'content').forEach((link) => counts.set(link.anchor, (counts.get(link.anchor) ?? 0) + 1));
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const list = el('ul', 'flex flex-col');
  top.forEach(([anchor, count]) => {
    const row = el('li', 'flex items-center gap-2 py-1 border-b border-border-subtle type-body');
    row.append(el('span', 'min-w-0 flex-1 truncate', `"${anchor}"`), el('span', 'num text-foreground-secondary', String(count)));
    list.append(row);
  });
  return section('Top anchors pointing here', top.length === 0 ? muted('No editorial links point here, so there are no anchors.') : list);
}

function viewAll(page) {
  const button = el('button', 'self-start type-table text-link hover:underline', 'View all in Links');
  button.type = 'button';
  button.addEventListener('click', () => {
    Object.assign(state.links, { search: page.path, placement: '', pair: null, limit: 200 });
    closeInspector();
    globalThis.location.hash = '#/internal-links/links';
  });
  return button;
}

function pageList(title, items, idOf, page) {
  const list = el('ul', 'flex flex-col');
  items.slice(0, LIST_LIMIT).forEach((link) => {
    const other = pageById(idOf(link));
    const row = el('li', 'border-b border-border-subtle');
    const open = el('button', 'w-full flex flex-col py-1.5 text-left hover:text-primary-text');
    open.type = 'button';
    open.append(el('span', 'truncate type-table text-foreground', other.path), el('span', 'truncate type-label text-foreground-tertiary', `"${link.anchor}", ${PLACEMENT_LABEL[link.placement].toLowerCase()}`));
    open.addEventListener('click', () => openInspector(other.id));
    row.append(open);
    list.append(row);
  });
  const more = items.length > LIST_LIMIT ? el('p', 'type-meta', `Showing ${LIST_LIMIT} of ${items.length}.`) : null;
  return section(`${title} (${items.length})`, items.length === 0 ? muted('None in editorial links.') : list, ...(more ? [more] : []), ...(items.length > 0 ? [viewAll(page)] : []));
}

function flagsSection(page) {
  const list = flags(page);
  const wrap = el('ul', 'flex flex-col gap-2');
  list.forEach((flag) => {
    const row = el('li', 'flex flex-col items-start gap-1');
    row.append(flagBadge(flag), el('span', 'type-body text-foreground-secondary', FLAG_TEXT[flag.key] ?? ''));
    wrap.append(row);
  });
  return section('Flags', list.length === 0 ? muted('No flags. This page has no linking problems.') : wrap);
}

function body(page) {
  const wrap = el('div', 'flex flex-col gap-5');
  wrap.append(
    tierSection(page),
    metricStrip(page),
    routeSection(page),
    suggestionsSection(page),
    linkingSection(page),
    anchorsSection(page),
    pageList('Linking pages', ins(page.id, 'editorial'), (link) => link.from, page),
    pageList('Outlinks', outs(page.id, 'editorial'), (link) => link.to, page),
    flagsSection(page),
  );
  return wrap;
}

function step(delta) {
  const ids = shownPageIds();
  const next = ids[ids.indexOf(state.open) + delta];
  if (next) openInspector(next);
}

function draw() {
  const scroll = host?.querySelector('[data-body]')?.scrollTop ?? 0;
  const same = host?.dataset.page === state.open;
  host?.remove();
  host = null;
  const page = state.open ? pageById(state.open) : null;
  if (!page) return;
  host = el('aside', 'fixed inset-y-0 right-0 z-(--z-drawer) w-full max-w-(--container-dialog-sm) bg-surface border-l border-border shadow-popover flex flex-col');
  host.dataset.page = page.id;
  host.setAttribute('aria-label', `Page ${page.path}`);
  const ids = shownPageIds();
  const index = ids.indexOf(page.id);
  const head = el('header', 'px-4 py-3 border-b border-border flex items-start gap-2');
  const text = el('div', 'min-w-0 flex-1 flex flex-col');
  text.append(el('h2', 'type-section-title truncate', page.path), el('span', 'type-meta truncate', page.title));
  const previous = iconButton('chevron-up', 'Previous page', () => step(-1));
  const next = iconButton('chevron-down', 'Next page', () => step(1));
  previous.disabled = index <= 0;
  next.disabled = index === -1 || index >= ids.length - 1;
  head.append(text, previous, next, iconButton('x', 'Close', closeInspector));
  const content = el('div', 'flex-1 min-h-0 overflow-auto px-4 py-4');
  content.dataset.body = '';
  content.append(body(page));
  const foot = el('footer', 'px-4 py-3 border-t border-border flex items-center gap-2');
  const journey = el('button', `${BUTTON_PRIMARY} h-control-sm px-2 gap-1.5`);
  journey.type = 'button';
  journey.append(icon('workflow', 'size-icon-sm'), el('span', '', 'Open in journey'));
  journey.addEventListener('click', () => {
    setFocus(page.id);
    closeInspector();
  });
  const visit = el('a', BUTTON_SM);
  visit.href = `${HOST_URL}${page.path}`;
  visit.target = '_blank';
  visit.rel = 'noopener noreferrer';
  visit.append(icon('external-link', 'size-icon-sm text-foreground-tertiary'), el('span', '', 'Visit page'));
  const copy = iconButton('copy', 'Copy URL', () => copyText(`${HOST_URL}${page.path}`, 'URL copied'));
  copy.classList.add('ml-auto', 'shrink-0');
  foot.append(journey, visit, copy);
  host.append(head, content, foot);
  host.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeInspector();
  });
  document.body.append(host);
  if (same) content.scrollTop = scroll;
  else host.querySelector('button')?.focus();
  if (same && restoreKey) host.querySelector(`[data-restore="${restoreKey}"]`)?.focus({ preventScroll: true });
  restoreKey = null;
}

window.addEventListener('preview-leave', closeInspector);
