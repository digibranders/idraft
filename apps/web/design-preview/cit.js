/* global document, window, location, history, URLSearchParams */
/**
 * The Citations page of the static preview (route #/citations, tab #/citations/gaps). It replaces the planned Sources
 * page: one place for which pages AI answers cite, for which prompts, and where competitors are cited instead of you.
 *
 * Layout (template T2, as the Prompts page): one toolbar with the scope (Platform, Group, Runs, Competitors), the
 * MetricStrip with the six citation measures, the page tabs, then one table panel that fills the page and scrolls
 * inside. A row opens the right inspector (cit-inspector.js): the page drawer or the prompt gap drawer.
 *
 * Numbers come from cit-data.js. Every control writes the address, so a link reopens the same view.
 */
import { formatInteger, formatPercent, formatRelativeChange, formatSignedInteger } from './vendor/format/number.js';
import { DEFAULT_COMPETITORS, MAX_COMPETITORS, OWN_DOMAIN, OWN_NAME, RUN_CHOICES, RUN_DAYS, TRACKED, gapRows, headline, pageRows, trackedOf } from './cit-data.js';
import { GROUPS, PLATFORMS, RUNS, groupOf } from './aiov-data.js';
import { createSelect, groupOptions, platformOptions } from './aiov-controls.js';
import { NEUTRAL_BADGE, el, engineName, icon, plural, sparkline } from './aiov-parts.js';
import { checkbox, trendIcon } from './prompts-parts.js';
import { initCitationInspector, openGapPrompt, openCitedPage, refreshCitationInspector } from './cit-inspector.js';

const ui = window.PreviewUI;
const view = ui.$('[data-view="citations"]');

// -------------------------------------------------------------------------------------------------
// State, kept in the address

const OWNERS = [
  { id: 'own', label: 'Your site', noun: 'your' },
  { id: 'competitor', label: 'Competitors', noun: 'competitor' },
  { id: 'third', label: 'Third-party', noun: 'third-party' },
  { id: 'all', label: 'All', noun: 'all' },
];
const DEFAULTS = { platform: 'all', group: 'all', runs: 4, competitors: DEFAULT_COMPETITORS, owner: 'own', gapsOnly: true, search: '', pageSort: { key: 'citations', dir: 'desc' }, gapSort: { key: 'gap', dir: 'desc' } };
export const state = { ...DEFAULTS, tab: 'pages' };
/** The scope the data module reads. */
export const scope = () => ({ platform: state.platform, group: state.group, runs: state.runs, competitors: state.competitors });

const PLATFORM_IDS = new Set(platformOptions.map((option) => option.id));
const GROUP_IDS = new Set(GROUPS.map((group) => group.id));

function readUrl() {
  const params = new URLSearchParams(location.search);
  state.platform = PLATFORM_IDS.has(params.get('platform')) ? params.get('platform') : DEFAULTS.platform;
  state.group = GROUP_IDS.has(params.get('group')) ? params.get('group') : DEFAULTS.group;
  state.runs = RUN_CHOICES.some((choice) => String(choice.id) === params.get('runs')) ? Number(params.get('runs')) : DEFAULTS.runs;
  const picked = (params.get('comp') ?? '').split(',').filter((id) => trackedOf(id));
  state.competitors = params.has('comp') ? [...new Set(picked)].slice(0, MAX_COMPETITORS) : DEFAULTS.competitors;
  state.owner = OWNERS.some((owner) => owner.id === params.get('owner')) ? params.get('owner') : DEFAULTS.owner;
  state.gapsOnly = params.get('gaps') !== 'all';
  state.search = (params.get('q') ?? '').slice(0, 200);
}

function writeUrl() {
  const params = new URLSearchParams();
  if (state.platform !== DEFAULTS.platform) params.set('platform', state.platform);
  if (state.group !== DEFAULTS.group) params.set('group', state.group);
  if (state.runs !== DEFAULTS.runs) params.set('runs', String(state.runs));
  if (state.competitors.join(',') !== DEFAULTS.competitors.join(',')) params.set('comp', state.competitors.join(','));
  if (state.owner !== DEFAULTS.owner) params.set('owner', state.owner);
  if (!state.gapsOnly) params.set('gaps', 'all');
  if (state.search !== '') params.set('q', state.search);
  // The open drawer keeps its place in the address
  const inspect = new URLSearchParams(location.search).get('inspect');
  if (inspect) params.set('inspect', inspect);
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
}

function set(patch) {
  Object.assign(state, patch);
  writeUrl();
  render();
}

// -------------------------------------------------------------------------------------------------
// Small pieces

const pct1 = (ratio) => formatPercent(ratio, { decimals: 1 });
const TONE = { positive: 'text-positive-text', negative: 'text-negative-text', neutral: 'text-foreground-secondary' };
const BUTTON = 'h-control px-3 rounded-md border border-border bg-surface flex items-center gap-2 whitespace-nowrap type-body-strong text-foreground hover:bg-surface-hover focus-visible:focus-ring';
const HEADER = 'sticky top-0 h-row-header border-b border-border bg-surface-subtle px-3 align-middle font-normal text-left not-last:border-r not-last:border-r-border-subtle';
const CELL = 'border-b border-border-subtle px-3';
const BADGE = 'h-badge inline-flex items-center gap-1 px-2 rounded-sm type-micro whitespace-nowrap num';
// The pinned first column keeps the row's ground when the row is hovered or open in the drawer
const PIN = 'sticky left-0 z-(--z-pinned-cell) bg-surface group-hover:bg-surface-hover group-data-[active=true]:bg-surface-selected';

/** A change in points as a trend icon: green up, red down, a grey dash when flat. */
function pointsDelta(change, value) {
  return change ? trendIcon(change, { value }) : null;
}

