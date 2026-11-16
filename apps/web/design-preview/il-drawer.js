/* global document, window */
/**
 * Internal links, page inspector (spec 7.4): the right drawer of the Pages and Links tabs. It shows one page's tier
 * (editable) with its source and tags, the metric strip, who links in by tier and placement, the top anchors, the
 * capped lists of linking pages and outlinks, and the flags with what they mean. It steps through the pages of the
 * Pages table in its order and closes with Escape. Exports `openInspector`, `closeInspector`, `redrawInspector`.
 */
import { BUTTON_SM, BUTTON_PRIMARY, copyText, icon, iconButton, popover, selectField, toast } from './perf-ui.js';
import { el } from './prompts-parts.js';
import { PLACEMENT_LABEL, allTags, depth, equity, flagBadge, flags, ins, links, outs, pageById, pct, refresh, resetToRule, setFocus, setTier, sourceText, state, tierBg, tierCode, tierIdOf, tierKeys, tierLabel, tierOf, tiers } from './il-model.js';
import { shownPageIds } from './il-pages.js';

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
  add.append(icon('plus', 'size-icon-sm text-foreground-tertiary'), el('span', '', 'Add tag'));
  popover(add, (panel, api) => {
    panel.classList.add('p-1', 'flex', 'flex-col');
    const free = allTags().filter((tag) => !page.tags.includes(tag));
    if (free.length === 0) panel.append(el('p', 'px-2 py-2 type-meta', 'Every tag is already on this page.'));
    free.forEach((tag) => {
      const item = el('button', 'w-full min-h-9 px-2 rounded-md flex items-center type-body text-foreground text-left hover:bg-surface-hover focus-visible:bg-surface-hover', tag);
      item.type = 'button';
      item.addEventListener('click', () => {
        api.close();
        page.tags = [...page.tags, tag];
        refresh();
      });
      panel.append(item);
    });
  }, { label: 'Add tag' });
  tags.append(add);
  return section('Tier', choose, source, tags);
}

function metricStrip(page) {
  const editorial = ins(page.id, 'editorial').length;
  const all = ins(page.id, 'all').length;
  const items = [
    ['Depth', depth[page.id] === undefined ? 'Not reachable' : String(depth[page.id]), null],
    ['Linking pages', String(editorial), `of ${all} all`],
    ['Equity share', pct(equity[page.id]), null],
    ['Outlinks', String(outs(page.id, 'editorial').length), `of ${outs(page.id, 'all').length} all`],
  ];
  const row = el('dl', 'grid grid-cols-4 rounded-md border border-border');
  items.forEach(([label, value, note], index) => {
    const item = el('div', `flex min-w-0 flex-col px-2 py-2 ${index < items.length - 1 ? 'border-r border-border' : ''}`);
    item.append(el('dt', 'type-label text-foreground-tertiary truncate', label), el('dd', 'type-body-strong num text-foreground', value));
    if (note) item.append(el('dd', 'type-micro text-foreground-tertiary', note));
    row.append(item);
  });
  return row;
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
  const foot = el('footer', 'px-4 py-3 border-t border-border flex flex-wrap gap-2');
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
  const copy = el('button', BUTTON_SM);
  copy.type = 'button';
  copy.append(icon('copy', 'size-icon-sm text-foreground-tertiary'), el('span', '', 'Copy URL'));
  copy.addEventListener('click', () => copyText(`${HOST_URL}${page.path}`, 'URL copied'));
  foot.append(journey, visit, copy);
  host.append(head, content, foot);
  host.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeInspector();
  });
  document.body.append(host);
  if (same) content.scrollTop = scroll;
  else host.querySelector('button')?.focus();
}

window.addEventListener('preview-leave', closeInspector);
