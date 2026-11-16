/* global document, window */
/**
 * The Topics tab, laid out as the app's screen: one row per parent topic, which opens onto the topics under it, then
 * "Show all N prompts" to read the prompts in the Prompts tab. A parent row counts every prompt under it (so rows do not
 * add up to the parent); a topic row opens the topic drawer. Three views of the same rows: the list, the topics by
 * engine, and a heat map. A topic's numbers are computed from its prompts (prompts-data.js, "group" measures).
 */
import { formatDecimal, formatInteger, formatSampleCount } from './vendor/format/number.js';
import { MIN_OBSERVATIONS } from './vendor/stats/index.js';
import { ENGINES, NOT_CLASSIFIED, countsOf, engineOf, groupAverage, groupChange, groupRate, groupTrend, groupUpdated, measures, rateFor, seoOf, topicsOf } from './prompts-data.js';
import { brandsOf, groupVolume, positionOf, sentimentOf } from './prompts-extra.js';
import { brandsCell, closeStaleList, positionCell, sentimentCell, textCell, volumeCell } from './prompts-extra-cells.js';
import { CELL, IDENTITY_RESIZE, focusSearchOnSlash, identityHandle, plainHeaderCell, rateCell, rowMenuCell, sortHeaderCell, sparkCell, topEngineCell, wireColumnChooser } from './prompts-cells.js';
import { checkbox, el, percent0, plural } from './prompts-parts.js';
import { METRIC_LABEL, isAllLocations, scopeCodes, scopeEngines, scopePrompts, scopeText, state } from './prompts-state.js';

const ui = window.PreviewUI;
const charts = window.PreviewCharts;
const { $, icon, openPopup, closePopup } = ui;

const view = $('[data-view="prompts"]');
const head = $('[data-topic-head]', view);
const body = $('[data-topic-rows]', view);
const cols = $('[data-topic-cols]', view);
const table = $('[data-topic-table]', view);
const toolbar = $('[data-topic-toolbar]', view);
const bulkBar = $('[data-topic-bulk]', view);
const empty = $('[data-topic-empty]', view);
const heatmap = $('[data-topic-heatmap]', view);
const menu = $('#menu-topic-row');

/** How many of a parent's prompts are counted in "Show all N prompts": every one of them. */
let host = null;
/** Every parent of the scope, with its topics, and the ones the table shows (after its search), in display order. */
let allTopics = [];
let allParents = [];
let shownParents = [];
let menuTopicId = null;
/** What the topic menu was opened from: focus returns there when the menu starts a dialog. */
let menuAnchor = null;

/** Off until chosen: the engine pointer and the counts of each engine. Everything else of the list is on. */
const defaultOff = () => new Set(['engine', ...ENGINES.flatMap((engine) => [`m:${engine.code}`, `c:${engine.code}`])]);

state.topicView = 'list';
state.topicHidden = defaultOff();
state.density = 'compact';

// -------------------------------------------------------------------------------------------------
// Measures of a topic, for the engines in scope

function summarize(topic) {
  const scope = scopeCodes();
  return {
    ...topic,
    mention: groupAverage(topic.prompts, scope, 'mention'),
    mentionChange: groupChange(topic.prompts, scope, 'mention'),
    citation: groupAverage(topic.prompts, scope, 'citation'),
    recommendation: groupAverage(topic.prompts, scope, 'recommendation'),
    sov: groupAverage(topic.prompts, scope, 'sov'),
    volume: groupVolume(topic.prompts),
    position: positionOf(topic.prompts, scope),
    sentiment: sentimentOf(topic.prompts, scope),
    brands: brandsOf(topic.prompts, scope),
    engineRates: scopeEngines().map((engine) => ({ engine, rate: groupRate(topic.prompts, engine.code, 'mention').rate })),
    trend: groupTrend(topic.prompts, scope),
    updated: groupUpdated(topic.prompts),
    // The topic's tracked keywords, which its drawer shows; a parent has none of its own
    seo: seoOf(topic.name),
  };
}

/** The answers behind one engine of a topic: the counts of its prompts added up, for a metric. */
function engineCounts(topic, code, metric) {
  return topic.prompts.reduce(
    (sum, prompt) => {
      const counts = countsOf(prompt, code, metric);
      return { k: sum.k + counts.k, n: sum.n + counts.n, observations: sum.observations + counts.observations };
    },
    { k: 0, n: 0, observations: 0 },
  );
}