/** A change of a count. Counts are not tested for detectability, so it stays neutral. Nothing when unchanged. */
function countDelta(now, before) {
  if (now === before) return null;
  const node = el('span', `num ${TONE.neutral}`, formatSignedInteger(now - before));
  node.dataset.tip = `${formatInteger(before)} before. Counts are not tested for detectability`;
  return node;
}

/** "the previous 4 runs (Aug 10 to Aug 31)", what every change on the page compares with. */
function previousText() {
  if (state.runs === 4) return 'the previous 4 runs (Aug 10 to Aug 31)';
  if (state.runs === 2) return `the 2 runs before (${RUN_DAYS[0]} to ${RUN_DAYS[1]})`;
  return `the run before (${RUN_DAYS[2]})`;
}

function scopeText() {
  return [engineName(state.platform), groupOf(state.group).label, RUN_CHOICES.find((choice) => choice.id === state.runs).label].join(', ');
}

// -------------------------------------------------------------------------------------------------
// Toolbar: the scope on the left, freshness and Export on the right

const title = el('h1', 'sr-only', 'Citations');
const platformSelect = createSelect({ name: 'Platform', options: platformOptions, get: () => state.platform, set: (id) => set({ platform: id }), width: 'min-w-52', triggerWidth: 'sm:w-56' });
const groupSelect = createSelect({ name: 'Group', options: groupOptions, get: () => state.group, set: (id) => set({ group: id }), searchable: true, width: 'min-w-60', triggerWidth: 'sm:w-52' });
const runsSelect = createSelect({ name: 'Runs', options: RUN_CHOICES.map((choice) => ({ id: String(choice.id), label: choice.label, note: choice.id === 4 ? '28 days' : choice.id === 1 ? RUN_DAYS[3] : `${RUN_DAYS[2]} to ${RUN_DAYS[3]}` })), get: () => String(state.runs), set: (id) => set({ runs: Number(id) }), width: 'min-w-56', triggerWidth: 'sm:w-44' });

/** Competitors: a multi-select of the tracked competitors, at most five, the columns of the gap analysis. */
const competitorTrigger = el('button', 'h-control px-3 w-full min-w-0 max-w-full sm:w-60 rounded-md border border-border bg-surface flex items-center gap-2 whitespace-nowrap type-body text-foreground hover:bg-surface-hover aria-expanded:bg-surface-hover');
competitorTrigger.type = 'button';
competitorTrigger.setAttribute('aria-haspopup', 'dialog');
competitorTrigger.setAttribute('aria-expanded', 'false');
const competitorPanel = el('div', 'hidden fixed z-(--z-dropdown) w-64 rounded-lg border border-border bg-surface-elevated shadow-popover p-1');
competitorPanel.setAttribute('role', 'dialog');
competitorPanel.setAttribute('aria-label', 'Competitors to compare');
document.body.append(competitorPanel);

