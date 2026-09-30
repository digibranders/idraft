/**
 * What the Topics tab, the Prompts tab and both inspectors share: the filters in force, and the pieces of a
 * cell that depend on them (which engines are in scope, whether changes are shown).
 */
import { formatMetricDelta } from './vendor/format/delta.js';
import { formatPointsDelta } from './vendor/format/number.js';
import { ENGINES, PROMPTS, changeFor } from './prompts-data.js';
import { el } from './prompts-parts.js';

/** A saved view is a set of filters (24 section 9.5). "Branded prompts" is branded only, in every panel. */
export const VIEWS = {
  default: { label: 'Default', panel: ['Core'], branded: 'exclude' },
  branded: { label: 'Branded prompts', panel: [], branded: 'only' },
  discovery: { label: 'Discovery panel', panel: ['Discovery'], branded: 'exclude' },
};
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
  compare: true,
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

export const TONE_CLASS = { positive: 'text-positive-text', negative: 'text-negative-text', neutral: 'text-foreground-secondary' };

/**
 * A change in points, colored only when it is detectable (17 section 6.3). Null when there is nothing to
 * compare, or when the person chose "No comparison".
 */
export function deltaNode(change, decimals = 0) {
  if (!change || !state.compare) return null;
  const display = formatMetricDelta({ value: change.value, unit: 'points', polarity: 'higher_is_better', isDetectable: change.detectable });
  const node = el('span', `num shrink-0 whitespace-nowrap ${TONE_CLASS[display.tone]}`, formatPointsDelta(change.value, { decimals }));
  node.dataset.tip = change.detectable ? 'Detectable change: its 95% interval excludes zero' : 'Within normal variation';
  // Color and the tooltip are not enough: the same is said in text for people who get neither
  node.append(el('span', 'sr-only', change.detectable ? ', detectable change' : ', within normal variation'));
  return node;
}