const SORTS = {
  topic: (topic) => topic.name.toLowerCase(),
  prompts: (topic) => topic.prompts.length,
  mention: (topic) => topic.mention.value,
  citation: (topic) => topic.citation.value,
  recommendation: (topic) => topic.recommendation.value,
  sov: (topic) => topic.sov.value,
  volume: (topic) => topic.volume.value,
  position: (topic) => topic.position.value,
  sentiment: (topic) => topic.sentiment.shares?.positive ?? null,
  engine: (topic) => topic.engineRates.filter((entry) => entry.rate !== null).sort((a, b) => b.rate - a.rate)[0]?.engine.name.toLowerCase() ?? null,
  gap: (topic) => {
    const rates = topic.engineRates.map((entry) => entry.rate).filter((rate) => rate !== null);
    return rates.length < 2 ? null : Math.max(...rates) - Math.min(...rates);
  },
};

/** The value a column sorts by. Engine columns (`m:`, `c:` counts and `e:` rates) sort by the engine's own rate. */
function sortValue(topic, key) {
  if (key in SORTS) return SORTS[key](topic);
  const [kind, code] = key.split(':');
  const counts = engineCounts(topic, code, kind === 'c' ? 'citation' : state.topicView === 'engines' ? state.metric : 'mention');
  return counts.n === 0 ? null : counts.k / counts.n;
}

function bySort(a, b, dir) {
  // Unknown values sort last in both directions (12 section 7)
  if (a.value === null || b.value === null) return a.value === b.value ? 0 : a.value === null ? 1 : -1;
  const order = typeof a.value === 'string' ? a.value.localeCompare(b.value) : a.value - b.value;
  return dir === 'asc' ? order : -order;
}

function sorted(topics) {
  const { key, dir } = state.topicSort;
  return topics
    .map((topic) => ({ topic, value: sortValue(topic, key) }))
    .sort((a, b) => bySort(a, b, dir))
    .map((entry) => entry.topic);
}