function competitorDot(token) {
  const dot = el('span', 'size-2 shrink-0 rounded-full');
  dot.style.background = `var(--${token})`;
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

function refreshCompetitorTrigger() {
  const names = state.competitors.map((id) => trackedOf(id).name);
  const text = names.length === 0 ? 'None' : names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  competitorTrigger.replaceChildren(el('span', 'text-foreground-secondary', 'Competitors:'), el('span', 'truncate', text), icon('chevron-down', 'size-icon-sm shrink-0 ml-auto text-foreground-tertiary'));
  competitorTrigger.setAttribute('aria-label', `Competitors: ${names.length === 0 ? 'none' : names.join(', ')}`);
}

function fillCompetitorPanel() {
  const head = el('div', 'px-2 pt-1.5 pb-2 flex items-center gap-2');
  head.append(el('span', 'type-label text-foreground-secondary', 'Compare with'), el('span', 'ml-auto type-meta num', `${state.competitors.length} of ${MAX_COMPETITORS}`));
  const list = el('div', 'flex flex-col');
  const full = state.competitors.length >= MAX_COMPETITORS;
  TRACKED.forEach((competitor) => {
    const on = state.competitors.includes(competitor.id);
    const row = el('label', `h-control-sm px-2 rounded-md flex items-center gap-2 type-body text-foreground ${!on && full ? 'opacity-50' : 'cursor-pointer hover:bg-surface-hover'}`);
    const box = checkbox(competitor.name);
    box.input.checked = on;
    box.input.disabled = !on && full;
    box.input.dataset.competitor = competitor.id;
    box.input.addEventListener('change', () => {
      const next = box.input.checked ? [...state.competitors, competitor.id] : state.competitors.filter((id) => id !== competitor.id);
      // Keep the order of the tracked list, so the columns never jump around
      set({ competitors: TRACKED.map((entry) => entry.id).filter((id) => next.includes(id)) });
      // The panel stays open for the next choice; its count and the disabled rows follow the new selection
      fillCompetitorPanel();
      competitorPanel.querySelector(`[data-competitor="${competitor.id}"]`)?.focus();
    });
    row.append(box.wrap, competitorDot(competitor.token), el('span', 'truncate', competitor.name), el('span', 'ml-auto type-meta', competitor.domain));
    list.append(row);
  });
  const foot = el('p', 'px-2 pt-2 pb-1.5 type-meta border-t border-border-subtle mt-1', `Up to ${MAX_COMPETITORS} tracked competitors. Manage the list in Settings.`);
  competitorPanel.replaceChildren(head, list, foot);
}

competitorTrigger.addEventListener('click', () => {
  if (!competitorPanel.classList.contains('hidden')) return ui.closePopup();
  fillCompetitorPanel();
  ui.openPopup(competitorPanel, competitorTrigger, { align: 'start', focus: competitorPanel.querySelector('input:not(:disabled)') });
});

const reset = el('button', 'size-control shrink-0 rounded-md flex items-center justify-center text-foreground-secondary hover:bg-surface-hover hover:text-foreground');
reset.type = 'button';
reset.dataset.tip = 'Reset scope';
reset.setAttribute('aria-label', 'Reset scope');
reset.append(icon('undo-2', 'size-icon'));
reset.addEventListener('click', () => set({ platform: DEFAULTS.platform, group: DEFAULTS.group, runs: DEFAULTS.runs, competitors: DEFAULTS.competitors }));
const isDefaultScope = () => state.platform === DEFAULTS.platform && state.group === DEFAULTS.group && state.runs === DEFAULTS.runs && state.competitors.join(',') === DEFAULTS.competitors.join(',');

const scopeBar = el('div', 'grid grid-cols-2 gap-2 w-full lg:w-auto lg:flex lg:flex-wrap lg:items-center');
scopeBar.setAttribute('role', 'group');
scopeBar.setAttribute('aria-label', 'Scope');
scopeBar.append(platformSelect.trigger, groupSelect.trigger, runsSelect.trigger, competitorTrigger, reset);

// Freshness sits in the table's footer, so the scope and Export keep to one row at 1440 px
const updated = el('span', 'ml-auto type-meta whitespace-nowrap', `Updated ${RUNS.last} · run ${RUNS.number}`);
const exportButton = el('button', BUTTON);
exportButton.type = 'button';
exportButton.dataset.previewNote = 'Exporting citations';
exportButton.append(icon('download', 'size-icon-sm'), el('span', '', 'Export'));
const right = el('div', 'flex items-center gap-x-4 min-w-0 xl:ml-auto');
right.append(exportButton);
const toolbar = el('section', 'flex flex-wrap items-center gap-x-4 gap-y-2');
toolbar.setAttribute('aria-label', 'Scope and actions');
toolbar.append(title, scopeBar, right);

// -------------------------------------------------------------------------------------------------
// MetricStrip: the six measures, each with its denominator and its change against the runs before

// Columns follow the strip's own width, not the window's, so the docked inspector never squeezes six labels into it
const strip = el('dl', 'grid grid-cols-2 @xl:grid-cols-3 @5xl:grid-cols-6 gap-px overflow-hidden rounded-lg border border-border bg-border-subtle');
const stripGroup = el('div', '@container');
stripGroup.setAttribute('role', 'group');
stripGroup.setAttribute('aria-label', 'Citation measures');
stripGroup.append(strip);

const INFO = {
  citations: { what: 'How many times AI answers cite a page of your site.', how: 'One URL in one answer’s list of citations counts once. An answer that cites two of your pages counts twice.' },
  frequency: { what: 'The share of answers that cite your site at least once.', how: 'Answers that cite you, divided by all valid answers. Over All platforms it is the equal-weight average of the platforms, never pooled.' },
  coverage: { what: 'The share of tracked prompts that cite your site at least once in these runs.', how: 'Prompts with at least one answer citing you, divided by prompts with an answer. Over All platforms it is the equal-weight average of the platforms.' },
  urls: { what: 'How many different pages of your site AI answers cite.', how: `Distinct URLs on ${OWN_DOMAIN} in the citation lists of the answers in scope.` },
  domains: { what: 'How many different domains AI answers cite for your prompts: the field you compete in for citations.', how: 'Distinct domains in the citation lists of the answers in scope, your site included.' },
  growth: { what: 'How total citations changed against the same number of runs before.', how: 'Total citations now minus before, divided by before. Not tested for detectability.' },
};

/**
 * One slot of the strip on one 36 px line, as on Prompts: the name, then the figure at the right. There is no info
 * button, so six names fit at 1440 px: the definition and the counts are the figure's tooltip, which focus reaches too.
 */
function stripItem({ key, label, value, delta, context, tip }) {
  const item = el('div', 'flex h-control min-w-0 items-center gap-2 bg-surface px-3');
  const dt = el('dt', 'min-w-0 flex-1 truncate type-meta text-foreground-secondary', label);
  const dd = el('dd', 'flex shrink-0 items-center gap-1.5 rounded-sm outline-none focus-visible:focus-ring-inset');
  dd.append(el('span', `num type-body-strong ${value === 'n/a' ? 'text-foreground-tertiary' : 'text-foreground'}`, value));
  if (delta) {
    delta.classList.add('shrink-0', 'type-body-strong');
    dd.append(delta);
  }
  // The denominator ("in 4,460 answers") is not a line of its own, to keep the strip to label and figure; it leads the
  // tooltip of the figure instead, so the sample size is still one hover or focus away
  const hint = [INFO[key].what, context && `${context.charAt(0).toUpperCase()}${context.slice(1)}.`, tip, INFO[key].how].filter(Boolean).join(' ');
  dd.tabIndex = 0;
  dd.dataset.tip = hint;
  dd.setAttribute('aria-label', `${label}: ${value}. ${hint}`);
  // The whole slot shows it, so the name is a way in too
  item.dataset.tip = hint;
  item.append(dt, dd);
  return item;
}

function renderStrip(data) {
  const all = state.platform === 'all';
  const rateContext = (cell, noun) => (all ? `average of ${cell.used} platforms` : `${formatInteger(cell.pooled.k)} of ${formatInteger(cell.pooled.n)} ${noun}`);
  const rateTip = (cell, noun) => `${formatInteger(cell.pooled.k)} of ${formatInteger(cell.pooled.n)} ${noun}${all ? ', summed over the platforms. The rate is their equal-weight average' : ''}. Change against ${previousText()}.`;
  const growth = data.citations.previous > 0 ? (data.citations.value - data.citations.previous) / data.citations.previous : null;
  strip.replaceChildren(
    stripItem({ key: 'citations', label: 'Total citations', value: formatInteger(data.citations.value), context: `in ${plural(data.answers, 'answer')}`, tip: `Citations of ${OWN_DOMAIN} pages in ${plural(data.answers, 'answer')} to ${plural(data.prompts, 'prompt')}.` }),
    stripItem({ key: 'frequency', label: 'Citation rate', value: data.frequency.value === null ? 'n/a' : pct1(data.frequency.value), delta: pointsDelta(data.frequency.change, data.frequency.value ?? undefined), context: data.frequency.value === null ? 'no answers' : rateContext(data.frequency, 'answers'), tip: data.frequency.value === null ? undefined : rateTip(data.frequency, 'answers cite you') }),
    stripItem({ key: 'coverage', label: 'Prompt coverage', value: data.coverage.value === null ? 'n/a' : pct1(data.coverage.value), delta: pointsDelta(data.coverage.change, data.coverage.value ?? undefined), context: data.coverage.value === null ? 'no answers' : rateContext(data.coverage, 'prompts'), tip: data.coverage.value === null ? undefined : rateTip(data.coverage, 'prompts cite you') }),
    stripItem({ key: 'urls', label: 'Unique cited URLs', value: formatInteger(data.urls.value), delta: countDelta(data.urls.value, data.urls.previous), context: `pages of ${OWN_DOMAIN}` }),
    stripItem({ key: 'domains', label: 'Unique cited domains', value: formatInteger(data.domains.value), delta: countDelta(data.domains.value, data.domains.previous), context: 'in answers to your prompts' }),
    stripItem({ key: 'growth', label: 'Citation growth', value: growth === null ? 'n/a' : formatRelativeChange(growth), context: `${formatSignedInteger(data.citations.value - data.citations.previous)} vs ${previousText().replace(/ \(.*\)$/, '')}`, tip: `${formatInteger(data.citations.value)} citations now, ${formatInteger(data.citations.previous)} in ${previousText()}.` }),
  );
}

// -------------------------------------------------------------------------------------------------
// Tabs: Cited pages and Gap analysis, in the route. They sit at the start of the table's toolbar, as the views of
// Prompts and Internal links do, so they cost no row of their own above the table.

const tabs = el('div', 'inline-flex shrink-0');
tabs.setAttribute('role', 'tablist');
tabs.setAttribute('aria-label', 'Citations views');
const tabLinks = {
  pages: Object.assign(el('a', ''), { href: '#/citations' }),
  gaps: Object.assign(el('a', ''), { href: '#/citations/gaps' }),
};
tabs.append(tabLinks.pages, tabLinks.gaps);

function renderTabs(gapCount) {
  Object.entries(tabLinks).forEach(([key, link], index) => {
    const on = state.tab === key;
    link.className = `inline-flex h-control-sm shrink-0 items-center justify-center gap-1.5 border px-2.5 select-none focus-visible:relative focus-visible:focus-ring-inset ${index === 0 ? 'rounded-l-md' : '-ml-px rounded-r-md'} ${on ? 'relative border-primary-border bg-primary-subtle type-body-strong text-primary-text' : 'border-border bg-surface type-body text-foreground-secondary hover:bg-surface-hover hover:text-foreground'}`;
    link.setAttribute('role', 'tab');
    link.setAttribute('aria-selected', String(on));
    link.replaceChildren(el('span', '', key === 'pages' ? 'Cited pages' : 'Gap analysis'));
    if (key === 'gaps' && gapCount !== null) {
      const badge = el('span', 'inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-neutral-subtle px-1 type-label num text-neutral-text', formatInteger(gapCount));
      badge.setAttribute('aria-hidden', 'true');
      link.append(badge, el('span', 'sr-only', `, ${plural(gapCount, 'gap')}`));
    }
  });
}

// -------------------------------------------------------------------------------------------------
// The table panel: toolbar, table, empty state, footer

// At least 384 px tall, so on a phone, where the strip takes the screen, the table still shows rows and the page scrolls
const panel = el('section', 'flex min-h-96 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface');
const panelBar = el('div', 'flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle px-3 py-2');
const searchWrap = el('div', 'flex h-control-sm w-64 max-w-full min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-2 has-[input:focus-visible]:focus-ring');
const search = el('input', 'h-full min-w-0 flex-1 bg-transparent type-input-touch text-foreground outline-none placeholder:text-foreground-tertiary md:type-body');
search.type = 'search';
search.maxLength = 200;
search.setAttribute('aria-label', 'Search in table');
search.setAttribute('aria-keyshortcuts', '/');
searchWrap.append(icon('search', 'size-icon shrink-0 text-foreground-tertiary'), search);
search.addEventListener('input', () => set({ search: search.value.trim() }));
function clearSearch() {
  search.value = '';
  set({ search: '' });
}
document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || search.offsetParent === null) return;
  if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  event.preventDefault();
  search.focus();
});
const barControls = el('div', 'flex flex-wrap items-center gap-3');
const barRight = el('div', 'ml-auto flex items-center gap-3');
// A hairline keeps the views (what the table is) apart from the filters (what it shows)
const barDivider = el('span', 'hidden h-5 border-l border-border md:block');
barDivider.setAttribute('aria-hidden', 'true');
panelBar.append(tabs, barDivider, searchWrap, barControls, barRight);

