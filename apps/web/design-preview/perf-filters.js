/* global document */
/**
 * The Page Performance filter bar (docs/32-page-performance.md section 5.4). One bar for the list and the
 * detail: they read and write the same state (principle S3). The query filter is live (each change asks Google)
 * and exists in the detail only.
 *
 * `build` returns `{ root, sync }`. The controls are made once; `sync` brings their labels and values in line
 * with the state, so typing in a field is never interrupted by a redraw.
 */
import { EARLIEST, FINAL_THROUGH, PROVISIONAL_DAYS, availableMonths, compareName, monthName, rangeText, resolveCompare, resolvePeriod } from './perf-calc.js';
import { COUNTRIES, DEVICES, GROUP_NAMES, SEARCH_TYPES, isValidRegex } from './perf-data.js';
import { rangesOf } from './perf-model.js';
import { BUTTON_SM, FIELD, badge, button, checkRow, icon, popover, selectField } from './perf-ui.js';
import { el } from './prompts-parts.js';

const QUERY_OPS = [['contains', 'contains'], ['excludes', 'does not contain'], ['equals', 'equals'], ['regex', 'matches regex']];

function triggerButton(label) {
  const node = el('button', BUTTON_SM);
  node.type = 'button';
  const text = el('span', 'truncate max-w-48', label);
  node.append(text, icon('chevron-down', 'size-icon-sm text-foreground-tertiary shrink-0'));
  node.text = text;
  return node;
}

const sectionTitle = (text) => el('p', 'px-2 pt-1.5 type-label text-foreground-tertiary', text);

function dateInput(label, value, onChange) {
  const wrap = el('label', 'flex flex-col gap-1 type-meta');
  wrap.append(el('span', '', label));
  const input = el('input', `${FIELD} num`);
  input.type = 'date';
  input.min = EARLIEST;
  input.max = FINAL_THROUGH;
  input.value = value;
  input.addEventListener('change', () => onChange(input.value));
  wrap.append(input);
  return wrap;
}

function customRange(panel, initial, onApply) {
  const draft = { from: initial?.from ?? '', to: initial?.to ?? '' };
  const row = el('div', 'px-2 pb-1 flex items-end gap-2');
  const error = el('p', 'px-2 type-meta text-negative-text');
  error.hidden = true;
  row.append(dateInput('From', draft.from, (value) => (draft.from = value)), dateInput('To', draft.to, (value) => (draft.to = value)));
  const apply = button('Apply', { className: BUTTON_SM, onClick: () => {
    const bad = !draft.from || !draft.to || draft.from > draft.to || draft.from < EARLIEST || draft.to > FINAL_THROUGH;
    error.hidden = !bad;
    error.textContent = bad ? `Pick two dates between ${EARLIEST} and ${FINAL_THROUGH}, the first not after the second.` : '';
    if (!bad) onApply(draft.from, draft.to);
  } });
  row.append(apply);
  panel.append(row, error);
}

/**
 * @param {{get: () => object, set: (patch: object) => void, scope: 'list' | 'detail'}} options
 */
