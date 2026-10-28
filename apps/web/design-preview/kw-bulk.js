/* global URL */
/**
 * The bulk actions of Rankings (docs/20 section 5.3, 12-tables.md section 14): add or remove tags, move to a group,
 * set the target URL and the priority, refresh metrics, archive or unarchive, and delete. Archive and unarchive run
 * at once up to 100 keywords with an Undo; above that they ask first. Delete always asks.
 */
import { RUNS_PER_DAY, activeCount, allTags, childrenOf, groupList, removeRecords, restoreArchived, roomLeft, setArchived, startRefresh, updateRecords, PLAN_LIMIT } from './kw-data.js';
import { BUTTON, BUTTON_PRIMARY, segmented, selectField, toast } from './perf-ui.js';
import { el } from './prompts-parts.js';
import { BUTTON_DANGER, INPUT, confirmDialog, field, fieldError, openDialog } from './kw-dialog.js';

export const ONE_STEP_LIMIT = 100;
const plural = (count, word) => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;
const MAX_URL = 2048;

function footerButtons(frame, confirmLabel, onConfirm, { disabled = false, danger = false } = {}) {
  const cancel = el('button', BUTTON, 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => frame.close());
  const confirm = el('button', danger ? BUTTON_DANGER : `${BUTTON_PRIMARY} disabled:bg-surface-disabled disabled:text-foreground-disabled`, confirmLabel);
  confirm.type = 'button';
  confirm.disabled = disabled;
  confirm.addEventListener('click', onConfirm);
  frame.footer.append(cancel, confirm);
  return confirm;
}

/** Tags: one dialog for both directions. The tags are typed, separated by commas, and checked against the vocabularies. */
export function openTags({ ids, count }, { onDone }) {
  const frame = openDialog({ title: 'Edit tags', description: "Tags come from the project's vocabularies. Separate several with commas, such as Topics: SEO > Technical SEO.", width: 'md' });
  let mode = 'add';
  const input = el('input', INPUT);
  input.setAttribute('list', 'kw-tag-options');
  input.placeholder = 'Topics: SEO';
  input.setAttribute('aria-label', 'Tags');
  const options = el('datalist');
  options.id = 'kw-tag-options';
  allTags().forEach((tag) => {
    const option = el('option');
    option.value = tag;
    options.append(option);
  });
  const error = fieldError('');
  error.hidden = true;
  const toggle = segmented([['add', 'Add tags'], ['remove', 'Remove tags']], mode, (value) => {
    mode = value;
    toggle.sync(value);
    confirm.textContent = `${mode === 'add' ? 'Add to' : 'Remove from'} ${plural(count, 'keyword')}`;
  }, 'Tag change');
  frame.body.append(toggle, field('Tags', input), options, error);
  const confirm = footerButtons(frame, `Add to ${plural(count, 'keyword')}`, () => {
    const tags = input.value.split(',').map((tag) => tag.trim()).filter(Boolean);
    const unknown = tags.filter((tag) => !allTags().includes(tag));
    let message = '';
    if (tags.length === 0) message = 'Enter at least one tag.';
    else if (unknown.length > 0) message = `Not in the vocabularies: ${unknown.join(', ')}.`;
    error.hidden = message === '';
    error.textContent = message;
    if (message) return;
    updateRecords(ids, (kw) => ({ tags: mode === 'add' ? [...new Set([...kw.tags, ...tags])] : kw.tags.filter((tag) => !tags.includes(tag)) }));
    frame.close();
    toast({ title: mode === 'add' ? `Tags added to ${plural(count, 'keyword')}` : `Tags removed from ${plural(count, 'keyword')}`, tone: 'success' });
    onDone?.();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') confirm.click();
  });
  input.focus();
}

/** Move to group: keywords sit in leaf groups only, so the choices are the groups without subgroups. */
export function openMoveGroup({ ids, count }, { onDone }) {
  const frame = openDialog({ title: 'Move to group', description: `Choose where ${plural(count, 'keyword')} belong. Groups with subgroups take keywords in their subgroups only.`, width: 'sm' });
  const leaves = groupList().filter((path) => childrenOf(path).length === 0);
  const select = selectField([['__none', 'No group'], ...leaves.map((path) => [path, path])], '__none', () => {}, 'Group', 'w-full');
  select.classList.remove('h-control-sm');
  select.classList.add('h-control');
  frame.body.append(field('Group', select));
  footerButtons(frame, 'Move', () => {
    const value = select.value;
    const target = value === '__none' ? null : value;
    updateRecords(ids, { group: target });
    frame.close();
    toast({ title: target ? `${plural(count, 'keyword')} moved to ${target}` : `${plural(count, 'keyword')} removed from their group`, tone: 'success' });
    onDone?.();
  });
}

export function openTargetUrl({ ids, count }, { onDone }) {
  const frame = openDialog({ title: 'Set target URL', description: `The page you want ${plural(count, 'keyword')} to rank. Leave it empty to clear it.`, width: 'sm' });
  const input = el('input', INPUT);
  input.type = 'url';
  input.placeholder = 'https://fynix.digital/leistungen/seo-audit';
  input.setAttribute('aria-label', 'Target URL');
  const error = fieldError('');
  error.hidden = true;
  frame.body.append(field('Target URL', input, { hint: 'An http or https address, at most 2,048 characters.' }), error);
  footerButtons(frame, 'Save', () => {
    const value = input.value.trim();
    let message = '';
    if (value.length > MAX_URL) message = `A target URL has ${MAX_URL.toLocaleString('en-US')} characters at most.`;
    else if (value !== '') {
      try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') message = 'Enter a web address that starts with http:// or https://.';
      } catch {
        message = 'Enter a web address that starts with http:// or https://.';
      }
    }
    error.hidden = message === '';
    error.textContent = message;
    if (message) return;
    updateRecords(ids, { target: value === '' ? null : value });
    frame.close();
    toast({ title: value === '' ? `Target URL cleared for ${plural(count, 'keyword')}` : `Target URL set for ${plural(count, 'keyword')}`, tone: 'success' });
    onDone?.();
  });
  input.focus();
}