const scroller = el('div', 'relative isolate min-h-0 flex-1 overflow-auto');
const table = el('table', 'table-fixed border-separate border-spacing-0 type-table');
table.dataset.selectable = '';
const colgroup = el('colgroup');
const thead = el('thead');
const tbody = el('tbody');
table.append(colgroup, thead, tbody);
const empty = el('div', 'hidden flex-col items-center gap-2 px-4 py-12 text-center');
scroller.append(table, empty);
const footer = el('div', 'flex h-12 shrink-0 items-center gap-3 border-t border-border-subtle px-3');
const footText = el('span', 'type-meta num');
footer.append(footText, updated);
panel.append(panelBar, scroller, footer);

view.replaceChildren(toolbar, stripGroup, panel);

/**
 * The layer of a header cell. The pinned corner sits above the other headers and the pinned cells, so a table scrolled
 * sideways slides under it. The scroller is isolated, so these layers stay inside the table.
 */
const headerLayer = (className) => (className.includes('left-0') ? 'z-(--z-sticky)' : 'z-(--z-table-header)');

/** A sortable column header. */
function sortHeader(label, key, sort, onSort, { tip, className = '' } = {}) {
  const th = el('th', `${HEADER} ${headerLayer(className)} ${className}`);
  th.scope = 'col';
  const active = sort.key === key;
  th.setAttribute('aria-sort', active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  if (tip) th.dataset.tip = tip;
  const button = el('button', 'flex min-w-0 items-center gap-1 rounded-sm focus-visible:focus-ring');
  button.type = 'button';
  button.append(el('span', `truncate type-table-header${active ? ' text-foreground' : ''}`, label));
  if (active) button.append(icon(sort.dir === 'asc' ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow', 'size-icon-sm shrink-0 text-foreground'));
  button.addEventListener('click', () => onSort({ key, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' }));
  th.append(button);
  return th;
}

function plainHeader(label, { tip, className = '', node } = {}) {
  const th = el('th', `${HEADER} ${headerLayer(className)} ${className}`);
  th.scope = 'col';
  if (tip) th.dataset.tip = tip;
  const span = el('span', 'flex min-w-0 items-center gap-1.5');
  if (node) span.append(node);
  span.append(el('span', 'truncate type-table-header', label));
  th.append(span);
  return th;
}

/** Fixed widths in px; `null` is the one flexible column, which takes the rest of the panel down to `FLEX_MIN`. */
const FLEX_MIN = 280;
function setColumns(widths) {
  colgroup.replaceChildren(
    ...widths.map((width) => {
      const col = el('col');
      if (width !== null) col.style.width = `${width}px`;
      return col;
    }),
  );
  table.style.width = '100%';
  table.style.minWidth = `${widths.reduce((sum, width) => sum + (width ?? FLEX_MIN), 0)}px`;
}

function showEmpty(heading, text, action) {
  table.classList.toggle('hidden', heading !== null);
  empty.classList.toggle('hidden', heading === null);
  empty.classList.toggle('flex', heading !== null);
  if (heading === null) return;
  const children = [el('p', 'type-subsection-title', heading), el('p', 'max-w-reading type-meta', text)];
  if (action) {
    const button = el('button', 'mt-2 h-control-sm px-2 rounded-md border border-border bg-surface flex items-center gap-1.5 whitespace-nowrap type-body-strong text-foreground hover:bg-surface-hover focus-visible:focus-ring', action.label);
    button.type = 'button';
    button.addEventListener('click', action.run);
    children.push(button);
  }
  empty.replaceChildren(...children);
}

/** The row's identity is a button, so the keyboard reaches the drawer too; the whole row opens it on click. */
function rowShell(id, open, label) {
  const row = el('tr', 'group h-row cursor-pointer bg-surface hover:bg-surface-hover data-[active=true]:bg-surface-selected');
  row.dataset.id = id;
  row.addEventListener('click', (event) => {
    if (event.target.closest('[data-cell-action]')) return;
    open(row);
  });
  const button = el('button', 'min-w-0 max-w-full text-left rounded-sm outline-none focus-visible:focus-ring flex items-center gap-2');
  button.type = 'button';
  button.setAttribute('aria-label', `Open ${label}`);
  return { row, button };
}

// -------------------------------------------------------------------------------------------------
// Cited pages

let pageOrder = [];
const ownerToken = (row) => (row.owner === 'own' ? 'chart-1' : row.owner === 'competitor' ? TRACKED.find((entry) => entry.name === row.brand)?.token ?? 'chart-other' : 'chart-other');

const promptsPopover = el('div', 'hidden fixed z-(--z-dropdown) w-96 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-surface-elevated shadow-popover');
promptsPopover.setAttribute('role', 'dialog');
document.body.append(promptsPopover);

/** The prompts a page is cited for, top ten, from the "+N" chip of the Prompts column. */
function openPromptsPopover(row, trigger, prompts) {
  if (!promptsPopover.classList.contains('hidden') && promptsPopover.dataset.for === row.id) return ui.closePopup();
  promptsPopover.dataset.for = row.id;
  promptsPopover.setAttribute('aria-label', `Prompts that cite ${row.path}`);
  const head = el('div', 'px-3 pt-3 pb-2 flex items-baseline gap-2 border-b border-border-subtle');
  head.append(el('span', 'type-subsection-title', 'Cited for'), el('span', 'type-meta num', `${plural(row.promptCount, 'prompt')} · ${plural(row.citations, 'citation')}`));
  const list = el('ol', 'py-1 max-h-80 overflow-y-auto');
  prompts.slice(0, 10).forEach(([prompt, count]) => {
    const item = el('li', 'px-3 min-h-8 py-1 flex items-center gap-3');
    item.append(el('span', 'min-w-0 flex-1 truncate type-body text-foreground', prompt.text), el('span', 'shrink-0 type-meta num', `${count}×`));
    item.firstChild.dataset.tip = prompt.text;
    list.append(item);
  });
  const foot = el('div', 'px-3 py-2 border-t border-border-subtle');
  const all = el('button', 'type-body text-link hover:underline', row.promptCount > 10 ? `Show all ${row.promptCount} prompts` : 'Open the page details');
  all.type = 'button';
  all.addEventListener('click', () => {
    ui.closePopup();
    openCitedPage(row.id, trigger.closest('tr'), 'cit-page-prompts');
  });
  foot.append(all);
  promptsPopover.replaceChildren(head, list, foot);
  ui.openPopup(promptsPopover, trigger, { align: 'start', focus: all });
}

function renderPages(rows, promptsById) {
  const sort = state.pageSort;
  const showOwner = state.owner !== 'own';
  const needle = state.search.toLowerCase();
  const visible = rows.filter((row) => (state.owner === 'all' || row.owner === state.owner) && (needle === '' || row.url.toLowerCase().includes(needle) || row.title.toLowerCase().includes(needle)));
  const value = (row) => (sort.key === 'change' ? row.citations - row.previous : sort.key === 'prompts' ? row.promptCount : sort.key === 'last' ? row.lastRun : sort.key === 'page' ? row.url : row.citations);
  visible.sort((a, b) => {
    const [x, y] = [value(a), value(b)];
    const order = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return (sort.dir === 'asc' ? order : -order) || b.citations - a.citations || a.url.localeCompare(b.url);
  });
  pageOrder = visible.map((row) => row.id);

  const codes = state.platform === 'all' ? PLATFORMS.map((platform) => platform.code) : [state.platform];
  setColumns([280, ...(showOwner ? [140] : []), 104, 88, null, codes.length > 1 ? 196 : 112, 104, 104]);
  const onSort = (next) => set({ pageSort: next });
  const headRow = el('tr');
  headRow.append(
    sortHeader('Page', 'page', sort, onSort, { className: 'left-0' }),
    ...(showOwner ? [plainHeader('Domain type')] : []),
    sortHeader('Citations', 'citations', sort, onSort, { tip: 'Answers whose citation list includes this URL' }),
    sortHeader('Change', 'change', sort, onSort, { tip: `Against ${previousText()}. Counts are not tested for detectability` }),
    sortHeader('Prompts', 'prompts', sort, onSort, { tip: 'How many tracked prompts cite this page, and the one that cites it most' }),
    plainHeader('Platforms', { tip: 'Citations on each platform' }),
    plainHeader('Trend', { tip: 'Citations in each of the last 8 weekly runs' }),
    sortHeader('Last cited', 'last', sort, onSort),
  );
  thead.replaceChildren(headRow);

  tbody.replaceChildren(
    ...visible.map((row) => {
      const { row: tr, button } = rowShell(row.id, (opener) => openCitedPage(row.id, opener), row.url);
      const first = el('td', `${CELL} ${PIN}`);
      const url = el('span', 'min-w-0 truncate text-foreground');
      if (row.owner === 'own') url.append(row.path);
      else url.append(el('span', 'text-foreground-tertiary', row.domain), row.path);
      button.append(url);
      button.dataset.tip = `${row.title} (${row.url})`;
      first.append(button);
      if (row.previous === 0) {
        const badge = el('span', `${NEUTRAL_BADGE} ml-2 align-middle`, 'New');
        badge.dataset.tip = `Not cited in ${previousText()}`;
        button.append(badge);
      }
      const cells = [first];
      if (showOwner) {
        const owner = el('td', CELL);
        const label = el('span', 'inline-flex items-center gap-2 min-w-0');
        label.append(competitorDot(ownerToken(row)), el('span', 'truncate', row.owner === 'own' ? 'Your site' : row.owner === 'competitor' ? row.brand : 'Third-party'));
        owner.append(label);
        cells.push(owner);
      }
      cells.push(el('td', `${CELL} num text-foreground`, formatInteger(row.citations)));
      const change = el('td', CELL);
      change.append(countDelta(row.citations, row.previous) ?? el('span', 'text-foreground-tertiary', 'No change'));
      cells.push(change);

      // Prompts: the count, the prompt that cites it most, and the rest behind "+N"
      const prompts = [...row.prompts.entries()].map(([id, count]) => [promptsById.get(id), count]).sort((a, b) => b[1] - a[1] || a[0].text.localeCompare(b[0].text));
      const promptCell = el('td', CELL);
      const line = el('span', 'flex min-w-0 items-center gap-2');
      line.append(el('span', 'w-8 shrink-0 num text-foreground', formatInteger(row.promptCount)));
      const topText = el('span', 'min-w-0 truncate text-foreground-secondary', prompts[0][0].text);
      topText.dataset.tip = `Cited most for: ${prompts[0][0].text} (${prompts[0][1]}×)`;
      line.append(topText);
      const more = el('button', `${BADGE} shrink-0 border border-border bg-surface text-foreground-secondary hover:bg-surface-hover hover:text-foreground focus-visible:focus-ring`, row.promptCount > 1 ? `+${row.promptCount - 1}` : 'Details');
      more.type = 'button';
      more.dataset.cellAction = '';
      more.setAttribute('aria-haspopup', 'dialog');
      more.setAttribute('aria-expanded', 'false');
      more.setAttribute('aria-label', `Prompts that cite ${row.path}, ${plural(row.promptCount, 'prompt')}`);
      more.addEventListener('click', () => openPromptsPopover(row, more, prompts));
      line.append(more);
      promptCell.append(line);
      cells.push(promptCell);

      const engines = el('td', CELL);
      const list = el('span', 'flex items-center gap-3');
      codes.forEach((code) => {
        const count = row.engines[code] ?? 0;
        const item = el('span', `inline-flex items-center gap-1 ${count === 0 ? 'opacity-40' : ''}`);
        const name = PLATFORMS.find((platform) => platform.code === code).name;
        item.append(ui.engineLogo(name), el('span', 'num text-foreground-secondary', formatInteger(count)));
        item.dataset.tip = `${name}: ${plural(count, 'citation')}`;
        list.append(item);
      });
      engines.append(list);
      cells.push(engines);

      const trend = el('td', CELL);
      const spark = el('span', 'block w-24');
      spark.append(sparkline(row.trend, { token: ownerToken(row), height: 20, label: `Citations per run, oldest first: ${row.trend.join(', ')}` }));
      trend.append(spark);
      cells.push(trend, el('td', `${CELL} text-foreground-secondary whitespace-nowrap`, row.lastCited ?? 'n/a'));
      tr.append(...cells);
      return tr;
    }),
  );

  const counts = Object.fromEntries(OWNERS.map((owner) => [owner.id, owner.id === 'all' ? rows.length : rows.filter((row) => row.owner === owner.id).length]));
  const ownerGroup = el('div', 'inline-flex max-w-full overflow-x-auto rounded-md border border-border bg-surface p-0.5');
  ownerGroup.setAttribute('role', 'group');
  ownerGroup.setAttribute('aria-label', 'Domain type');
  OWNERS.forEach((owner) => {
    const pressed = state.owner === owner.id;
    const button = el('button', `h-6 px-2 shrink-0 rounded-sm flex items-center gap-1.5 whitespace-nowrap ${pressed ? 'bg-primary-subtle text-primary-text type-body-strong' : 'type-body text-foreground-secondary hover:bg-surface-hover hover:text-foreground'}`);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(pressed));
    button.append(el('span', '', owner.label), el('span', 'num type-meta', formatInteger(counts[owner.id])));
    button.addEventListener('click', () => set({ owner: owner.id, pageSort: DEFAULTS.pageSort }));
    ownerGroup.append(button);
  });
  barControls.replaceChildren(ownerGroup);
  barRight.replaceChildren();
  search.placeholder = 'Search pages';
  footText.textContent = `${plural(visible.length, 'page')} · ${formatInteger(visible.reduce((sum, row) => sum + row.citations, 0))} citations`;

  if (rows.length === 0) showEmpty('No citations in this scope', `No answer in ${scopeText()} cites a page. Choose more runs or another group.`, { label: 'Reset scope', run: () => reset.click() });
  else if (visible.length === 0)
    showEmpty(
      'No pages match',
      state.search !== '' ? `No ${state.owner === 'all' ? '' : `${OWNERS.find((owner) => owner.id === state.owner).noun} `}page contains "${state.search}".` : `No ${OWNERS.find((owner) => owner.id === state.owner).noun} pages are cited in ${scopeText()}.`,
      { label: state.search !== '' ? 'Clear search' : 'Show all pages', run: () => (state.search !== '' ? clearSearch() : set({ owner: 'all' })) },
    );
  else showEmpty(null);
}

// -------------------------------------------------------------------------------------------------
// Gap analysis

let gapOrder = [];

const answersText = (n) => `${formatInteger(n)} answer${n === 1 ? '' : 's'}`;
const platformName = (code) => PLATFORMS.find((platform) => platform.code === code).name;

/** One brand on one platform, as a sentence for a tooltip. */
function platformLine(code, cell) {
  if (cell.n === 0) return `${platformName(code)}: no answers`;
  if (cell.k > 0) return `${platformName(code)}: cited in ${cell.k} of ${answersText(cell.n)}`;
  if (cell.m > 0) return `${platformName(code)}: mentioned in ${cell.m} of ${answersText(cell.n)}, never cited`;
  return `${platformName(code)}: not cited in ${answersText(cell.n)}`;
}

/**
 * Whether a brand is cited for a prompt: a check when any answer in scope cites it, a dash when none does (a mention
 * without a link is a dash). The counts per platform are in the tooltip. Only your own mark carries a tone: green when
 * cited and lost nowhere, amber when cited but lost on another platform, red when a competitor is cited and you are
 * not. Competitor marks stay neutral, so color means your position.
 */
export function statePill(cell, { own, lost = 0 }) {
  const cited = cell.state === 'cited';
  const ownTone = cited ? (lost > 0 ? 'text-warning-text' : 'text-positive-text') : lost > 0 ? 'text-negative-text' : 'text-foreground-tertiary';
  const tone = own ? ownTone : cited ? 'text-foreground' : 'text-foreground-tertiary';
  const node = el('span', `inline-flex size-6 items-center justify-center ${tone}`);
  if (cell.state === 'none') node.append(el('span', 'type-table', 'n/a'));
  else node.append(icon(cited ? 'check' : 'minus', 'size-icon'), el('span', 'sr-only', cited ? 'Cited' : 'Not cited'));
  node.dataset.tip = Object.entries(cell.perCode)
    .map(([code, entry]) => platformLine(code, entry))
    .join('. ');
  return node;
}

function renderGaps(rows) {
  const sort = state.gapSort;
  const needle = state.search.toLowerCase();
  const competitors = state.competitors.map(trackedOf);
  const visible = rows.filter((row) => (!state.gapsOnly || row.gap > 0) && (needle === '' || row.prompt.text.toLowerCase().includes(needle) || row.prompt.topic.toLowerCase().includes(needle)));
  const rank = { cited: 3, mentioned: 2, not: 1, none: 0 };
  const value = (row) =>
    sort.key === 'prompt' ? row.prompt.text : sort.key === 'topic' ? row.prompt.topic : sort.key === 'you' ? rank[row.you.state] * 100000 + row.you.citedOn * 1000 + row.you.k : sort.key.startsWith('c:') ? (row.rivals[sort.key.slice(2)]?.k ?? 0) : row.gap * 100000 + row.lostTo.length * 1000 + row.rivalAnswers;
  visible.sort((a, b) => {
    const [x, y] = [value(a), value(b)];
    const order = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return (sort.dir === 'asc' ? order : -order) || a.prompt.text.localeCompare(b.prompt.text);
  });
  gapOrder = visible.map((row) => row.id);

  setColumns([null, 136, 120, ...competitors.map(() => 120), 184]);
  const onSort = (next) => set({ gapSort: next });
  const headRow = el('tr');
  headRow.append(
    sortHeader('Prompt', 'prompt', sort, onSort, { className: 'left-0' }),
    sortHeader('Group', 'topic', sort, onSort),
    sortHeader(OWN_NAME, 'you', sort, onSort, { tip: 'Whether answers to the prompt cite your site, with how many answers do' }),
    ...competitors.map((competitor) => {
      const th = sortHeader(competitor.name, `c:${competitor.id}`, sort, onSort, { tip: `Whether answers cite ${competitor.domain}` });
      th.querySelector('button').prepend(competitorDot(competitor.token));
      return th;
    }),
    sortHeader('Lost on', 'gap', sort, onSort, { tip: 'Platforms where a selected competitor is cited and you are not' }),
  );
  thead.replaceChildren(headRow);

  tbody.replaceChildren(
    ...visible.map((row) => {
      const { row: tr, button } = rowShell(row.id, (opener) => openGapPrompt(row.id, opener), row.prompt.text);
      const first = el('td', `${CELL} ${PIN}`);
      button.append(el('span', 'truncate text-foreground', row.prompt.text));
      button.dataset.tip = row.prompt.text;
      first.append(button);
      const you = el('td', CELL);
      you.append(statePill(row.you, { own: true, lost: row.gap }));
      const rivals = competitors.map((competitor) => {
        const cell = el('td', CELL);
        cell.append(statePill(row.rivals[competitor.id], { own: false }));
        return cell;
      });
      // Where you lose: the platforms, then to how many of the selected competitors
      const gap = el('td', CELL);
      if (row.gap > 0) {
        const line = el('span', 'flex items-center gap-2 min-w-0');
        const logos = el('span', 'flex shrink-0 items-center gap-1');
        row.lostOn.forEach((code) => logos.append(ui.engineLogo(platformName(code))));
        line.append(logos, el('span', 'truncate text-foreground-secondary num', `to ${plural(row.lostTo.length, 'competitor')}`));
        gap.append(line);
        gap.dataset.tip = `Lost on ${row.lostOn.map(platformName).join(', ')} to ${row.lostTo.map((id) => trackedOf(id).name).join(', ')}`;
      } else gap.append(el('span', 'text-foreground-tertiary', 'None'));
      tr.append(first, el('td', `${CELL} truncate text-foreground-secondary`, row.prompt.topic), you, ...rivals, gap);
      return tr;
    }),
  );

  const gaps = rows.filter((row) => row.gap > 0).length;
  const only = el('label', 'flex items-center gap-2 type-body text-foreground cursor-pointer select-none');
  const box = checkbox('Only gaps');
  box.input.checked = state.gapsOnly;
  box.input.addEventListener('change', () => set({ gapsOnly: box.input.checked }));
  only.append(box.wrap, el('span', '', 'Only gaps'));
  barControls.replaceChildren(only);
  const summary = el('p', 'type-meta num md:whitespace-nowrap');
  summary.append(el('span', 'type-body-strong text-foreground', formatInteger(gaps)), ` of ${plural(rows.length, 'prompt')} lost to a competitor on at least one platform`);
  barRight.replaceChildren(summary);
  search.placeholder = 'Search prompts and groups';
  footText.textContent = `${plural(visible.length, 'prompt')}${state.gapsOnly ? ' with a gap' : ''}`;

  if (competitors.length === 0) showEmpty('Choose competitors to compare', 'The gap analysis compares you with up to 5 tracked competitors.', { label: 'Choose competitors', run: () => competitorTrigger.click() });
  else if (rows.length === 0) showEmpty('No answers in this scope', `No prompt in ${scopeText()} has an answer yet.`, { label: 'Reset scope', run: () => reset.click() });
  else if (visible.length === 0 && state.search !== '') showEmpty('No prompts match', `No prompt or group contains "${state.search}".`, { label: 'Clear search', run: clearSearch });
  else if (visible.length === 0) showEmpty('No gaps in this scope', 'On every platform, the prompts that cite a selected competitor also cite you.', { label: 'Show all prompts', run: () => set({ gapsOnly: false }) });
  else showEmpty(null);
}

// -------------------------------------------------------------------------------------------------
// Drawing

let promptsById = new Map();
function render() {
  if (ui.currentRoute().view !== 'citations') return;
  [platformSelect, groupSelect, runsSelect].forEach((select) => select.refresh());
  refreshCompetitorTrigger();
  // Invisible keeps its place in the desktop row; in the two-column phone grid it would leave an empty row
  reset.classList.toggle('invisible', isDefaultScope());
  reset.classList.toggle('max-lg:hidden', isDefaultScope());
  if (search.value !== state.search) search.value = state.search;

  const s = scope();
  renderStrip(headline(s));
  const gaps = gapRows(s);
  renderTabs(state.competitors.length > 0 ? gaps.filter((row) => row.gap > 0).length : null);
  promptsById = new Map(gaps.map((row) => [row.id, row.prompt]));
  if (state.tab === 'pages') renderPages(pageRows(s), promptsById);
  else renderGaps(gaps);
  ui.syncActiveRow();
  refreshCitationInspector();
}

initCitationInspector({ scope, order: { page: () => pageOrder, gap: () => gapOrder }, statePill });

window.addEventListener('preview-route', (event) => {
  if (event.detail.view !== 'citations') return;
  state.tab = event.detail.section === 'gaps' ? 'gaps' : 'pages';
  readUrl();
  render();
});
window.addEventListener('preview-leave', (event) => {
  if (event.detail.from !== 'citations') return;
  // This page's query must not follow the person to the next page
  history.replaceState(null, '', location.pathname + location.hash);
});

if (ui.currentRoute().view === 'citations') {
  state.tab = ui.currentRoute().section === 'gaps' ? 'gaps' : 'pages';
  readUrl();
  render();
  // A shared link restores the drawer (?inspect=cited-page:<url>, ?inspect=gap-prompt:<id>)
  const shared = new URLSearchParams(location.search).get('inspect') ?? '';
  if (shared.startsWith('cited-page:')) openCitedPage(shared.slice('cited-page:'.length));
  if (shared.startsWith('gap-prompt:')) openGapPrompt(shared.slice('gap-prompt:'.length));
}
