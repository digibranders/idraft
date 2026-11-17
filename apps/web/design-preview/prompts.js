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
  ENGINES,
  NOT_CLASSIFIED,
  PANELS,
  PROMPTS,
  PROMPT_BY_ID,
  TOPIC_PARENT,
  TYPE_LABEL,
  absenceOf,
  absenceSentence,
  averageFor,
  countsOf,
  engineOf,
  measures,
  rateFor,
} from './prompts-data.js';
import { visibilityCounts } from './aiov-data.js';
import { infoButton } from './aiov-parts.js';
import { brandsOf, citedLinksOf, intentOf, latestAnswerOf, positionOf, sentimentOf, volumeOf } from './prompts-extra.js';
import { brandsCell, citedLinksCell, closeStaleList, initEngineSelect, onCompetitorsChange, intentCell, positionCell, screenshotCell, sentimentCell, textCell, volumeCell } from './prompts-extra-cells.js';
import { initAddPrompts } from './prompts-add.js';
import { initPromptInspector, refreshPromptInspector } from './prompts-inspector.js';
import { initTopicInspector, refreshTopicInspector } from './prompts-topic-inspector.js';
import { initTopics, promptsByMention, renderTopics, topicOrder, topicsInScope } from './prompts-topics.js';
import { CELL, IDENTITY_RESIZE, focusSearchOnSlash, identityHandle, plainHeaderCell, promptLine, promptRateCell, rowMenuCell, sortHeaderCell, wireColumnChooser } from './prompts-cells.js';
import { NEUTRAL_BADGE, checkbox, el, insufficient, intervalText, percent0, plural, setComparedWithYear } from './prompts-parts.js';
import { BRANDED_LABEL, METRIC_LABEL, VIEWS, deltaNode, inScope, isAllLocations, scopeCodes, scopeEngines, scopePrompts, scopeText, state } from './prompts-state.js';

