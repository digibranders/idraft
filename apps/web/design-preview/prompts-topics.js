/* global document, window */
/**
 * The Topics tab: one row per topic of the taxonomy, with the prompts of the scope grouped under it.
 * The chevron opens a topic's prompts in place; the row opens the topic drawer; a prompt row opens the prompt
 * drawer. A topic's numbers are computed from its prompts (prompts-data.js, "group" measures).
 */
import { formatInteger, formatPercent, formatSampleCount } from './vendor/format/number.js';
import { MIN_OBSERVATIONS } from './vendor/stats/index.js';
import { groupAverage, groupChange, groupRate, groupTrend, groupUpdated, rateFor, seoOf, topicsOf } from './prompts-data.js';
import { focusSearchOnSlash, plainHeaderCell, promptLine, promptRateCell, promptTrendCell, promptUpdatedCell, rateCell, rowMenuCell, sortHeaderCell, sparkCell, topEngineCell, updatedCell, valueCell, wireColumnChooser } from './prompts-cells.js';
import { el, percent0, plural } from './prompts-parts.js';
import { deltaNode, scopeCodes, scopeEngines, scopePrompts, scopeText, state } from './prompts-state.js';

const ui = window.PreviewUI;
const charts = window.PreviewCharts;
const { $, icon, openPopup, closePopup } = ui;

const view = $('[data-view="prompts"]');
const head = $('[data-topic-head]', view);
const body = $('[data-topic-rows]', view);
const list = $('[data-topic-list]', view);
const toolbar = $('[data-topic-toolbar]', view);
const bulkBar = $('[data-topic-bulk]', view);
const empty = $('[data-topic-empty]', view);
const region = $('[data-topic-table]', view).parentElement;
const menu = $('#menu-topic-row');

/** How many prompts open under a topic before "Show all": the rest are in the topic drawer. */
const CHILD_LIMIT = 8;

let host = null;
/** Every topic of the scope, and the ones the table shows (after its search), in display order. */
let allTopics = [];
let shownTopics = [];
let menuTopicId = null;
/** What the topic menu was opened from: focus returns there when the menu starts a dialog. */
let menuAnchor = null;

// -------------------------------------------------------------------------------------------------
// Measures of a topic, for the engines in scope

function summarize(topic) {
  const scope = scopeCodes();
  return {
    ...topic,
    mention: groupAverage(topic.prompts, scope, 'mention'),
    mentionChange: groupChange(topic.prompts, scope, 'mention'),
    citation: groupAverage(topic.prompts, scope, 'citation'),
    engineRates: scopeEngines().map((engine) => ({ engine, rate: groupRate(topic.prompts, engine.code, 'mention').rate })),
    trend: groupTrend(topic.prompts, scope),
    updated: groupUpdated(topic.prompts),
    // The topic's tracked keywords. The prompt filters do not reach them: they are the search side of the topic
    seo: seoOf(topic.name),
  };
}

const SORTS = {
  topic: (topic) => topic.name.toLowerCase(),
  prompts: (topic) => topic.prompts.length,
  mention: (topic) => topic.mention.value,
  citation: (topic) => topic.citation.value,
  seo: (topic) => topic.seo.visibility,
  top10: (topic) => topic.seo.top10,
  updated: (topic) => topic.updated.order,
};

function compute() {
  allTopics = topicsOf(scopePrompts()).map(summarize);
  // Sorting by a column that is not shown would leave no sort indicator
  if (!['topic', 'mention'].includes(state.topicSort.key) && !shows(state.topicSort.key)) state.topicSort = { key: 'mention', dir: 'desc' };
  const { key, dir } = state.topicSort;
  const search = state.topicSearch;
  shownTopics = allTopics
    .filter((topic) => search === '' || topic.name.toLowerCase().includes(search) || topic.parent.toLowerCase().includes(search))
    .map((topic) => ({ topic, value: SORTS[key](topic) }))
    .sort((a, b) => {
      // Unknown values sort last in both directions (12 section 7)
      if (a.value === null || b.value === null) return a.value === b.value ? 0 : a.value === null ? 1 : -1;
      const order = typeof a.value === 'string' ? a.value.localeCompare(b.value) : a.value - b.value;
      return dir === 'asc' ? order : -order;
    })
    .map((entry) => entry.topic);
}