export function build({ get, set, scope }) {
  const root = el('div', 'flex flex-col gap-2');
  const bar = el('div', 'flex items-center gap-2 flex-wrap');
  root.append(bar);
  const updaters = [];

  // Period: a month (the default), a quick range, or two dates
  const period = triggerButton('');
  period.setAttribute('aria-label', 'Period');
  popover(period, (panel, { close }) => {
    const state = get();
    panel.append(sectionTitle('Month'));
    const months = availableMonths();
    const monthPick = selectField(months.map((ym) => [`m:${ym}`, monthName(ym)]), state.period.startsWith('m:') ? state.period : months[0], (value) => { set({ period: value }); close(); }, 'Month', 'mx-2');
    panel.append(monthPick);
    panel.append(sectionTitle('Ranges'));
    [['d:7', 'Last 7 days'], ['d:28', 'Last 28 days'], ['d:90', 'Last 3 months'], [`r:${EARLIEST}_${FINAL_THROUGH}`, 'Whole history (16 months)']].forEach(([value, text]) => {
      const row = el('button', `min-h-8 px-2 rounded-md flex items-center gap-2 text-left type-body hover:bg-surface-hover ${state.period === value ? 'type-body-strong text-primary-text' : 'text-foreground'}`, text);
      row.type = 'button';
      row.addEventListener('click', () => { set({ period: value }); close(); });
      panel.append(row);
    });
    panel.append(sectionTitle('Custom range'));
    const now = resolvePeriod(state.period, state.provisional);
    customRange(panel, now, (from, to) => { set({ period: `r:${from}_${to}` }); close(); });
    panel.append(el('div', 'mx-2 my-1 border-t border-border-subtle'));
    panel.append(checkRow(`Include provisional days (${PROVISIONAL_DAYS.length})`, state.provisional, (checked) => set({ provisional: checked }), { hint: 'May be revised' }));
  });
  updaters.push((state) => (period.text.textContent = resolvePeriod(state.period, state.provisional).label));

  // Compare
  const compare = triggerButton('');
  compare.setAttribute('aria-label', 'Compare with');
  popover(compare, (panel, { close }) => {
    const state = get();
    const current = resolvePeriod(state.period, state.provisional);
    [['prev', compareName('prev', current)], ['year', 'Same period last year'], ['none', 'No comparison']].forEach(([value, text]) => {
      const range = value === 'none' ? null : resolveCompare(value, current);
      const row = el('button', `min-h-9 px-2 rounded-md flex flex-col items-start justify-center text-left hover:bg-surface-hover ${state.compare === value ? 'bg-surface-selected' : ''}`);
      row.type = 'button';
      row.append(el('span', `type-body ${state.compare === value ? 'type-body-strong text-primary-text' : 'text-foreground'}`, text));
      if (range) row.append(el('span', `type-meta ${range.unavailable ? 'text-warning-text' : ''}`, range.unavailable ? `Starts before our history (${EARLIEST})` : rangeText(range)));
      row.addEventListener('click', () => { set({ compare: value }); close(); });
      panel.append(row);
    });
    panel.append(sectionTitle('Custom range'));
    const existing = state.compare.startsWith('c:') ? state.compare.slice(2).split('_') : [];
    customRange(panel, { from: existing[0], to: existing[1] }, (from, to) => { set({ compare: `c:${from}_${to}` }); close(); });
  });
  updaters.push((state) => {
    const range = resolveCompare(state.compare, resolvePeriod(state.period, state.provisional));
    compare.text.textContent = range ? `vs ${rangeText(range)}` : 'No comparison';
    compare.classList.toggle('text-warning-text', Boolean(range?.unavailable));
  });

  // Country and device: several values each
  const multi = (name, items, key, searchable) => {
    const trigger = triggerButton('');
    trigger.setAttribute('aria-label', name);
    popover(trigger, (panel) => {
      let filter = '';
      const rows = el('div', 'flex flex-col');
      const draw = () => {
        rows.replaceChildren();
        items.filter((item) => item.name.toLowerCase().includes(filter)).forEach((item) => {
          rows.append(checkRow(item.name, get()[key].has(item.code), (checked) => {
            const next = new Set(get()[key]);
            if (checked) next.add(item.code); else next.delete(item.code);
            set({ [key]: next });
          }));
        });
      };
      if (searchable) {
        const search = el('input', `${FIELD} mx-1 mt-1`);
        search.type = 'search';
        search.placeholder = `Search ${name.toLowerCase()}`;
        search.setAttribute('aria-label', `Search ${name.toLowerCase()}`);
        search.addEventListener('input', () => { filter = search.value.toLowerCase(); draw(); });
        panel.append(search);
      }
      draw();
      panel.append(rows);
      panel.append(button('Show all', { className: `${BUTTON_SM} mx-1 mt-1 justify-center`, onClick: () => { set({ [key]: new Set() }); draw(); } }));
    });
    updaters.push((state) => {
      const chosen = [...state[key]].map((code) => items.find((item) => item.code === code)?.name ?? code);
      trigger.text.textContent = chosen.length === 0 ? `${name}: All` : chosen.length === 1 ? chosen[0] : `${chosen[0]} +${chosen.length - 1}`;
    });
    return trigger;
  };
  const country = multi('Country', COUNTRIES, 'countries', true);
  const device = multi('Device', DEVICES, 'devices', false);

  const type = selectField(SEARCH_TYPES.map((item) => [item.code, item.code === 'discover' ? 'Discover' : `${item.name} search`]), 'web', (value) => set({ type: value }), 'Search type');
  updaters.push((state) => (type.value = state.type));

  // The rarely used filters live behind one button; it shows how many are on. The controls are made once and
  // moved into the panel each time it opens, so a half-typed query survives.
  const extra = el('div', 'flex flex-col gap-3 p-2');
  const typeField = el('label', 'flex flex-col gap-1');
  typeField.append(el('span', 'type-label text-foreground-tertiary', 'Search type'), type);
  extra.append(typeField);
  const more = triggerButton('More filters');
  more.setAttribute('aria-label', 'More filters');
  popover(more, (panel) => panel.append(extra));
  updaters.push((state) => {
    const count = (state.type !== 'web' ? 1 : 0) + (state.query ? 1 : 0);
    more.text.textContent = count > 0 ? `More filters (${count})` : 'More filters';
  });
  bar.append(period, compare, country, device, more);

  if (scope === 'list') {
    const group = selectField([['', 'All groups'], ...GROUP_NAMES.map((name) => [name, name])], '', (value) => set({ group: value }), 'Group');
    updaters.push((state) => (group.value = state.group));
    bar.append(group);
  }

  const reset = button('Reset filters', { className: `${BUTTON_SM} text-foreground-secondary`, iconName: 'x', onClick: () => set({ countries: new Set(), devices: new Set(), type: 'web', group: '', query: null, provisional: false }) });
  updaters.push((state) => {
    const changed = state.countries.size > 0 || state.devices.size > 0 || state.type !== 'web' || state.group !== '' || Boolean(state.query) || state.provisional;
    reset.hidden = !changed;
  });
  bar.append(reset);

  // Query filter: live (detail only)
  if (scope === 'detail') {
    const line = el('div', 'flex flex-col gap-1');
    const op = selectField(QUERY_OPS, 'contains', () => commit(), 'Query condition');
    const input = el('input', `${FIELD} w-full min-w-0`);
    input.type = 'search';
    input.placeholder = 'Filter by query';
    input.setAttribute('aria-label', 'Query text');
    const live = badge('Live from Google', 'info');
    live.hidden = true;
    const error = el('p', 'type-meta text-negative-text');
    error.hidden = true;
    const commit = () => {
      const value = input.value.trim();
      const invalid = op.value === 'regex' && value !== '' && !isValidRegex(value);
      error.hidden = !invalid;
      error.textContent = invalid ? 'This is not a valid regular expression.' : '';
      if (invalid) return;
      const next = value ? { op: op.value, value } : null;
      const now = get().query;
      if ((next?.value ?? '') !== (now?.value ?? '') || (next?.op ?? '') !== (now?.op ?? '')) set({ query: next });
    };
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') commit(); });
    input.addEventListener('blur', commit);
    line.append(el('span', 'type-label text-foreground-tertiary', 'Query'), op, input, live, error);
    extra.append(line);
    updaters.push((state) => {
      if (document.activeElement !== input) input.value = state.query?.value ?? '';
      op.value = state.query?.op ?? op.value;
      live.hidden = !state.query;
    });
  }

  const sync = () => {
    const state = get();
    updaters.forEach((update) => update(state));
  };
  sync();
  return { root, sync, rangesOf };
}
