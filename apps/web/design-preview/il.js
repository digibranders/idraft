/* global document, window, location, setTimeout, clearTimeout, URL */
/**
 * Internal links (route #/internal-links): the page shell of the mock. A row with the tabs (Pages, Links, Journey,
 * Tier flow) and the page actions (crawl in scope, Crawl now, Export, More), the summary strip, the crawl state
 * banner, then the tab's own panel. Each tab is a module with `render(host)` and `exportRows()`.
 * "Preview state" switches the screen through the crawl states of spec section 9. A reload starts from the fixtures.
 */
import { BUTTON_SM, icon, popover, toast } from './perf-ui.js';
import { el } from './prompts-parts.js';
import {
  WORKLISTS, activePages, alertTierText, alertsFor, crawls, currentCrawl, depth, flags, isLive, links, lostToTop, opportunityCounts, pages, pct, plural, refresh, setCrawl, setRenderer, state, tierCode, tierFlow, tierIdOf, tierLabel, tierPosition, worklistCount, writeQuery,
} from './il-model.js';
import * as pagesTab from './il-pages.js';
import * as linksTab from './il-links.js';
import * as journeyTab from './il-journey.js';
import * as flowTab from './il-flow.js';
import * as changesTab from './il-changes.js';
import * as oppsTab from './il-opps.js';
import { closeInspector, redrawInspector } from './il-drawer.js';
import { openAddWebsite, openCrawlSettings, openImportTiers, openRules } from './il-dialogs.js';
import { mountSettings } from './il-settings.js';

const view = document.querySelector('[data-view="internal-links"]');
const TABS = [
  ['pages', 'Pages', 'file-text', pagesTab],
  ['links', 'Links', 'link', linksTab],
  ['journey', 'Journey', 'workflow', journeyTab],
  ['flow', 'Tier flow', 'grid-3x3', flowTab],
  ['changes', 'Changes', 'history', changesTab],
  ['opportunities', 'Opportunities', 'sparkles', oppsTab],
];
// An address with a tab we do not have (an old link, a typo) shows the first tab instead of failing
const knownTab = (key) => (TABS.some(([tab]) => tab === key) ? key : 'pages');
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

/**
 * The preview's new crawl finds the same links as the latest one: every link and page the latest crawl saw is seen
 * again, so it stays active, and the crawl joins the front of the list.
 */
function addCrawl() {
  const previous = crawls[0];
  const n = previous.n + 1;
  links.forEach((link) => {
    if (link.lastSeen === previous.n) link.lastSeen = n;
  });
  pages.forEach((page) => {
    if (page.lastSeen === previous.n) page.lastSeen = n;
  });
  const count = pages.filter((page) => page.since <= n && (page.lastSeen ?? Infinity) >= n).length;
  crawls.unshift({ id: `c${n}`, n, when: 'Today, just now', short: 'Today', trigger: 'Manual', state: 'ready', pages: count, cost: 0.006 });
  return crawls[0];
}

function crawlNow() {
  if (state.review === 'running' || state.review === 'first') return;
  state.review = 'running';
  refresh();
  toast({ title: 'Crawl started', description: 'eventussecurity.com is being crawled. The tables keep showing the last crawl until it finishes.', tone: 'info' });
  setTimeout(() => {
    const crawl = addCrawl();
    state.review = 'ready';
    setCrawl(crawl.id);
    const lost = lostToTop(crawl.id).length;
    toast({ title: `Crawl finished: ${plural(crawl.pages, 'page')} mapped.`, description: lost === 0 ? `No editorial links to ${alertTierText()} pages were lost.` : `${plural(lost, 'editorial link')} to ${alertTierText()} pages ${lost === 1 ? 'was' : 'were'} lost.`, tone: 'success' });
  }, 2600);
}