/** The prompts of a topic in the order they are listed everywhere: most mentioned first, unknown last. */
export function promptsByMention(topic) {
  const scope = scopeCodes();
  const valueOf = (prompt) => {
    const rates = scope.map((code) => rateFor(prompt, code, 'mention')).filter((rate) => rate !== null);
    return rates.length === 0 ? -1 : rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  };
  return [...topic.prompts].sort((a, b) => valueOf(b) - valueOf(a));
}

// -------------------------------------------------------------------------------------------------
// Header

/**
 * Optional columns, in the order they are chosen from, with the width from which the table shows each. Topic and
 * Mention rate are always there. The two search columns make this the one table that shows a topic on both
 * channels (ADR-DS-022).
 */
const COLUMNS = [
  { key: 'prompts', label: 'Prompts', from: 1280, cell: 'hidden xl:table-cell' },
  { key: 'citation', label: 'Citation rate', from: 1280, cell: 'hidden xl:table-cell' },
  { key: 'engine', label: 'Top engine', from: 1280, cell: 'hidden xl:table-cell' },
  { key: 'trend', label: 'Trend', from: 1440, cell: 'hidden 2xl:table-cell' },
  { key: 'seo', label: 'SEO visibility', from: 1440, cell: 'hidden 2xl:table-cell' },
  { key: 'top10', label: 'Top 10 keywords', from: 1440, cell: 'hidden 2xl:table-cell' },
  { key: 'updated', label: 'Updated', from: 1680, cell: 'hidden 3xl:table-cell' },
];
const COLUMN = Object.fromEntries(COLUMNS.map((column) => [column.key, column.cell]));
const allColumns = () => new Set(COLUMNS.map((column) => column.key));
state.topicColumns = allColumns();
const shows = (key) => state.topicColumns.has(key);
const sortHeader = (key, label, className, options = {}) => sortHeaderCell({ key, label, className, ...options, sort: state.topicSort, attr: 'topicSort' });
const plainHeader = plainHeaderCell;

function renderHead() {
  const engines = scopeEngines();
  const note = engines.length > 1 ? `avg of ${engines.length}` : engines[0].name;
  const row = el('tr', 'h-row-header text-left');
  const select = el('th', 'w-10 pl-4 pr-2 border-r border-border-subtle');
  const all = el('input', 'size-4 rounded-sm accent-primary align-middle');
  all.type = 'checkbox';
  all.dataset.topicAll = '';
  all.setAttribute('aria-label', 'Select all topics');
  select.append(all);
  const actions = el('th', 'w-10');
  actions.append(el('span', 'sr-only', 'Row actions'));
  const cells = {
    prompts: () => sortHeader('prompts', 'Prompts', `${COLUMN.prompts} w-24 px-1 text-right border-r border-border-subtle`),
    citation: () => sortHeader('citation', 'Citation rate', `${COLUMN.citation} w-32 px-1 text-right border-r border-border-subtle`, { note }),
    engine: () => plainHeader('Top engine', `${COLUMN.engine} w-40`),
    trend: () => plainHeader('Trend', `${COLUMN.trend} w-24`),
    seo: () => sortHeader('seo', 'SEO visibility', `${COLUMN.seo} w-32 px-1 text-right border-r border-border-subtle`, { note: 'volume-weighted' }),
    top10: () => sortHeader('top10', 'Top 10', `${COLUMN.top10} w-28 px-1 text-right border-r border-border-subtle`, { note: 'keywords' }),
    updated: () => sortHeader('updated', 'Updated', `${COLUMN.updated} w-36 px-1 border-r border-border-subtle`, { align: 'justify-start' }),
  };
  row.append(
    select,
    sortHeader('topic', 'Topic', 'sticky left-0 z-(--z-pinned-cell) bg-surface-subtle min-w-60 px-1 text-left border-r border-border-subtle', { align: 'justify-start' }),
    ...(shows('prompts') ? [cells.prompts()] : []),
    sortHeader('mention', 'Mention rate', 'w-32 px-1 text-right border-r border-border-subtle', { note }),
    ...['citation', 'engine', 'trend', 'seo', 'top10', 'updated'].filter(shows).map((key) => cells[key]()),
    actions,
  );
  head.replaceChildren(row);
}

