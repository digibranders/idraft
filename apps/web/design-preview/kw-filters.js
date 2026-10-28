/**
 * The filter chips of Rankings (13-filters-search.md): one chip per filter, each edited in a popover, removed with
 * its x, and a Filter menu that starts a new one. Every change goes through `ctx.setFilter`, so the URL is the only
 * record of a filter.
 */
import { CHANGE_OPTIONS, DEFAULT_STATE, FILTERS, RANK_OPTIONS, activeFilterChips } from './kw-model.js';
import { DEPTHS, DEVICES, INTENTS, LANGUAGES, LOCATIONS, SOURCES, STAGES, allTags, groupList } from './kw-data.js';
import { BUTTON, BUTTON_PRIMARY, BUTTON_SM, FIELD, checkRow, icon, popover } from './perf-ui.js';
import { el } from './prompts-parts.js';

/** The choices of a single or multi filter, as `[value, label]` pairs. */
function optionsFor(key) {
  const table = {
    grp: groupList().map((path) => [path, path]),
    tag: allTags().map((tag) => [tag, tag]),
    rank: RANK_OPTIONS,
    chg: CHANGE_OPTIONS,
    dev: DEVICES,
    loc: LOCATIONS.map(([code, name]) => [String(code), name]),
    lang: LANGUAGES,
    intent: INTENTS,
    stage: STAGES,
    src: SOURCES,
    depth: DEPTHS,
    stale: [['stale', 'Stale']],
  };
  return table[key] ?? [];
}

const NUMERIC = {
  prio: { min: 1, max: 5, text: 'Show keywords at this priority or higher (1 is highest).' },
  vol: { min: 0, max: 10000000, text: 'Show keywords with at least this many searches a month.' },
  kd: { min: 0, max: 100, text: 'Show keywords with at most this difficulty (0 to 100).' },
};

function header(text) {
  return el('p', 'px-2 pt-1 type-label text-foreground-tertiary', text);
}

function choiceRow(label, selected, onPick) {
  const row = el('button', `min-h-8 px-2 rounded-md flex items-center gap-2 text-left type-body hover:bg-surface-hover ${selected ? 'type-body-strong text-primary-text' : 'text-foreground'}`, label);
  row.type = 'button';
  row.setAttribute('aria-pressed', String(selected));
  row.addEventListener('click', onPick);
  return row;
}

/**
 * Fills a popover with the editor of one filter. `apply` gets the new value (an array, a string or '' to clear).
 */
