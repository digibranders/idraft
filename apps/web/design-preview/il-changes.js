/**
 * Internal links, Changes tab (spec slice 2): what changed since the last crawl, for the crawl in view against the one
 * before it. Lost and new links, the alert for links lost to important pages, and the pages that moved most.
 * Exports `render(host)` and `exportRows()`.
 */
import { BUTTON_SM, icon } from './perf-ui.js';
import { el } from './prompts-parts.js';
import {
  PLACEMENT_LABEL, activePages, alertMaxPosition, alertTierText, alertsFor, crawlSettings, currentCrawl, depth, flagBadge, ins, isLive, linkChanges, lostToTop, pageById, pageDelta, plural, previousCrawl, refresh, tierBadge, tierCode, tierIdOf, tierPosition,
} from './il-model.js';
import { openInspector } from './il-drawer.js';
import { openCrawlSettings } from './il-dialogs.js';
import { applyRestore, menuSelect, setRestore } from './il-pages.js';

const CELL = 'border-b border-border-subtle px-3 align-middle';
const HEAD = 'border-b border-border bg-surface-subtle px-3 align-middle font-normal text-left not-last:border-r not-last:border-r-border-subtle';
const PANEL = 'rounded-lg border border-border bg-surface overflow-hidden';
const CHANNEL_TEXT = { app: 'Alert sent in the app', email: 'Alert sent by email', slack: 'Alert sent in Slack' };
const showOptions = () => [['all', 'All lost links'], ['top', `Only ${alertTierText()} targets`]];
const LINK_SCOPES = [['editorial', 'Editorial'], ['all', 'All links']];

// null until the user picks: then it follows the crawl (important targets when there are any, else everything)
let lostScope = null;
// Which links the two panels count: editorial links (the default) or every kind of link
let lostLinkScope = 'editorial';
let addedLinkScope = 'editorial';

const path = (id) => pageById(id).path;
const isTop = (link) => {
  const position = tierPosition(tierIdOf(pageById(link.to)));
  return position >= 1 && position <= alertMaxPosition();
};
const targetPosition = (link) => tierPosition(tierIdOf(pageById(link.to))) || Infinity;
const byPriority = (a, b) => targetPosition(a) - targetPosition(b) || path(a.from).localeCompare(path(b.from));

export function exportRows() {
  const crawl = currentCrawl();
  const { added, lost } = linkChanges(crawl.id);
  const row = (change, link) => [change, path(link.from), path(link.to), link.anchor, PLACEMENT_LABEL[link.placement], tierCode(tierIdOf(pageById(link.to))), link.stillLinkedBy ?? '', crawl.short];
  return [
    ['Change', 'Source', 'Target', 'Anchor', 'Link type', 'Target tier', 'Still linked from', 'Crawl'],
    ...[...lost].sort(byPriority).map((link) => row('Lost', link)),
    ...[...added].sort(byPriority).map((link) => row('Added', link)),
  ];
}

// -------------------------------------------------------------------------------------------------
// Pieces

function pageButton(id) {
  const node = el('button', 'block w-full truncate type-table text-foreground text-left hover:underline');
  node.type = 'button';
  node.textContent = path(id);
  node.title = pageById(id).title;
  node.addEventListener('click', () => openInspector(id));
  return node;
}

function metric(label, value, sub, tone = 'text-foreground') {
  const item = el('div', 'flex min-w-0 flex-col gap-0.5 border-r border-border-subtle px-4 py-3 last:border-r-0');
  item.append(el('span', 'type-meta text-foreground-secondary', label), el('span', `type-section-title num ${tone}`, value), el('span', 'type-meta text-foreground-tertiary', sub));
  return item;
}

function strip(changes, since) {
  const top = lostToTop();
  const wrap = el('div', `${PANEL} grid grid-cols-2 md:grid-cols-4`);
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Changes since the last crawl');
  const sub = `since ${since}`;
  wrap.append(
    metric('Editorial links lost', changes.lost.length.toLocaleString('en-US'), sub),
    metric('Editorial links added', changes.added.length.toLocaleString('en-US'), sub),
    metric(`Lost to ${alertTierText()} pages`, top.length.toLocaleString('en-US'), `editorial links, ${sub}`, top.length > 0 ? 'text-negative-text' : 'text-foreground'),
    metric('Pages added', changes.addedPages.length.toLocaleString('en-US'), sub),
  );
  return wrap;
}

function alertBanner(alerts, since) {
  const { channel } = crawlSettings.alerts;
  const box = el('div', 'flex flex-wrap items-start gap-2 rounded-md border border-warning-border bg-warning-subtle px-3 py-2');
  box.setAttribute('role', 'status');
  const words = el('div', 'min-w-0 flex-1 basis-80 flex flex-col gap-0.5');
  words.append(
    el('p', 'type-body text-foreground', `${plural(alerts.length, 'editorial link')} to ${alertTierText()} pages ${alerts.length === 1 ? 'was' : 'were'} lost since ${since}.`),
    el('p', 'type-meta text-foreground-secondary', CHANNEL_TEXT[channel] ?? CHANNEL_TEXT.app),
  );
  const rules = el('button', BUTTON_SM, 'Change alert rules');
  rules.type = 'button';
  rules.addEventListener('click', openCrawlSettings);
  box.append(icon('triangle-alert', 'size-icon shrink-0 mt-0.5 text-warning-text'), words, rules);
  return box;
}

