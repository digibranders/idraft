/* global window, location, console */
/**
 * The AI visibility Overview of the static preview (route #/ai).
 * Spec: docs/superpowers/specs/2026-11-16-ai-overview-redesign-design.md.
 *
 * This module is the page: the header, the scope controls (Platform, Group, compare, branded) and the card grid. The
 * numbers come from aiov-data.js, the cards from aiov-registry.js, the layout (which cards, in what order, at what
 * width) from aiov-layout.js, and customize mode from aiov-customize.js. Every control writes the address and the
 * whole page draws again from one scope, so every number has one denominator (inventory R12).
 */
import { RUNS, buildModel, platformsIn } from './aiov-data.js';
import { disposeCharts } from './aiov-charts.js';
import { createSelect, groupOptions, platformOptions, readUrl, setScope, state, subscribe } from './aiov-controls.js';
import { initCompetitorDrawer, openCompetitor, refreshCompetitorDrawer } from './aiov-competitor.js';
import { createCustomizer } from './aiov-customize.js';
import { cardFrame, el, emptyBody, engineName, plural } from './aiov-parts.js';
import { cardDef } from './aiov-registry.js';

const ui = window.PreviewUI;
const view = ui.$('[data-view="ai"]');

// -------------------------------------------------------------------------------------------------
// Static parts: header, scope bar, the grid

const grid = el('div', 'grid grid-cols-1 md:grid-cols-12 gap-4');
const custom = createCustomizer({ grid, onChange: () => render() });

// As in the app, the page name is in the top bar; the heading stays for screen readers only (11 section 3)
const title = el('h1', 'sr-only', 'AI visibility');
const meta = el('span', 'type-meta');
const status = el('div', 'flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0');
status.append(meta, custom.badge);
const actions = el('div', 'flex items-center gap-2');
const exportButton = el('button', 'h-control px-3 rounded-md border border-border bg-surface flex items-center gap-2 whitespace-nowrap type-body-strong text-foreground hover:bg-surface-hover', 'Export');
exportButton.type = 'button';
exportButton.dataset.previewNote = 'Exporting the Overview';
actions.append(custom.presetsButton, custom.toggle, exportButton);

const scopeBar = el('div', 'grid grid-cols-2 gap-2 w-full sm:w-auto sm:flex sm:flex-wrap sm:items-center');
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
const reset = el('button', 'h-control px-3 rounded-md type-body text-foreground-secondary hover:bg-surface-hover hover:text-foreground whitespace-nowrap', 'Reset scope');
reset.type = 'button';
reset.addEventListener('click', () => setScope({ platform: 'all', group: 'all', branded: 'exclude', compare: true, metric: 'visibility' }));
scopeBar.append(platformSelect.trigger, groupSelect.trigger, compareSelect.trigger, reset);

const note = el('p', 'type-meta');
note.setAttribute('role', 'status');
// One compact toolbar, as in the app: the scope on the left, the status and the actions on the right
const toolbar = el('section', 'flex flex-wrap items-center gap-x-4 gap-y-2');
toolbar.setAttribute('aria-label', 'Scope and actions');
const right = el('div', 'flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0 xl:ml-auto');
right.append(status, actions);
toolbar.append(title, scopeBar, right);
view.replaceChildren(toolbar, grid, note, custom.bar, custom.live);

// -------------------------------------------------------------------------------------------------
// Drawing

function safeBuild(def, ctx) {
  try {
    return def.build(ctx);
  } catch (error) {
    console.error(`AI Overview card "${def.key}" failed`, error);
    return cardFrame({ key: `error.${def.key}`, title: def.title, body: emptyBody('This card could not be drawn', 'Reload the preview. The error is in the console.') });
  }
}

function render() {
  disposeCharts();
  // The charts are gone, the drawer's trend with them: an open competitor drawer draws itself again
  refreshCompetitorDrawer();
  const scope = { ...state };
  const model = buildModel(scope);
  // With one group selected, cards can show the project value beside it
  const ctx = { model, scope, compare: state.compare, baseline: scope.group === 'all' ? null : buildModel({ ...scope, group: 'all' }), openCompetitor };
  const names = platformsIn(scope).length;
  meta.textContent = `Updated ${RUNS.last} · run ${RUNS.number} · ${plural(model.prompts.length, 'prompt')} · ${scope.platform === 'all' ? `${names} platforms` : engineName(scope.platform)}${scope.group === 'all' ? '' : ` · ${scope.group.split(':')[1]}`}`;
  [platformSelect, groupSelect, compareSelect].forEach((select) => select.refresh());
  reset.hidden = state.platform === 'all' && state.group === 'all' && state.compare && state.metric === 'visibility';
  custom.updateBar();

  grid.replaceChildren();
  if (model.prompts.length === 0) {
    const empty = cardFrame({ key: 'empty', title: 'No prompts in this scope', body: emptyBody('Nothing to show', 'No prompts match this group and branded setting. Reset the scope.') });
    empty.className += ' md:col-span-12';
    grid.append(empty);
    note.textContent = '';
    return;
  }

  const hidden = [];
  const items = custom.current().cards;
  items.forEach((item) => {
    const def = cardDef(item.type);
    const frame = custom.frameFor(item, safeBuild(def, ctx), { unavailableText: `${def.title} has nothing to show on ${engineName(scope.platform)}${scope.group === 'all' ? '' : ' in this group'}. It stays in your layout.` });
    if (frame) grid.append(frame);
    else hidden.push(def.title);
  });
  if (custom.customizing()) grid.append(custom.addSlot());
  else if (items.length === 0) {
    const empty = cardFrame({ key: 'empty', title: 'This page has no cards', body: emptyBody('Nothing on the page', 'Choose Customize, then Start from a preset or Add card.') });
    empty.className += ' md:col-span-12';
    grid.append(empty);
  }
  note.textContent = hidden.length === 0 ? '' : `${plural(hidden.length, 'card')} not drawn for ${engineName(scope.platform)}${scope.group === 'all' ? '' : ' in this group'}: ${hidden.join(', ')}.`;
}

subscribe(render);
// After the page: when the scope changes the page draws first (and clears its charts), then the open drawer follows
initCompetitorDrawer();
window.addEventListener('preview-route', (event) => {
  if (event.detail.view !== 'ai') return;
  readUrl();
  custom.sync();
  render();
});
if (location.hash.startsWith('#/ai')) {
  readUrl();
  render();
}