export function editorBody(panel, key, value, apply, close) {
  const def = FILTERS[key];
  panel.replaceChildren(header(def.label));
  if (def.kind === 'single') {
    const options = optionsFor(key);
    options.forEach(([optionValue, label]) => {
      panel.append(choiceRow(label, value === optionValue, () => {
        apply(value === optionValue ? '' : optionValue);
        close();
      }));
    });
    return;
  }
  if (def.kind === 'multi') {
    const chosen = new Set(value);
    const list = el('div', 'flex flex-col max-h-72 overflow-auto');
    const options = optionsFor(key);
    if (options.length > 8) {
      const search = el('input', `${FIELD} mx-1 w-auto`);
      search.type = 'search';
      search.placeholder = `Search ${def.label.toLowerCase()}`;
      search.setAttribute('aria-label', `Search ${def.label.toLowerCase()}`);
      search.addEventListener('input', () => {
        const query = search.value.trim().toLowerCase();
        list.querySelectorAll('label').forEach((row) => {
          row.hidden = query !== '' && !row.textContent.toLowerCase().includes(query);
        });
      });
      panel.append(search);
    }
    options.forEach(([optionValue, label]) => {
      list.append(checkRow(label, chosen.has(optionValue), (on) => {
        if (on) chosen.add(optionValue);
        else chosen.delete(optionValue);
      }));
    });
    panel.append(list);
    const footer = el('div', 'flex items-center gap-2 pt-1 px-1');
    const applyButton = el('button', `${BUTTON_PRIMARY} h-control-sm px-2`, 'Apply');
    applyButton.type = 'button';
    applyButton.addEventListener('click', () => {
      apply([...chosen]);
      close();
    });
    const clear = el('button', `${BUTTON_SM} text-foreground-secondary`, 'Clear');
    clear.type = 'button';
    clear.addEventListener('click', () => {
      apply([]);
      close();
    });
    footer.append(applyButton, clear);
    panel.append(footer);
    return;
  }
  const bounds = NUMERIC[key];
  const row = el('div', 'flex items-end gap-2 px-2');
  const input = el('input', `${FIELD} num w-28`);
  input.type = 'number';
  input.min = String(bounds.min);
  input.max = String(bounds.max);
  input.step = '1';
  input.value = value;
  input.setAttribute('aria-label', def.label);
  const error = el('p', 'px-2 type-meta text-negative-text');
  error.hidden = true;
  const commit = () => {
    const raw = input.value.trim();
    const number = Number(raw);
    const bad = raw !== '' && (!Number.isInteger(number) || number < bounds.min || number > bounds.max);
    error.hidden = !bad;
    error.textContent = bad ? `Enter a whole number from ${bounds.min} to ${bounds.max}.` : '';
    if (bad) return;
    apply(raw);
    close();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commit();
  });
  const ok = el('button', `${BUTTON_PRIMARY} h-control-sm px-2`, 'Apply');
  ok.type = 'button';
  ok.addEventListener('click', commit);
  row.append(input, ok);
  panel.append(el('p', 'px-2 type-meta text-foreground-secondary', bounds.text), row, error);
}

/**
 * @param {{state: () => object, setFilter: (key: string, value: unknown) => void, clearFilters: () => void}} ctx
 * @returns {HTMLElement[]} the Filter button, the chips and the Clear filters link, in that order
 */
export function filterNodes(state, ctx) {
  const nodes = [];
  const addButton = el('button', `${BUTTON} h-control-sm`, 'Filter');
  addButton.type = 'button';
  addButton.prepend(icon('list-filter', 'size-icon text-foreground-tertiary'));
  addButton.setAttribute('aria-label', 'Add a filter');
  popover(addButton, (panel, api) => {
    const menu = el('div', 'flex flex-col gap-0.5');
    panel.append(header('Add a filter'));
    Object.entries(FILTERS).forEach(([key, def]) => {
      menu.append(choiceRow(def.label, false, () => {
        editorBody(panel, key, ctx.state().filters[key], (value) => ctx.setFilter(key, value), api.close);
      }));
    });
    panel.append(menu);
  });
  nodes.push(addButton);

  const chips = activeFilterChips(state);
  chips.forEach(({ key, text }) => {
    const chip = el('span', 'flex h-control-sm pl-0.5 pr-0.5 rounded-md bg-neutral-subtle items-center gap-0.5 type-body text-foreground max-w-72');
    const edit = el('button', 'h-7 min-w-0 px-2 rounded-sm truncate hover:bg-surface-hover', text);
    edit.type = 'button';
    edit.setAttribute('aria-label', `Edit filter ${text}`);
    popover(edit, (panel, api) => {
      editorBody(panel, key, ctx.state().filters[key], (value) => ctx.setFilter(key, value), api.close);
    });
    const remove = el('button', 'size-7 shrink-0 rounded-sm flex items-center justify-center text-foreground-tertiary hover:bg-surface-hover hover:text-foreground');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove filter ${text}`);
    remove.append(icon('x', 'size-icon-sm'));
    remove.addEventListener('click', () => ctx.setFilter(key, Array.isArray(DEFAULT_STATE.filters[key]) ? [] : ''));
    chip.append(edit, remove);
    nodes.push(chip);
  });
  if (chips.length > 2) {
    const clear = el('button', `${BUTTON_SM} text-link hover:underline`, 'Clear filters');
    clear.type = 'button';
    clear.addEventListener('click', () => ctx.clearFilters());
    nodes.push(clear);
  }
  return nodes;
}
