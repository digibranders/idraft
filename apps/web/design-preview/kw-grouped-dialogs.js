/* global FileReader */
/**
 * The dialogs of the grouped Rankings mock: Add keywords, Import, Manage groups, Rename a group and Move to a group.
 * Each one changes the store (kw-grouped-data.js) and asks the page to draw again.
 */
import { CHECK_COST_USD, COUNTRIES, PLAN_LIMIT, UNGROUPED, addGroup, addKeywords, addTracked, trackedCount, deleteGroup, groupNames, moveKeywords, renameGroup, store } from './kw-grouped-data.js';
import { BUTTON, BUTTON_PRIMARY, button, checkRow, icon, toast } from './perf-ui.js';
import { INPUT, confirmDialog, field, fieldError, openDialog } from './kw-dialog.js';
import { el } from './prompts-parts.js';
import { plural, refresh } from './kw-grouped-model.js';

const SELECT = `${INPUT} pr-8`;

function select(options, value) {
  const node = el('select', SELECT);
  options.forEach((option) => {
    const item = el('option', '', option);
    item.value = option;
    node.append(item);
  });
  node.value = value;
  return node;
}

const lines = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean);

function report(result) {
  const parts = result.countries
    ? [`${plural(result.keywords, 'keyword')} in ${plural(result.countries, 'country')} on ${plural(result.devices, 'device')}: ${plural(result.checks, 'check')} a day`]
    : [`${plural(result.added, 'keyword')} added`];
  if (result.skipped > 0) parts.push(`${plural(result.skipped, 'keyword')} already tracked`);
  toast({ title: 'Keywords added', description: `${parts.join('. ')}. Their first check runs within minutes.`, tone: 'success' });
}

/**
 * Countries: a list of chips that opens a searchable list of checkboxes under it (in the dialog, since a popover
 * would sit under a modal). A keyword is tracked in each country chosen.
 */
function countryPicker(chosen, onChange) {
  const wrap = el('div', 'flex flex-col gap-1');
  const trigger = el('button', `${INPUT} flex items-center gap-2 text-left h-auto min-h-control py-1.5`);
  trigger.type = 'button';
  trigger.setAttribute('aria-label', 'Countries');
  trigger.setAttribute('aria-expanded', 'false');
  const summary = el('span', 'flex flex-1 flex-wrap items-center gap-1.5 min-w-0');
  trigger.append(summary, icon('chevron-down', 'size-icon-sm shrink-0 text-foreground-tertiary'));
  const panel = el('div', 'rounded-md border border-border bg-surface p-2 flex flex-col gap-2');
  panel.hidden = true;
  const search = el('input', `${INPUT} h-control-sm`);
  search.type = 'search';
  search.placeholder = 'Search countries';
  search.setAttribute('aria-label', 'Search countries');
  const list = el('div', 'flex max-h-44 flex-col overflow-auto');
  const drawSummary = () => {
    summary.replaceChildren();
    if (chosen.size === 0) summary.append(el('span', 'text-foreground-tertiary', 'Choose countries'));
    chosen.forEach((name) => summary.append(el('span', 'h-6 px-2 rounded-sm bg-neutral-subtle text-neutral-text type-label flex items-center', name)));
  };
  const drawList = () => {
    list.replaceChildren(
      ...COUNTRIES.filter((name) => name.toLowerCase().includes(search.value.trim().toLowerCase())).map((name) =>
        checkRow(name, chosen.has(name), (on) => {
          if (on) chosen.add(name);
          else chosen.delete(name);
          drawSummary();
          onChange();
        }),
      ),
    );
  };
  search.addEventListener('input', drawList);
  trigger.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    trigger.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) search.focus();
  });
  panel.append(search, list);
  wrap.append(trigger, panel);
  drawSummary();
  drawList();
  return wrap;
}

