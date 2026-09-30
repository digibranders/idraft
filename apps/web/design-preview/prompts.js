/* global document, window, navigator */
/**
 * The "Topics & Prompts" page of the static preview (24 section 9.5, ADR-DS-022): the Prompts tab, the Panels
 * and Versions tabs, the Add prompts dialog, the filters both scoped tabs share, and the routing between tabs.
 *
 * Everything on screen is computed from the generated counts of prompts-data.js with the tested code of
 * src/lib/stats and src/lib/format (transpiled by core-modules.mjs), so filtering, sorting, paging, the strip,
 * the intervals and the "detectable change" coloring behave as they will in the app.
 *
 * In the app this is features/prompts with DataTable, FilterBar, MetricStrip and Inspector. Here: this module,
 * prompts-topics.js for the Topics tab, prompts-inspector.js and prompts-topic-inspector.js for the drawers,
 * prompts-data.js for the fixture, prompts-state.js, prompts-cells.js and prompts-parts.js for what they share.
 */
import { formatDecimal, formatInteger, formatPercent, formatSampleCount } from './vendor/format/number.js';
import { MIN_OBSERVATIONS, detectableChange, isDetectableChange, pooledCounts, promptWeightedRate, rateState } from './vendor/stats/index.js';
import {
  COMPETITORS,
  ENGINES,
  METRICS,
  NOT_CLASSIFIED,
  OWN,
  PANELS,
  PROMPTS,
  PROMPT_BY_ID,
  PROMPT_QUOTA,
  TOPIC_PARENT,
  TYPE_LABEL,
  averageFor,
  changeFor,
  clamp,
  countsOf,
  engineOf,
  measures,
  rateFor,
  seeded,
  topCompetitor,
  topicPath,
  updatedOf,
  versionDayOrder,
} from './prompts-data.js';
import { initPromptInspector, refreshPromptInspector } from './prompts-inspector.js';
import { initTopicInspector, refreshTopicInspector } from './prompts-topic-inspector.js';
import { initTopics, promptsByMention, renderTopics, topicOrder, topicsInScope } from './prompts-topics.js';
import { focusSearchOnSlash, plainHeaderCell, promptLine, promptRateCell, promptTrendCell, promptUpdatedCell, rowMenuCell, sortHeaderCell, wireColumnChooser } from './prompts-cells.js';
import { NEUTRAL_BADGE, el, insufficient, intervalText, percent0, plural } from './prompts-parts.js';
import { BRANDED_LABEL, VIEWS, deltaNode, inScope, scopeCodes, scopeEngines, scopePrompts, scopeText, state } from './prompts-state.js';

const ui = window.PreviewUI;
const charts = window.PreviewCharts;
const { $, $$, icon, toast, openPopup, closePopup, openModal, closeModal, trapFocus, askDiscard, setSelectValue, engineLogo } = ui;

const view = $('[data-view="prompts"]');

// -------------------------------------------------------------------------------------------------
// State of the Explorer

const PAGE_SIZE = 25;
/** Optional columns, with the width from which the table shows each (19 section 6.3). */
const COLUMNS = [
  { key: 'topic', label: 'Topic', from: 1440, cell: 'hidden 2xl:table-cell' },
  { key: 'citation', label: 'Citation rate', from: 1280, cell: 'hidden xl:table-cell' },
  { key: 'recommendation', label: 'Recommendation rate', from: 1280, cell: 'hidden xl:table-cell', extra: true },
  { key: 'sov', label: 'Share of voice', from: 1280, cell: 'hidden xl:table-cell', extra: true },
  { key: 'competitor', label: 'Top competitor', from: 1680, cell: 'hidden 3xl:table-cell' },
  { key: 'trend', label: 'Trend', from: 1440, cell: 'hidden 2xl:table-cell' },
  { key: 'updated', label: 'Updated', from: 1680, cell: 'hidden 3xl:table-cell' },
];
const columnOf = (key) => COLUMNS.find((column) => column.key === key);
state.columns = new Set(COLUMNS.filter((column) => !column.extra).map((column) => column.key));

/** The Prompts tab finds rows by their text, on top of the filters. */
const matches = (prompt) => inScope(prompt) && (state.search === '' || prompt.text.toLowerCase().includes(state.search));

/** The value a column sorts by. Null is unknown (insufficient, not observed) and always sorts last (12 section 7). */
function sortValue(prompt, key) {
  const scope = scopeCodes();
  if (key === 'prompt') return prompt.text.toLowerCase();
  if (key === 'updated') return updatedOf(prompt).order;
  if (key.startsWith('engine:')) return rateFor(prompt, key.slice(7), state.metric);
  return averageFor(prompt, scope, key).value;
}

function compute() {
  // Sorting by an engine column only makes sense while that column is on screen
  const engineSort = state.sort.key.startsWith('engine:') ? state.sort.key.slice(7) : null;
  if (engineSort && (state.engines.length < 2 || !state.engines.includes(engineSort))) setSort('mention', 'desc');
  const { key, dir } = state.sort;
  const keyed = PROMPTS.filter(matches).map((prompt) => ({ prompt, value: sortValue(prompt, key) }));
  keyed.sort((a, b) => {
    if (a.value === null || b.value === null) return a.value === b.value ? 0 : a.value === null ? 1 : -1;
    const order = typeof a.value === 'string' ? a.value.localeCompare(b.value) : a.value - b.value;
    return dir === 'asc' ? order : -order;
  });
  state.rows = keyed.map((entry) => entry.prompt);
  const pages = Math.max(1, Math.ceil(state.rows.length / PAGE_SIZE));
  state.page = clamp(state.page, 1, pages);
}

const pageRows = () => state.rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

// -------------------------------------------------------------------------------------------------
// Cells

/** What one engine cell shows and what its tooltip says: the counts are always one hover away (P5). */
function engineValue(prompt, engine, metric) {
  const counts = countsOf(prompt, engine.code, metric);
  const status = rateState(counts.observations);
  if (counts.reason) return { node: el('span', 'text-foreground-tertiary', 'n/a'), tip: `${engine.name}: ${counts.reason}`, text: 'n/a' };
  if (status === 'none') return { node: el('span', 'text-foreground-tertiary', 'n/a'), tip: `${engine.name}: not observed in this window`, text: 'n/a' };
  if (status === 'insufficient') {
    return {
      node: insufficient(`${counts.observations} obs`),
      tip: `${engine.name}: ${plural(counts.observations, 'observation')}. A rate needs at least ${MIN_OBSERVATIONS}.`,
      text: `${counts.observations} obs`,
    };
  }
  if (counts.n === 0) return { node: el('span', 'text-foreground-tertiary', 'n/a'), tip: `${engine.name}: no entity was mentioned`, text: 'n/a' };
  const text = percent0(counts.k / counts.n);
  const unit = metric === 'sov' ? 'entity mentions' : engine.unit;
  const interval = metric === 'sov' ? null : intervalText(counts);
  return { node: el('span', 'num', text), tip: `${engine.name}: ${formatSampleCount(counts.k, counts.n)} ${unit}${interval ? `, 95% interval ${interval}` : ''}`, text };
}

function topicCell(prompt, className) {
  const cell = el('td', `${className} px-3`);
  const tag = el('span', `${NEUTRAL_BADGE} max-w-32 group-aria-selected:bg-surface`);
  tag.append(el('span', 'truncate', prompt.topic));
  tag.dataset.tip = topicPath(prompt.topic);
  cell.append(tag);
  return cell;
}

function competitorCell(prompt, className) {
  const cell = el('td', `${className} px-3`);
  const top = topCompetitor(prompt, scopeCodes());
  if (!top) {
    cell.append(el('span', 'text-foreground-tertiary', 'n/a'));
    return cell;
  }
  const line = el('span', 'flex items-center gap-2 min-w-0');
  const swatch = el('span', `size-2 shrink-0 rounded-full ${top.swatch}`);
  swatch.setAttribute('aria-hidden', 'true');
  line.append(swatch, el('span', 'truncate', top.name), el('span', 'ml-auto num text-foreground-secondary', percent0(top.rate)));
  cell.append(line);
  cell.dataset.tip = `${top.name} is mentioned most often on this prompt`;
  return cell;
}

