/* global window, location, console */
/**
 * The AI visibility Overview of the static preview (route #/ai).
 * Spec: docs/superpowers/specs/2026-11-16-ai-overview-redesign-design.md.
 *
 * This module is the page: the header, the scope controls (Platform, Group, compare, branded) and the card grid. The
 * numbers come from aiov-data.js, the cards from aiov-cards-core.js and aiov-cards-more.js. Every control writes the
 * address and the whole page draws again from one scope, so every number has one denominator (inventory R12).
 */
import { BRANDED_LABEL, RUNS, buildModel, platformsIn } from './aiov-data.js';
import { calendarCard, changesCard, domainsCard, fanoutCard, groupExtremesCard, groupHeatmapCard, groupPromptsCard, ownPagesCard, positionCard, referralCard, sentimentCard, sourceTypesCard, unlinkedCard } from './aiov-cards-more.js';
import { gapCard, headlineRow, matrixCard, outcomeCard, sovCard, sovOverTimeCard, trendCard } from './aiov-cards-core.js';
import { disposeCharts } from './aiov-charts.js';
import { createSelect, groupOptions, platformOptions, readUrl, setScope, state, subscribe } from './aiov-controls.js';
import { cardFrame, el, emptyBody, engineName, plural } from './aiov-parts.js';

const ui = window.PreviewUI;
const view = ui.$('[data-view="ai"]');

const WIDTH = {
  third: 'md:col-span-6 xl:col-span-4',
  half: 'md:col-span-6',
  two_thirds: 'md:col-span-12 xl:col-span-8',
  full: 'md:col-span-12',
};

/**
 * The default layout: rows of cards. `build` returns a card, or null when the card cannot exist for the scope. When a
 * row loses a card, the one left takes the whole row. Group scope swaps the heat map row for the group's prompts.
 */
const ROWS = [
  [{ key: 'trend', title: 'Trend', build: trendCard, width: 'two_thirds' }, { key: 'outcome', title: 'Outcome split', build: outcomeCard, width: 'third' }],
  [{ key: 'matrix', title: 'Metrics by platform', build: matrixCard, width: 'full' }],
  [{ key: 'sov', title: 'Share of voice', build: sovCard, width: 'half' }, { key: 'sovTime', title: 'Share of voice over time', build: sovOverTimeCard, width: 'half' }],
  [{ key: 'gap', title: 'Competitor gap', build: gapCard, width: 'full' }],
  'groups',
  [{ key: 'domains', title: 'Top cited domains', build: domainsCard, width: 'half' }, { key: 'sourceTypes', title: 'Sources by type', build: sourceTypesCard, width: 'half' }],
  [{ key: 'ownPages', title: 'Your pages cited', build: ownPagesCard, width: 'half' }, { key: 'unlinked', title: 'Unlinked mentions', build: unlinkedCard, width: 'half' }],
  [{ key: 'position', title: 'Mention position', build: positionCard, width: 'half' }, { key: 'sentiment', title: 'Brand sentiment', build: sentimentCard, width: 'half' }],
  [{ key: 'referral', title: 'AI referral traffic', build: referralCard, width: 'full' }],
  [{ key: 'fanout', title: 'Fan-out queries', build: fanoutCard, width: 'half' }, { key: 'changes', title: 'Key changes', build: changesCard, width: 'half' }],
  [{ key: 'calendar', title: 'Collection runs', build: calendarCard, width: 'full' }],
];
const GROUP_ROWS = {
  all: [{ key: 'heatmap', title: 'Groups by platform', build: groupHeatmapCard, width: 'two_thirds' }, { key: 'extremes', title: 'Strongest and weakest groups', build: groupExtremesCard, width: 'third' }],
  one: [{ key: 'groupPrompts', title: 'Prompts in this group', build: groupPromptsCard, width: 'full' }],
};

// -------------------------------------------------------------------------------------------------
// Static parts: header, scope bar, the grid

const header = el('section', 'flex flex-wrap items-start gap-x-4 gap-y-3');
const heading = el('div', 'flex min-w-0 flex-col gap-1 basis-full md:basis-auto md:flex-1');
const title = el('h1', 'type-page-title', 'AI visibility');
const meta = el('p', 'type-meta');
heading.append(title, meta);
const actions = el('div', 'flex items-center gap-3 md:ml-auto');
const ACTION = 'h-control px-3 rounded-md border border-border bg-surface flex items-center gap-2 whitespace-nowrap type-body-strong text-foreground hover:bg-surface-hover';
for (const name of ['Customize', 'Export']) {
  const button = el('button', `${ACTION} ${name === 'Customize' ? 'hidden md:flex' : ''}`, name);
  button.type = 'button';
  button.dataset.previewNote = name === 'Customize' ? 'Customizing this page' : 'Exporting the Overview';
  actions.append(button);
}
header.append(heading, actions);