/** Add keywords: one to a line, into a group, in one or more countries, for the devices to track. */
export function openAdd({ group = UNGROUPED, countries = [] } = {}) {
  const frame = openDialog({ title: 'Add keywords', description: 'Keywords are tracked on Google. Their metrics arrive within minutes.', width: 'md' });
  const text = el('textarea', `${INPUT} h-40 py-2 resize-y font-mono`);
  text.placeholder = 'One keyword on each line';
  text.setAttribute('aria-label', 'Keywords');
  const count = el('span', 'type-meta text-foreground-tertiary', 'No keywords yet');
  const groupField = select([UNGROUPED, ...groupNames()], group);
  const chosen = new Set(countries.length > 0 ? countries : ['India']);
  const countryField = countryPicker(chosen, () => sync());
  const devices = { desktop: true, mobile: true };
  const desktop = checkRow('Desktop', true, (on) => {
    devices.desktop = on;
    sync();
  });
  const mobile = checkRow('Mobile', true, (on) => {
    devices.mobile = on;
    sync();
  });
  const error = fieldError('Choose at least one device.');
  error.hidden = true;
  const plan = el('p', 'rounded-md bg-surface-subtle px-3 py-2 type-body text-foreground-secondary flex flex-col gap-0.5');
  plan.setAttribute('aria-live', 'polite');
  const add = button('Add keywords', { className: `${BUTTON_PRIMARY} disabled:opacity-50` });
  const chosenDevices = () => ['desktop', 'mobile'].filter((device) => devices[device]);
  function sync() {
    const total = lines(text.value).length;
    count.textContent = total === 0 ? 'No keywords yet' : plural(total, 'keyword');
    error.hidden = devices.desktop || devices.mobile;
    const checks = total * chosen.size * chosenDevices().length;
    const used = trackedCount();
    const over = used + checks > PLAN_LIMIT;
    const daily = checks * CHECK_COST_USD;
    plan.replaceChildren();
    if (checks === 0) plan.append(el('span', '', 'Each keyword is checked once a day for every country and device chosen.'));
    else {
      plan.append(
        el('span', 'type-body-strong text-foreground', `${plural(total, 'keyword')} × ${plural(chosenDevices().length, 'device')} × ${plural(chosen.size, 'country')} = ${plural(checks, 'check')} a day`),
        el('span', '', `Estimated cost about $${daily.toFixed(2)} a day, $${(daily * 30).toFixed(2)} a month, at $${CHECK_COST_USD} a check.`),
        el('span', over ? 'text-negative-text' : '', over ? `This passes the plan's ${PLAN_LIMIT.toLocaleString('en-US')} tracked keywords: ${used.toLocaleString('en-US')} are used and this adds ${checks.toLocaleString('en-US')}.` : `Plan: ${used.toLocaleString('en-US')} of ${PLAN_LIMIT.toLocaleString('en-US')} tracked keywords used, ${(used + checks).toLocaleString('en-US')} after this.`),
      );
    }
    add.disabled = checks === 0 || over;
  }
  text.addEventListener('input', sync);
  const cancel = button('Cancel', { className: BUTTON, onClick: frame.close });
  add.addEventListener('click', () => {
    report(addTracked(text.value, { group: groupField.value, countries: [...chosen], devices: chosenDevices() }));
    frame.close();
    refresh();
  });
  frame.body.append(field('Keywords', text), count, field('Countries', countryField, { hint: 'A keyword is tracked in each country you choose, on each device.' }), field('Group', groupField, { hint: 'Keywords with no group are listed as not grouped.' }));
  const row = el('fieldset', 'flex flex-col gap-1');
  row.append(el('legend', 'type-label mb-1', 'Track on'), desktop, mobile, error);
  frame.body.append(row, plan);
  frame.footer.append(cancel, add);
  sync();
  text.focus();
}

const SAMPLE = ['soc as a service india, India', 'managed soc pricing india, Service, pricing and technology', 'best soc service provider india, Providers and vendors', 'soc vendor comparison, Providers and vendors', 'soc as a service cost, Service, pricing and technology', 'cyber security operations center india, India'].join('\n');

/** Import: a file or pasted lines, `keyword` or `keyword, group` on each; a new group name makes the group. */
export function openImport() {
  const frame = openDialog({ title: 'Import keywords', description: 'Choose a CSV file or paste lines. Each line is a keyword, then a comma and its group.', width: 'md' });
  const text = el('textarea', `${INPUT} h-40 py-2 resize-y font-mono`);
  text.placeholder = 'keyword, group';
  text.setAttribute('aria-label', 'Lines to import');
  const picker = el('input', 'sr-only');
  picker.type = 'file';
  picker.accept = '.csv,text/csv';
  picker.setAttribute('aria-label', 'CSV file');
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      text.value = String(reader.result).replace(/^keyword.*\n/i, '');
      sync();
    };
    reader.readAsText(file);
  });
  const choose = button('Choose a CSV file', { iconName: 'file-up', className: BUTTON, onClick: () => picker.click() });
  const sample = button('Use a sample file', { className: BUTTON, onClick: () => {
    text.value = SAMPLE;
    sync();
  } });
  const summary = el('p', 'type-meta text-foreground-tertiary', 'No lines yet');
  const run = button('Import', { className: `${BUTTON_PRIMARY} disabled:opacity-50` });
  function sync() {
    const total = lines(text.value).length;
    summary.textContent = total === 0 ? 'No lines yet' : plural(total, 'keyword');
    run.textContent = total === 0 ? 'Import' : `Import ${plural(total, 'keyword')}`;
    run.disabled = total === 0;
  }
  text.addEventListener('input', sync);
  run.addEventListener('click', () => {
    let added = 0;
    let skipped = 0;
    lines(text.value).forEach((line) => {
      const [keyword, group = UNGROUPED] = line.split(',').map((part) => part.trim());
      if (group !== UNGROUPED && !groupNames().includes(group)) addGroup(group);
      const result = addKeywords(keyword, { group, country: 'India', devices: ['desktop', 'mobile'] });
      added += result.added;
      skipped += result.skipped;
    });
    report({ added, skipped });
    frame.close();
    refresh();
  });
  const tools = el('div', 'flex flex-wrap gap-2');
  tools.append(choose, sample, picker);
  frame.body.append(tools, field('Or paste lines', text), summary);
  frame.footer.append(button('Cancel', { className: BUTTON, onClick: frame.close }), run);
  sync();
}

