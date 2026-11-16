/* global document, window, navigator, MutationObserver */
/**
 * The "Prompts" page (once "Topics & Prompts") of the static preview (24 section 9.5, ADR-DS-022): the Prompts tab, the Panels
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
import { formatInteger, formatSampleCount } from './vendor/format/number.js';
import { MIN_OBSERVATIONS, isDetectableChange, pooledCounts, promptWeightedRate, rateState } from './vendor/stats/index.js';
import {
  COMPETITORS,
  ENGINES,
  NOT_CLASSIFIED,
  OWN,
  PANELS,
  PROMPTS,
  PROMPT_BY_ID,
  PROMPT_QUOTA,
  TOPIC_PARENT,
  TYPE_LABEL,
  absenceOf,
  absenceSentence,
  averageFor,
  countsOf,
  engineOf,
  measures,
  rateFor,
  seeded,
} from './prompts-data.js';
import { brandsOf, citedLinksOf, intentOf, latestAnswerOf, positionOf, sentimentOf, volumeOf } from './prompts-extra.js';
import { brandsCell, citedLinksCell, closeStaleList, initEngineSelect, onCompetitorsChange, intentCell, positionCell, screenshotCell, sentimentCell, textCell, volumeCell } from './prompts-extra-cells.js';
import { initPromptInspector, refreshPromptInspector } from './prompts-inspector.js';
import { initTopicInspector, refreshTopicInspector } from './prompts-topic-inspector.js';
import { initTopics, promptsByMention, renderTopics, topicOrder, topicsInScope } from './prompts-topics.js';
import { CELL, IDENTITY_RESIZE, focusSearchOnSlash, identityHandle, plainHeaderCell, promptLine, promptRateCell, promptTrendCell, rowMenuCell, sortHeaderCell, wireColumnChooser } from './prompts-cells.js';
import { NEUTRAL_BADGE, checkbox, el, insufficient, intervalText, percent0, plural } from './prompts-parts.js';
import { BRANDED_LABEL, METRIC_LABEL, VIEWS, deltaNode, inScope, isAllLocations, scopeCodes, scopeEngines, scopePrompts, scopeText, state } from './prompts-state.js';

const ui = window.PreviewUI;
const charts = window.PreviewCharts;
const { $, $$, icon, toast, openPopup, closePopup, openModal, closeModal, trapFocus, askDiscard, setSelectValue, engineLogo } = ui;

const view = $('[data-view="prompts"]');

// -------------------------------------------------------------------------------------------------
// State of the Explorer

/** The table lists every prompt in view and scrolls inside its panel, as the app's does: no pages. */
const PAGE_SIZE = Number.MAX_SAFE_INTEGER;

/**
 * The columns of the Prompts tab, in table order. The rates are the average of the engines in view, so one engine in
 * view is that engine's own value. Cited links and the answer screenshot belong to one engine's answers, so they are
 * there only while one engine is in view. The per-engine columns and counts are off until they are chosen.
 */