/** PromptCell (25 section 8.2) as the pinned column of the Prompts tab. */
function promptCell(prompt) {
  // w-full with max-w-0 makes this the column that takes the space the others leave, and lets its text truncate
  const cell = el('th', 'sticky left-0 z-(--z-pinned-cell) bg-surface group-hover:bg-surface-hover group-aria-selected:bg-surface-selected w-full min-w-60 max-w-0 px-3 py-1.5 text-left font-normal');
  cell.scope = 'row';
  // Below 1280 px the engine columns are hidden: their values move under the prompt
  const under = scopeEngines().map((engine) => `${engine.name} ${engineValue(prompt, engine, state.metric).text}`);
  cell.append(promptLine(prompt), el('span', 'xl:hidden block truncate type-label', [prompt.topic, ...under].join(' · ')));
  return cell;
}

function rowFor(prompt) {
  const row = el('tr', 'group h-row border-t border-border-subtle hover:bg-surface-hover cursor-pointer');
  row.dataset.id = prompt.id;
  const select = el('td', 'w-10 pl-4 pr-2');
  const box = el('input', 'size-4 rounded-sm accent-primary align-middle');
  box.type = 'checkbox';
  box.checked = state.selected.has(prompt.id);
  box.setAttribute('aria-label', `Select ${prompt.text}`);
  select.append(box);
  row.append(select, promptCell(prompt));

  const shown = (key) => state.columns.has(key);
  if (shown('topic')) row.append(topicCell(prompt, columnOf('topic').cell));
  if (scopeEngines().length > 1) {
    for (const engine of scopeEngines()) {
      const { node, tip } = engineValue(prompt, engine, state.metric);
      const cell = el('td', 'hidden xl:table-cell px-3 text-right');
      cell.append(node);
      cell.dataset.tip = tip;
      row.append(cell);
    }
  }
  row.append(promptRateCell(prompt, 'mention', true));
  for (const key of ['citation', 'recommendation', 'sov']) {
    if (!shown(key)) continue;
    const cell = promptRateCell(prompt, key, false);
    cell.classList.add(...columnOf(key).cell.split(' '));
    row.append(cell);
  }
  if (shown('competitor')) row.append(competitorCell(prompt, columnOf('competitor').cell));
  if (shown('trend')) row.append(promptTrendCell(prompt, columnOf('trend').cell));
  if (shown('updated')) row.append(promptUpdatedCell(prompt, columnOf('updated').cell));

  row.append(rowMenuCell('prompt', prompt.text));
  return row;
}

function listRowFor(prompt) {
  const scope = scopeCodes();
  const item = el('li');
  const link = el('a', 'block min-h-14 px-3 py-2');
  link.href = '#';
  link.dataset.openId = prompt.id;
  const { value } = averageFor(prompt, scope, 'mention');
  const first = el('span', 'flex items-center gap-3');
  first.append(el('span', 'truncate type-body-strong', prompt.text), el('span', `ml-auto type-body-strong num${value === null ? ' text-foreground-tertiary' : ''}`, value === null ? 'n/a' : percent0(value)));
  const second = el('span', 'flex items-center gap-3');
  const engines = scopeEngines().map((engine) => `${engine.name} ${engineValue(prompt, engine, state.metric).text}`);
  second.append(el('span', 'truncate type-meta', [prompt.topic, ...engines].join(' · ')));
  const delta = deltaNode(changeFor(prompt, scope, 'mention'));
  if (delta) {
    delta.classList.add('ml-auto', 'type-table');
    second.append(delta);
  }
  link.append(first, second);
  item.append(link);
  return item;
}

// -------------------------------------------------------------------------------------------------
// Header: two rows while several engines are in scope, so the engine columns sit under the metric they show

const head = $('[data-prompt-head]', view);
const sortHeader = (key, label, className, options = {}) => sortHeaderCell({ key, label, className, ...options, sort: state.sort, attr: 'promptSort' });
const plainHeader = plainHeaderCell;

function renderHead() {
  const engines = scopeEngines();
  const grouped = engines.length > 1;
  const span = grouped ? 2 : undefined;
  const shown = (key) => state.columns.has(key);
  const top = el('tr', grouped ? 'text-left' : 'h-row-header text-left');
  const select = el('th', 'w-10 pl-4 pr-2 border-r border-border-subtle');
  if (span) select.rowSpan = span;
  const all = el('input', 'size-4 rounded-sm accent-primary align-middle');
  all.type = 'checkbox';
  all.dataset.promptAll = '';
  all.setAttribute('aria-label', 'Select all prompts on this page');
  select.append(all);
  top.append(select, sortHeader('prompt', 'Prompt', 'sticky left-0 z-(--z-pinned-cell) bg-surface-subtle min-w-60 px-1 text-left border-r border-border-subtle', { align: 'justify-start', rowSpan: span }));
  if (shown('topic')) top.append(plainHeader('Topic', `${columnOf('topic').cell} w-36`, span));
  if (grouped) {
    const group = el('th', 'hidden xl:table-cell h-7 px-3 text-center type-label whitespace-nowrap border-r border-b border-border-subtle', METRICS[state.metric].group);
    group.colSpan = engines.length;
    group.scope = 'colgroup';
    top.append(group);
  }
  // An average names how many engines take part in it: recommendation is not classified on every engine
  const averageNote = (metric) => {
    const taking = engines.filter((engine) => measures(engine.code, metric));
    return taking.length === 1 ? taking[0].name : taking.length === 0 ? 'n/a' : `avg of ${taking.length}`;
  };
  top.append(sortHeader('mention', 'Mention rate', 'w-28 px-1 text-right border-r border-border-subtle', { note: averageNote('mention'), rowSpan: span }));
  for (const key of ['citation', 'recommendation', 'sov']) {
    if (shown(key)) top.append(sortHeader(key, columnOf(key).label, `${columnOf(key).cell} w-28 px-1 text-right border-r border-border-subtle`, { note: averageNote(key), rowSpan: span }));
  }
  if (shown('competitor')) top.append(plainHeader('Top competitor', `${columnOf('competitor').cell} w-36`, span));
  if (shown('trend')) top.append(plainHeader('Trend', `${columnOf('trend').cell} w-24`, span));
  if (shown('updated')) top.append(sortHeader('updated', 'Updated', `${columnOf('updated').cell} w-36 px-1 border-r border-border-subtle`, { align: 'justify-start', rowSpan: span }));
  const actions = el('th', 'w-10');
  if (span) actions.rowSpan = span;
  actions.append(el('span', 'sr-only', 'Row actions'));
  top.append(actions);

  const rows = [top];
  if (grouped) {
    const second = el('tr', 'text-left');
    for (const engine of engines) second.append(sortHeader(`engine:${engine.code}`, engine.name, 'hidden xl:table-cell w-22 px-1 text-right border-r border-border-subtle'));
    rows.push(second);
  }
  head.replaceChildren(...rows);
}

// -------------------------------------------------------------------------------------------------
// Strip (23 section 2): per engine for the metric the engine columns show; four rates when one engine is in scope

const strip = $('[data-prompt-strip]', view);
const STRIP_COLUMNS = { 2: ['grid-cols-2'], 3: ['grid-cols-1', '@xl:grid-cols-3'], 4: ['grid-cols-2', '@4xl:grid-cols-4'], 5: ['grid-cols-2', '@xl:grid-cols-3', '@4xl:grid-cols-5'] };
const ALL_STRIP_COLUMNS = [...new Set(Object.values(STRIP_COLUMNS).flat())];

