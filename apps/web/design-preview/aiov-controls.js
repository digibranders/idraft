/* global document, window, history, location, URLSearchParams */
/**
 * The scope of the AI visibility Overview and the controls that change it: Platform and Group selects, the compare
 * trigger and the branded chip. The scope lives in the address (`?platform=chatgpt_web&group=topic:Pricing`), so a
 * link reopens the same view (inventory 3.2). Platform and group are single selects (spec decisions D3 and D4).
 */
import { GROUPS, PLATFORMS } from './aiov-data.js';
import { el, icon } from './aiov-parts.js';

const ui = window.PreviewUI;

export const DEFAULTS = { platform: 'all', group: 'all', branded: 'exclude', compare: true, metric: 'visibility' };
export const state = { ...DEFAULTS };
const listeners = new Set();
export const subscribe = (listener) => listeners.add(listener);

const PLATFORM_IDS = new Set(['all', ...PLATFORMS.map((platform) => platform.code)]);
const GROUP_IDS = new Set(GROUPS.map((group) => group.id));
export const HEAT_METRICS = ['visibility', 'mention', 'citation', 'sov'];

export function readUrl() {
  const params = new URLSearchParams(location.search);
  const platform = params.get('platform');
  const group = params.get('group');
  const metric = params.get('metric');
  state.platform = PLATFORM_IDS.has(platform) ? platform : DEFAULTS.platform;
  state.group = GROUP_IDS.has(group) ? group : DEFAULTS.group;
  // The page has no branded filter: branded prompts are never in these numbers (inventory R10)
  state.branded = DEFAULTS.branded;
  state.compare = params.get('cmp') !== 'off';
  state.metric = HEAT_METRICS.includes(metric) ? metric : DEFAULTS.metric;
}

function writeUrl() {
  const params = new URLSearchParams();
  if (state.platform !== DEFAULTS.platform) params.set('platform', state.platform);
  if (state.group !== DEFAULTS.group) params.set('group', state.group);
  if (!state.compare) params.set('cmp', 'off');
  if (state.metric !== DEFAULTS.metric) params.set('metric', state.metric);
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
}

/** Changes the scope, writes the address and tells the page to draw again. */
export function setScope(patch) {
  Object.assign(state, patch);
  writeUrl();
  listeners.forEach((listener) => listener());
}

// -------------------------------------------------------------------------------------------------
// A single select: a trigger and a listbox popup, optionally with a search field

const TRIGGER = 'h-control px-3 w-full sm:w-auto min-w-0 max-w-full rounded-md border border-border bg-surface flex items-center gap-2 whitespace-nowrap type-body text-foreground hover:bg-surface-hover aria-expanded:bg-surface-hover';
const OPTION = 'group w-full h-control-sm px-2 rounded-md flex items-center gap-2 whitespace-nowrap type-body text-foreground text-left outline-none hover:bg-surface-hover focus-visible:bg-surface-hover';

export function createSelect({ name, options, get, set, searchable = false, width = 'min-w-56' }) {
  const trigger = el('button', TRIGGER);
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const panel = el('div', `hidden fixed z-(--z-dropdown) max-h-80 overflow-y-auto rounded-lg border border-border bg-surface-elevated shadow-popover p-1 ${width}`);
  // The search field sits beside the listbox, not inside it: a listbox holds only options
  const list = el('div');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', name);
  panel.append(list);
  document.body.append(panel);

  let search = null;
  const buttons = [];
  const labelOf = (option) => {
    const wrap = el('span', 'inline-flex items-center gap-2 min-w-0');
    if (option.logo) wrap.append(ui.engineLogo(option.logo));
    wrap.append(el('span', 'truncate', option.label));
    return wrap;
  };
  const refresh = () => {
    const current = options.find((option) => option.id === get()) ?? options[0];
    trigger.replaceChildren(el('span', 'text-foreground-secondary', `${name}:`), labelOf(current), icon('chevron-down', 'size-icon-sm shrink-0 text-foreground-tertiary'));
    trigger.setAttribute('aria-label', `${name}: ${current.label}`);
    buttons.forEach(({ button, option }) => button.setAttribute('aria-selected', String(option.id === current.id)));
  };

  if (searchable) {
    search = el('input', 'w-full h-control-sm mb-1 px-2 rounded-md border border-border bg-surface type-body text-foreground placeholder:text-foreground-tertiary outline-none focus-visible:border-primary');
    search.type = 'search';
    search.placeholder = `Search ${name.toLowerCase()}s`;
    search.setAttribute('aria-label', `Search ${name.toLowerCase()}s`);
    panel.insertBefore(search, list);
  }
  options.forEach((option) => {
    const button = el('button', `${OPTION} ${option.indent ? 'pl-6' : ''}`);
    button.type = 'button';
    button.setAttribute('role', 'option');
    button.dataset.value = option.id;
    // Indentation is visual only, so the group a topic belongs to is in its name
    if (option.parent) button.setAttribute('aria-label', `${option.label}, in ${option.parent}`);
    const check = el('span', 'size-icon-sm shrink-0 text-primary-text invisible group-aria-selected:visible');
    check.setAttribute('aria-hidden', 'true');
    check.append(icon('check', 'size-icon-sm'));
    button.append(check, labelOf(option));
    if (option.note) button.append(el('span', 'ml-auto pl-4 type-meta', option.note));
    button.addEventListener('click', () => {
      ui.closePopup();
      if (option.id !== get()) set(option.id);
    });
    buttons.push({ button, option });
    list.append(button);
  });
  search?.addEventListener('input', () => {
    const needle = search.value.trim().toLowerCase();
    buttons.forEach(({ button, option }) => (button.hidden = needle !== '' && !option.label.toLowerCase().includes(needle)));
  });
  // Arrow keys inside a popup are handled once, for every popup, by interactions.js
  trigger.addEventListener('click', () => {
    if (!panel.classList.contains('hidden')) return ui.closePopup();
    if (search) {
      search.value = '';
      buttons.forEach(({ button }) => (button.hidden = false));
    }
    ui.openPopup(panel, trigger, { align: 'start', focus: search ?? buttons.find(({ button }) => button.getAttribute('aria-selected') === 'true')?.button });
  });
  refresh();
  return { trigger, refresh };
}

export const platformOptions = [{ id: 'all', label: 'All platforms' }, ...PLATFORMS.map((platform) => ({ id: platform.code, label: platform.name, logo: platform.name }))];
export const groupOptions = GROUPS.map((group) => ({ id: group.id, label: group.label, indent: group.kind === 'topic', parent: group.kind === 'topic' ? group.parent : undefined, note: group.kind === 'parent' ? 'group' : undefined }));