function panelHead(id, title, meta, extra) {
  const head = el('div', 'flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3');
  const words = el('div', 'min-w-0 flex-1 basis-64 flex flex-col gap-1');
  const heading = el('h2', 'type-subsection-title', title);
  heading.id = id;
  words.append(heading, el('p', 'type-meta text-foreground-secondary', meta));
  head.append(words);
  if (extra) head.append(extra);
  return head;
}

function emptyText(text, action) {
  const box = el('div', 'flex flex-col items-center gap-2 px-6 py-10 text-center');
  box.append(el('p', 'type-body text-foreground-secondary max-w-md', text));
  if (action) box.append(action);
  return box;
}

function table(label, columns, rows) {
  const node = el('table', 'table-fixed border-separate border-spacing-0 type-table w-full');
  node.style.minWidth = `${columns.reduce((sum, column) => sum + column.width, 0)}px`;
  node.setAttribute('aria-label', label);
  const widths = el('colgroup');
  const headRow = el('tr', 'h-row-header');
  columns.forEach((column) => {
    const col = el('col');
    col.style.width = `${column.width}px`;
    widths.append(col);
    const th = el('th', `${HEAD} ${column.right ? 'text-right' : ''}`);
    th.scope = 'col';
    th.append(el('span', 'truncate type-table-header text-foreground-tertiary', column.label));
    headRow.append(th);
  });
  const head = el('thead');
  head.append(headRow);
  const body = el('tbody');
  rows.forEach((cells) => {
    const row = el('tr', 'h-row bg-surface hover:bg-surface-hover');
    cells.forEach((cell, index) => {
      const holder = el(index === 0 ? 'th' : 'td', `${CELL} ${columns[index].right ? 'text-right' : ''} ${index === 0 ? 'text-left font-normal' : ''}`);
      if (index === 0) holder.scope = 'row';
      holder.append(cell);
      row.append(holder);
    });
    body.append(row);
  });
  node.append(widths, head, body);
  const scroller = el('div', 'overflow-x-auto');
  scroller.append(node);
  return scroller;
}

// A pair that is still linked another way (the menu, say) is a smaller loss: warning instead of negative
function priorityBadge(link) {
  const position = targetPosition(link);
  const tail = link.stillLinkedBy ? ', still in menu' : '';
  if (position === 1) return flagBadge({ label: `Lost to T1${tail}`, tone: link.stillLinkedBy ? 'warning' : 'negative' });
  if (position === 2) return flagBadge({ label: `Lost to T2${tail}`, tone: 'warning' });
  return flagBadge({ label: 'Lower priority', tone: 'neutral' });
}

function stillLinked(link) {
  return link.stillLinkedBy
    ? el('span', 'type-label text-foreground-secondary', `Still linked from ${link.stillLinkedBy}`)
    : el('span', 'type-label text-negative-text', 'No longer linked');
}

function linksPanel({ id, title, meta, rows, lost, empty, extra }) {
  const panel = el('section', PANEL);
  panel.setAttribute('aria-labelledby', id);
  panel.append(panelHead(id, title, meta, extra));
  if (rows.length === 0) {
    panel.append(empty);
    return panel;
  }
  const columns = [
    { label: 'Source page', width: 220 }, { label: 'Source tier', width: 88 }, { label: 'Target page', width: 220 }, { label: 'Target tier', width: 88 }, { label: 'Anchor', width: 200 }, { label: 'Link type', width: 120 },
    ...(lost ? [{ label: 'Priority', width: 200 }, { label: 'Still linked', width: 190 }] : []),
  ];
  panel.append(table(title, columns, rows.map((link) => [
    pageButton(link.from),
    tierBadge(tierIdOf(pageById(link.from))),
    pageButton(link.to),
    tierBadge(tierIdOf(pageById(link.to))),
    el('span', 'block truncate type-table text-foreground', `"${link.anchor}"`),
    el('span', 'type-table text-foreground', PLACEMENT_LABEL[link.placement]),
    ...(lost ? [priorityBadge(link), stillLinked(link)] : []),
  ])));
  return panel;
}

const delta = (value, suffix, goodWhenUp = true) => {
  if (value === 'lost') return el('span', 'type-label text-negative-text', 'No longer reachable');
  if (value === 'found') return el('span', 'type-label text-positive-text', 'Now reachable');
  if (value === null || value === 0) return null;
  const good = (value > 0) === goodWhenUp;
  return el('span', `type-label num ${good ? 'text-positive-text' : 'text-negative-text'}`, `${value > 0 ? '+' : ''}${suffix === ' pts' ? value.toFixed(1) : value}${suffix}`);
};
const withDelta = (value, change) => {
  const cell = el('span', 'inline-flex items-baseline justify-end gap-1.5');
  cell.append(el('span', 'type-table num text-foreground', value));
  if (change) cell.append(change);
  return cell;
};