/** The name rules of a group, as the product has them. */
function nameProblem(name, except = null) {
  const value = name.trim();
  if (value === '') return 'Enter a group name.';
  if (value.length > 100) return 'A group name has 100 characters at most.';
  if (value.includes('/')) return 'A group name cannot contain “/”.';
  if (groupNames().some((existing) => existing !== except && existing.toLowerCase() === value.toLowerCase())) return 'A group with this name already exists.';
  return '';
}

export function openRename(name) {
  const frame = openDialog({ title: 'Rename group', width: 'sm' });
  const input = el('input', INPUT);
  input.value = name;
  input.setAttribute('aria-label', 'Group name');
  const error = fieldError('');
  error.hidden = true;
  const save = button('Save', { className: BUTTON_PRIMARY });
  const submit = () => {
    const problem = nameProblem(input.value, name);
    error.hidden = problem === '';
    error.textContent = problem;
    if (problem !== '') return;
    renameGroup(name, input.value.trim());
    frame.close();
    toast({ title: 'Group renamed', description: `${name} is now ${input.value.trim()}.`, tone: 'success' });
    refresh();
  };
  save.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
  frame.body.append(field('Name', input), error);
  frame.footer.append(button('Cancel', { className: BUTTON, onClick: frame.close }), save);
  input.select();
}

export function confirmDeleteGroup(name, onDone) {
  const members = store.keywords.filter((keyword) => keyword.group === name).length;
  confirmDialog({
    title: `Delete ${name}?`,
    description: `Its ${plural(members, 'keyword')} stay tracked and are listed as not grouped.`,
    confirmLabel: 'Delete group',
    danger: true,
    onConfirm: () => {
      deleteGroup(name);
      toast({ title: 'Group deleted', description: `${name} was deleted.`, tone: 'success' });
      refresh();
      onDone?.();
    },
  });
}

/** Manage groups: the list with each group's count, a new group, and rename and delete for each. */
export function openManageGroups() {
  const frame = openDialog({ title: 'Manage groups', description: 'Keywords belong to one group. Deleting a group keeps its keywords.', width: 'md' });
  const list = el('ul', 'flex flex-col');
  const input = el('input', INPUT);
  input.placeholder = 'New group name';
  input.setAttribute('aria-label', 'New group name');
  const error = fieldError('');
  error.hidden = true;
  const draw = () => {
    list.replaceChildren(
      ...store.groups.map((group) => {
        const count = store.keywords.filter((keyword) => keyword.group === group.name && !keyword.archived).length;
        const item = el('li', 'min-h-12 py-2 flex items-center gap-3 border-b border-border-subtle');
        const text = el('div', 'min-w-0 flex-1 flex flex-col');
        text.append(el('span', 'truncate type-body-strong', group.name), el('span', 'type-label', plural(count, 'keyword')));
        const rename = button('Rename', { className: 'h-control-sm px-2 rounded-md type-body text-link hover:underline', onClick: () => {
          frame.close();
          openRename(group.name);
        } });
        const remove = button('Delete', { className: 'h-control-sm px-2 rounded-md type-body text-negative-text hover:underline', onClick: () => {
          frame.close();
          confirmDeleteGroup(group.name);
        } });
        item.append(text, rename, remove);
        return item;
      }),
    );
  };
  const add = button('Add group', { className: BUTTON, onClick: () => {
    const problem = nameProblem(input.value);
    error.hidden = problem === '';
    error.textContent = problem;
    if (problem !== '') return;
    addGroup(input.value.trim());
    input.value = '';
    draw();
    refresh();
  } });
  const row = el('div', 'flex items-center gap-2');
  row.append(input, add);
  frame.body.append(list, row, error);
  frame.footer.append(button('Done', { className: BUTTON_PRIMARY, onClick: frame.close }));
  draw();
}

/** Move to a group: one choice of the groups, or none. */
export function openMove(ids, onDone) {
  const frame = openDialog({ title: `Move ${plural(ids.size, 'keyword')} to a group`, width: 'sm' });
  const choices = [UNGROUPED, ...groupNames()];
  let chosen = choices[1];
  const list = el('div', 'flex flex-col gap-1');
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', 'Group');
  choices.forEach((name) => {
    const label = el('label', 'min-h-9 px-2 rounded-md flex items-center gap-2 type-body hover:bg-surface-hover cursor-pointer');
    const radio = el('input', 'accent-primary');
    radio.type = 'radio';
    radio.name = 'move-group';
    radio.checked = name === chosen;
    radio.addEventListener('change', () => {
      chosen = name;
    });
    label.append(radio, el('span', '', name === UNGROUPED ? 'No group' : name));
    list.append(label);
  });
  frame.body.append(list);
  frame.footer.append(
    button('Cancel', { className: BUTTON, onClick: frame.close }),
    button('Move', { className: BUTTON_PRIMARY, onClick: () => {
      moveKeywords(ids, chosen);
      frame.close();
      toast({ title: 'Keywords moved', description: `${plural(ids.size, 'keyword')} moved to ${chosen === UNGROUPED ? 'no group' : chosen}.`, tone: 'success' });
      onDone?.();
      refresh();
    } }),
  );
}