function compute() {
  const leaves = topicsOf(scopePrompts()).map(summarize);
  allTopics = leaves;
  const parents = new Map();
  for (const leaf of leaves) {
    if (!parents.has(leaf.parent)) parents.set(leaf.parent, { id: `g-${leaf.parent.toLowerCase().replace(/[^a-z]+/g, '-')}`, name: leaf.parent, prompts: [], children: [] });
    const parent = parents.get(leaf.parent);
    parent.prompts.push(...leaf.prompts);
    parent.children.push(leaf);
  }
  allParents = [...parents.values()].map((parent) => ({ ...summarize(parent), children: parent.children, group: true }));
  // Sorting by a column that is not shown would leave no sort indicator
  // ... and neither does one the column chooser turned off
  const { key } = state.topicSort;
  if (!columnsOf().some((column) => column.key === key) || (key !== 'mention' && state.topicHidden.has(key))) state.topicSort = { key: 'mention', dir: 'desc' };
  const search = state.topicSearch;
  shownParents = sorted(allParents)
    .map((parent) => {
      if (search === '' || parent.name.toLowerCase().includes(search)) return { ...parent, shown: sorted(parent.children) };
      const kept = parent.children.filter((child) => child.name.toLowerCase().includes(search));
      return kept.length === 0 ? null : { ...parent, shown: sorted(kept) };
    })
    .filter(Boolean);
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
// Columns of the three views

const WIDTH = { select: 40, topic: 260, prompts: 96, country: 120, volume: 132, position: 120, mention: 168, citation: 136, recommendation: 196, sov: 140, sentiment: 168, brands: 248, engine: 140, trend: 96, count: 152, e: 176, gap: 120, actions: 40 };

/** The columns of the view in force, in table order. `locked` columns cannot be turned off. */
function columnsOf() {
  const engines = scopeEngines();
  if (state.topicView === 'engines') {
    return [
      { key: 'topic', label: 'Topic', width: WIDTH.topic, locked: true },
      { key: 'prompts', label: 'Prompts', width: WIDTH.prompts },
      { key: 'mention', label: 'Mention rate', width: WIDTH.mention },
      ...engines.map((engine) => ({ key: `e:${engine.code}`, label: `${engine.name} ${METRIC_LABEL[state.metric].toLowerCase()}`, width: WIDTH.e })),
      { key: 'gap', label: 'Engine gap', width: WIDTH.gap },
    ];
  }
  return [
    { key: 'topic', label: 'Topic', width: WIDTH.topic, locked: true },
    { key: 'prompts', label: 'Prompts', width: WIDTH.prompts },
    ...(isAllLocations() ? [{ key: 'country', label: 'Location', width: WIDTH.country }] : []),
    { key: 'volume', label: 'Search volume', width: WIDTH.volume },
    { key: 'position', label: 'Avg position', width: WIDTH.position },
    { key: 'mention', label: 'Mention rate', width: WIDTH.mention },
    { key: 'citation', label: 'Citation rate', width: WIDTH.citation },
    { key: 'recommendation', label: 'Recommendation rate', width: WIDTH.recommendation },
    { key: 'sov', label: 'Share of voice', width: WIDTH.sov },
    { key: 'sentiment', label: 'Sentiment', width: WIDTH.sentiment },
    { key: 'trend', label: 'Trend', width: WIDTH.trend },
    { key: 'brands', label: 'Brands', width: WIDTH.brands },
    { key: 'engine', label: 'Top engine', width: WIDTH.engine },
    ...engines.flatMap((engine) => [
      { key: `m:${engine.code}`, label: `${engine.name} mentioned`, width: WIDTH.count },
      { key: `c:${engine.code}`, label: `${engine.name} cited`, width: WIDTH.count },
    ]),
  ];
}
const shownColumns = () => columnsOf().filter((column) => column.locked || !state.topicHidden.has(column.key));
const rowClass = () => (state.density === 'compact' ? 'h-row-compact' : 'h-row');

const HEAD_TIP = {
  prompts: 'The prompts under the topic, each counted once',
  mention: 'The share of valid answers that name your brand, averaged over the engines shown',
  citation: 'The share of valid answers that cite your domain, averaged over the engines shown',
  engine: 'The engine with the highest mention rate. A pointer, not a ranking.',
  trend: 'The mention rate for each week of the window, averaged over the engines shown. A week with no valid answer is a gap in the line.',
  country: 'The location the prompts are asked for',
  volume: 'Monthly searches of the keywords the prompts are linked to, each keyword counted once. Sample values.',
  position: 'Where your brand sits in an ordered answer, 1 being first. Lower is better. Only ordered lists have a position.',
  recommendation: 'The share of valid answers that recommend your brand, on the engines that classify recommendations',
  sov: 'Your mentions as a share of every brand mention in the answers',
  sentiment: 'The tone of the answers that name your brand, as four shares. Sample values.',
  brands: 'The brands the answers name, most named first. Opens the list.',
  gap: 'The distance in points between the engine with the highest rate and the one with the lowest',
};
const sortHeader = (column) => sortHeaderCell({ key: column.key, label: column.label, sort: state.topicSort, attr: 'topicSort', tip: HEAD_TIP[column.key] });

/** The width the person gave the Topic column, or null for its default. */
state.topicIdentity = null;
const identityWidth = () => state.topicIdentity ?? WIDTH.topic;
const widthOf = (column) => (column.key === 'topic' ? identityWidth() : column.width);

/** Sets the width of every column and of the table. Dragging the Topic column calls this, so it never draws the header again. */
function applyWidths() {
  const shown = shownColumns();
  cols.replaceChildren(
    ...[WIDTH.select, ...shown.map(widthOf), WIDTH.actions].map((width) => {
      const col = el('col');
      col.style.width = `${width}px`;
      return col;
    }),
  );
  table.style.width = `${WIDTH.select + WIDTH.actions + shown.reduce((sum, column) => sum + widthOf(column), 0)}px`;
}

/** The widest the Topic column can be: the other columns keep room beside it in the panel. */
const identityMax = () => table.parentElement.clientWidth - IDENTITY_RESIZE.leaveRoom;
function setIdentityWidth(width) {
  state.topicIdentity = width;
  applyWidths();
}

function renderHead() {
  const shown = shownColumns();
  applyWidths();
  const row = el('tr', 'h-row-header');
  const select = el('th', 'sticky top-0 left-0 z-(--z-sticky) border-b border-border border-r border-r-border-subtle bg-surface-subtle px-0 text-center align-middle font-normal');
  const all = checkbox('Select all topics');
  all.input.dataset.topicAll = '';
  select.append(all.wrap);
  const cells = shown.map((column) => {
    if (column.key === 'topic') {
      const th = sortHeader(column);
      // The pinned header must sit above the headers that scroll under it: it takes the sticky layer, not the header one
      th.classList.remove('z-(--z-table-header)');
      th.classList.add('z-(--z-sticky)');
      th.style.left = `${WIDTH.select}px`;
      th.append(identityHandle({ current: identityWidth, set: setIdentityWidth, max: identityMax }));
      return th;
    }
    return ['trend', 'engine', 'country', 'brands'].includes(column.key) ? plainHeaderCell(column.label, '', HEAD_TIP[column.key]) : sortHeader(column);
  });
  const actions = el('th', 'sticky top-0 z-(--z-table-header) border-b border-border bg-surface-subtle');
  actions.append(el('span', 'sr-only', 'Row actions'));
  row.append(select, ...cells, actions);
  head.replaceChildren(row);
}

// -------------------------------------------------------------------------------------------------
// Rows

/** The pinned cells hold the row's own surface and take the hover and selected ones with it. */
const PIN = (surface) => `${surface} group-hover:bg-surface-hover group-aria-selected:bg-surface-selected`;

function selectCell(topic, surface) {
  const cell = el('td', `sticky left-0 z-(--z-pinned-cell) border-b border-border-subtle px-0 text-center ${PIN(surface)}`);
  const box = checkbox(`Select ${topic.name}`);
  box.input.checked = state.topicSelected.has(topic.id);
  cell.append(box.wrap);
  return cell;
}

function topicRateCell(topic, metric) {
  const average = topic[metric];
  const scope = scopeCodes();
  if (scope.every((code) => !measures(code, metric))) {
    const cell = el('td', CELL);
    cell.append(el('span', 'text-foreground-tertiary', 'n/a'));
    cell.dataset.tip = `${scope.map((code) => engineOf(code).name).join(', ')}: ${NOT_CLASSIFIED}`;
    return cell;
  }
  // The engines that took part: one without enough observations in this topic is left out of the average
  const engines = scopeEngines()
    .filter((engine) => groupRate(topic.prompts, engine.code, metric).rate !== null)
    .map((engine) => engine.name)
    .join(', ');
  const observed = topic.prompts.reduce((sum, prompt) => sum + scopeCodes().reduce((total, code) => total + prompt.engines[code].n, 0), 0);
  return rateCell({
    value: average.value,
    change: metric === 'mention' ? topic.mentionChange : null,
    sample: `${formatSampleCount(average.pooled.k, average.pooled.n)} obs`,
    tip: average.used === 1 ? `${engines} only` : `Equal-weight average of ${engines}, each prompt counting once`,
    gap: { text: observed === 0 ? 'n/a' : 'Insufficient', tip: observed === 0 ? 'Not observed in this window' : `${plural(observed, 'observation')} in this topic. A rate needs at least ${MIN_OBSERVATIONS} on an engine.` },
  });
}

/** "36 of 76": the answers that name the brand (or cite it) out of the valid ones, for one engine. */
function countCell(topic, code, metric) {
  const cell = el('td', CELL);
  const counts = engineCounts(topic, code, metric);
  if (counts.n === 0) {
    cell.append(el('span', 'text-foreground-tertiary', 'No answers'));
    cell.dataset.tip = 'No answer in this window yet. Each prompt is asked twice a week.';
  } else {
    cell.append(el('span', 'num', formatSampleCount(counts.k, counts.n)));
    cell.dataset.tip = metric === 'citation' ? 'Answers that cite your domain, of the valid answers in the window' : 'Answers that name your brand, of the valid answers in the window';
  }
  return cell;
}

/** "48% 36 of 76": one engine's rate in the by-engine view, with the answers behind it. */
function engineRateCell(topic, code) {
  const cell = el('td', CELL);
  const { rate } = groupRate(topic.prompts, code, state.metric);
  const counts = engineCounts(topic, code, state.metric);
  if (rate === null) {
    cell.append(el('span', 'text-foreground-tertiary', counts.n === 0 ? 'No answers' : `${counts.observations} obs`));
    return cell;
  }
  const line = el('span', 'inline-flex items-baseline gap-2 whitespace-nowrap');
  line.append(el('span', 'num', percent0(rate)), el('span', 'type-meta num text-foreground-secondary', formatSampleCount(counts.k, counts.n)));
  cell.append(line);
  return cell;
}

function gapCell(topic) {
  const cell = el('td', CELL);
  const gap = SORTS.gap(topic);
  cell.append(el('span', `num${gap === null ? ' text-foreground-tertiary' : ''}`, gap === null ? 'n/a' : `${formatDecimal(gap * 100, 1)} pts`));
  return cell;
}

/** The cells of a row after its name, one per column shown. `leaf` rows are topics, the others parents. */
function dataCells(topic) {
  const make = {
    mention: () => topicRateCell(topic, 'mention'),
    citation: () => topicRateCell(topic, 'citation'),
    recommendation: () => topicRateCell(topic, 'recommendation'),
    sov: () => topicRateCell(topic, 'sov'),
    country: () => textCell('United States', 'Every prompt is asked for the project location, the one the top bar shows'),
    volume: () => volumeCell(topic.volume),
    position: () => positionCell(topic.position),
    sentiment: () => sentimentCell(topic.sentiment),
    brands: () => brandsCell(topic.brands, topic.name),
    engine: () => topEngineCell(topic.engineRates),
    trend: () => sparkCell(topic.trend, ''),
    gap: () => gapCell(topic),
  };
  return shownColumns()
    .filter((column) => column.key !== 'topic')
    .map((column) => {
      if (column.key === 'prompts') {
        const cell = el('td', CELL);
        cell.append(el('span', 'num', formatInteger(topic.prompts.length)));
        return cell;
      }
      if (column.key.startsWith('m:') || column.key.startsWith('c:')) return countCell(topic, column.key.slice(2), column.key.startsWith('c:') ? 'citation' : 'mention');
      if (column.key.startsWith('e:')) return engineRateCell(topic, column.key.slice(2));
      return make[column.key]();
    });
}

function nameCell(topic, { parent, open }) {
  const surface = parent ? 'bg-surface-subtle' : 'bg-surface';
  const cell = el('th', `sticky z-(--z-pinned-cell) border-b border-border-subtle px-3 text-left ${PIN(surface)}${parent ? '' : ' pl-10 font-normal'}`);
  cell.style.left = `${WIDTH.select}px`;
  cell.scope = 'row';
  cell.setAttribute('aria-label', topic.name);
  if (!parent) {
    const title = el('span', 'block min-w-0 truncate text-foreground', topic.name);
    title.dataset.keyCell = '';
    cell.append(title);
    return cell;
  }
  const line = el('span', 'flex min-w-0 items-center gap-2');
  const toggle = el('button', 'flex size-5 shrink-0 items-center justify-center rounded-sm text-foreground-tertiary outline-none hover:text-foreground focus-visible:focus-ring');
  toggle.type = 'button';
  toggle.dataset.topicToggle = '';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${topic.name}, ${plural(topic.children.length, 'topic')}`);
  toggle.append(icon('chevron-right', `size-icon-sm shrink-0 transition-transform${open ? ' rotate-90' : ''}`));
  const text = el('span', 'flex min-w-0 flex-1 items-baseline gap-2');
  const title = el('span', 'min-w-0 truncate text-foreground', topic.name);
  title.dataset.keyCell = '';
  text.append(title, el('span', 'min-w-0 truncate num font-normal text-foreground-tertiary', plural(topic.children.length, 'topic')));
  line.append(toggle, text);
  cell.append(line);
  return cell;
}

function parentRow(parent) {
  const open = state.expanded.has(parent.id);
  const row = el('tr', `group ${rowClass()} cursor-default type-body-strong bg-surface-subtle hover:bg-surface-hover`);
  row.dataset.id = parent.id;
  row.dataset.parent = '';
  row.setAttribute('aria-level', '1');
  row.setAttribute('aria-expanded', String(open));
  row.append(selectCell(parent, 'bg-surface-subtle'), nameCell(parent, { parent: true, open }), ...dataCells(parent), rowMenuCell('topic', parent.name));
  return row;
}

function topicRow(topic, parent) {
  const row = el('tr', `group ${rowClass()} cursor-pointer bg-surface font-normal hover:bg-surface-hover aria-selected:bg-surface-selected`);
  row.dataset.id = topic.id;
  row.dataset.topic = '';
  row.dataset.childOf = parent.id;
  row.setAttribute('aria-level', '2');
  row.append(selectCell(topic, 'bg-surface'), nameCell(topic, { parent: false }), ...dataCells(topic), rowMenuCell('topic', topic.name));
  return row;
}

/** "Show all 10 prompts" under the topics of a parent: the Prompts tab, filtered to them. */
function moreRow(parent) {
  const row = el('tr', `${rowClass()} bg-surface`);
  row.dataset.moreOf = parent.id;
  const cell = el('td', 'border-b border-border-subtle pr-3');
  // Under the names of the topics: the checkbox column, the chevron and the gap before the name
  cell.style.paddingLeft = '80px';
  cell.colSpan = shownColumns().length + 2;
  const count = parent.prompts.length;
  // The row spans every column, so the button is pinned to the window's left edge and stays put while the table scrolls
  const pinned = el('div', 'sticky w-fit');
  pinned.style.left = '80px';
  const button = el('button', 'type-body text-link hover:underline', count === 1 ? 'Show the prompt' : `Show all ${formatInteger(count)} prompts`);
  button.type = 'button';
  button.dataset.topicMore = '';
  button.setAttribute('aria-label', `Show ${count === 1 ? 'the prompt' : `all ${formatInteger(count)} prompts`} of ${parent.name}`);
  pinned.append(button);
  cell.append(pinned);
  row.append(cell);
  return row;
}

function renderRows() {
  const rows = [];
  for (const parent of shownParents) {
    rows.push(parentRow(parent));
    if (!state.expanded.has(parent.id)) continue;
    parent.shown.forEach((topic) => rows.push(topicRow(topic, parent)));
    rows.push(moreRow(parent));
  }
  body.replaceChildren(...rows);
  closeStaleList();
  const none = shownParents.length === 0;
  empty.hidden = !none;
  table.hidden = none || state.topicView === 'heatmap';
  heatmap.hidden = none || state.topicView !== 'heatmap';
  if (none) {
    $('[data-topic-empty-text]', empty).textContent =
      state.topicSearch !== '' ? `No topic in this scope (${scopeText()}) is called "${state.topicSearch}".` : `The scope is ${scopeText()}. Remove a filter, or reset them all.`;
  }
  charts.sparklines(body);
  charts.syncRows();
  ui.syncActiveRow();
}

// -------------------------------------------------------------------------------------------------
// Heat map: the same rows as a grid of the metric by engine, in the app's seven sequential bins

const BINS = [
  { fill: 'bg-seq-1', text: 'text-foreground', label: '0%' },
  { fill: 'bg-seq-2', text: 'text-foreground', label: 'Under 10%' },
  { fill: 'bg-seq-3', text: 'text-foreground', label: '10% to 20%' },
  { fill: 'bg-seq-4', text: 'text-foreground', label: '20% to 35%' },
  { fill: 'bg-seq-5', text: 'text-foreground dark:text-foreground-inverse', label: '35% to 50%' },
  { fill: 'bg-seq-6', text: 'text-foreground-inverse', label: '50% to 70%' },
  { fill: 'bg-seq-7', text: 'text-foreground-inverse', label: '70% and up' },
];
const EDGES = [0.1, 0.2, 0.35, 0.5, 0.7];
function binOf(rate) {
  const printed = Math.round(rate * 100) / 100;
  return rate === 0 ? BINS[0] : BINS[1 + EDGES.filter((edge) => printed >= edge).length];
}

function renderHeatmap() {
  const engines = scopeEngines();
  const metric = state.metric;
  const label = METRIC_LABEL[metric];
  const wrap = el('div', 'flex min-w-0 flex-col gap-3');
  const title = el('div', 'flex flex-col');
  title.append(el('h2', 'type-section-title', `${label} by topic and engine`), el('p', 'type-meta num', `${plural(allTopics.length, 'topic')}, ${plural(engines.length, 'engine')}`));
  const frame = el('div', 'min-w-0 overflow-x-auto rounded-md border border-border-subtle');
  const grid = el('table', 'w-full table-fixed border-separate border-spacing-0 type-table');
  const header = el('tr', 'h-row-header');
  const headClass = 'border-b border-border bg-surface-subtle px-3 align-middle font-normal type-table-header';
  header.append(el('th', `${headClass} w-64 text-left border-r border-r-border-subtle`, 'Topic'), el('th', `${headClass} w-22 text-right`, 'Prompts'));
  engines.forEach((engine) => header.append(el('th', `${headClass} text-center`, engine.name)));
  if (engines.length > 1) header.append(el('th', `${headClass} text-center`, `Avg of ${engines.length}`));
  const rows = shownParents.map((parent) => {
    const row = el('tr', rowClass());
    row.append(el('th', 'border-b border-border-subtle border-r border-r-border-subtle bg-surface px-3 text-left font-normal', parent.name), el('td', 'border-b border-border-subtle px-3 text-right num', formatInteger(parent.prompts.length)));
    const values = engines.map((engine) => groupRate(parent.prompts, engine.code, metric).rate);
    const average = engines.length > 1 ? groupAverage(parent.prompts, scopeCodes(), metric).value : null;
    [...values, ...(engines.length > 1 ? [average] : [])].forEach((rate) => {
      if (rate === null) row.append(el('td', 'border-b border-border-subtle bg-surface px-3 text-center text-foreground-tertiary', 'n/a'));
      else row.append(el('td', `border-b border-border-subtle px-3 text-center num ${binOf(rate).fill} ${binOf(rate).text}`, percent0(rate)));
    });
    return row;
  });
  grid.append(el('thead'), el('tbody'));
  grid.firstChild.append(header);
  grid.lastChild.append(...rows);
  frame.append(grid);
  const key = el('ul', 'flex max-w-dialog-md flex-wrap gap-x-6 gap-y-2 type-meta');
  BINS.forEach((bin) => {
    const item = el('li', 'flex w-44 items-center gap-2');
    item.append(el('span', `size-4 shrink-0 rounded-xs ${bin.fill}`), bin.label);
    key.append(item);
  });
  wrap.append(title, frame, key, el('p', 'type-meta', 'Topic rows overlap: a prompt in two topics counts in both. Each cell is prompt weighted.'));
  heatmap.replaceChildren(wrap);
}

function renderChrome() {
  const parents = shownParents.length;
  const prompts = new Set(shownParents.flatMap((parent) => parent.prompts.map((prompt) => prompt.id))).size;
  const topics = shownParents.reduce((sum, parent) => sum + parent.shown.length, 0);
  $('[data-topic-count]', view).textContent = plural(topics, 'topic');
  $('[data-topic-range]', view).textContent = `${plural(topics, 'topic')} · ${plural(prompts, 'prompt')}`;
  const allOpen = parents > 0 && shownParents.every((parent) => state.expanded.has(parent.id));
  const expand = $('[data-topic-expand-all]', view);
  const label = $('[data-topic-expand-label]', view);
  label.textContent = allOpen ? 'Collapse all' : 'Expand all';
  expand.replaceChildren(icon(allOpen ? 'chevrons-down-up' : 'chevrons-up-down', 'size-icon-sm shrink-0'), label);
  expand.hidden = state.topicView === 'heatmap';
  $('[data-topic-engines-only]', view).hidden = state.topicView !== 'engines';
  $$topicView().forEach((button) => button.setAttribute('aria-checked', String(button.dataset.topicView === state.topicView)));
  $$topicDensity().forEach((item) => item.setAttribute('aria-checked', String(item.dataset.density === state.density)));

  const visible = new Set(shownParents.flatMap((parent) => [parent.id, ...parent.shown.map((topic) => topic.id)]));
  const selected = [...state.topicSelected].filter((id) => visible.has(id));
  toolbar.hidden = selected.length > 0;
  bulkBar.hidden = selected.length === 0;
  $('[data-topic-selected]', bulkBar).textContent = `${plural(selected.length, 'topic')} selected · ${plural(selectedPromptIds().length, 'prompt')}`;
  const all = $('[data-topic-all]', head);
  if (all) {
    const rows = shownParents.map((parent) => parent.id);
    all.checked = rows.length > 0 && rows.every((id) => state.topicSelected.has(id));
    all.indeterminate = !all.checked && selected.length > 0;
  }
}

const $$topicView = () => [...view.querySelectorAll('[data-topic-view]')];
const $$topicDensity = () => [...document.querySelectorAll('#menu-topic-density [data-density]')];

export function renderTopics() {
  compute();
  renderHead();
  renderRows();
  if (state.topicView === 'heatmap') renderHeatmap();
  renderChrome();
}

/** Topics of the current scope, whatever the table search: the drawer and the strip count these. */
export const topicsInScope = () => allTopics;
export const topicOrder = () => shownParents.flatMap((parent) => parent.shown.map((topic) => topic.id));

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
  $('[data-topic-menu-label]', menu).textContent = allTopics.find((topic) => topic.id === id)?.name ?? allParents.find((parent) => parent.id === id).name;
  openPopup(menu, anchor, options);
}

const selectedTopics = () => {
  const chosen = state.topicSelected;
  return [...allParents.filter((parent) => chosen.has(parent.id)), ...allTopics.filter((topic) => chosen.has(topic.id))];
};
const selectedPromptIds = () => [...new Set(selectedTopics().flatMap((topic) => topic.prompts.map((prompt) => prompt.id)))];

export function initTopics(page) {
  host = page;

  head.addEventListener('click', (event) => {
    const key = event.target.closest('[data-topic-sort]')?.dataset.topicSort;
    if (!key) return;
    // Names start A to Z, and so does the position (1 is best); numbers and dates start with the largest. A second click reverses.
    const first = key === 'topic' || key === 'position' ? 'asc' : 'desc';
    state.topicSort = { key, dir: state.topicSort.key === key ? (state.topicSort.dir === 'asc' ? 'desc' : 'asc') : first };
    renderTopics();
    $(`[data-topic-sort="${key}"]`, head)?.focus();
  });
  head.addEventListener('change', (event) => {
    if (!event.target.matches('[data-topic-all]')) return;
    shownParents.forEach((parent) => (event.target.checked ? state.topicSelected.add(parent.id) : state.topicSelected.delete(parent.id)));
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
    const parentId = row.dataset.childOf ?? row.dataset.moreOf ?? row.dataset.id;
    if (event.target.closest('[data-topic-toggle]')) return toggle(parentId);
    if (event.target.closest('[data-topic-more]')) {
      const parent = allParents.find((entry) => entry.id === parentId);
      return host.showInPrompts(parent.children.map((child) => child.name));
    }
    const more = event.target.closest('[data-record-menu]');
    if (more) {
      event.stopPropagation();
      return openMenu(row.dataset.id, more, { align: 'end' });
    }
    if (event.target.closest('input, button, a, label') || row.dataset.moreOf) return undefined;
    if (row.dataset.parent !== undefined) return toggle(row.dataset.id, false);
    return host.openTopic(row.dataset.id, row);
  });
  body.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('tr');
    if (!row || row.dataset.moreOf || event.shiftKey) return;
    event.preventDefault();
    openMenu(row.dataset.id, row, { point: { x: event.clientX, y: event.clientY } });
  });

  $('[data-topic-search]', view).addEventListener('input', (event) => {
    state.topicSearch = event.target.value.trim().toLowerCase();
    renderTopics();
  });
  $('[data-topic-expand-all]', view).addEventListener('click', () => {
    const allOpen = shownParents.every((parent) => state.expanded.has(parent.id));
    shownParents.forEach((parent) => (allOpen ? state.expanded.delete(parent.id) : state.expanded.add(parent.id)));
    renderRows();
    renderChrome();
  });
  view.querySelector('[data-prompt-topic-view]').addEventListener('click', (event) => {
    const next = event.target.closest('[data-topic-view]')?.dataset.topicView;
    if (!next || next === state.topicView) return;
    state.topicView = next;
    // A column of one view is not a column of the other: the sort falls back to the Mention rate
    state.topicSort = { key: 'mention', dir: 'desc' };
    renderTopics();
  });
  document.querySelector('#menu-topic-density').addEventListener('click', (event) => {
    const next = event.target.closest('[data-density]')?.dataset.density;
    if (!next) return;
    state.density = next;
    closePopup();
    host.renderDensity();
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
    identity: { label: 'Topic', current: identityWidth, isDefault: () => state.topicIdentity === null, set: setIdentityWidth, max: identityMax },
    columns: columnsOf,
    shown: () => ({ has: (key) => !state.topicHidden.has(key) }),
    change: (key, on) => {
      if (on) state.topicHidden.delete(key);
      else state.topicHidden.add(key);
      renderTopics();
    },
    reset: () => {
      state.topicHidden = defaultOff();
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
    const topic = allTopics.find((entry) => entry.id === menuTopicId) ?? allParents.find((entry) => entry.id === menuTopicId);
    if (!action || !topic) return;
    closePopup({ restoreFocus: false });
    const names = topic.group ? topic.children.map((child) => child.name) : [topic.name];
    if (action === 'open') {
      if (topic.group) toggle(topic.id, false);
      else host.openTopic(topic.id, $(`tr[data-id="${topic.id}"]`, body));
    } else if (action === 'explore') host.showInPrompts(names);
    else if (action === 'add') host.addPrompt(names[0], menuAnchor?.isConnected ? menuAnchor : null);
    else if (action === 'run') host.runNow(topic.prompts.map((prompt) => prompt.id));
    else if (action === 'export') host.exportRows(topic.prompts.length);
  });

  focusSearchOnSlash($('[data-topic-search]', view));
}
