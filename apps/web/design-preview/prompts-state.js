/* global document */
/**
 * What the Topics tab, the Prompts tab and both inspectors share: the filters in force, and the pieces of a
 * cell that depend on them (which engines are in scope, whether changes are shown).
 */
import { ENGINES, PROMPTS, changeFor } from './prompts-data.js';
import { trendIcon } from './prompts-parts.js';

/** A saved view is a set of filters (24 section 9.5). "Branded prompts" is branded only, in every panel. */
export const VIEWS = {
  default: { label: 'Default', panel: ['Core'], branded: 'exclude' },
  branded: { label: 'Branded prompts', panel: [], branded: 'only' },
  discovery: { label: 'Discovery panel', panel: ['Discovery'], branded: 'exclude' },
};
/** The metric names of the select and of the engine columns. */
export const METRIC_LABEL = { visibility: 'AI visibility', mention: 'Mention', citation: 'Citation', sov: 'Share of voice' };
export const BRANDED_LABEL = { exclude: 'Excluded', include: 'Included', only: 'Only' };

export const state = {
  // Filters, shared by both tabs
  view: 'default',
  engines: ENGINES.map((engine) => engine.code),
  panel: [...VIEWS.default.panel],
  branded: VIEWS.default.branded,
  topic: [],
  type: [],
  detectable: false,
  metric: 'mention',
  // The default view shows no comparison: a change in points and the trend line appear when the person compares
  compare: false,
  archived: new Set(),
  // The Prompts tab: its table search, sort, page, selection and columns
  search: '',
  sort: { key: 'mention', dir: 'desc' },
  page: 1,
  selected: new Set(),
  columns: new Set(),
  rows: [], // the filtered, searched and sorted prompts
  // The Topics tab: its table search, sort, selection, columns and which topics are open
  topicSearch: '',
  topicSort: { key: 'mention', dir: 'desc' },
  topicSelected: new Set(),
  topicColumns: new Set(),
  expanded: new Set(),
};

/**
 * Whether the location of the top bar is "All locations". The Location column of the tables shows only then: with one
 * location chosen the top bar already says which, so the column would repeat it on every row.
 */
export const isAllLocations = () => document.querySelector('[data-location-label]')?.textContent.trim() === 'All locations';

export const scopeEngines = () => ENGINES.filter((engine) => state.engines.includes(engine.code));
export const scopeCodes = () => scopeEngines().map((engine) => engine.code);

/** True when the filters keep this prompt. The table searches are not filters: they only find rows. */
export function inScope(prompt) {
  if (state.archived.has(prompt.id)) return false;
  if (state.panel.length > 0 && !state.panel.includes(prompt.panel)) return false;
  if (state.branded === 'exclude' && prompt.branded) return false;
  if (state.branded === 'only' && !prompt.branded) return false;
  if (state.topic.length > 0 && !state.topic.includes(prompt.topic)) return false;
  if (state.type.length > 0 && !state.type.includes(prompt.type)) return false;
  if (state.detectable && changeFor(prompt, scopeCodes(), 'mention')?.detectable !== true) return false;
  return true;
}

export const scopePrompts = () => PROMPTS.filter(inScope);

/** Says which prompts the numbers are about: "core, not branded". */
export function scopeText() {
  const panel = state.panel.length === 0 ? 'all panels' : state.panel.map((name) => name.toLowerCase()).join(' and ');
  const branded = { exclude: 'not branded', include: 'branded included', only: 'branded only' }[state.branded];
  return `${panel}, ${branded}`;
}

/**
 * A change in points as a trend icon: green up, red down, a grey dash when flat; `detail` is what its hover adds (see
 * trendIcon). Null when there is nothing to compare, or when the person chose "No comparison".
 */
export function deltaNode(change, detail) {
  if (!change || !state.compare) return null;
  return trendIcon(change, detail);
}