export function openPriority({ ids, count }, { onDone }) {
  const frame = openDialog({ title: 'Set priority', description: 'Priority orders the keywords you care about most. It does not change how often they are checked.', width: 'sm' });
  const select = selectField([['1', '1, highest'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5, lowest']], '3', () => {}, 'Priority', 'w-full');
  select.classList.remove('h-control-sm');
  select.classList.add('h-control');
  frame.body.append(field('Priority', select));
  footerButtons(frame, `Set for ${plural(count, 'keyword')}`, () => {
    const priority = Number(select.value);
    updateRecords(ids, { priority });
    frame.close();
    toast({ title: `Priority ${priority} set for ${plural(count, 'keyword')}`, tone: 'success' });
    onDone?.();
  });
}

/**
 * Refresh metrics: one run at a time, at most RUNS_PER_DAY a day. The choices are what the run reads.
 * @param {{selected: number[], matching: number[], stale: number[], runsLeft: number}} options
 */
export function openRefresh({ selected, matching, stale, runsLeft }, { onStarted }) {
  const frame = openDialog({ title: 'Refresh metrics', description: `Reads the search volume, difficulty and CPC again from Google. ${runsLeft} of ${RUNS_PER_DAY} manual runs are left today.`, width: 'sm' });
  const choices = [
    ['selected', `Chosen keywords (${selected.length})`, selected],
    ['matching', `Keywords matching these filters (${matching.length})`, matching],
    ['stale', `All keywords with stale metrics (${stale.length})`, stale],
  ];
  let picked = selected.length > 0 ? 'selected' : 'matching';
  const group = el('div', 'flex flex-col gap-2');
  group.setAttribute('role', 'radiogroup');
  const buttons = choices.map(([key, text, ids]) => {
    const row = el('label', 'min-h-9 px-2 py-1 rounded-md flex items-center gap-2 type-body text-foreground hover:bg-surface-hover cursor-pointer has-disabled:text-foreground-disabled');
    const box = el('input', 'size-4 accent-primary shrink-0');
    box.type = 'radio';
    box.name = 'kw-refresh-choice';
    box.value = key;
    box.checked = picked === key;
    box.disabled = ids.length === 0;
    box.addEventListener('change', () => {
      picked = key;
      confirm.disabled = pickedIds().length === 0 || runsLeft === 0;
    });
    row.append(box, el('span', '', text));
    group.append(row);
    return { key, ids };
  });
  const pickedIds = () => buttons.find(({ key }) => key === picked)?.ids ?? [];
  frame.body.append(group);
  const confirm = footerButtons(frame, 'Refresh', () => {
    const ids = pickedIds();
    if (!startRefresh(ids, (total) => toast({ title: 'Metrics refreshed', description: `${plural(total, 'keyword')} read again.`, tone: 'success' }))) {
      toast({ title: 'A refresh is already running', description: 'Wait for it to finish, then start another.', tone: 'info' });
      return;
    }
    onStarted?.(ids.length);
    frame.close();
  }, { disabled: pickedIds().length === 0 || runsLeft === 0 });
}

function undoAction(message, before, tone = 'success') {
  toast({ title: message, tone, action: { label: 'Undo', run: () => { restoreArchived(before); toast({ title: 'Restored', tone: 'info' }); } } });
}

/**
 * Archive or unarchive the given keywords. Up to ONE_STEP_LIMIT run at once with an Undo, whether they were chosen
 * or came from "all matching". Above the limit they ask first, and a filtered set that large has no Undo.
 */
export function archiveKeywords(ids, archived, { byFilter }, onDone) {
  const count = ids.length;
  const run = () => {
    if (!archived && count > roomLeft()) {
      toast({ title: 'The plan has no room for these', description: `Your plan has room for ${roomLeft()} more active keywords (${activeCount()} of ${PLAN_LIMIT} used). Unarchive fewer.`, tone: 'info' });
      return;
    }
    const before = setArchived(ids, archived);
    const message = archived ? `${plural(count, 'keyword')} archived` : `${plural(count, 'keyword')} unarchived`;
    if (byFilter && count > ONE_STEP_LIMIT) toast({ title: message, tone: 'success' });
    else undoAction(message, before);
    onDone?.();
  };
  if (count <= ONE_STEP_LIMIT) {
    run();
    return;
  }
  const verb = archived ? 'Archive' : 'Unarchive';
  confirmDialog({
    title: `${verb} ${count.toLocaleString('en-US')}?`,
    description: archived ? 'Archived keywords are no longer checked and do not count against the plan. Their history is kept, and you can unarchive them.' : 'Unarchived keywords are checked again and count against the plan.',
    confirmLabel: `${verb} ${count.toLocaleString('en-US')}`,
    onConfirm: run,
  });
}

export function deleteKeywords(ids, onDone) {
  const count = ids.length;
  confirmDialog({
    title: `Delete ${count.toLocaleString('en-US')}?`,
    description: 'Their rank checks stop and they leave Keywords. Their history is kept: adding one again brings it back with its settings.',
    confirmLabel: `Delete ${count.toLocaleString('en-US')}`,
    danger: true,
    onConfirm: () => {
      removeRecords(ids);
      toast({ title: `${plural(count, 'keyword')} deleted`, tone: 'success' });
      onDone?.();
    },
  });
}