function stripItem({ label, logo, value, delta, context, wide }) {
  const cell = el('div', `bg-surface px-4 @4xl:px-5 py-3 min-w-0${wide ? ' col-span-2 @xl:col-span-2 @4xl:col-span-1' : ''}`);
  const dt = el('dt', 'flex items-center gap-1.5 min-w-0 type-meta');
  if (logo) dt.append(engineLogo(logo));
  dt.append(el('span', 'truncate', label));
  const dd = el('dd', 'flex flex-wrap items-baseline gap-x-2 min-w-0');
  dd.append(el('span', `type-metric num shrink-0${value === 'n/a' ? ' text-foreground-tertiary' : ''}`, value));
  if (delta) {
    delta.classList.add('type-body-strong');
    dd.append(delta);
  }
  dd.append(el('span', 'type-meta truncate min-w-0 basis-full', context));
  cell.append(dt, dd);
  return cell;
}

/** One rate of the filtered scope on one engine: prompt-weighted, with the pooled counts as its context. */
function scopeRate(code, metric) {
  const usable = scopePrompts().filter((prompt) => prompt.engines[code].n > 0);
  const current = usable.map((prompt) => countsOf(prompt, code, metric));
  const pooled = pooledCounts(current);
  const engine = engineOf(code);
  if (!measures(code, metric)) return { value: 'n/a', delta: null, context: NOT_CLASSIFIED };
  if (pooled.n === 0) return { value: 'n/a', delta: null, context: `no ${engine.unit} in this scope` };
  const rate = metric === 'sov' ? pooled.k / pooled.n : promptWeightedRate(current);
  let delta = null;
  if (metric === 'mention' || metric === 'citation') {
    const previous = usable.map((prompt) => countsOf(prompt, code, metric, 'previous'));
    const change = { value: rate - promptWeightedRate(previous), detectable: isDetectableChange(pooled, pooledCounts(previous)) };
    delta = deltaNode(change, 1);
  }
  return { value: percent0(rate), delta, context: `${formatSampleCount(pooled.k, pooled.n)} ${metric === 'sov' ? 'entity mentions' : engine.unit}` };
}

function renderStrip() {
  const engines = scopeEngines();
  const count = scopePrompts().length;
  const items = [{ label: 'Prompts', value: formatInteger(count), context: scopeText() }];
  if (engines.length > 1) {
    items.unshift({ label: 'Topics', value: formatInteger(topicsInScope().length), context: 'in this scope' });
    for (const engine of engines) items.push({ label: `${METRICS[state.metric].label} ${engine.name}`, logo: engine.name, ...scopeRate(engine.code, state.metric) });
  } else {
    for (const metric of Object.keys(METRICS)) items.push({ label: METRICS[metric].label, ...scopeRate(engines[0].code, metric) });
    items[0].label = `Prompts on ${engines[0].name}`;
  }
  if (items.length === 5) items[4].wide = true;
  $('[data-prompt-meta]', view).textContent = `Updated Sep 28, 02:10 · ${plural(topicsInScope().length, 'topic')} · ${plural(count, 'prompt')}`;
  strip.classList.remove(...ALL_STRIP_COLUMNS);
  strip.classList.add(...STRIP_COLUMNS[items.length]);
  strip.replaceChildren(...items.map(stripItem));
}

// -------------------------------------------------------------------------------------------------
// Table, list, toolbar, bulk bar and footer

const body = $('[data-prompt-rows]', view);
const list = $('[data-prompt-list]', view);
const toolbar = $('[data-prompt-toolbar]', view);
const bulkBar = $('[data-prompt-bulk]', view);
const empty = $('[data-prompt-empty]', view);
const tableRegion = $('[data-prompt-table]', view).parentElement;

function renderRows() {
  const rows = pageRows();
  body.replaceChildren(...rows.map(rowFor));
  list.replaceChildren(...rows.map(listRowFor));
  const none = state.rows.length === 0;
  empty.hidden = !none;
  tableRegion.classList.toggle('md:block', !none);
  if (none) {
    $('[data-prompt-empty-text]', empty).textContent =
      state.search !== '' ? `Nothing in this scope (${scopeText()}) contains "${state.search}".` : `The scope is ${scopeText()}. Remove a filter, or reset them all.`;
  }
  charts.sparklines(body);
  charts.syncRows();
  ui.syncActiveRow();
}

function renderFooter() {
  const total = state.rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (state.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, state.page * PAGE_SIZE);
  const count = plural(total, 'prompt');
  $('[data-prompt-range]', view).textContent = total === 0 ? 'No prompts · Updated Sep 28, 02:10' : `Showing ${from} to ${to} of ${count} · Updated Sep 28, 02:10`;
  $('[data-prompt-page]', view).textContent = `Page ${state.page} of ${pages}`;
  $('[data-prompt-count]', view).textContent = count;
  $('[data-prompt-count-mobile]', view).textContent = count;
  const previous = $('[data-prompt-prev]', view);
  const next = $('[data-prompt-next]', view);
  previous.disabled = state.page <= 1;
  next.disabled = state.page >= pages;
  previous.dataset.tip = previous.disabled ? 'No previous page' : 'Previous page';
  next.dataset.tip = next.disabled ? 'No next page' : 'Next page';
}

/** Selection survives sorting, paging and filtering (12 section 14); rows a filter hides are reported, not dropped. */
function renderSelection() {
  const visible = new Set(state.rows.map((prompt) => prompt.id));
  const selected = state.selected.size;
  const hidden = [...state.selected].filter((id) => !visible.has(id)).length;
  toolbar.hidden = selected > 0;
  bulkBar.hidden = selected === 0;
  $('[data-prompt-selected]', bulkBar).textContent = `${formatInteger(selected)} selected`;
  const page = pageRows();
  const onPage = page.filter((prompt) => state.selected.has(prompt.id)).length;
  const all = $('[data-prompt-all]', head);
  if (all) {
    all.checked = page.length > 0 && onPage === page.length;
    all.indeterminate = onPage > 0 && onPage < page.length;
  }
  const selectAll = $('[data-prompt-select-all]', bulkBar);
  const matching = state.rows.length;
  selectAll.hidden = !(onPage === page.length && selected - hidden < matching);
  selectAll.textContent = `Select all ${formatInteger(matching)} matching`;
  const note = $('[data-prompt-hidden-note]', view);
  note.hidden = hidden === 0;
  note.textContent = `${plural(hidden, 'selected row')} ${hidden === 1 ? 'is' : 'are'} hidden by filters`;
}

function render() {
  compute();
  renderTopics();
  renderHead();
  renderStrip();
  renderRows();
  renderFooter();
  renderSelection();
  renderChips();
}

// -------------------------------------------------------------------------------------------------
// Filters: scope trigger, chips, editors (13 sections 2 and 3)

const chips = $('[data-prompt-chips]', view);
const FIELDS = {
  engines: { title: 'Engines', values: () => ENGINES.map((engine) => [engine.code, engine.name]) },
  panel: { title: 'Panel', values: () => PANELS.map((panel) => [panel.name, panel.name]) },
  topic: { title: 'Topic', values: () => Object.keys(TOPIC_PARENT).map((topic) => [topic, topic]) },
  type: { title: 'Type', values: () => Object.entries(TYPE_LABEL) },
  branded: { title: 'Branded', single: true, values: () => Object.entries(BRANDED_LABEL) },
};

function chipLabel(field) {
  if (field === 'branded') return `Branded: ${BRANDED_LABEL[state.branded]}`;
  const labels = new Map(FIELDS[field].values());
  const values = state[field].map((value) => labels.get(value));
  return values.length <= 2 ? `${FIELDS[field].title}: ${values.join(', ')}` : `${FIELDS[field].title}: ${values.length} selected`;
}