/** Size of a click depth change; a page that became reachable or unreachable carries text, not a number. */
const depthMove = (change) => (typeof change.depth === 'number' ? Math.abs(change.depth) : 0);

function movedPanel(crawlId) {
  const rows = activePages()
    .filter(isLive)
    .map((page) => ({ page, change: pageDelta(page.id, crawlId) }))
    .filter(({ change }) => change.editorialIn !== null && (change.editorialIn !== 0 || (change.depth ?? 0) !== 0))
    .sort((a, b) => Math.abs(b.change.editorialIn) - Math.abs(a.change.editorialIn) || depthMove(b.change) - depthMove(a.change))
    .slice(0, 8);
  const panel = el('section', PANEL);
  panel.setAttribute('aria-labelledby', 'il-changes-moved-title');
  panel.append(panelHead('il-changes-moved-title', 'Pages that moved most', `The eight live pages whose editorial links in or click depth changed most since ${previousCrawl(crawlId)?.short ?? 'the last crawl'}.`));
  if (rows.length === 0) {
    panel.append(emptyText('No page moved: editorial links in and click depth are the same as in the last crawl.'));
    return panel;
  }
  panel.append(table('Pages that moved most', [
    { label: 'Page', width: 260 }, { label: 'Tier', width: 88 }, { label: 'Editorial links in', width: 150, right: true }, { label: 'Depth', width: 190, right: true },
  ], rows.map(({ page, change }) => [
    pageButton(page.id),
    tierBadge(tierIdOf(page)),
    withDelta(String(ins(page.id, 'editorial').length), delta(change.editorialIn, '')),
    withDelta(depth[page.id] === undefined ? 'n/a' : String(depth[page.id]), delta(change.depth, '', false)),
  ])));
  return panel;
}

// -------------------------------------------------------------------------------------------------

export function render(host) {
  const crawl = currentCrawl();
  const before = previousCrawl(crawl.id);
  if (!before) {
    const box = el('div', `${PANEL} flex flex-col items-center gap-2 px-6 py-16 text-center`);
    box.append(el('h2', 'type-section-title', 'This is the first crawl.'), el('p', 'type-body text-foreground-secondary max-w-md', 'Changes appear after the next crawl.'));
    host.append(box);
    return;
  }
  const since = before.short;
  const changes = linkChanges(crawl.id);
  const alerts = alertsFor();
  const lostChanges = linkChanges(crawl.id, lostLinkScope).lost;
  const top = lostChanges.filter(isTop);
  const scope = lostScope ?? (top.length > 0 ? 'top' : 'all');
  const lostRows = [...(scope === 'top' ? top : lostChanges)].sort(byPriority);
  const addedRows = linkChanges(crawl.id, addedLinkScope).added;
  const showAll = el('button', BUTTON_SM, 'Show all lost links');
  showAll.type = 'button';
  showAll.addEventListener('click', () => {
    lostScope = 'all';
    refresh();
  });
  const lostWord = lostLinkScope === 'all' ? 'links' : 'editorial links';
  const lostEmpty = lostChanges.length === 0
    ? emptyText(`No ${lostWord} were lost: every one from the last crawl is still there.`)
    : emptyText(`No lost link points to ${alertTierText()} pages. The links that were lost went to lower tiers.`, showAll);
  const linkScope = (label, value, set, key) => {
    const node = menuSelect('Links', LINK_SCOPES, value, (next) => {
      set(next);
      setRestore(key);
      refresh();
    }, label);
    node.dataset.restore = key;
    return node;
  };
  const lostControls = el('div', 'flex flex-wrap items-center gap-2');
  lostControls.append(linkScope('Lost links scope', lostLinkScope, (next) => (lostLinkScope = next), 'menu:Links:lost'));
  if (lostChanges.length > 0) {
    lostControls.append(menuSelect('Show', showOptions(), scope, (value) => {
      lostScope = value;
      refresh();
    }, 'Lost links shown'));
  }
  const wrap = el('div', 'flex flex-col gap-4 min-w-0');
  if (alerts.length > 0) wrap.append(alertBanner(alerts, since));
  wrap.append(
    strip(changes, since),
    linksPanel({
      id: 'il-changes-lost-title',
      title: 'Lost links',
      meta: `${lostLinkScope === 'all' ? 'Links' : 'Editorial links'} the crawl of ${since} had and this crawl no longer finds, one row per source and target page.`,
      rows: lostRows,
      lost: true,
      empty: lostEmpty,
      extra: lostControls,
    }),
    linksPanel({
      id: 'il-changes-added-title',
      title: 'New links',
      meta: `${addedLinkScope === 'all' ? 'Links' : 'Editorial links'} this crawl found that the crawl of ${since} did not have, one row per source and target page.`,
      rows: [...addedRows].sort(byPriority),
      lost: false,
      empty: emptyText(`No ${addedLinkScope === 'all' ? '' : 'editorial '}links were added: this crawl found nothing new.`),
      extra: linkScope('New links scope', addedLinkScope, (next) => (addedLinkScope = next), 'menu:Links:added'),
    }),
    movedPanel(crawl.id),
  );
  host.append(wrap);
  applyRestore(host);
}