const WIDTH = { select: 40, prompt: 300, topic: 160, country: 120, intent: 128, volume: 132, position: 120, mention: 168, citation: 136, recommendation: 196, sov: 140, sentiment: 168, trend: 96, links: 320, brands: 248, shot: 120, e: 176, count: 152, actions: 40 };
const columnsOf = () => {
  const single = scopeEngines().length === 1;
  return [
    { key: 'prompt', label: 'Prompt', width: WIDTH.prompt, locked: true },
    { key: 'topic', label: 'Topic', width: WIDTH.topic },
    ...(isAllLocations() ? [{ key: 'country', label: 'Location', width: WIDTH.country }] : []),
    { key: 'intent', label: 'Intent', width: WIDTH.intent },
    { key: 'volume', label: 'Search volume', width: WIDTH.volume },
    { key: 'position', label: 'Avg position', width: WIDTH.position },
    { key: 'mention', label: 'Mention rate', width: WIDTH.mention },
    { key: 'citation', label: 'Citation rate', width: WIDTH.citation },
    { key: 'recommendation', label: 'Recommendation rate', width: WIDTH.recommendation },
    { key: 'sov', label: 'Share of voice', width: WIDTH.sov },
    { key: 'sentiment', label: 'Sentiment', width: WIDTH.sentiment },
    { key: 'trend', label: 'Trend', width: WIDTH.trend },
    ...(single ? [{ key: 'links', label: 'Cited links', width: WIDTH.links }] : []),
    { key: 'brands', label: 'Brands', width: WIDTH.brands },
    ...(single ? [{ key: 'shot', label: 'Screenshot', width: WIDTH.shot }] : []),
    ...scopeEngines().map((engine) => ({ key: `e:${engine.code}`, label: `${engine.name} ${METRIC_LABEL[state.metric].toLowerCase()}`, width: WIDTH.e })),
    ...scopeEngines().flatMap((engine) => [
      { key: `m:${engine.code}`, label: `${engine.name} mentioned`, width: WIDTH.count },
      { key: `c:${engine.code}`, label: `${engine.name} cited`, width: WIDTH.count },
    ]),
  ];
};
const defaultOff = () => new Set(ENGINES.flatMap((engine) => [`e:${engine.code}`, `m:${engine.code}`, `c:${engine.code}`]));
state.promptHidden = defaultOff();
/** The width the person gave the Prompt column, or null for its default. */
state.promptIdentity = null;
const identityWidth = () => state.promptIdentity ?? WIDTH.prompt;
const widthOf = (column) => (column.key === 'prompt' ? identityWidth() : column.width);
const shownColumns = () => columnsOf().filter((column) => column.locked || !state.promptHidden.has(column.key));
const rowClass = () => (state.density === 'compact' ? 'h-row-compact' : 'h-row');

/** The Prompts tab finds rows by their text, on top of the filters. */
const matches = (prompt) => inScope(prompt) && (state.search === '' || prompt.text.toLowerCase().includes(state.search));

/** The value a column sorts by. Null is unknown (insufficient, not observed) and always sorts last (12 section 7). */
function sortValue(prompt, key) {
  const scope = scopeCodes();
  if (key === 'prompt') return prompt.text.toLowerCase();
  if (key === 'topic') return prompt.topic.toLowerCase();
  if (key === 'country') return COUNTRY;
  if (key === 'intent') return intentOf(prompt).toLowerCase();
  if (key === 'volume') return volumeOf(prompt).value;
  if (key === 'position') return positionOf([prompt], scope).value;
  if (key === 'sentiment') return sentimentOf([prompt], scope).shares?.positive ?? null;
  if (key.startsWith('e:')) return rateFor(prompt, key.slice(2), state.metric);
  if (key.startsWith('m:') || key.startsWith('c:')) {
    const counts = countsOf(prompt, key.slice(2), key.startsWith('c:') ? 'citation' : 'mention');
    return counts.n === 0 ? null : counts.k / counts.n;
  }
  return averageFor(prompt, scope, key).value;
}

function compute() {
  // Sorting by an engine column only makes sense while that column is on screen
  const sortCode = state.sort.key.includes(':') ? state.sort.key.slice(2) : null;
  if (sortCode && !state.engines.includes(sortCode)) setSort('mention', 'desc');
  // A column the chooser turned off, or one the scope took away (Location), has no header to show the sort on
  const gone = state.promptHidden.has(state.sort.key) || !columnsOf().some((column) => column.key === state.sort.key);
  if (state.sort.key !== 'mention' && gone) setSort('mention', 'desc');
  const { key, dir } = state.sort;
  const keyed = PROMPTS.filter(matches).map((prompt) => ({ prompt, value: sortValue(prompt, key) }));
  keyed.sort((a, b) => {
    if (a.value === null || b.value === null) return a.value === b.value ? 0 : a.value === null ? 1 : -1;
    const order = typeof a.value === 'string' ? a.value.localeCompare(b.value) : a.value - b.value;
    return dir === 'asc' ? order : -order;
  });
  state.rows = keyed.map((entry) => entry.prompt);
  state.page = 1;
}

const pageRows = () => state.rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

// -------------------------------------------------------------------------------------------------
// Cells

