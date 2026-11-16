/* global document, window, location, setTimeout, URL */
/**
 * Internal links (route #/internal-links): the page shell of the mock. A row with the tabs (Pages, Links, Journey,
 * Tier flow) and the page actions (crawl in scope, Crawl now, Export, More), the summary strip, the crawl state
 * banner, then the tab's own panel. Each tab is a module with `render(host)` and `exportRows()`.
 * "Preview state" switches the screen through the crawl states of spec section 9. A reload starts from the fixtures.
 */
import { BUTTON_SM, icon, popover, toast } from './perf-ui.js';
import { el } from './prompts-parts.js';
import { crawls, currentCrawl, depth, flags, isLive, pages, plural, refresh, setRenderer, state, tierIdOf, tierPosition } from './il-model.js';
import * as pagesTab from './il-pages.js';
import * as linksTab from './il-links.js';
import * as journeyTab from './il-journey.js';
import * as flowTab from './il-flow.js';
import { closeInspector, redrawInspector } from './il-drawer.js';
import { openCrawlSettings, openImportTiers, openRules } from './il-dialogs.js';
import { mountSettings } from './il-settings.js';

const view = document.querySelector('[data-view="internal-links"]');
const TABS = [
  ['pages', 'Pages', 'file-text', pagesTab],
  ['links', 'Links', 'link', linksTab],
  ['journey', 'Journey', 'workflow', journeyTab],
  ['flow', 'Tier flow', 'grid-3x3', flowTab],
];
const REVIEW_STATES = [
  ['ready', 'Crawl ready'],
  ['running', 'Weekly crawl running'],
  ['first', 'First crawl running (website just added)'],
  ['failed', 'Last crawl failed'],
  ['ceiling', 'Stopped at the safety limit'],
  ['nowebsite', 'No website on the project'],
];
const ITEM = 'w-full min-h-9 px-2 rounded-md flex items-center gap-2 type-body text-foreground text-left hover:bg-surface-hover focus-visible:bg-surface-hover';

function menuItem(panel, api, label, { iconName, detail, checked, run }) {
  const node = el('button', ITEM);
  node.type = 'button';
  node.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemradio');
  if (checked !== undefined) node.setAttribute('aria-checked', String(checked));
  node.append(iconName ? icon(iconName, 'size-icon-sm text-foreground-tertiary') : el('span', 'size-4'), el('span', 'flex-1 truncate', label));
  if (detail) node.append(el('span', 'type-label text-foreground-tertiary whitespace-nowrap', detail));
  if (checked) node.append(icon('check', 'size-icon-sm text-primary-text'));
  node.addEventListener('click', () => {
    api.close();
    run();
  });
  panel.append(node);
}
const pad = (panel) => {
  panel.classList.add('p-1');
  return panel;
};

// -------------------------------------------------------------------------------------------------
// Crawl actions (spec 6.2)

function crawlNow() {
  if (state.review === 'running' || state.review === 'first') return;
  state.review = 'running';
  refresh();
  toast({ title: 'Crawl started', description: 'eventussecurity.com is being crawled. The tables keep showing the last crawl until it finishes.', tone: 'info' });
  setTimeout(() => {
    crawls.unshift({ id: `c${crawls.length + 1}`, when: 'Today, just now', short: 'Today', trigger: 'Crawl now', state: 'ready', pages: pages.length, cost: 0.006 });
    state.crawl = crawls[0].id;
    state.review = 'ready';
    refresh();
    toast({ title: 'Crawl finished', description: `${plural(pages.length, 'page')} crawled. No links to T1 pages were lost.`, tone: 'success' });
  }, 2600);
}

function crawlMenu(trigger) {
  popover(trigger, (panel, api) => {
    pad(panel);
    panel.append(el('p', 'px-2 pt-1 pb-2 type-label text-foreground-tertiary', 'Crawl shown'));
    crawls.forEach((crawl) => menuItem(panel, api, crawl.when, { detail: `${crawl.trigger}, ${plural(crawl.pages, 'page')}`, checked: crawl.id === state.crawl, run: () => {
      state.crawl = crawl.id;
      refresh();
      if (crawl.id !== crawls[0].id) toast({ title: `Showing the crawl of ${crawl.short}`, description: 'In this preview every crawl holds the same links. Changes between crawls arrive in slice 2.', tone: 'info' });
    } }));
  }, { label: 'Crawl shown' });
}