function crawlMenu(trigger) {
  popover(trigger, (panel, api) => {
    pad(panel);
    panel.append(el('p', 'px-2 pt-1 pb-2 type-label text-foreground-tertiary', 'Crawl shown'));
    crawls.forEach((crawl) => menuItem(panel, api, crawl.when, { detail: `${crawl.trigger}, ${plural(crawl.pages, 'page')}`, checked: crawl.id === state.crawl, run: () => {
      if (crawl.id === state.crawl) return;
      setCrawl(crawl.id);
      if (crawl.id !== crawls[0].id) toast({ title: `Showing eventussecurity.com as crawled on ${crawl.short}.`, description: 'Tier changes still apply.', tone: 'info' });
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

function download(text, type, name) {
  const link = el('a', '');
  link.href = URL.createObjectURL(new window.Blob([text], { type }));
  link.download = name;
  link.click();
}

function exportCurrent() {
  const tab = TABS.find(([key]) => key === state.tab)[3];
  const rows = tab.exportRows?.();
  if (!rows) {
    toast({ title: 'Nothing to export here', description: 'Export the Pages, Links, Tier flow, Changes or Opportunities tab.', tone: 'info' });
    return;
  }
  download(rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv', `internal-links-${state.tab}.csv`);
  toast({ title: 'Export ready', description: `${plural(rows.length - 1, 'row')} in internal-links-${state.tab}.csv.`, tone: 'success' });
}

const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TH = 'border-bottom:1px solid #d4d4d8;padding:6px 10px;text-align:left;font-weight:600;background:#f4f4f5';
const TD = 'border-bottom:1px solid #e4e4e7;padding:6px 10px';
const htmlTable = (head, rows) => `<table style="border-collapse:collapse;width:100%;font-size:14px;margin:8px 0 24px"><thead><tr>${head.map((cell) => `<th style="${TH}">${esc(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td style="${TD}">${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

/** A self-contained report for a client: the tiers, the flow between them, the open worklists and the links lost to important pages. */
function clientSummary() {
  const crawl = currentCrawl();
  const flow = tierFlow('editorial');
  const total = activePages().length;
  const tierRows = flow.strip.map((row) => [tierLabel(row.key), row.pages.toLocaleString('en-US'), pct(total ? row.pages / total : 0), row.depth === null ? 'n/a' : row.depth.toFixed(1)]);
  const matrixRows = flow.keys.map((from) => [tierCode(from), ...flow.keys.map((to) => flow.matrix.get(from).get(to).toLocaleString('en-US'))]);
  const open = WORKLISTS.map((list) => [list.label, worklistCount(list.key)]).filter(([, count]) => count > 0).map(([label, count]) => [label, count.toLocaleString('en-US')]);
  const lost = lostToTop().map((link) => [pageOf(link.from), pageOf(link.to), link.anchor]);
  const heading = (text) => `<h2 style="font-size:18px;margin:24px 0 4px">${esc(text)}</h2>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Internal links summary for eventussecurity.com</title></head>
<body style="font-family:system-ui,sans-serif;color:#18181b;max-width:880px;margin:32px auto;padding:0 16px;line-height:1.5">
<h1 style="font-size:24px;margin:0 0 4px">Internal links summary for eventussecurity.com</h1>
<p style="margin:0;color:#52525b">Crawl of ${esc(crawl.when)}, ${esc(plural(crawl.pages, 'page'))}.</p>
${heading('Tiers')}${htmlTable(['Tier', 'Pages', 'Share of pages', 'Average depth'], tierRows)}
${heading('Links between tiers')}<p style="margin:0;color:#52525b">Editorial links, one per pair of pages. Rows link to columns.</p>${htmlTable(['From', ...flow.keys.map((key) => `To ${tierCode(key)}`)], matrixRows)}
${heading('Open worklists')}${open.length ? htmlTable(['Worklist', 'Pages'], open) : '<p style="color:#52525b">No worklist has pages in this crawl.</p>'}
${heading(`Lost editorial links to ${alertTierText()} pages`)}${lost.length ? htmlTable(['Source page', 'Target page', 'Anchor'], lost) : `<p style="color:#52525b">No editorial links to ${alertTierText()} pages were lost since the last crawl.</p>`}
<p style="margin:32px 0 0;padding-top:12px;border-top:1px solid #d4d4d8;color:#52525b;font-size:13px">Link counts use editorial links.</p>
</body></html>`;
  download(html, 'text/html', 'internal-links-summary.html');
  toast({ title: 'Client summary ready', description: 'Saved as internal-links-summary.html.', tone: 'success' });
}
const pageOf = (id) => pages.find((page) => page.id === id).path;

function exportMenu(trigger) {
  popover(trigger, (panel, api) => {
    pad(panel);
    menuItem(panel, api, 'Export this tab (CSV)', { iconName: 'download', run: exportCurrent });
    menuItem(panel, api, 'Client summary (HTML)', { iconName: 'file-text', run: clientSummary });
  }, { label: 'Export' });
}

// -------------------------------------------------------------------------------------------------
// The row above the panel

function tabs() {
  // Six tabs are wider than a phone: the group scrolls inside itself instead of widening the page
  // `relative` keeps the screen-reader-only badge text inside this scroller instead of widening the page
  const group = el('div', 'relative inline-flex max-w-full overflow-x-auto');
  group.setAttribute('role', 'tablist');
  group.setAttribute('aria-label', 'Internal links views');
  TABS.forEach(([key, label, iconName], index) => {
    const selected = state.tab === key;
    const node = el('a', `inline-flex h-control-sm shrink-0 items-center justify-center gap-1.5 border px-2.5 type-body select-none ${index === 0 ? 'rounded-l-md' : '-ml-px'} ${index === TABS.length - 1 ? 'rounded-r-md' : ''} ${selected ? 'relative border-primary-border bg-primary-subtle type-body-strong text-primary-text' : 'border-border bg-surface text-foreground-secondary hover:bg-surface-hover hover:text-foreground'}`);
    node.href = key === 'pages' ? '#/internal-links' : `#/internal-links/${key}`;
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-selected', String(selected));
    node.append(icon(iconName, 'size-icon-sm shrink-0'), el('span', '', label));
    const alerts = key === 'changes' ? alertsFor().length : 0;
    const open = key === 'opportunities' ? opportunityCounts().open : 0;
    // The badge is for sighted users; the hidden text gives the tab the name "Changes, 3 alerts"
    const badge = (count, text, tone) => {
      const visible = el('span', `inline-flex h-badge min-w-5 items-center justify-center rounded-sm px-1 type-label num ${tone}`, String(count));
      visible.setAttribute('aria-hidden', 'true');
      node.append(visible, el('span', 'sr-only', `, ${text}`));
    };
    if (alerts > 0) badge(alerts, plural(alerts, 'alert'), 'bg-negative-subtle text-negative-text');
    else if (open > 0) badge(open, `${open.toLocaleString('en-US')} open`, 'bg-surface-subtle text-foreground-secondary');
    group.append(node);
  });
  return group;
}

function showUntiered() {
  Object.assign(state, { worklist: null, search: '', filters: [{ field: 'tier', value: 'none', label: 'Tier: Untiered' }] });
  state.selected.clear();
  if (location.hash === '#/internal-links') refresh();
  else location.hash = '#/internal-links';
}

function strip() {
  const live = activePages().filter(isLive);
  const t1 = live.filter((page) => tierPosition(tierIdOf(page)) === 1);
  const reached = t1.filter((page) => depth[page.id] !== undefined);
  const active = activePages();
  const tiered = active.filter((page) => tierIdOf(page)).length;
  const lostTop = lostToTop().length;
  const goChanges = () => {
    location.hash = '#/internal-links/changes';
  };
  const items = [
    ['Pages', active.length.toLocaleString('en-US')],
    ['Tiered', `${tiered.toLocaleString('en-US')} of ${active.length.toLocaleString('en-US')}`, tiered < active.length ? showUntiered : null, 'Show the pages without a tier'],
    ['T1 pages', String(t1.length)],
    ['T1 average depth', reached.length ? (reached.reduce((sum, page) => sum + depth[page.id], 0) / reached.length).toFixed(1) : 'n/a'],
    ['No editorial links in', String(active.filter((page) => flags(page).some((flag) => flag.key === 'editorialOrphan' || flag.key === 'orphan')).length)],
    ...(lostTop > 0 ? [[`Lost editorial links to ${alertTierText()}`, String(lostTop), goChanges, 'Show what changed since the last crawl', true]] : []),
  ];
  const wrap = el('div', 'hidden h-control-sm items-center gap-4 md:flex');
  items.forEach(([label, value, run, title, negative]) => {
    const item = el(run ? 'button' : 'span', 'flex items-baseline gap-1.5');
    if (run) {
      item.type = 'button';
      item.title = title;
      item.addEventListener('click', run);
    }
    item.append(el('span', 'type-meta text-foreground-secondary', label), el('span', `type-body-strong num ${run ? `${negative ? 'text-negative-text' : 'text-link'} underline` : 'text-foreground'}`, value));
    wrap.append(item);
  });
  return wrap;
}

function pageRow() {
  const row = el('div', 'flex flex-wrap items-center gap-x-4 gap-y-2');
  // Six tabs plus the actions need a row of their own; the summary strip sits on the next row
  const left = el('div', 'min-w-0 flex flex-wrap items-center gap-x-4 gap-y-2');
  left.append(tabs());
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
    const older = crawl.id !== crawls[0].id;
    const olderBadge = el('span', 'inline-flex h-badge items-center rounded-sm px-1.5 type-label whitespace-nowrap bg-warning-subtle text-warning-text', 'Older crawl');
    const latest = smallButton('Back to latest', () => setCrawl(crawls[0].id));
    const more = el('button', 'size-control-sm rounded-md border border-border bg-surface flex items-center justify-center text-foreground-secondary hover:bg-surface-hover aria-expanded:bg-surface-selected');
    more.type = 'button';
    more.setAttribute('aria-label', 'More actions');
    more.append(icon('ellipsis', 'size-icon'));
    moreMenu(more);
    const exportButton = el('button', BUTTON_SM);
    exportButton.type = 'button';
    exportButton.append(icon('download', 'size-icon-sm text-foreground-tertiary'), el('span', '', 'Export'));
    exportMenu(exportButton);
    const running = state.review === 'running';
    const now = el('button', `h-control-sm px-2 rounded-md bg-primary text-primary-foreground type-body-strong flex items-center gap-1.5 whitespace-nowrap hover:bg-primary-hover disabled:bg-surface-disabled disabled:text-foreground-disabled`);
    now.type = 'button';
    now.disabled = running;
    now.append(icon('refresh-cw', `size-icon-sm ${running ? 'animate-spin' : ''}`), el('span', '', running ? 'Crawling' : 'Crawl now'));
    now.addEventListener('click', crawlNow);
    right.append(crawlButton, ...(older ? [olderBadge, latest] : []), more, exportButton, now);
  }
  row.append(left, right);
  const wrap = el('div', 'flex flex-col gap-2');
  wrap.append(row);
  if (state.review !== 'nowebsite' && state.review !== 'first') wrap.append(strip());
  return wrap;
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
  const lead = el('div', 'flex flex-col gap-2 px-4 py-3 border-b border-border-subtle');
  const actions = el('div', 'flex flex-wrap items-center gap-2');
  actions.append(smallButton('Set up tier rules', openRules), smallButton('Import tiers from CSV', openImportTiers));
  lead.append(el('p', 'type-body text-foreground', 'Tag your most important pages while you wait. Tiers do not need a crawl, and rules apply to every page the crawl finds.'), actions);
  box.append(head, bar, lead, body);
  return box;
}

// -------------------------------------------------------------------------------------------------

let firstTimer = null;

function render() {
  writeQuery();
  // The first crawl of a just-added website finishes by itself in the preview
  if (state.review === 'first' && firstTimer === null) {
    firstTimer = setTimeout(() => {
      firstTimer = null;
      if (state.review !== 'first') return;
      state.review = 'ready';
      refresh();
      toast({ title: 'First crawl finished: 40 pages mapped', tone: 'success' });
    }, 6000);
  } else if (state.review !== 'first' && firstTimer !== null) {
    clearTimeout(firstTimer);
    firstTimer = null;
  }
  const nodes = [pageRow()];
  if (state.review === 'nowebsite') {
    nodes.push(emptyPanel('Add your website to map internal links', 'Internal links crawls the project\'s website, then shows how its pages link to each other. The first crawl starts as soon as a website is added.', [smallButton('Add website', openAddWebsite)]));
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
  state.tab = knownTab(event.detail.section);
  appChrome(true);
  render();
});
window.addEventListener('preview-leave', (event) => {
  if (event.detail.from !== 'internal-links') return;
  appChrome(false);
  closeInspector();
  // writeQuery put this page's query in the address; the next page must not inherit it
  window.history.replaceState(null, '', location.pathname + location.hash);
});
if (location.hash.startsWith('#/internal-links')) {
  state.tab = knownTab(location.hash.split('/')[2]);
  appChrome(true);
  render();
}