function chip(label, editField, onRemove) {
  const node = el('span', 'flex h-control max-w-60 pl-1 pr-1 rounded-md bg-neutral-subtle items-center gap-0.5 type-body text-foreground');
  const edit = el('button', 'h-7 min-w-0 px-2 rounded-sm truncate hover:bg-surface-hover', label);
  edit.type = 'button';
  if (editField) {
    edit.dataset.promptEditor = editField;
    edit.setAttribute('aria-haspopup', 'dialog');
    edit.dataset.tip = `Edit filter ${label}`;
  }
  const remove = el('button', 'size-7 shrink-0 rounded-sm flex items-center justify-center text-foreground-tertiary hover:bg-surface-hover hover:text-foreground');
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove filter ${label}`);
  remove.dataset.tip = 'Remove filter';
  remove.append(icon('x', 'size-icon-sm'));
  remove.addEventListener('click', () => {
    onRemove();
    applyFilters();
    $('[data-prompt-add-filter]', view).focus();
  });
  node.append(edit, remove);
  return node;
}

function isDefaultScope() {
  const preset = VIEWS[state.view];
  const same = (a, b) => a.length === b.length && a.every((value) => b.includes(value));
  return (
    same(state.panel, preset.panel) &&
    state.branded === preset.branded &&
    state.topic.length === 0 &&
    state.type.length === 0 &&
    !state.detectable &&
    state.engines.length === ENGINES.length
  );
}

function renderChips() {
  const nodes = [];
  if (state.panel.length > 0) nodes.push(chip(chipLabel('panel'), 'panel', () => (state.panel = [])));
  if (state.branded !== 'include') nodes.push(chip(chipLabel('branded'), 'branded', () => (state.branded = 'include')));
  if (state.topic.length > 0) nodes.push(chip(chipLabel('topic'), 'topic', () => (state.topic = [])));
  if (state.type.length > 0) nodes.push(chip(chipLabel('type'), 'type', () => (state.type = [])));
  if (state.detectable) nodes.push(chip('Detectable changes only', null, () => (state.detectable = false)));
  chips.replaceChildren(...nodes);
  $('[data-prompt-engines-count]', view).textContent = String(state.engines.length);
  $('[data-prompt-reset]', view).hidden = isDefaultScope();
  $('[data-prompt-detectable]').setAttribute('aria-checked', String(state.detectable));
}

/** After the set of prompts changed (archive, undo, add, move): every part that lists or counts them. */
function update() {
  render();
  renderPanels();
  renderVersions();
  refreshPromptInspector();
  refreshTopicInspector();
}

/** A filter change starts again at the first page; the selection is kept. */
function applyFilters() {
  state.page = 1;
  update();
}

/** Shows the Prompts tab with the filters as they now are, whether or not it is already showing. */
function goToPrompts() {
  if (ui.currentRoute().section === 'explorer') applyFilters();
  else window.location.hash = '#/prompts/explorer';
}

/** After an action removed the control that had focus: the search field of the table on screen. */
function focusTable() {
  if (document.activeElement && document.activeElement !== document.body && document.activeElement.offsetParent !== null) return;
  [$('[data-topic-search]', view), $('[data-prompt-search]', view)].find((search) => search.offsetParent !== null)?.focus({ preventScroll: true });
}

function resetFilters() {
  const preset = VIEWS[state.view];
  Object.assign(state, { panel: [...preset.panel], branded: preset.branded, topic: [], type: [], detectable: false, engines: ENGINES.map((engine) => engine.code) });
  applyFilters();
}

// The editor: one popover, filled for the field that is being edited. Multi-choice fields apply with the
// Apply button or Enter; closing any other way discards (13 section 3).
const editor = $('#pop-prompt-filter');
let editing = null;

const editorChoice = () => $$('input', editor).filter((input) => input.checked).map((input) => input.value);
const appliedValues = (field) => (field === 'branded' ? [state.branded] : state[field]);

function updateEditorFooter() {
  const applied = new Set(appliedValues(editing));
  const chosen = editorChoice();
  const changed = chosen.length !== applied.size || chosen.some((value) => !applied.has(value));
  // At least one engine has to stay in scope
  $('[data-apply]', editor).disabled = !changed || (editing === 'engines' && chosen.length === 0);
  $('[data-clear]', editor).disabled = chosen.length === 0 || FIELDS[editing].single === true;
}

function openEditor(field, anchor) {
  editing = field;
  const definition = FIELDS[field];
  $('[data-title]', editor).textContent = definition.title;
  editor.setAttribute('aria-label', `${definition.title} filter`);
  $('[data-select-all]', editor).hidden = definition.single === true;
  const applied = new Set(appliedValues(field));
  const counted = PROMPTS.filter((prompt) => !state.archived.has(prompt.id));
  const countOf = {
    panel: (value) => counted.filter((prompt) => prompt.panel === value).length,
    topic: (value) => counted.filter((prompt) => prompt.topic === value).length,
    type: (value) => counted.filter((prompt) => prompt.type === value).length,
  }[field];
  $('[data-options]', editor).replaceChildren(
    ...definition.values().map(([value, label]) => {
      const row = el('label', 'h-control-sm px-2 rounded-md flex items-center gap-2 type-body hover:bg-surface-hover cursor-pointer');
      const input = el('input', definition.single ? 'size-4 accent-primary' : 'size-4 rounded-sm accent-primary');
      input.type = definition.single ? 'radio' : 'checkbox';
      input.name = 'prompt-filter';
      input.value = value;
      input.checked = applied.has(value);
      row.append(input);
      if (field === 'engines') row.append(engineLogo(label));
      row.append(el('span', 'truncate', label));
      if (countOf) row.append(el('span', 'ml-auto pl-4 type-meta num', formatInteger(countOf(value))));
      return row;
    }),
  );
  updateEditorFooter();
  openPopup(editor, anchor, { focus: $('input:checked', editor) ?? $('input', editor) });
}

function applyEditor() {
  const chosen = editorChoice();
  if (editing === 'branded') state.branded = chosen[0] ?? 'include';
  else state[editing] = chosen;
  closePopup();
  applyFilters();
}

$('[data-options]', editor).addEventListener('change', updateEditorFooter);
$('[data-select-all]', editor).addEventListener('click', () => {
  $$('input', editor).forEach((input) => (input.checked = true));
  updateEditorFooter();
});
$('[data-clear]', editor).addEventListener('click', () => {
  $$('input', editor).forEach((input) => (input.checked = false));
  updateEditorFooter();
});
$('[data-apply]', editor).addEventListener('click', applyEditor);
editor.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.target.matches('button') || $('[data-apply]', editor).disabled) return;
  event.preventDefault();
  applyEditor();
});

// Editors open from the scope trigger, from a chip, and from "+ Filter" (anchored to that button)
document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-prompt-editor]');
  if (!trigger) return;
  event.stopPropagation();
  const fromMenu = trigger.closest('#menu-prompt-filter') !== null;
  if (fromMenu) closePopup({ restoreFocus: false });
  openEditor(trigger.dataset.promptEditor, fromMenu ? $('[data-prompt-add-filter]', view) : trigger);
}, true);

$('[data-prompt-detectable]').addEventListener('click', () => {
  state.detectable = !state.detectable;
  closePopup();
  applyFilters();
});
$('[data-prompt-reset]', view).addEventListener('click', resetFilters);
$('[data-prompt-empty-reset]', view).addEventListener('click', () => {
  state.search = '';
  $('[data-prompt-search]', view).value = '';
  resetFilters();
});

// Compare: the shared menu sets the label; "No comparison" takes the deltas away
$('#ed-compare').addEventListener('click', (event) => {
  const option = event.target.closest('[role="menuitemradio"]');
  if (!option) return;
  state.compare = option.dataset.value !== 'No comparison';
  render();
});

// Saved views (24 section 9.5): a view is a set of filters. "Branded prompts" is branded only, in every panel.
$('#menu-prompt-view').addEventListener('click', (event) => {
  const option = event.target.closest('[role="menuitemradio"]');
  if (!option) return;
  state.view = option.dataset.value;
  $('[data-prompt-view-label]', view).textContent = VIEWS[state.view].label;
  resetFilters();
});

// -------------------------------------------------------------------------------------------------
// Toolbar: search, the metric of the engine columns, the column chooser

$('[data-prompt-search]', view).addEventListener('input', (event) => {
  state.search = event.target.value.trim().toLowerCase();
  applyFilters();
});
$('#prompt-metric').addEventListener('change', (event) => {
  state.metric = event.target.dataset.value;
  render();
});

wireColumnChooser({
  popover: $('#pop-prompt-columns'),
  columns: COLUMNS,
  shown: () => state.columns,
  change: (key, on) => {
    if (on) state.columns.add(key);
    else state.columns.delete(key);
    // Sorting by a column that was just removed would leave no sort indicator: fall back to the default
    if (!on && state.sort.key === key) setSort('mention', 'desc');
    render();
  },
  reset: () => {
    state.columns = new Set(COLUMNS.filter((column) => !column.extra).map((column) => column.key));
    render();
  },
});

// -------------------------------------------------------------------------------------------------
// Sorting and paging

const SORT_LABEL = { mention: 'Mention rate', citation: 'Citation rate', prompt: 'Prompt', updated: 'Last updated', recommendation: 'Recommendation rate', sov: 'Share of voice' };

/** Sets the sort and keeps the mobile Sort button and its menu in step. */
function setSort(key, dir) {
  state.sort = { key, dir };
  const label = key.startsWith('engine:') ? engineOf(key.slice(7)).name : SORT_LABEL[key];
  $('[data-prompt-sort-label]', view).textContent = `Sort: ${label}`;
  $$('#menu-prompt-sort [role="menuitemradio"]').forEach((option) => option.setAttribute('aria-checked', String(option.dataset.value === `${key}:${dir}`)));
}

function sortBy(key, dir) {
  // Text starts A to Z; rates and dates start with the largest first. A second click reverses.
  const first = key === 'prompt' ? 'asc' : 'desc';
  setSort(key, dir ?? (state.sort.key === key ? (state.sort.dir === 'asc' ? 'desc' : 'asc') : first));
  state.page = 1;
  render();
}

head.addEventListener('click', (event) => {
  const button = event.target.closest('[data-prompt-sort]');
  if (!button) return;
  const key = button.dataset.promptSort;
  sortBy(key);
  $(`[data-prompt-sort="${key}"]`, head)?.focus();
});
$('#menu-prompt-sort').addEventListener('click', (event) => {
  const option = event.target.closest('[role="menuitemradio"]');
  if (!option) return;
  const [key, dir] = option.dataset.value.split(':');
  sortBy(key, dir);
});

function goToPage(page) {
  state.page = page;
  compute();
  renderRows();
  renderFooter();
  renderSelection();
  refreshPromptInspector();
  view.querySelector('[aria-label="Prompts"]').scrollIntoView({ block: 'nearest' });
}
$('[data-prompt-prev]', view).addEventListener('click', () => goToPage(state.page - 1));
$('[data-prompt-next]', view).addEventListener('click', () => goToPage(state.page + 1));

// -------------------------------------------------------------------------------------------------
// Selection and bulk actions (12 section 14)

body.addEventListener('change', (event) => {
  if (event.target.type !== 'checkbox') return;
  const id = event.target.closest('tr').dataset.id;
  if (event.target.checked) state.selected.add(id);
  else state.selected.delete(id);
  charts.syncRows();
  renderSelection();
});
head.addEventListener('change', (event) => {
  if (!event.target.matches('[data-prompt-all]')) return;
  pageRows().forEach((prompt) => (event.target.checked ? state.selected.add(prompt.id) : state.selected.delete(prompt.id)));
  $$('input[type="checkbox"]', body).forEach((box) => (box.checked = event.target.checked));
  charts.syncRows();
  renderSelection();
});
$('[data-prompt-select-all]', bulkBar).addEventListener('click', () => {
  state.rows.forEach((prompt) => state.selected.add(prompt.id));
  $$('input[type="checkbox"]', body).forEach((box) => (box.checked = true));
  charts.syncRows();
  renderSelection();
});

function clearSelection() {
  state.selected.clear();
  $$('input[type="checkbox"]', body).forEach((box) => (box.checked = false));
  charts.syncRows();
  renderSelection();
}

const MANUAL_RUNS_LEFT = 400;

function runNow(ids) {
  const runs = ids.length * scopeEngines().length;
  if (runs > MANUAL_RUNS_LEFT) {
    toast({
      title: 'Not queued',
      description: `${plural(ids.length, 'prompt')} need ${plural(runs, 'observation')}, and ${MANUAL_RUNS_LEFT} manual runs are left this month. Select fewer prompts, or wait for the next scheduled run.`,
      tone: 'info',
    });
    return;
  }
  toast({
    title: ids.length === 1 ? 'Run queued' : `Run queued for ${plural(ids.length, 'prompt')}`,
    description: `${plural(runs, 'observation')} on ${scopeEngines().map((engine) => engine.name).join(', ')}. ${formatInteger(MANUAL_RUNS_LEFT - runs)} of ${MANUAL_RUNS_LEFT} manual runs are left this month.`,
  });
}

/** Archive is reversible: the rows leave the table and the toast can bring them back (TriageToast). */
async function archive(ids) {
  // Any bulk action over 100 rows confirms with the count (20 section 2, WCAG 3.3.4)
  if (ids.length > 100) {
    const ok = await ui.confirmAction({
      title: `Archive ${plural(ids.length, 'prompt')}?`,
      body: 'They stop being observed from the next run. Their history is kept, and they can be restored.',
      confirmLabel: `Archive ${formatInteger(ids.length)}`,
    });
    if (!ok) return;
  }
  const close = () => {
    ids.forEach((id) => {
      state.archived.add(id);
      state.selected.delete(id);
    });
    update();
    focusTable();
    toast({
      title: ids.length === 1 ? 'Prompt archived' : `${plural(ids.length, 'prompt')} archived`,
      description: 'History is kept. Observation stops from the next run.',
      action: {
        label: 'Undo',
        run: () => {
          ids.forEach((id) => state.archived.delete(id));
          update();
          toast({ title: ids.length === 1 ? 'Prompt restored' : `${plural(ids.length, 'prompt')} restored` });
        },
      },
    });
  };
  const open = ui.inspectorState();
  if (open.open && open.type === 'prompt' && ids.includes(open.id)) ui.closeInspector(false, close);
  else close();
}

bulkBar.addEventListener('click', (event) => {
  const action = event.target.closest('[data-prompt-bulk-action]')?.dataset.promptBulkAction;
  if (!action) return;
  const ids = [...state.selected];
  if (action === 'clear') clearSelection();
  else if (action === 'run') runNow(ids);
  else if (action === 'export') exportRows(ids.length);
  else if (action === 'archive') archive(ids);
});

function exportRows(count) {
  toast({ title: 'Export started', description: `prompts.csv with ${plural(count, 'row')} downloads when it is ready, usually within a minute.` });
}
$('[data-prompt-export]').addEventListener('click', () => {
  closePopup({ restoreFocus: false });
  exportRows(state.rows.length);
});

$('#menu-prompt-panel').addEventListener('click', (event) => {
  const target = event.target.closest('[data-prompt-to-panel]')?.dataset.promptToPanel;
  if (!target) return;
  closePopup({ restoreFocus: false });
  const ids = [...state.selected].filter((id) => PROMPT_BY_ID.get(id).panel !== 'Core');
  const skipped = state.selected.size - ids.length;
  ids.forEach((id) => (PROMPT_BY_ID.get(id).panel = target));
  update();
  toast({
    title: `${plural(ids.length, 'prompt')} moved to ${target}`,
    description: skipped > 0 ? `${plural(skipped, 'core prompt')} stayed: the core panel is locked.` : undefined,
    tone: ids.length === 0 ? 'info' : 'success',
  });
});

// -------------------------------------------------------------------------------------------------
// Rows: open the inspector, row menu, context menu

/** The list a prompt was opened from, when it is not the page of the Prompts tab: stepping stays inside it. */
let openedFrom = null;
function openPrompt(id, opener, ids = null) {
  openedFrom = ids;
  ui.openInspector(id, opener, 'prompt');
}
function openTopic(id, opener, tab) {
  ui.openInspector(id, opener, 'topic');
  if (tab) ui.selectInspectorTab(tab);
}
/** `ids` is the list the prompt sits in when that is not the page of the Prompts tab (a topic's prompts). */
function openPromptMenu(id, anchor, options, ids = null) {
  setMenuPrompt(id);
  menuContext = { ids, row: anchor.closest('tr') };
  openPopup(rowMenu, anchor, options);
}

body.addEventListener('click', (event) => {
  if (event.target.closest('input, button, a')) return;
  const row = event.target.closest('tr');
  if (row) openPrompt(row.dataset.id, row);
});
list.addEventListener('click', (event) => {
  const link = event.target.closest('[data-open-id]');
  if (!link) return;
  event.preventDefault();
  openPrompt(link.dataset.openId, link);
});

const rowMenu = $('#menu-prompt-row');
let menuPromptId = null;
let menuContext = { ids: null, row: null };
function setMenuPrompt(id) {
  menuPromptId = id;
  $('[data-prompt-menu-label]', rowMenu).textContent = PROMPT_BY_ID.get(id).text;
}
body.addEventListener('click', (event) => {
  const button = event.target.closest('[data-record-menu="prompt"]');
  if (!button) return;
  event.stopPropagation();
  openPromptMenu(button.closest('tr').dataset.id, button, { align: 'end' });
});
body.addEventListener('contextmenu', (event) => {
  const row = event.target.closest('tr');
  if (!row || event.shiftKey) return;
  event.preventDefault();
  openPromptMenu(row.dataset.id, row, { point: { x: event.clientX, y: event.clientY } });
});
// The inspector's More button acts on the prompt that is open
document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-popup="menu-prompt-row"]')) return;
  setMenuPrompt(ui.inspectorState().id);
  menuContext = { ids: openedFrom, row: null };
}, true);
rowMenu.addEventListener('click', (event) => {
  const action = event.target.closest('[data-prompt-action]')?.dataset.promptAction;
  if (!action || !menuPromptId) return;
  closePopup({ restoreFocus: false });
  const prompt = PROMPT_BY_ID.get(menuPromptId);
  if (action === 'open') openPrompt(prompt.id, menuContext.row?.isConnected ? menuContext.row : undefined, menuContext.ids);
  else if (action === 'run') runNow([prompt.id]);
  else if (action === 'archive') archive([prompt.id]);
  else if (action === 'copy') {
    navigator.clipboard?.writeText(prompt.text).then(
      () => toast({ title: 'Prompt copied', tone: 'info' }),
      () => toast({ title: 'Could not copy', description: 'Select the prompt text and copy it by hand.', tone: 'info' }),
    );
  }
});
$('[data-prompt-run]').addEventListener('click', () => runNow([ui.inspectorState().id]));

focusSearchOnSlash($('[data-prompt-search]', view));

// -------------------------------------------------------------------------------------------------
// Add prompts (16 section 4). The text is checked against the prompt guidelines while it is typed (11 section 4).

const addDialog = $('#dlg-add-prompts');
const addInput = $('#prompt-input');
const addPanel = $('#prompt-panel');
const addTopic = $('#prompt-topic');
const addReason = $('#prompt-reason');
const addSubmit = $('[data-prompt-submit]', addDialog);
let addOpener = null;

const BRAND_ALIASES = [OWN, ...COMPETITORS.map((competitor) => competitor.name)].map((name) => name.toLowerCase());
const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;
const isBrandedText = (text) => BRAND_ALIASES.some((alias) => text.toLowerCase().includes(alias));

/** The prompts typed so far, each with the number of its line in the field. Blank and repeated lines are left out. */
function typedPrompts() {
  const seen = new Set();
  return addInput.value
    .split('\n')
    .map((line, i) => ({ text: line.trim(), line: i + 1 }))
    .filter(({ text }) => text !== '' && !seen.has(text.toLowerCase()) && seen.add(text.toLowerCase()));
}

/** One finding per line at most, the most serious first: errors block, warnings and notes do not. */
function lint(lines) {
  const tracked = new Set(PROMPTS.filter((prompt) => !state.archived.has(prompt.id)).map((prompt) => prompt.text.toLowerCase()));
  const core = addPanel.dataset.value === 'Core';
  return lines.flatMap(({ text, line }) => {
    const where = `Line ${line}`;
    const words = wordCount(text);
    if (tracked.has(text.toLowerCase())) return [{ level: 'error', text: `${where} is already tracked.` }];
    if (words < 5) return [{ level: 'error', text: `${where} is too short. A prompt needs at least 5 words.` }];
    if (words > 60) return [{ level: 'error', text: `${where} has ${words} words. The limit is 60.` }];
    if (isBrandedText(text) && core) return [{ level: 'error', text: `${where} names a brand. Branded prompts cannot join the core panel.` }];
    if (isBrandedText(text)) return [{ level: 'note', text: `${where} names a brand, so it is tracked as branded and left out of unbranded rates.` }];
    if ((text.match(/\?/g) ?? []).length > 1) return [{ level: 'warning', text: `${where} asks more than one question. Answers to it will be mixed.` }];
    return [];
  });
}

const LINT_STYLE = {
  error: ['circle-alert', 'text-negative-text'],
  warning: ['triangle-alert', 'text-warning-text'],
  note: ['info', 'text-foreground-secondary'],
};

function refreshAdd() {
  const lines = typedPrompts();
  const findings = lint(lines);
  const errors = findings.filter((finding) => finding.level === 'error').length;
  const core = addPanel.dataset.value === 'Core';
  $('[data-prompt-reason]', addDialog).hidden = !core;
  $('[data-prompt-help]', addDialog).textContent =
    lines.length === 0 ? 'One prompt per line, written as a buyer would ask it.' : `${plural(lines.length, 'prompt')}${errors > 0 ? `. ${errors} cannot be added` : ''}.`;
  const shown = findings.slice(0, 4);
  const rows = shown.map((finding) => {
    const [glyph, tone] = LINT_STYLE[finding.level];
    const row = el('li', `flex items-start gap-1.5 type-meta ${tone}`);
    row.append(icon(glyph, 'mt-0.5 size-icon-sm shrink-0'), el('span', '', finding.text));
    return row;
  });
  if (findings.length > shown.length) rows.push(el('li', 'type-meta', `And ${findings.length - shown.length} more.`));
  $('[data-prompt-lint]', addDialog).replaceChildren(...rows);
  const used = PROMPTS.filter((prompt) => !state.archived.has(prompt.id)).length;
  const over = used + lines.length > PROMPT_QUOTA;
  $('[data-prompt-quota]', addDialog).textContent = over
    ? `${formatInteger(used + lines.length)} of ${PROMPT_QUOTA} prompts: over the plan limit`
    : `${formatInteger(used)} of ${PROMPT_QUOTA} prompts used${lines.length > 0 ? `, ${formatInteger(used + lines.length)} after adding` : ''}`;
  addSubmit.disabled = lines.length === 0 || errors > 0 || over || (core && addReason.value.trim() === '');
  addSubmit.textContent = lines.length > 1 ? `Add ${lines.length} prompts` : 'Add prompt';
}

function resetAdd() {
  addInput.value = '';
  addReason.value = '';
  setSelectValue(addPanel, 'Discovery');
  setSelectValue(addTopic, 'Startups');
  refreshAdd();
}

const closeAdd = () => closeModal(addDialog, () => addOpener?.focus());
function requestCloseAdd() {
  if (typedPrompts().length === 0) {
    closeAdd();
    return;
  }
  askDiscard('The prompts you typed will be lost.', {
    onKeep: () => addInput.focus(),
    onDiscard: () => {
      closeAdd();
      resetAdd();
    },
  });
}

/** Opens the dialog. From a topic, that topic is already chosen. */
function openAdd(opener, topic) {
  addOpener = opener;
  if (topic) setSelectValue(addTopic, topic);
  refreshAdd();
  openModal(addDialog);
  addInput.focus();
}
$('[data-prompt-add]', view).addEventListener('click', (event) => openAdd(event.currentTarget));
addInput.addEventListener('input', refreshAdd);
addReason.addEventListener('input', refreshAdd);
addPanel.addEventListener('change', refreshAdd);
addInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !addSubmit.disabled) {
    event.preventDefault();
    $('form', addDialog).requestSubmit();
  }
});
$$('[data-dialog-close]', addDialog).forEach((button) => button.addEventListener('click', requestCloseAdd));
$('[data-scrim]', addDialog).addEventListener('click', () => typedPrompts().length === 0 && closeAdd());
addDialog.addEventListener('keydown', (event) => {
  trapFocus(addDialog, event);
  // Escape closes an open listbox first; only then the dialog
  if (event.key === 'Escape' && !ui.popupOpen() && $('#dlg-discard').hidden) {
    event.preventDefault();
    requestCloseAdd();
  }
});

$('form', addDialog).addEventListener('submit', (event) => {
  event.preventDefault();
  if (addSubmit.disabled) return;
  const panel = addPanel.dataset.value;
  const topic = addTopic.dataset.value;
  const lines = typedPrompts();
  const random = seeded(PROMPTS.length + 1);
  const guess = (text) => (/^(how do|what is the easiest way)/i.test(text) ? 'how_to' : /\b(best|recommend)\b/i.test(text) ? 'recommendation' : /\b(or|vs)\b/i.test(text) ? 'comparison' : 'question');
  for (const { text } of lines) {
    const prompt = {
      id: `p${PROMPTS.length + 1}`,
      text,
      type: guess(text),
      topic,
      panel,
      branded: isBrandedText(text),
      locked: panel === 'Core',
      version: 1,
      versionChanged: false,
      stale: false,
      pending: true,
      seed: Math.floor(random() * 2 ** 31),
      engines: Object.fromEntries(
        ENGINES.map((engine) => [engine.code, { n: 0, mention: 0, citation: 0, recommendation: measures(engine.code, 'recommendation') ? 0 : null, prevMention: 0, prevCitation: 0, competitors: COMPETITORS.map(() => 0) }]),
      ),
    };
    PROMPTS.push(prompt);
    PROMPT_BY_ID.set(prompt.id, prompt);
  }
  closeAdd();
  resetAdd();
  update();
  const schedule = PANELS.find((entry) => entry.name === panel).schedule.toLowerCase();
  const visible = lines.some(({ text }) => state.rows.some((prompt) => prompt.text === text));
  toast({
    title: `${plural(lines.length, 'prompt')} added to ${panel}`,
    description: `The first observations arrive with the next ${schedule} run.`,
    action: visible
      ? undefined
      : {
          label: 'Show',
          run: () => {
            Object.assign(state, { panel: [panel], branded: 'include', topic: [], type: [], detectable: false, search: '' });
            $('[data-prompt-search]', view).value = '';
            setSort('updated', 'asc');
            goToPrompts();
          },
        },
  });
});

// -------------------------------------------------------------------------------------------------
// Panels tab (20 section 5.7)

/** Share of prompts whose mention flips between two weekly runs, per engine (measured; 17 section 8.1). */
const FLIP_RATE = { chatgpt_web: 0.22, gemini_web: 0.18, google_ai_mode: 0.25 };
const MEMBERSHIP = [
  ['Sep 21', 'plus', '4 prompts promoted from Discovery', 'Ana Brandt', 'Pricing questions buyers started asking'],
  ['Sep 7', 'minus', '2 prompts removed', 'Tomás Rivera', 'Near-duplicates of an existing prompt'],
  ['Aug 17', 'plus', '6 prompts promoted from Discovery', 'Ana Brandt', 'Coverage of the email tracking topic'],
  ['Jul 27', 'minus', '3 prompts removed', 'Priya Nair', 'Off topic after the product repositioning'],
];

/** A change in points, or a plain statement when the panel is too small to detect any. */
const points = (ratio) => (ratio === null ? 'no change at this size' : `${formatDecimal(ratio * 100, 1)} points`);

function renderPanels() {
  const active = PROMPTS.filter((prompt) => !state.archived.has(prompt.id));
  $('[data-panel-rows]', view).replaceChildren(
    ...PANELS.map((panel) => {
      const row = el('tr', 'h-row border-t border-border-subtle');
      const name = el('th', 'pl-4 pr-3 text-left font-normal');
      name.scope = 'row';
      const line = el('span', 'flex items-center gap-2');
      line.append(el('span', 'type-body-strong text-foreground', panel.name));
      if (panel.locked) {
        const lock = el('span', `${NEUTRAL_BADGE} gap-1`);
        lock.append(icon('lock', 'size-icon-xs'), 'Locked');
        line.append(lock);
      }
      if (panel.type !== panel.name) line.append(el('span', NEUTRAL_BADGE, panel.type));
      name.append(line);
      const engines = el('td', 'px-3');
      const engineList = el('span', 'flex flex-wrap items-center gap-x-3 gap-y-1');
      ENGINES.forEach((engine) => {
        const item = el('span', 'flex items-center gap-1.5 whitespace-nowrap');
        item.append(engineLogo(engine.name), engine.name);
        engineList.append(item);
      });
      engines.append(engineList);
      const changed = el('td', 'px-3 text-right num', panel.type === 'Core' ? formatPercent(panel.changed) : 'n/a');
      if (panel.type !== 'Core') {
        changed.classList.add('text-foreground-tertiary');
        changed.dataset.tip = 'Only the core panel is held stable: its changes are tracked against a 10% limit';
      }
      row.append(
        name,
        el('td', 'px-3 text-right num', formatInteger(active.filter((prompt) => prompt.panel === panel.name).length)),
        el('td', 'px-3 whitespace-nowrap', panel.schedule),
        engines,
        changed,
        el('td', 'px-3 pr-4 whitespace-nowrap num text-foreground-tertiary', panel.lastRun),
      );
      return row;
    }),
  );

  const core = active.filter((prompt) => prompt.panel === 'Core').length;
  $('[data-panel-flip]', view).replaceChildren(
    ...ENGINES.map((engine) => {
      const row = el('li', 'h-9 flex items-center gap-3 border-t border-border-subtle first:border-t-0');
      const label = el('span', 'flex items-center gap-2 min-w-0 type-body text-foreground');
      label.append(engineLogo(engine.name), el('span', 'truncate', engine.name));
      row.append(label, el('span', 'ml-auto type-table num', percent0(FLIP_RATE[engine.code])), el('span', 'w-40 text-right type-meta num', `detects ${points(detectableChange(core, FLIP_RATE[engine.code]))}`));
      return row;
    }),
  );
  const changes = ENGINES.map((engine) => detectableChange(core, FLIP_RATE[engine.code]));
  $('[data-panel-detect]', view).textContent = changes.includes(null)
    ? `With ${formatInteger(core)} prompts, the core panel is too small to detect a week-over-week change on every engine.`
    : `With ${formatInteger(core)} prompts, the core panel can detect a week-over-week change in mention rate of ${points(Math.max(...changes))} or more on every engine.`;
  $('[data-panel-changed]', view).textContent = `${formatPercent(PANELS[0].changed)} of the panel changed in the last 90 days. A warning shows at 10%.`;
  $('[data-panel-history]', view).replaceChildren(
    ...MEMBERSHIP.map(([day, glyph, what, who, why]) => {
      const item = el('li', 'px-4 py-2 flex items-start gap-3 border-t border-border-subtle');
      const text = el('span', 'min-w-0 flex flex-col');
      text.append(el('span', 'type-table text-foreground', what), el('span', 'type-meta', `${who} · ${why}`));
      item.append(el('span', 'w-12 shrink-0 type-meta num', day), icon(glyph, 'mt-0.5 size-icon shrink-0 text-foreground-tertiary'), text);
      return item;
    }),
  );
  renderSizing();
}

function renderSizing() {
  const input = $('#panel-size');
  const size = Number(input.value);
  const result = $('[data-panel-size-result]', view);
  const valid = Number.isInteger(size) && size >= 10 && size <= 5000;
  input.setAttribute('aria-invalid', String(!valid));
  result.classList.toggle('text-negative-text', !valid);
  result.classList.toggle('text-foreground-secondary', valid);
  if (!valid) {
    result.textContent = 'Enter a whole number from 10 to 5,000.';
    return;
  }
  const changes = ENGINES.map((engine) => detectableChange(size, FLIP_RATE[engine.code]));
  if (changes.some((change) => change === null)) {
    result.textContent = `A panel of ${formatInteger(size)} is too small to detect a change on every engine.`;
    return;
  }
  const [first, ...rest] = ENGINES.map((engine, i) => `${formatDecimal(changes[i] * 100, 1)} on ${engine.name}`);
  result.textContent = `A panel of ${formatInteger(size)} detects about ${first.replace(' on', ' points on')}, ${rest.join(' and ')}.`;
}
$('#panel-size').addEventListener('input', renderSizing);

// -------------------------------------------------------------------------------------------------
// Versions tab (11 section 1)

const CHANGE_REASONS = {
  Wording: ['Added the team size: buyers ask with it', 'Matches how the question is asked in sales calls', 'Removed a leading word'],
  Context: ['Added the industry the buyer is in', 'Added the budget the buyer has'],
  Typo: ['Spelling'],
};
const AUTHORS = ['Ana Brandt', 'Tomás Rivera', 'Priya Nair'];
const VERSION_ROWS = 20;

function renderVersions() {
  // Latest change first: the day is the prompt's own, so this table, the drawer's events and the chart agree
  const changed = PROMPTS.filter((prompt) => prompt.versionDay && !prompt.pending && !state.archived.has(prompt.id)).sort(
    (a, b) => versionDayOrder(b.versionDay) - versionDayOrder(a.versionDay) || Number(a.id.slice(1)) - Number(b.id.slice(1)),
  );
  $('[data-version-rows]', view).replaceChildren(
    ...changed.slice(0, VERSION_ROWS).map((prompt) => {
      const random = seeded(prompt.seed + 53);
      const pinned = prompt.id === 'p1';
      const kind = pinned ? 'Wording' : ['Wording', 'Wording', 'Wording', 'Context', 'Context', 'Typo'][Math.floor(random() * 6)];
      const reasons = CHANGE_REASONS[kind];
      const row = el('tr', 'h-row border-t border-border-subtle');
      const text = el('td', 'px-3 max-w-100');
      const link = el('button', 'block max-w-full truncate text-left text-foreground hover:underline', prompt.text);
      link.type = 'button';
      link.dataset.versionPrompt = prompt.id;
      link.dataset.tip = 'Open in Prompts';
      text.append(link);
      const change = el('td', 'px-3');
      change.append(el('span', NEUTRAL_BADGE, kind));
      row.append(
        el('td', 'pl-4 pr-3 whitespace-nowrap num text-foreground-secondary', prompt.versionDay),
        text,
        change,
        el('td', 'px-3 whitespace-nowrap num', `v${prompt.version - 1} → v${prompt.version}`),
        el('td', 'px-3 whitespace-nowrap', AUTHORS[Math.floor(random() * AUTHORS.length)]),
        el('td', 'px-3 pr-4 text-foreground-secondary', pinned ? reasons[0] : reasons[Math.floor(random() * reasons.length)]),
      );
      return row;
    }),
  );
}

// A version row leads to its prompt: the Prompts tab, with the row's panel in scope and the inspector open
$('[data-version-rows]', view).addEventListener('click', (event) => {
  const id = event.target.closest('[data-version-prompt]')?.dataset.versionPrompt;
  if (!id) return;
  const prompt = PROMPT_BY_ID.get(id);
  Object.assign(state, { panel: [prompt.panel], branded: prompt.branded ? 'include' : state.branded === 'only' ? 'include' : state.branded, topic: [], type: [], detectable: false, search: '' });
  $('[data-prompt-search]', view).value = '';
  compute();
  state.page = Math.floor(state.rows.indexOf(prompt) / PAGE_SIZE) + 1;
  pendingOpen = id;
  window.location.hash = '#/prompts/explorer';
});

// -------------------------------------------------------------------------------------------------
// Tabs follow the route: #/prompts is Topics, then #/prompts/explorer, #/prompts/panels, #/prompts/versions

const TAB_ON = ['border-primary', 'type-body-strong', 'text-primary-text'];
const TAB_OFF = ['border-transparent', 'type-body', 'text-foreground-secondary', 'hover:text-foreground'];
let pendingOpen = null;

function showTab(section) {
  $$('[data-prompt-tab]', view).forEach((tab) => {
    const on = tab.dataset.promptTab === section;
    tab.classList.remove(...(on ? TAB_OFF : TAB_ON));
    tab.classList.add(...(on ? TAB_ON : TAB_OFF));
    if (on) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  // Topics and Prompts share the filters, the saved view and the strip; Panels and Versions have none
  const scoped = section === 'topics' || section === 'explorer';
  $$('[data-prompt-panel]', view).forEach((panel) => (panel.hidden = panel.dataset.promptPanel !== section));
  $$('[data-prompt-scoped]', view).forEach((part) => (part.hidden = !scoped));
  $$('[data-prompt-explorer-only]', view).forEach((control) => (control.hidden = section !== 'explorer'));
  const open = ui.inspectorState();
  if (!scoped && open.open && (open.type === 'prompt' || open.type === 'topic')) ui.closeInspector(true);
  if (scoped) render();
  if (section === 'explorer' && pendingOpen) {
    const id = pendingOpen;
    pendingOpen = null;
    openPrompt(id, $(`tr[data-id="${id}"]`, body));
  }
}

window.addEventListener('preview-route', (event) => {
  if (event.detail.view === 'prompts') showTab(event.detail.section);
});

// -------------------------------------------------------------------------------------------------
// The inspector asks the Explorer where a prompt sits in the list

initPromptInspector({
  canOpen: (id) => !state.archived.has(id),
  order: () => openedFrom ?? pageRows().map((prompt) => prompt.id),
  positionOf: (prompt) => {
    const ids = openedFrom ?? state.rows.map((row) => row.id);
    const at = ids.indexOf(prompt.id);
    return at === -1 ? 'not in this list' : `${formatInteger(at + 1)} of ${formatInteger(ids.length)}`;
  },
  // The topic badge of a prompt leads to its topic
  openTopic: (name) => {
    const topic = topicsInScope().find((entry) => entry.name === name);
    if (topic) openTopic(topic.id);
  },
  hasTopic: (name) => topicsInScope().some((entry) => entry.name === name),
});

/** "Show in Prompts": the Prompts tab, filtered to one topic. */
function showInPrompts(topic) {
  state.topic = [topic];
  state.page = 1;
  goToPrompts();
}

initTopics({ openPrompt, openTopic, openPromptMenu, runNow, exportRows, resetFilters, showInPrompts, addPrompt: (topic, opener) => openAdd(opener, topic) });
initTopicInspector({ topics: topicsInScope, order: topicOrder, promptsOf: promptsByMention, openPrompt, openTopic, addPrompt: (topic, opener) => openAdd(opener, topic) });

// -------------------------------------------------------------------------------------------------
// Start

render();
renderPanels();
renderVersions();
resetAdd();
const route = ui.currentRoute();
if (route.view === 'prompts') {
  showTab(route.section);
  // A shared link restores the drawer (?inspect=prompt:p1, ?inspect=topic:t-startups) on either scoped tab
  const shared = new window.URL(window.location.href).searchParams.get('inspect');
  const scoped = route.section === 'topics' || route.section === 'explorer';
  if (scoped && shared?.startsWith('topic:')) openTopic(shared.slice(6));
  if (scoped && shared?.startsWith('prompt:')) {
    const prompt = PROMPT_BY_ID.get(shared.slice(7));
    if (prompt && state.rows.includes(prompt)) {
      state.page = Math.floor(state.rows.indexOf(prompt) / PAGE_SIZE) + 1;
      render();
    }
    if (prompt) openPrompt(prompt.id);
  }
}