function moreMenu(trigger) {
  popover(trigger, (panel, api) => {
    pad(panel);
    menuItem(panel, api, 'Tier rules', { iconName: 'list-filter', run: openRules });
    menuItem(panel, api, 'Import tiers from CSV', { iconName: 'upload', run: openImportTiers });
    menuItem(panel, api, 'Crawl settings', { iconName: 'settings-2', run: openCrawlSettings });
    menuItem(panel, api, 'Edit page tiers', { iconName: 'layers', detail: 'Workspace', run: () => {
      location.hash = '#/settings/page-tiers';
    } });
  }, { label: 'More actions' });
}

function reviewMenu(trigger) {
  popover(trigger, (panel, api) => {
    pad(panel);
    panel.append(el('p', 'px-2 pt-1 pb-2 type-label text-foreground-tertiary', 'Preview state'));
    REVIEW_STATES.forEach(([value, label]) => menuItem(panel, api, label, { checked: state.review === value, run: () => {
      state.review = value;
      refresh();
    } }));
  }, { label: 'Preview state' });
}

function exportCurrent() {
  const tab = TABS.find(([key]) => key === state.tab)[3];
  const rows = tab.exportRows?.();
  if (!rows) {
    toast({ title: 'Nothing to export here', description: 'Export the Pages or Links tab, or the tier flow table.', tone: 'info' });
    return;
  }
  const text = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const link = el('a', '');
  link.href = URL.createObjectURL(new window.Blob([text], { type: 'text/csv' }));
  link.download = `internal-links-${state.tab}.csv`;
  link.click();
  toast({ title: 'Export ready', description: `${plural(rows.length - 1, 'row')} in internal-links-${state.tab}.csv.`, tone: 'success' });
}

// -------------------------------------------------------------------------------------------------
// The row above the panel

function tabs() {
  const group = el('div', 'inline-flex shrink-0');
  group.setAttribute('role', 'tablist');
  group.setAttribute('aria-label', 'Internal links views');
  TABS.forEach(([key, label, iconName], index) => {
    const selected = state.tab === key;
    const node = el('a', `inline-flex h-control-sm shrink-0 items-center justify-center gap-1.5 border px-2.5 type-body select-none ${index === 0 ? 'rounded-l-md' : '-ml-px'} ${index === TABS.length - 1 ? 'rounded-r-md' : ''} ${selected ? 'relative border-primary-border bg-primary-subtle type-body-strong text-primary-text' : 'border-border bg-surface text-foreground-secondary hover:bg-surface-hover hover:text-foreground'}`);
    node.href = key === 'pages' ? '#/internal-links' : `#/internal-links/${key}`;
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-selected', String(selected));
    node.append(icon(iconName, 'size-icon-sm shrink-0'), el('span', '', label));
    group.append(node);
  });
  return group;
}

function strip() {
  const live = pages.filter(isLive);
  const t1 = live.filter((page) => tierPosition(tierIdOf(page)) === 1);
  const reached = t1.filter((page) => depth[page.id] !== undefined);
  const items = [
    ['Pages', live.length.toLocaleString('en-US')],
    ['T1 pages', String(t1.length)],
    ['T1 average depth', reached.length ? (reached.reduce((sum, page) => sum + depth[page.id], 0) / reached.length).toFixed(1) : 'n/a'],
    ['No editorial links in', String(pages.filter((page) => flags(page).some((flag) => flag.key === 'editorialOrphan' || flag.key === 'orphan')).length)],
  ];
  const wrap = el('div', 'flex h-control-sm items-center gap-4');
  items.forEach(([label, value]) => {
    const item = el('span', 'flex items-baseline gap-1.5');
    item.append(el('span', 'type-meta text-foreground-secondary', label), el('span', 'type-body-strong num text-foreground', value));
    wrap.append(item);
  });
  return wrap;
}