const scopeBar = el('section', 'flex flex-wrap items-center gap-2');
scopeBar.setAttribute('aria-label', 'Scope');
const platformSelect = createSelect({ name: 'Platform', options: platformOptions, get: () => state.platform, set: (id) => setScope({ platform: id }), width: 'min-w-52' });
const groupSelect = createSelect({ name: 'Group', options: groupOptions, get: () => state.group, set: (id) => setScope({ group: id }), searchable: true, width: 'min-w-60' });
const compareSelect = createSelect({
  name: 'Compare',
  options: [
    { id: 'prev', label: 'vs previous period' },
    { id: 'off', label: 'No comparison' },
  ],
  get: () => (state.compare ? 'prev' : 'off'),
  set: (id) => setScope({ compare: id === 'prev' }),
  width: 'min-w-52',
});
const brandedSelect = createSelect({
  name: 'Branded',
  options: Object.entries(BRANDED_LABEL).map(([id, label]) => ({ id, label })),
  get: () => state.branded,
  set: (id) => setScope({ branded: id }),
  width: 'min-w-40',
});
const reset = el('button', 'h-control px-3 rounded-md type-body text-foreground-secondary hover:bg-surface-hover hover:text-foreground whitespace-nowrap', 'Reset');
reset.type = 'button';
reset.addEventListener('click', () => setScope({ platform: 'all', group: 'all', branded: 'exclude', compare: true, metric: 'visibility' }));
scopeBar.append(platformSelect.trigger, groupSelect.trigger, compareSelect.trigger, brandedSelect.trigger, reset);

const grid = el('div', 'grid grid-cols-1 md:grid-cols-12 gap-4');
const note = el('p', 'type-meta');
note.setAttribute('role', 'status');
view.replaceChildren(header, scopeBar, grid, note);

// -------------------------------------------------------------------------------------------------
// Drawing

function safeBuild(entry, ctx) {
  try {
    return entry.build(ctx);
  } catch (error) {
    console.error(`AI Overview card "${entry.key}" failed`, error);
    return cardFrame({ key: `error.${entry.key}`, title: entry.title, body: emptyBody('This card could not be drawn', 'Reload the preview. The error is in the console.') });
  }
}

function render() {
  disposeCharts();
  const scope = { ...state };
  const model = buildModel(scope);
  // With one group selected, cards can show the project value beside it
  const ctx = { model, scope, compare: state.compare, baseline: scope.group === 'all' ? null : buildModel({ ...scope, group: 'all' }) };
  const names = platformsIn(scope).length;
  meta.textContent = `Updated ${RUNS.last} · run ${RUNS.number} · ${plural(model.prompts.length, 'prompt')} · ${scope.platform === 'all' ? `${names} platforms` : engineName(scope.platform)}${scope.group === 'all' ? '' : ` · ${scope.group.split(':')[1]}`}`;
  [platformSelect, groupSelect, compareSelect, brandedSelect].forEach((select) => select.refresh());
  reset.hidden = state.platform === 'all' && state.group === 'all' && state.branded === 'exclude' && state.compare && state.metric === 'visibility';

  grid.replaceChildren();
  if (model.prompts.length === 0) {
    const empty = cardFrame({ key: 'empty', title: 'No prompts in this scope', body: emptyBody('Nothing to show', 'No prompts match this group and branded setting. Reset the scope.') });
    empty.className += ' md:col-span-12';
    grid.append(empty);
    note.textContent = '';
    return;
  }

  const head = headlineRow(ctx);
  head.className += ' md:col-span-12';
  grid.append(head);
  const hidden = [];
  ROWS.forEach((row) => {
    const entries = row === 'groups' ? (scope.group === 'all' ? GROUP_ROWS.all : GROUP_ROWS.one) : row;
    const built = entries.map((entry) => ({ entry, node: safeBuild(entry, ctx) }));
    built.filter(({ node }) => node === null).forEach(({ entry }) => hidden.push(entry.title));
    const shown = built.filter(({ node }) => node !== null);
    shown.forEach(({ entry, node }) => {
      node.className += ` ${WIDTH[shown.length === 1 ? 'full' : entry.width]}`;
      grid.append(node);
    });
  });
  note.textContent = hidden.length === 0 ? '' : `${plural(hidden.length, 'card')} not available for ${engineName(scope.platform)}: ${hidden.join(', ')}.`;
}

subscribe(render);
window.addEventListener('preview-route', (event) => {
  if (event.detail.view !== 'ai') return;
  readUrl();
  render();
});
if (location.hash.startsWith('#/ai')) {
  readUrl();
  render();
}