const ui = window.PreviewUI;
const charts = window.PreviewCharts;
const { $, $$, icon, toast, openPopup, closePopup, engineLogo } = ui;

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
const WIDTH = { select: 40, prompt: 300, topic: 160, country: 120, intent: 128, volume: 132, position: 120, mention: 168, citation: 136, recommendation: 196, sov: 140, sentiment: 168, links: 344, brands: 272, shot: 120, e: 176, count: 152, actions: 40 };
// The Mention rate column also holds the trend line (64 px) when the person compares, so it is wider then
const MENTION_COMPARE_WIDTH = 204;
const columnsOf = () => {
  const single = scopeEngines().length === 1;
  return [
    { key: 'prompt', label: 'Prompt', width: WIDTH.prompt, locked: true },
    { key: 'topic', label: 'Group', width: WIDTH.topic },
    ...(isAllLocations() ? [{ key: 'country', label: 'Location', width: WIDTH.country }] : []),
    { key: 'intent', label: 'Intent', width: WIDTH.intent },
    { key: 'volume', label: 'Search volume', width: WIDTH.volume },
    { key: 'position', label: 'Mention position', width: WIDTH.position },
    { key: 'mention', label: 'Mention rate', width: state.compare ? MENTION_COMPARE_WIDTH : WIDTH.mention },
    { key: 'citation', label: 'Citation rate', width: WIDTH.citation },
    { key: 'recommendation', label: 'Recommendation rate', width: WIDTH.recommendation },
    { key: 'sov', label: 'Share of voice', width: WIDTH.sov },
    { key: 'sentiment', label: 'Sentiment', width: WIDTH.sentiment },
    ...(single ? [{ key: 'links', label: 'Cited pages', width: WIDTH.links, engine: scopeEngines()[0].name }] : []),
    { key: 'brands', label: 'Brands', width: WIDTH.brands },
    ...(single ? [{ key: 'shot', label: 'Screenshot', width: WIDTH.shot, engine: scopeEngines()[0].name }] : []),
    ...scopeEngines().map((engine) => ({ key: `e:${engine.code}`, label: `${engine.label} ${METRIC_LABEL[state.metric].toLowerCase()}`, width: WIDTH.e, engine: engine.name })),
    ...scopeEngines().flatMap((engine) => [
      { key: `m:${engine.code}`, label: `${engine.label} mentioned`, width: WIDTH.count, engine: engine.name },
      { key: `c:${engine.code}`, label: `${engine.label} cited`, width: WIDTH.count, engine: engine.name },
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
  if (counts.reason) return { node: el('span', 'text-foreground-tertiary', 'n/a'), tip: `${engine.label}: ${counts.reason}`, text: 'n/a' };
  if (status === 'none') {
    const absence = absenceOf(prompt, engine.code);
    return { node: el('span', 'text-foreground-tertiary whitespace-nowrap', absence.text), tip: `${engine.label}: ${absence.reason}`, text: absence.text };
  }
  if (status === 'insufficient') {
    return {
      node: insufficient(plural(counts.observations, 'answer')),
      tip: `${engine.label}: ${plural(counts.observations, 'answer')}. A rate needs at least ${MIN_OBSERVATIONS}.`,
      text: plural(counts.observations, 'answer'),
    };
  }
  if (counts.n === 0) return { node: el('span', 'text-foreground-tertiary', 'n/a'), tip: `${engine.label}: no brand was mentioned`, text: 'n/a' };
  const text = percent0(counts.k / counts.n);
  const unit = metric === 'sov' ? 'brand mentions' : engine.unit;
  const interval = metric === 'sov' ? null : intervalText(counts);
  return { node: el('span', 'num', text), tip: `${engine.label}: ${formatSampleCount(counts.k, counts.n)} ${unit}${interval ? `, 95% interval ${interval}` : ''}`, text };
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
    cell.dataset.tip = 'No answer in this period yet. Each prompt is asked twice a week.';
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
  const absent = scope.length === 1 ? absenceSentence(prompt, scope[0]) : 'No answers in this period';
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
const sortHeader = (column) => sortHeaderCell({ key: column.key, label: column.label, sort: state.sort, attr: 'promptSort', tip: HEAD_TIP[column.key], logo: column.engine });
const HEAD_TIP = {
  get mention() {
    const base = 'The share of valid answers that mention your brand, averaged over the platforms shown';
    return state.compare ? `${base}. The change is against the comparison period, and the line is the rate of each week of the period (a week with no valid answer is a gap).` : base;
  },
  citation: 'The share of valid answers that cite your site, averaged over the platforms shown',
  country: 'The location the prompt is asked for',
  intent: 'What the asker wants: to learn, to choose, to buy or to find a brand',
  volume: 'Monthly searches of the keyword the prompt is linked to. Sample values.',
  position: 'Where your brand sits in an ordered answer, 1 being first. Lower is better. Only ordered lists have a mention position.',
  recommendation: 'The share of valid answers that recommend your brand, on the platforms that classify recommendations',
  sov: 'Your mentions as a share of every brand mention in the answers',
  sentiment: 'The tone of the answers that mention your brand, as four shares. Sample values.',
  links: 'The pages the platform cited in its answers, most cited first',
  brands: 'The brands the answers mention, most mentioned first. Opens the list.',
  shot: 'The latest answer of the platform, as the page showed it',
};
/** Columns that open something or show a picture: they have no order. */
const PLAIN_COLUMNS = ['links', 'brands', 'shot'];

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
    if (PLAIN_COLUMNS.includes(column.key)) return plainHeaderCell(column.label, '', HEAD_TIP[column.key], column.engine);
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
// Strip (ADR-DS-022 decision 12): the chips of the toolbar, the prompts in view and one AI visibility rate per engine

const strip = $('[data-prompt-strip]', view);
// The "i" button says what the percentages are; it sits beside the chips, and the chips scroll on their own
const STRIP_INFO = {
  what: 'The percentage for each platform is its AI visibility rate: how often that platform’s answers mention or cite your brand.',
  how: 'The share of valid answers that mention your brand, cite your site, or both. Each prompt counts once. Hover a figure for the counts behind it, with the mention, citation and share of voice figures.',
};
strip.parentElement.classList.remove('overflow-x-auto');
strip.parentElement.classList.add('flex');
strip.classList.add('min-w-0', 'flex-1', 'overflow-x-auto', 'scrollbar-none');
const stripInfo = el('div', 'flex shrink-0 items-center border-l border-border-subtle px-1');
stripInfo.append(infoButton('AI visibility rate', STRIP_INFO));
strip.parentElement.append(stripInfo);

/** One rate of the filtered scope on one engine: prompt-weighted, with the pooled counts as its context. */
function scopeRate(code, metric) {
  const usable = scopePrompts().filter((prompt) => prompt.engines[code].n > 0);
  // AI visibility (named or cited) is derived in the Overview's data layer, so both pages show the same figure
  const countsFor = (prompt, period) => (metric === 'visibility' ? visibilityCounts(prompt, code, period) : countsOf(prompt, code, metric, period));
  const current = usable.map((prompt) => countsFor(prompt, 'current'));
  const pooled = pooledCounts(current);
  const engine = engineOf(code);
  if (metric !== 'visibility' && !measures(code, metric)) return { value: 'n/a', delta: null, context: NOT_CLASSIFIED };
  const observations = current.reduce((sum, entry) => sum + entry.observations, 0);
  if (observations === 0 || pooled.n === 0) return { value: 'n/a', delta: null, context: `no ${engine.unit} in this scope` };
  // A narrow scope can leave an engine with fewer observations than a rate needs, like a single prompt
  if (rateState(observations) !== 'ok') return { value: 'n/a', delta: null, context: `${formatInteger(observations)} ${engine.unit}, not enough for a rate` };
  const rate = metric === 'sov' ? pooled.k / pooled.n : promptWeightedRate(current);
  let delta = null;
  if (metric !== 'sov') {
    const previous = usable.map((prompt) => countsFor(prompt, 'previous'));
    const change = { value: rate - promptWeightedRate(previous), detectable: isDetectableChange(pooled, pooledCounts(previous)) };
    delta = deltaNode(change, { value: rate, sample: `${formatSampleCount(pooled.k, pooled.n)} ${engine.unit}` });
  }
  return { value: percent0(rate), delta, context: `${formatSampleCount(pooled.k, pooled.n)} ${metric === 'sov' ? 'brand mentions' : engine.unit}` };
}

/** One chip of the toolbar: a label, the figure, and its change. The counts behind it are one hover away (P5). */
function stripChip({ label, logo, value, delta, tip, quiet }) {
  // One slot of the strip: the name (with the engine's mark), the figure, its change. The change comes after the figure,
  // so it appearing or going never moves anything else, and a slot keeps its width whatever it holds.
  const item = el('div', `flex h-control min-w-0 items-center gap-2 px-3${quiet ? ' bg-surface-subtle' : ''}`);
  const dt = el('dt', 'flex min-w-0 items-center gap-1.5 type-meta text-foreground-secondary');
  if (logo) dt.append(engineLogo(logo));
  dt.append(el('span', 'truncate', label));
  const dd = el('dd', 'flex shrink-0 items-baseline gap-1.5 rounded-sm px-1 -mx-1 outline-none focus-visible:focus-ring-inset');
  dd.tabIndex = 0;
  dd.append(el('span', `num type-body-strong ${value === 'n/a' ? 'text-foreground-tertiary' : 'text-foreground'}`, value));
  if (delta) {
    delta.classList.add('type-body-strong');
    dd.append(delta);
  }
  if (quiet) dd.append(el('span', 'sr-only', ', not in the Platform filter'));
  item.append(dt, dd);
  if (tip) item.dataset.tip = tip;
  return item;
}

/**
 * The summary strip: the prompts in view and one mention rate for each of the four engines, in that order, always. An
 * engine the Engine select leaves out stays in its place on a quiet ground, so choosing an engine, comparing or
 * filtering changes figures but never the shape of the strip.
 */
function renderStrip() {
  const count = scopePrompts().length;
  const items = [{ label: 'Prompts', value: formatInteger(count), tip: `Across ${plural(topicsInScope().length, 'group')}` }];
  for (const engine of ENGINES) {
    const rate = scopeRate(engine.code, 'visibility');
    const others = ['mention', 'citation', 'sov'].map((metric) => `${METRIC_LABEL[metric]}: ${scopeRate(engine.code, metric).context}`);
    const quiet = !state.engines.includes(engine.code);
    items.push({
      label: engine.label,
      logo: engine.name,
      value: rate.value,
      delta: rate.delta,
      quiet,
      tip: `${engine.label}. AI visibility rate (mentioned or cited): ${rate.context}. ${others.join('. ')}.${quiet ? ' Not in the Platform filter, so the table leaves it out.' : ''}`,
    });
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

function renderFooter() {
  $('[data-prompt-range]', view).textContent = plural(state.rows.length, 'prompt');
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
  engines: { title: 'Platforms', values: () => ENGINES.map((engine) => [engine.code, engine.label]) },
  panel: { title: 'Schedule', values: () => PANELS.map((panel) => [panel.name, panel.name]) },
  topic: { title: 'Group', values: () => Object.keys(TOPIC_PARENT).map((topic) => [topic, topic]) },
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
  // The height of every control of the row, so a chip appearing never makes the row taller
  const node = el('span', 'flex h-control-sm shrink-0 max-w-60 pl-0.5 pr-0.5 rounded-md bg-neutral-subtle items-center gap-0.5 type-body text-foreground');
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
      if (field === 'engines') row.append(engineLogo(engineOf(value).name));
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
  before: $('[data-compare-wrap]', view),
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
  setComparedWithYear(option.dataset.value === 'vs same period last year');
  render();
});

// -------------------------------------------------------------------------------------------------
// Toolbar: search, the column chooser (the engine columns always show the mention rate)

$('[data-prompt-search]', view).addEventListener('input', (event) => {
  state.search = event.target.value.trim().toLowerCase();
  applyFilters();
});
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
    toast({ title: 'Nothing to run', description: 'Google AI Overview is taken from rank checks, not asked. Add ChatGPT, Gemini or Google AI Mode to the scope to run these prompts.', tone: 'info' });
    return;
  }
  const runs = ids.length * asked.length;
  if (runs > MANUAL_RUNS_LEFT) {
    toast({
      title: 'Not queued',
      description: `${plural(ids.length, 'prompt')} need ${plural(runs, 'answer')}, and ${MANUAL_RUNS_LEFT} manual runs are left this month. Select fewer prompts, or wait for the next scheduled run.`,
      tone: 'info',
    });
    return;
  }
  toast({
    title: ids.length === 1 ? 'Run queued' : `Run queued for ${plural(ids.length, 'prompt')}`,
    description: `${plural(runs, 'answer')} on ${asked.map((engine) => engine.label).join(', ')}. ${formatInteger(MANUAL_RUNS_LEFT - runs)} of ${MANUAL_RUNS_LEFT} manual runs are left this month.`,
  });
}

/** Archive is reversible: the rows leave the table and the toast can bring them back (TriageToast). */
async function archive(ids) {
  // Any bulk action over 100 rows confirms with the count (20 section 2, WCAG 3.3.4)
  if (ids.length > 100) {
    const ok = await ui.confirmAction({
      title: `Archive ${plural(ids.length, 'prompt')}?`,
      body: 'They stop being asked from the next run. Their history is kept, and they can be restored.',
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
      description: 'History is kept. No answers are collected from the next run.',
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
    description: skipped > 0 ? `${plural(skipped, 'core prompt')} stayed: the core schedule is locked.` : undefined,
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
// Add prompts (16 section 4): the dialog is prompts-add.js. An added prompt joins PROMPTS, and the page is drawn again.

const addDialog = initAddPrompts({ update, showPrompt: (id) => openPrompt(id) });
const openAdd = (opener, topic) => addDialog.open(opener, topic);
$('[data-prompt-add]', view).addEventListener('click', (event) => openAdd(event.currentTarget));

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

initTopics({ openPrompt, openTopic, openPromptMenu, runNow, exportRows, resetFilters, showInPrompts, addPrompt: (topic, opener) => openAdd(opener, topic) });
initTopicInspector({ topics: topicsInScope, order: topicOrder, promptsOf: promptsByMention, openPrompt, openTopic, addPrompt: (topic, opener) => openAdd(opener, topic) });

// -------------------------------------------------------------------------------------------------
// Start

render();
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