function pageRow() {
  const row = el('div', 'flex flex-wrap items-center gap-x-4 gap-y-2');
  const left = el('div', 'min-w-0 flex-1 basis-96 flex flex-wrap items-center gap-x-4 gap-y-2');
  left.append(tabs());
  if (state.review !== 'nowebsite' && state.review !== 'first') left.append(strip());
  const right = el('div', 'ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2');
  const review = el('button', 'h-control-sm px-2 rounded-md border border-dashed border-border-strong flex items-center gap-1.5 whitespace-nowrap type-body text-foreground-secondary hover:bg-surface-hover');
  review.type = 'button';
  review.append(el('span', '', 'Preview state'), icon('chevron-down', 'size-icon-sm text-foreground-tertiary'));
  reviewMenu(review);
  right.append(review);
  if (state.review !== 'nowebsite' && state.review !== 'first') {
    const crawl = currentCrawl();
    const crawlButton = el('button', 'h-control-sm px-2 rounded-md flex items-center gap-1.5 whitespace-nowrap type-meta hover:bg-surface-hover hover:text-foreground');
    crawlButton.type = 'button';
    crawlButton.setAttribute('aria-label', `Crawl shown: ${crawl.when}`);
    crawlButton.append(icon('radar', 'size-icon-sm text-foreground-tertiary'), el('span', 'num', `Crawled ${crawl.short}, ${plural(crawl.pages, 'page')}`), icon('chevron-down', 'size-icon-sm text-foreground-tertiary'));
    crawlMenu(crawlButton);
    const more = el('button', 'size-control-sm rounded-md border border-border bg-surface flex items-center justify-center text-foreground-secondary hover:bg-surface-hover aria-expanded:bg-surface-selected');
    more.type = 'button';
    more.setAttribute('aria-label', 'More actions');
    more.append(icon('ellipsis', 'size-icon'));
    moreMenu(more);
    const exportButton = el('button', BUTTON_SM);
    exportButton.type = 'button';
    exportButton.append(icon('download', 'size-icon-sm text-foreground-tertiary'), el('span', '', 'Export'));
    exportButton.addEventListener('click', exportCurrent);
    const running = state.review === 'running';
    const now = el('button', `h-control-sm px-2 rounded-md bg-primary text-primary-foreground type-body-strong flex items-center gap-1.5 whitespace-nowrap hover:bg-primary-hover disabled:bg-surface-disabled disabled:text-foreground-disabled`);
    now.type = 'button';
    now.disabled = running;
    now.append(icon('refresh-cw', `size-icon-sm ${running ? 'animate-spin' : ''}`), el('span', '', running ? 'Crawling' : 'Crawl now'));
    now.addEventListener('click', crawlNow);
    right.append(crawlButton, more, exportButton, now);
  }
  row.append(left, right);
  return row;
}

// -------------------------------------------------------------------------------------------------
// Crawl states (spec 9)

function banner(tone, title, text, action) {
  const look = { info: 'border-info-border bg-info-subtle', warning: 'border-warning-border bg-warning-subtle', negative: 'border-negative-border bg-negative-subtle' }[tone];
  const iconName = { info: 'info', warning: 'triangle-alert', negative: 'circle-alert' }[tone];
  const iconTone = { info: 'text-info-text', warning: 'text-warning-text', negative: 'text-negative-text' }[tone];
  const box = el('div', `px-3 py-2 rounded-md border ${look} flex flex-wrap items-start gap-2`);
  box.setAttribute('role', 'status');
  box.append(icon(iconName, `size-icon shrink-0 mt-0.5 ${iconTone}`));
  const words = el('p', 'min-w-0 flex-1 basis-80 type-body text-foreground');
  words.append(el('span', 'type-body-strong', `${title} `), text);
  box.append(words);
  if (action) box.append(action);
  return box;
}

function smallButton(label, run) {
  const node = el('button', BUTTON_SM);
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', run);
  return node;
}