// -------------------------------------------------------------------------------------------------
// Rows


/** The optional columns right of Mention rate, in table order. */
const OPTIONAL_AFTER_MENTION = ['citation', 'engine', 'trend', 'seo', 'top10', 'updated'];

function topicRateCell(topic, metric) {
  const average = topic[metric];
  const engines = scopeEngines().map((engine) => engine.name).join(', ');
  const observed = topic.prompts.reduce((sum, prompt) => sum + scopeCodes().reduce((total, code) => total + prompt.engines[code].n, 0), 0);
  return rateCell({
    value: average.value,
    change: metric === 'mention' ? topic.mentionChange : null,
    sample: `${formatSampleCount(average.pooled.k, average.pooled.n)} obs`,
    tip: average.used === 1 ? `${engines} only` : `Equal-weight average of ${engines}, each prompt counting once`,
    gap: { text: observed === 0 ? 'n/a' : 'Insufficient', tip: observed === 0 ? 'Not observed in this window' : `${plural(observed, 'observation')} in this topic. A rate needs at least ${MIN_OBSERVATIONS} on an engine.` },
  });
}

function topicRow(topic) {
  const open = state.expanded.has(topic.id);
  const row = el('tr', 'group border-t border-border-subtle hover:bg-surface-hover cursor-pointer');
  row.dataset.id = topic.id;
  row.dataset.topic = '';
  const select = el('td', 'w-10 pl-4 pr-2');
  const box = el('input', 'size-4 rounded-sm accent-primary align-middle');
  box.type = 'checkbox';
  box.checked = state.topicSelected.has(topic.id);
  box.setAttribute('aria-label', `Select ${topic.name}`);
  select.append(box);

  const name = el('th', 'sticky left-0 z-(--z-pinned-cell) bg-surface group-hover:bg-surface-hover group-aria-selected:bg-surface-selected w-full min-w-60 max-w-0 px-3 py-2 text-left font-normal');
  name.scope = 'row';
  const line = el('span', 'flex items-center gap-2 min-w-0');
  const toggle = el('button', 'size-6 shrink-0 rounded-md flex items-center justify-center text-foreground-tertiary hover:bg-surface-hover hover:text-foreground');
  toggle.type = 'button';
  toggle.dataset.topicToggle = '';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} the ${plural(topic.prompts.length, 'prompt')} in ${topic.name}`);
  toggle.append(icon(open ? 'chevron-down' : 'chevron-right', 'size-icon'));
  const text = el('span', 'min-w-0 flex flex-col');
  const title = el('span', 'truncate type-body-strong text-foreground', topic.name);
  title.dataset.keyCell = '';
  text.append(title, el('span', 'truncate type-label', `${topic.parent} · ${plural(topic.prompts.length, 'prompt')}`));
  line.append(toggle, text);
  name.append(line);

  const searchTip = 'The tracked keywords of this topic. The prompt filters do not apply to them';
  const cells = {
    citation: () => {
      const cell = topicRateCell(topic, 'citation');
      cell.classList.add(...COLUMN.citation.split(' '));
      return cell;
    },
    engine: () => topEngineCell(topic.engineRates, COLUMN.engine),
    trend: () => sparkCell(topic.trend, COLUMN.trend),
    seo: () => valueCell({ text: formatPercent(topic.seo.visibility), sample: plural(topic.seo.tracked, 'keyword'), tip: searchTip }, COLUMN.seo),
    top10: () => valueCell({ text: formatInteger(topic.seo.top10), sample: `of ${formatInteger(topic.seo.checked)} checked`, tip: searchTip }, COLUMN.top10),
    updated: () => updatedCell(topic.updated, COLUMN.updated),
  };
  row.append(
    select,
    name,
    ...(shows('prompts') ? [el('td', `${COLUMN.prompts} px-3 text-right num`, formatInteger(topic.prompts.length))] : []),
    topicRateCell(topic, 'mention'),
    ...OPTIONAL_AFTER_MENTION.filter(shows).map((key) => cells[key]()),
    rowMenuCell('topic', topic.name),
  );
  return row;
}

/** A prompt grouped under its topic: the same columns, indented, on the subtle surface. */
function childRow(prompt, topic) {
  // The aria-selected variant outranks the subtle fill when this prompt is the one open in the drawer
  const row = el('tr', 'group h-row border-t border-border-subtle bg-surface-subtle aria-selected:bg-surface-selected hover:bg-surface-hover cursor-pointer');
  row.dataset.id = prompt.id;
  row.dataset.childOf = topic.id;
  const name = el('th', 'sticky left-0 z-(--z-pinned-cell) bg-surface-subtle group-hover:bg-surface-hover group-aria-selected:bg-surface-selected w-full min-w-60 max-w-0 pl-11 pr-3 py-1.5 text-left font-normal');
  name.scope = 'row';
  name.append(promptLine(prompt));
  const rates = scopeEngines().map((engine) => ({ engine, rate: rateFor(prompt, engine.code, 'mention') }));
  const cells = {
    citation: () => {
      const cell = promptRateCell(prompt, 'citation', false);
      cell.classList.add(...COLUMN.citation.split(' '));
      return cell;
    },
    engine: () => topEngineCell(rates, COLUMN.engine),
    trend: () => promptTrendCell(prompt, COLUMN.trend),
    // Keywords belong to the topic, not to one prompt: the search columns stay empty on a prompt row
    seo: () => el('td', COLUMN.seo),
    top10: () => el('td', COLUMN.top10),
    updated: () => promptUpdatedCell(prompt, COLUMN.updated),
  };
  row.append(
    el('td', 'w-10'),
    name,
    ...(shows('prompts') ? [el('td', COLUMN.prompts)] : []),
    promptRateCell(prompt, 'mention', true),
    ...OPTIONAL_AFTER_MENTION.filter(shows).map((key) => cells[key]()),
    rowMenuCell('prompt', prompt.text),
  );
  return row;
}

function moreRow(topic, shown) {
  const row = el('tr', 'h-row border-t border-border-subtle bg-surface-subtle');
  row.dataset.moreOf = topic.id;
  const cell = el('td', 'pl-21 pr-3');
  // Select, Topic, Mention rate and the actions, plus the optional columns that are on
  cell.colSpan = 4 + state.topicColumns.size;
  const button = el('button', 'type-body text-link hover:underline', `Show all ${plural(topic.prompts.length, 'prompt')}`);
  button.type = 'button';
  button.dataset.topicMore = '';
  cell.append(button, el('span', 'ml-2 type-meta', `${shown} most mentioned shown`));
  row.append(cell);
  return row;
}

function listRow(topic) {
  const item = el('li');
  const link = el('a', 'block min-h-14 px-3 py-2');
  link.href = '#';
  link.dataset.openId = topic.id;
  const first = el('span', 'flex items-center gap-3');
  const value = topic.mention.value;
  first.append(el('span', 'truncate type-body-strong', topic.name), el('span', `ml-auto type-body-strong num${value === null ? ' text-foreground-tertiary' : ''}`, value === null ? 'n/a' : percent0(value)));
  const second = el('span', 'flex items-center gap-3');
  second.append(el('span', 'truncate type-meta', `${topic.parent} · ${plural(topic.prompts.length, 'prompt')}`));
  const delta = deltaNode(topic.mentionChange);
  if (delta) {
    delta.classList.add('ml-auto', 'type-table');
    second.append(delta);
  }
  link.append(first, second);
  item.append(link);
  return item;
}

function renderRows() {
  const rows = [];
  for (const topic of shownTopics) {
    rows.push(topicRow(topic));
    if (!state.expanded.has(topic.id)) continue;
    const prompts = promptsByMention(topic);
    prompts.slice(0, CHILD_LIMIT).forEach((prompt) => rows.push(childRow(prompt, topic)));
    if (prompts.length > CHILD_LIMIT) rows.push(moreRow(topic, CHILD_LIMIT));
  }
  body.replaceChildren(...rows);
  list.replaceChildren(...shownTopics.map(listRow));
  const none = shownTopics.length === 0;
  empty.hidden = !none;
  region.classList.toggle('md:block', !none);
  if (none) {
    $('[data-topic-empty-text]', empty).textContent =
      state.topicSearch !== '' ? `No topic in this scope (${scopeText()}) is called "${state.topicSearch}".` : `The scope is ${scopeText()}. Remove a filter, or reset them all.`;
  }
  charts.sparklines(body);
  charts.syncRows();
  ui.syncActiveRow();
}

function renderChrome() {
  const prompts = shownTopics.reduce((sum, topic) => sum + topic.prompts.length, 0);
  $('[data-topic-count]', view).textContent = plural(shownTopics.length, 'topic');
  $('[data-topic-range]', view).textContent = `${plural(shownTopics.length, 'topic')} · ${plural(prompts, 'prompt')} · Updated Sep 28, 02:10`;
  const allOpen = shownTopics.length > 0 && shownTopics.every((topic) => state.expanded.has(topic.id));
  $('[data-topic-expand-label]', view).textContent = allOpen ? 'Collapse all' : 'Expand all';
  $('[data-topic-expand-all]', view).setAttribute('aria-pressed', String(allOpen));

  const visible = new Set(shownTopics.map((topic) => topic.id));
  const selected = [...state.topicSelected].filter((id) => visible.has(id));
  toolbar.hidden = selected.length > 0;
  bulkBar.hidden = selected.length === 0;
  const selectedPrompts = shownTopics.filter((topic) => state.topicSelected.has(topic.id)).reduce((sum, topic) => sum + topic.prompts.length, 0);
  $('[data-topic-selected]', bulkBar).textContent = `${plural(selected.length, 'topic')} selected · ${plural(selectedPrompts, 'prompt')}`;
  const all = $('[data-topic-all]', head);
  all.checked = shownTopics.length > 0 && selected.length === shownTopics.length;
  all.indeterminate = selected.length > 0 && selected.length < shownTopics.length;
}

export function renderTopics() {
  compute();
  renderHead();
  renderRows();
  renderChrome();
}

/** Topics of the current scope, whatever the table search: the drawer and the strip count these. */
export const topicsInScope = () => allTopics;
export const topicOrder = () => shownTopics.map((topic) => topic.id);

// -------------------------------------------------------------------------------------------------
// Interaction

function toggle(id, focus = true) {
  if (state.expanded.has(id)) state.expanded.delete(id);
  else state.expanded.add(id);
  renderRows();
  renderChrome();
  if (focus) $(`tr[data-id="${id}"] [data-topic-toggle]`, body)?.focus();
}

function openMenu(id, anchor, options) {
  menuTopicId = id;
  menuAnchor = anchor;
  $('[data-topic-menu-label]', menu).textContent = allTopics.find((topic) => topic.id === id).name;
  openPopup(menu, anchor, options);
}

/** The prompts of a topic in display order: the list J and K step through once one of them is open. */
const siblingIds = (topicId) => promptsByMention(allTopics.find((topic) => topic.id === topicId)).map((prompt) => prompt.id);

const selectedPromptIds = () => shownTopics.filter((topic) => state.topicSelected.has(topic.id)).flatMap((topic) => topic.prompts.map((prompt) => prompt.id));

export function initTopics(page) {
  host = page;

  head.addEventListener('click', (event) => {
    const key = event.target.closest('[data-topic-sort]')?.dataset.topicSort;
    if (!key) return;
    // Names start A to Z; numbers and dates start with the largest. A second click reverses.
    const first = key === 'topic' ? 'asc' : 'desc';
    state.topicSort = { key, dir: state.topicSort.key === key ? (state.topicSort.dir === 'asc' ? 'desc' : 'asc') : first };
    renderTopics();
    $(`[data-topic-sort="${key}"]`, head)?.focus();
  });
  head.addEventListener('change', (event) => {
    if (!event.target.matches('[data-topic-all]')) return;
    shownTopics.forEach((topic) => (event.target.checked ? state.topicSelected.add(topic.id) : state.topicSelected.delete(topic.id)));
    renderRows();
    renderChrome();
  });

  body.addEventListener('change', (event) => {
    if (event.target.type !== 'checkbox') return;
    const id = event.target.closest('tr').dataset.id;
    if (event.target.checked) state.topicSelected.add(id);
    else state.topicSelected.delete(id);
    charts.syncRows();
    renderChrome();
  });

  body.addEventListener('click', (event) => {
    const row = event.target.closest('tr');
    if (!row) return;
    const topicId = row.dataset.childOf ?? row.dataset.moreOf ?? row.dataset.id;
    if (event.target.closest('[data-topic-toggle]')) return toggle(topicId);
    if (event.target.closest('[data-topic-more]')) return host.openTopic(topicId, event.target.closest('button'), 'topic-prompts');
    const more = event.target.closest('[data-record-menu]');
    if (more) {
      event.stopPropagation();
      return more.dataset.recordMenu === 'topic' ? openMenu(topicId, more, { align: 'end' }) : host.openPromptMenu(row.dataset.id, more, { align: 'end' }, siblingIds(topicId));
    }
    if (event.target.closest('input, button, a') || row.dataset.moreOf) return undefined;
    if (row.dataset.childOf) return host.openPrompt(row.dataset.id, row, siblingIds(topicId));
    return host.openTopic(topicId, row);
  });
  body.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('tr');
    if (!row || row.dataset.moreOf || event.shiftKey) return;
    event.preventDefault();
    const point = { point: { x: event.clientX, y: event.clientY } };
    if (row.dataset.childOf) host.openPromptMenu(row.dataset.id, row, point, siblingIds(row.dataset.childOf));
    else openMenu(row.dataset.id, row, point);
  });
  list.addEventListener('click', (event) => {
    const link = event.target.closest('[data-open-id]');
    if (!link) return;
    event.preventDefault();
    host.openTopic(link.dataset.openId, link);
  });

  $('[data-topic-search]', view).addEventListener('input', (event) => {
    state.topicSearch = event.target.value.trim().toLowerCase();
    renderTopics();
  });
  $('[data-topic-expand-all]', view).addEventListener('click', () => {
    const allOpen = shownTopics.every((topic) => state.expanded.has(topic.id));
    shownTopics.forEach((topic) => (allOpen ? state.expanded.delete(topic.id) : state.expanded.add(topic.id)));
    renderRows();
    renderChrome();
  });
  $('[data-topic-empty-reset]', view).addEventListener('click', () => {
    state.topicSearch = '';
    $('[data-topic-search]', view).value = '';
    host.resetFilters();
  });

  bulkBar.addEventListener('click', (event) => {
    const action = event.target.closest('[data-topic-bulk-action]')?.dataset.topicBulkAction;
    if (action === 'run') host.runNow(selectedPromptIds());
    else if (action === 'export') host.exportRows(selectedPromptIds().length);
    else if (action === 'clear') {
      state.topicSelected.clear();
      renderRows();
      renderChrome();
    }
  });

  wireColumnChooser({
    popover: $('#pop-topic-columns'),
    columns: COLUMNS,
    shown: () => state.topicColumns,
    change: (key, on) => {
      if (on) state.topicColumns.add(key);
      else state.topicColumns.delete(key);
      renderTopics();
    },
    reset: () => {
      state.topicColumns = allColumns();
      renderTopics();
    },
  });

  // The drawer's More button acts on the topic that is open
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-popup="menu-topic-row"]')) return;
    menuTopicId = ui.inspectorState().id;
    menuAnchor = event.target.closest('[data-popup="menu-topic-row"]');
    $('[data-topic-menu-label]', menu).textContent = allTopics.find((topic) => topic.id === menuTopicId)?.name ?? '';
  }, true);
  menu.addEventListener('click', (event) => {
    const action = event.target.closest('[data-topic-action]')?.dataset.topicAction;
    const topic = allTopics.find((entry) => entry.id === menuTopicId);
    if (!action || !topic) return;
    closePopup({ restoreFocus: false });
    if (action === 'open') host.openTopic(topic.id, $(`tr[data-id="${topic.id}"]`, body));
    else if (action === 'explore') host.showInPrompts(topic.name);
    else if (action === 'add') host.addPrompt(topic.name, menuAnchor?.isConnected ? menuAnchor : null);
    else if (action === 'run') host.runNow(topic.prompts.map((prompt) => prompt.id));
    else if (action === 'export') host.exportRows(topic.prompts.length);
  });

  focusSearchOnSlash($('[data-topic-search]', view));
}