/** What one engine cell shows and what its tooltip says: the counts are always one hover away (P5). */
function engineValue(prompt, engine, metric) {
  const counts = countsOf(prompt, engine.code, metric);
  const status = rateState(counts.observations);
  if (counts.reason) return { node: el('span', 'text-foreground-tertiary', 'n/a'), tip: `${engine.name}: ${counts.reason}`, text: 'n/a' };
  if (status === 'none') {
    const absence = absenceOf(prompt, engine.code);
    return { node: el('span', 'text-foreground-tertiary whitespace-nowrap', absence.text), tip: `${engine.name}: ${absence.reason}`, text: absence.text };
  }
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

/** Every prompt of the fixture is asked for the project's one country, the one the top bar shows. */
const COUNTRY = 'United States';

/** The pinned cells hold the row's own surface and take the hover and selected ones with it. */
const PIN = 'bg-surface group-hover:bg-surface-hover group-aria-selected:bg-surface-selected';

/** The topic of a prompt as a badge that leads to the topic (25 section 8.2). */
function topicCell(prompt) {
  const cell = el('td', CELL);
  const tag = el('span', `${NEUTRAL_BADGE} max-w-full group-aria-selected:bg-surface`);
  tag.append(el('span', 'truncate', prompt.topic));
  cell.append(tag);
  return cell;
}

function promptCell(prompt) {
  const cell = el('th', `sticky z-(--z-pinned-cell) border-b border-border-subtle px-3 text-left font-normal ${PIN}`);
  cell.style.left = `${WIDTH.select}px`;
  cell.scope = 'row';
  cell.setAttribute('aria-label', prompt.text);
  cell.append(promptLine(prompt));
  return cell;
}

/** "36 of 76": the answers behind one engine's mentions or citations. */
function countCell(prompt, code, metric) {
  const cell = el('td', CELL);
  const counts = countsOf(prompt, code, metric);
  if (counts.n === 0) {
    cell.append(el('span', 'text-foreground-tertiary', 'No answers'));
    cell.dataset.tip = 'No answer in this window yet. Each prompt is asked twice a week.';
  } else cell.append(el('span', 'num', formatSampleCount(counts.k, counts.n)));
  return cell;
}

/** One engine's cell for the metric the select chose: "100% 8 of 8", or why there is no rate. */
function engineCell(prompt, engine) {
  const cell = el('td', CELL);
  const { node, tip } = engineValue(prompt, engine, state.metric);
  const counts = countsOf(prompt, engine.code, state.metric);
  if (rateState(counts.observations) === 'ok' && counts.n > 0 && !counts.reason) {
    const line = el('span', 'inline-flex items-baseline gap-2 whitespace-nowrap');
    line.append(node, el('span', 'type-meta num text-foreground-secondary', formatSampleCount(counts.k, counts.n)));
    cell.append(line);
  } else cell.append(node);
  cell.dataset.tip = tip;
  return cell;
}

/** The cell of a column that is not a rate or a count of an engine. */
function extraCell(prompt, key) {
  const scope = scopeCodes();
  // With one engine in view, nothing observed has that engine's own reason (an AI Overview that did not show)
  const absent = scope.length === 1 ? absenceSentence(prompt, scope[0]) : 'Not observed in this window';
  if (key === 'intent') return intentCell(prompt);
  if (key === 'volume') return volumeCell(volumeOf(prompt));
  if (key === 'position') return positionCell(positionOf([prompt], scope), absent);
  if (key === 'sentiment') return sentimentCell(sentimentOf([prompt], scope), absent);
  if (key === 'brands') return brandsCell(brandsOf([prompt], scope), 'This prompt');
  if (key === 'links') return citedLinksCell(citedLinksOf(prompt, scope[0]), 'This prompt', absent);
  return screenshotCell(prompt, scope[0], latestAnswerOf(prompt, scope[0]));
}

function rowFor(prompt) {
  const row = el('tr', `group ${rowClass()} cursor-pointer bg-surface hover:bg-surface-hover aria-selected:bg-surface-selected`);
  row.dataset.id = prompt.id;
  const select = el('td', `sticky left-0 z-(--z-pinned-cell) border-b border-border-subtle px-0 text-center ${PIN}`);
  const box = checkbox(`Select ${prompt.text}`);
  box.input.checked = state.selected.has(prompt.id);
  select.append(box.wrap);
  const cells = shownColumns()
    .filter((column) => column.key !== 'prompt')
    .map((column) => {
      if (column.key === 'topic') return topicCell(prompt);
      if (column.key === 'country') return textCell(COUNTRY, 'Every prompt is asked for the project location, the one the top bar shows');
      if (column.key === 'mention') return promptRateCell(prompt, 'mention', true);
      if (['citation', 'recommendation', 'sov'].includes(column.key)) return promptRateCell(prompt, column.key, false);
      if (column.key === 'trend') return promptTrendCell(prompt, '');
      if (['intent', 'volume', 'position', 'sentiment', 'brands', 'links', 'shot'].includes(column.key)) return extraCell(prompt, column.key);
      if (column.key.startsWith('e:')) return engineCell(prompt, engineOf(column.key.slice(2)));
      return countCell(prompt, column.key.slice(2), column.key.startsWith('c:') ? 'citation' : 'mention');
    });
  row.append(select, promptCell(prompt), ...cells, rowMenuCell('prompt', prompt.text));
  return row;
}

// -------------------------------------------------------------------------------------------------
// Header

const head = $('[data-prompt-head]', view);
const cols = $('[data-prompt-cols]', view);
const promptTable = $('[data-prompt-table]', view);
const sortHeader = (column) => sortHeaderCell({ key: column.key, label: column.label, sort: state.sort, attr: 'promptSort', tip: HEAD_TIP[column.key] });
const HEAD_TIP = {
  mention: 'The share of valid answers that name your brand, averaged over the engines shown',
  citation: 'The share of valid answers that cite your domain, averaged over the engines shown',
  trend: 'The mention rate for each week of the window, averaged over the engines shown. A week with no valid answer is a gap in the line.',
  country: 'The location the prompt is asked for',
  intent: 'What the asker wants: to learn, to choose, to buy or to find a brand',
  volume: 'Monthly searches of the keyword the prompt is linked to. Sample values.',
  position: 'Where your brand sits in an ordered answer, 1 being first. Lower is better. Only ordered lists have a position.',
  recommendation: 'The share of valid answers that recommend your brand, on the engines that classify recommendations',
  sov: 'Your mentions as a share of every brand mention in the answers',
  sentiment: 'The tone of the answers that name your brand, as four shares. Sample values.',
  links: 'The links the engine cited in its answers, most cited first',
  brands: 'The brands the answers name, most named first. Opens the list.',
  shot: 'The latest answer of the engine, as the page showed it',
};
/** Columns that open something or show a picture: they have no order. */
const PLAIN_COLUMNS = ['trend', 'links', 'brands', 'shot'];

/** Sets the width of every column and of the table. Dragging the Prompt column calls this, so it never draws the header again. */
function applyWidths() {
  const shown = shownColumns();
  cols.replaceChildren(
    ...[WIDTH.select, ...shown.map(widthOf), WIDTH.actions].map((width) => {
      const col = el('col');
      col.style.width = `${width}px`;
      return col;
    }),
  );
  promptTable.style.width = `${WIDTH.select + WIDTH.actions + shown.reduce((sum, column) => sum + widthOf(column), 0)}px`;
}

/** The widest the Prompt column can be: the other columns keep room beside it in the panel. */
const identityMax = () => promptTable.parentElement.clientWidth - IDENTITY_RESIZE.leaveRoom;
function setIdentityWidth(width) {
  state.promptIdentity = width;
  applyWidths();
}

function renderHead() {
  const shown = shownColumns();
  applyWidths();
  const row = el('tr', 'h-row-header');
  const select = el('th', 'sticky top-0 left-0 z-(--z-sticky) border-b border-border border-r border-r-border-subtle bg-surface-subtle px-0 text-center align-middle font-normal');
  const all = checkbox('Select all prompts');
  all.input.dataset.promptAll = '';
  select.append(all.wrap);
  const cells = shown.map((column) => {
    if (PLAIN_COLUMNS.includes(column.key)) return plainHeaderCell(column.label, '', HEAD_TIP[column.key]);
    const th = sortHeader(column);
    if (column.key === 'prompt') {
      // The pinned header must sit above the headers that scroll under it: it takes the sticky layer, not the header one
      th.classList.remove('z-(--z-table-header)');
      th.classList.add('z-(--z-sticky)');
      th.style.left = `${WIDTH.select}px`;
      th.append(identityHandle({ current: identityWidth, set: setIdentityWidth, max: identityMax }));
    }
    return th;
  });
  const actions = el('th', 'sticky top-0 z-(--z-table-header) border-b border-border bg-surface-subtle');
  actions.append(el('span', 'sr-only', 'Row actions'));
  row.append(select, ...cells, actions);
  head.replaceChildren(row);
}

// -------------------------------------------------------------------------------------------------
// Strip (ADR-DS-022 decision 12): the chips of the toolbar, the prompts in view and one mention rate per engine

const strip = $('[data-prompt-strip]', view);

/** One rate of the filtered scope on one engine: prompt-weighted, with the pooled counts as its context. */
function scopeRate(code, metric) {
  const usable = scopePrompts().filter((prompt) => prompt.engines[code].n > 0);
  const current = usable.map((prompt) => countsOf(prompt, code, metric));
  const pooled = pooledCounts(current);
  const engine = engineOf(code);
  if (!measures(code, metric)) return { value: 'n/a', delta: null, context: NOT_CLASSIFIED };
  const observations = current.reduce((sum, entry) => sum + entry.observations, 0);
  if (observations === 0 || pooled.n === 0) return { value: 'n/a', delta: null, context: `no ${engine.unit} in this scope` };
  // A narrow scope can leave an engine with fewer observations than a rate needs, like a single prompt
  if (rateState(observations) !== 'ok') return { value: 'n/a', delta: null, context: `${formatInteger(observations)} ${engine.unit}, too few for a rate` };
  const rate = metric === 'sov' ? pooled.k / pooled.n : promptWeightedRate(current);
  let delta = null;
  if (metric === 'mention' || metric === 'citation') {
    const previous = usable.map((prompt) => countsOf(prompt, code, metric, 'previous'));
    const change = { value: rate - promptWeightedRate(previous), detectable: isDetectableChange(pooled, pooledCounts(previous)) };
    delta = deltaNode(change, 1);
  }
  return { value: percent0(rate), delta, context: `${formatSampleCount(pooled.k, pooled.n)} ${metric === 'sov' ? 'entity mentions' : engine.unit}` };
}

/** One chip of the toolbar: a label, the figure, and its change. The counts behind it are one hover away (P5). */
function stripChip({ label, value, delta, tip }) {
  const item = el('div', 'flex min-w-0 shrink-0 items-baseline gap-1.5');
  const dd = el('dd', 'flex items-baseline gap-1.5 -mx-1 rounded-sm px-1 outline-none focus-visible:focus-ring-inset');
  dd.tabIndex = 0;
  dd.append(el('span', `num type-body-strong ${value === 'n/a' ? 'text-foreground-tertiary' : 'text-foreground'}`, value));
  if (delta) {
    delta.classList.add('type-body-strong');
    dd.append(delta);
  }
  item.append(el('dt', 'type-meta text-foreground-tertiary', label), dd);
  if (tip) item.dataset.tip = tip;
  return item;
}

function renderStrip() {
  const engines = scopeEngines();
  const count = scopePrompts().length;
  const items = [{ label: 'Prompts', value: formatInteger(count), tip: `Across ${plural(topicsInScope().length, 'topic')}` }];
  for (const engine of engines) {
    const rate = scopeRate(engine.code, 'mention');
    const others = ['citation', 'sov'].map((metric) => `${METRIC_LABEL[metric]}: ${scopeRate(engine.code, metric).context}`);
    items.push({ label: engine.name, value: rate.value, delta: rate.delta, tip: `${engine.name}. Mention: ${rate.context}. ${others.join('. ')}.` });
  }
  $('[data-prompt-updated]', view).textContent = 'Updated Sep 28, 02:10';
  strip.replaceChildren(...items.map(stripChip));
}

// -------------------------------------------------------------------------------------------------
// Table, list, toolbar, bulk bar and footer

const body = $('[data-prompt-rows]', view);
const toolbar = $('[data-prompt-toolbar]', view);
const bulkBar = $('[data-prompt-bulk]', view);
const empty = $('[data-prompt-empty]', view);

function renderRows() {
  const rows = pageRows();
  body.replaceChildren(...rows.map(rowFor));
  closeStaleList();
  const none = state.rows.length === 0;
  empty.hidden = !none;
  promptTable.hidden = none;
  if (none) {
    $('[data-prompt-empty-text]', empty).textContent =
      state.search !== '' ? `Nothing in this scope (${scopeText()}) contains "${state.search}".` : `The scope is ${scopeText()}. Remove a filter, or reset them all.`;
  }
  charts.sparklines(body);
  charts.syncRows();
  ui.syncActiveRow();
}

const SORT_LABEL = {
  mention: 'Mention rate',
  citation: 'Citation rate',
  recommendation: 'Recommendation rate',
  sov: 'Share of voice',
  prompt: 'Prompt',
  topic: 'Topic',
  country: 'Location',
  intent: 'Intent',
  volume: 'Search volume',
  position: 'Avg position',
  sentiment: 'Sentiment',
};

/** "Sorted by Mention rate descending", beside the count, as the app's toolbar says it. */
function sortNote() {
  const { key, dir } = state.sort;
  const label = key.includes(':') ? columnsOf().find((column) => column.key === key)?.label ?? key : SORT_LABEL[key];
  return `Sorted by ${label} ${dir === 'asc' ? 'ascending' : 'descending'}`;
}

function renderFooter() {
  const count = plural(state.rows.length, 'prompt');
  $('[data-prompt-range]', view).textContent = count;
  $('[data-prompt-count]', view).textContent = count;
  $('[data-prompt-sort-note]', view).textContent = sortNote();
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
  refreshEngineSelect();
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

function renderChips() {
  const nodes = [];
  // The default scope (the core panel, branded prompts left out) says nothing: a chip is a filter someone set
  const preset = VIEWS.default;
  const samePanel = state.panel.length === preset.panel.length && state.panel.every((name) => preset.panel.includes(name));
  if (!samePanel) nodes.push(chip(chipLabel('panel'), 'panel', () => (state.panel = [...preset.panel])));
  if (state.branded !== preset.branded) nodes.push(chip(chipLabel('branded'), 'branded', () => (state.branded = preset.branded)));
  // One engine is the Engine select's own choice, so it needs no chip; a set of two or more is a filter
  if (state.engines.length > 1 && state.engines.length < ENGINES.length) nodes.push(chip(chipLabel('engines'), 'engines', () => (state.engines = ENGINES.map((engine) => engine.code))));
  if (state.topic.length > 0) nodes.push(chip(chipLabel('topic'), 'topic', () => (state.topic = [])));
  if (state.type.length > 0) nodes.push(chip(chipLabel('type'), 'type', () => (state.type = [])));
  if (state.detectable) nodes.push(chip('Detectable changes only', null, () => (state.detectable = false)));
  chips.replaceChildren(...nodes);
  $('[data-prompt-reset]', view).hidden = nodes.length === 0;
  $('[data-prompt-detectable]').setAttribute('aria-checked', String(state.detectable));
}

/** After the set of prompts changed (archive, undo, add, move): every part that lists or counts them. */
function update() {
  render();
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

// Engine: one engine or all of them, beside the filters. One engine adds the columns that belong to one engine's answers.
const refreshEngineSelect = initEngineSelect({
  before: $('[role="group"][aria-label="Filters"]', view),
  choose: (codes) => {
    state.engines = codes;
    applyFilters();
  },
});

// A brand added to the competitor list from a brands list shows in every list once that list has closed
onCompetitorsChange(render);

// The Location column is there only for "All locations" in the top bar, so a change of location draws the tables again
new MutationObserver(render).observe($('[data-location-label]'), { childList: true, characterData: true, subtree: true });

// Compare: the shared menu sets the label; "No comparison" takes the deltas away
$('#ed-compare').addEventListener('click', (event) => {
  const option = event.target.closest('[role="menuitemradio"]');
  if (!option) return;
  state.compare = option.dataset.value !== 'No comparison';
  render();
});

// -------------------------------------------------------------------------------------------------
// Toolbar: search, the metric of the engine columns, the column chooser

$('[data-prompt-search]', view).addEventListener('input', (event) => {
  state.search = event.target.value.trim().toLowerCase();
  applyFilters();
});
// The metric of the engine columns, chosen in the Prompts toolbar or, for the topics by engine, in the Topics one
$$('[data-select="lb-prompt-metric"]', view).forEach((trigger) =>
  trigger.addEventListener('change', (event) => {
    state.metric = event.target.dataset.value;
    // The other trigger shows the metric too, and a column of the old metric is no longer there to sort by
    $$('[data-select="lb-prompt-metric"]', view).forEach((other) => {
      other.dataset.value = state.metric;
      $('[data-select-value]', other).textContent = METRIC_LABEL[state.metric];
    });
    render();
  }),
);

wireColumnChooser({
  popover: $('#pop-prompt-columns'),
  identity: { label: 'Prompt', current: identityWidth, isDefault: () => state.promptIdentity === null, set: setIdentityWidth, max: identityMax },
  columns: columnsOf,
  shown: () => ({ has: (key) => !state.promptHidden.has(key) }),
  change: (key, on) => {
    if (on) state.promptHidden.delete(key);
    else state.promptHidden.add(key);
    // Sorting by a column that was just removed would leave no sort indicator: fall back to the default
    if (!on && state.sort.key === key) setSort('mention', 'desc');
    render();
  },
  reset: () => {
    state.promptHidden = defaultOff();
    render();
  },
});

// -------------------------------------------------------------------------------------------------
// Sorting and paging

/** Sets the sort and keeps the menu of sort options in step. */
function setSort(key, dir) {
  state.sort = { key, dir };
  $$('#menu-prompt-sort [role="menuitemradio"]').forEach((option) => option.setAttribute('aria-checked', String(option.dataset.value === `${key}:${dir}`)));
}

function sortBy(key, dir) {
  // Text starts A to Z, and so does the position (1 is best); rates and dates start with the largest first. A second click reverses.
  const first = ['prompt', 'topic', 'country', 'intent', 'position'].includes(key) ? 'asc' : 'desc';
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
  // A run asks the prompt. AI Overview is not asked: it arrives with the next rank check of the linked keyword
  const asked = scopeEngines().filter((engine) => engine.asked);
  if (asked.length === 0) {
    toast({ title: 'Nothing to run', description: 'AI Overview is read from rank checks, not asked. Add ChatGPT, Gemini or AI Mode to the scope to run these prompts.', tone: 'info' });
    return;
  }
  const runs = ids.length * asked.length;
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
    description: `${plural(runs, 'observation')} on ${asked.map((engine) => engine.name).join(', ')}. ${formatInteger(MANUAL_RUNS_LEFT - runs)} of ${MANUAL_RUNS_LEFT} manual runs are left this month.`,
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
  if (event.target.closest('input, button, a, label')) return;
  const row = event.target.closest('tr');
  if (row) openPrompt(row.dataset.id, row);
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
      linked: false,
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
// Tabs follow the route: #/prompts is Topics, then #/prompts/explorer. The switch is in each table's toolbar.

let pendingOpen = null;

function showTab(section) {
  $$('[data-prompt-tab]', view).forEach((tab) => tab.setAttribute('aria-checked', String(tab.dataset.promptTab === section)));
  $$('[data-prompt-panel]', view).forEach((panel) => (panel.hidden = panel.dataset.promptPanel !== section));
  // The note under the panel is about the parent rows of the Topics tab
  $('[data-prompt-rollup]', view).hidden = section !== 'topics';
  render();
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

// Other pages (the competitor drawer of the AI visibility Overview) open a prompt in this inspector, with the list it sits in
window.PreviewPrompts = { openPrompt };

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

/** "Show in Prompts" and "Show all N prompts": the Prompts tab, filtered to a topic or to the topics of a parent. */
function showInPrompts(topics) {
  state.topic = Array.isArray(topics) ? topics : [topics];
  state.page = 1;
  goToPrompts();
}

/** A density chosen in either table's menu applies to both. */
function renderDensity() {
  renderTopics();
  renderRows();
  $$('#menu-topic-density [data-density]').forEach((item) => item.setAttribute('aria-checked', String(item.dataset.density === state.density)));
}

initTopics({ openPrompt, openTopic, openPromptMenu, runNow, exportRows, resetFilters, showInPrompts, renderDensity, addPrompt: (topic, opener) => openAdd(opener, topic) });
initTopicInspector({ topics: topicsInScope, order: topicOrder, promptsOf: promptsByMention, openPrompt, openTopic, addPrompt: (topic, opener) => openAdd(opener, topic) });

// -------------------------------------------------------------------------------------------------
// Start

render();
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