function stateBanner() {
  if (state.review === 'running') return banner('info', 'Crawling now: 312 pages found so far.', `You are seeing the crawl of ${crawls[0].short}. The tables switch to the new crawl when it finishes.`);
  if (state.review === 'failed') return banner('negative', 'The last crawl failed.', `eventussecurity.com answered 403 to our crawler on the start page, so nothing was crawled. Ask the site owner to allow the user agent "RSiteAuditor". You are seeing the crawl of ${crawls[0].short}.`, smallButton('Try again', crawlNow));
  if (state.review === 'ceiling') return banner('warning', 'Stopped at 6,000 pages.', 'The site has far more URLs than its sitemap lists (filter pages that never end). The pages found so far are shown.', smallButton('Crawl again with a higher limit', crawlNow));
  return null;
}

function emptyPanel(title, text, actions = []) {
  const box = el('div', 'rounded-lg border border-border bg-surface flex flex-col items-center gap-2 px-6 py-16 text-center');
  box.append(el('h2', 'type-section-title', title), el('p', 'type-body text-foreground-secondary max-w-md', text));
  if (actions.length) {
    const row = el('div', 'flex gap-2 pt-2');
    row.append(...actions);
    box.append(row);
  }
  return box;
}

function firstCrawlPanel() {
  const box = el('div', 'rounded-lg border border-border bg-surface overflow-hidden');
  const head = el('div', 'px-4 py-3 border-b border-border-subtle flex flex-wrap items-center gap-3');
  head.append(icon('radar', 'size-icon text-primary-text'), el('span', 'type-body-strong', 'Mapping eventussecurity.com'), el('span', 'type-meta num', '1,240 pages found so far. Started 4 minutes ago, when the website was added.'));
  const bar = el('div', 'h-0.5 bg-surface-subtle');
  bar.append(el('div', 'h-full w-2/5 bg-primary'));
  const body = el('div', 'p-4 flex flex-col gap-2');
  for (let index = 0; index < 8; index += 1) body.append(el('div', 'h-6 rounded-sm bg-surface-hover animate-skeleton-pulse'));
  box.append(head, bar, body, el('p', 'px-4 py-2 border-t border-border-subtle type-meta', 'Tag your most important pages while you wait: tiers do not need a crawl, and rules apply to every page the crawl finds.'));
  return box;
}

// -------------------------------------------------------------------------------------------------

function render() {
  const nodes = [pageRow()];
  if (state.review === 'nowebsite') {
    nodes.push(emptyPanel('Add your website to map internal links', 'Internal links crawls the project\'s website, then shows how its pages link to each other. The first crawl starts as soon as a website is added.', [smallButton('Open project settings', () => {
      location.hash = '#/settings/general';
    })]));
    view.replaceChildren(...nodes);
    return;
  }
  if (state.review === 'first') {
    nodes.push(firstCrawlPanel());
    view.replaceChildren(...nodes);
    return;
  }
  const note = stateBanner();
  if (note) nodes.push(note);
  const host = el('div', 'flex flex-col gap-4 min-w-0');
  nodes.push(host);
  view.replaceChildren(...nodes);
  TABS.find(([key]) => key === state.tab)[3].render(host);
  redrawInspector();
}

// -------------------------------------------------------------------------------------------------
// The app's top bar on this page, as on Keywords: the project is Eventus Security

const crumb = document.querySelector('button.truncate[data-popup="menu-project"]');
const sidebarName = document.querySelector('[data-project-name]');
const original = { crumb: crumb?.firstChild?.textContent, sidebar: sidebarName?.textContent };
function appChrome(on) {
  if (crumb?.firstChild) crumb.firstChild.textContent = on ? 'Eventus Security' : original.crumb;
  if (sidebarName) sidebarName.textContent = on ? 'Eventus Security' : original.sidebar;
}

setRenderer(render);
mountSettings();
window.addEventListener('preview-route', (event) => {
  if (event.detail.view !== 'internal-links') return;
  state.tab = event.detail.section ?? 'pages';
  appChrome(true);
  render();
});
window.addEventListener('preview-leave', (event) => {
  if (event.detail.from !== 'internal-links') return;
  appChrome(false);
  closeInspector();
});
if (location.hash.startsWith('#/internal-links')) {
  state.tab = location.hash.split('/')[2] || 'pages';
  appChrome(true);
  render();
}
