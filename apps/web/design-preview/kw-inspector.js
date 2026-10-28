/**
 * The keyword inspector (docs/20 section 5.3, 16-drawers-dialogs-popovers.md section 1.1): a drawer over the table
 * with the cards of one keyword. Each card edits in place with its own Edit and Save. The depth profile changes
 * through a dialog, because a change starts a new version of the configuration history.
 */
import { DEPTHS, DEVICES, INTENTS, LANGUAGES, SOURCES, STAGES, allTags, byId, changeDepth, childrenOf, groupList, labelOf, locationName, monthlyVolumes, subscribe, updateRecords } from './kw-data.js';
import { competitionLabel, formatCpc, formatDate, formatInt, monthLabel, rankOf, relativeTime } from './kw-model.js';
import { BUTTON, BUTTON_PRIMARY, BUTTON_SM, badge, iconButton, popover, segmented, selectField, toast } from './perf-ui.js';
import { el } from './prompts-parts.js';
import { INPUT, confirmDiscard, field, fieldError, openDialog } from './kw-dialog.js';
import { archiveKeywords } from './kw-bulk.js';

const HISTORY_SHOWN = 10;
const PRIORITY_OPTIONS = [['1', '1, highest'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5, lowest']];
const MAX_URL = 2048;
const DISCARD_MESSAGE = 'Your unsaved changes to this keyword will be lost.';

function card(title, { onEdit, editing = false, onSave, onCancel } = {}, body) {
  const section = el('section', 'rounded-lg border border-border bg-surface px-4 pb-4 flex flex-col gap-3 min-w-0');
  section.setAttribute('aria-label', title);
  const head = el('div', 'min-h-12 py-3 flex items-center gap-2');
  head.append(el('h3', 'type-section-title flex-1 min-w-0', title));
  if (editing) {
    const cancel = el('button', `${BUTTON_SM} text-foreground-secondary`, 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', onCancel);
    const save = el('button', `${BUTTON_PRIMARY} h-control-sm px-2`, 'Save');
    save.type = 'button';
    save.addEventListener('click', onSave);
    head.append(cancel, save);
  } else if (onEdit) {
    const edit = el('button', `${BUTTON_SM} text-foreground-secondary`, 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', onEdit);
    head.append(edit);
  }
  section.append(head, body);
  return section;
}

function row(label, text, note) {
  const line = el('div', 'min-h-8 py-1 grid grid-cols-[8rem_1fr] gap-3 items-baseline border-t border-border-subtle first:border-t-0');
  line.append(el('span', 'type-meta text-foreground-tertiary', label));
  const cell = el('div', 'min-w-0 type-body text-foreground break-words', text);
  if (note) cell.append(el('span', 'block type-meta text-foreground-tertiary', note));
  line.append(cell);
  return line;
}

function metricTile(label, value, note) {
  const tile = el('div', 'rounded-md border border-border-subtle bg-surface-subtle px-3 py-2 min-w-0');
  tile.append(el('p', 'type-meta text-foreground-tertiary', label), el('p', 'type-metric num text-foreground', value), el('p', 'type-meta text-foreground-tertiary', note));
  return tile;
}

/** The last twelve months of volume, as bars or as a table of the same numbers. */
function volumeCard(kw) {
  const values = monthlyVolumes(kw);
  const now = new Date();
  const months = values.map((_, index) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + index, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }));
  const max = Math.max(1, ...values);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const peak = values.indexOf(max);
  const body = el('div', 'flex flex-col gap-2');
  let view = 'chart';
  const draw = () => {
    body.replaceChildren();
    if (view === 'chart') {
      const bars = el('div', 'h-36 flex items-end gap-1.5');
      bars.setAttribute('role', 'img');
      bars.setAttribute('aria-label', `Searches by month: ${values.map((value, index) => `${months[index]} ${formatInt(value)}`).join(', ')}`);
      values.forEach((value, index) => {
        const column = el('div', 'flex-1 min-w-0 h-full flex flex-col justify-end');
        const bar = el('span', `block rounded-t-sm ${index === peak ? 'bg-primary' : 'bg-primary-subtle'}`);
        bar.style.height = `${Math.max(4, Math.round((value / max) * 100))}%`;
        bar.dataset.tip = `${months[index]}: ${formatInt(value)}`;
        column.append(bar);
        bars.append(column);
      });
      const axis = el('div', 'flex gap-1.5 type-micro text-foreground-tertiary');
      months.forEach((label) => axis.append(el('span', 'flex-1 min-w-0 text-center truncate', label)));
      body.append(bars, axis);
      return;
    }
    const table = el('table', 'w-full type-table');
    const head = el('tr', 'text-left type-label text-foreground-secondary');
    head.append(el('th', 'py-1 font-normal', 'Month'), el('th', 'py-1 font-normal text-right', 'Searches'));
    const tbody = el('tbody');
    values.forEach((value, index) => {
      const tr = el('tr', 'border-t border-border-subtle');
      tr.append(el('td', 'py-1', months[index]), el('td', 'py-1 num text-right', formatInt(value)));
      tbody.append(tr);
    });
    table.append(el('thead', '', ''), tbody);
    table.querySelector('thead').append(head);
    body.append(table);
  };
  const toggle = segmented([['chart', 'Chart'], ['table', 'Table']], view, (value) => {
    view = value;
    toggle.sync(value);
    draw();
  }, 'View');
  draw();
  const note = average > 0 && max / average >= 1.2 ? `Seasonal: searches peak in ${months[peak]}.` : 'Searches are steady through the year.';
  const head = el('div', 'flex items-center justify-between gap-2 flex-wrap');
  head.append(el('span', 'type-meta text-foreground-tertiary', 'Last 12 months'), toggle);
  return card('Search volume by month', {}, cardBody(head, body, note));
}

function cardBody(...nodes) {
  const wrap = el('div', 'flex flex-col gap-2');
  wrap.append(...nodes.filter(Boolean).map((node) => (typeof node === 'string' ? el('p', 'type-meta text-foreground-tertiary', node) : node)));
  return wrap;
}

function depthLabel(code) {
  return labelOf(DEPTHS, code);
}

/** Changes the depth profile through a dialog: the change starts a new version of the configuration. */
function openDepthDialog(kw) {
  const frame = openDialog({ title: 'Change depth profile', description: `Rank checks of “${kw.keyword}” use the new depth from the next check. This starts version ${kw.history.length + 1} of its configuration.`, width: 'sm' });
  const select = selectField(DEPTHS, kw.depth, () => {}, 'Depth profile', 'w-full');
  select.classList.replace('h-control-sm', 'h-control');
  const reason = el('textarea', 'h-20 px-3 py-2 rounded-md border border-border bg-surface text-foreground type-body w-full');
  reason.maxLength = 500;
  reason.setAttribute('aria-label', 'Reason');
  const error = fieldError('');
  error.hidden = true;
  frame.body.append(field('Depth profile', select), field('Reason', reason, { hint: 'Optional, at most 500 characters. Kept in the configuration history.' }), error);
  const cancel = el('button', BUTTON, 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => frame.close());
  const confirm = el('button', BUTTON_PRIMARY, 'Change depth');
  confirm.type = 'button';
  confirm.addEventListener('click', () => {
    if (select.value === kw.depth) {
      error.hidden = false;
      error.textContent = 'Choose a different depth profile.';
      return;
    }
    changeDepth(kw.id, select.value, reason.value.trim() || null);
    frame.close();
    toast({ title: `Depth profile changed to ${depthLabel(select.value)}`, tone: 'success' });
  });
  frame.footer.append(cancel, confirm);
  select.focus();
}

/**
 * @param {{id: number, onClose: () => void, onStep: (delta: number) => void, canStep: (delta: number) => boolean}} options
 * @returns {{root: HTMLElement, focusTitle: () => void, dispose: () => void}}
 */
export function createInspector({ id, onClose, onStep, canStep }) {
  const root = el('div', 'flex flex-col min-h-0 flex-1');
  let title = null;
  let editing = null;
  const draft = {};
  // What the draft held when its edit started. The draft is dirty once it differs from this.
  let baseline = '';
  const fields = () => JSON.stringify([draft.target, draft.priority, draft.intent, draft.stage, draft.group, draft.tags]);
  const dirty = () => editing !== null && fields() !== baseline;

  const start = (key, kw) => {
    editing = key;
    Object.assign(draft, { target: kw.target ?? '', priority: String(kw.priority), intent: kw.intent, stage: kw.stage, group: kw.group ?? '', tags: kw.tags.join(', '), error: '' });
    baseline = fields();
    render();
  };
  const stop = () => {
    editing = null;
    draft.error = '';
    render();
  };
  /** Runs `proceed` now, or once the person has chosen to discard the draft. Keep editing leaves everything as it is. */
  const confirmLeave = (proceed) => {
    if (dirty()) confirmDiscard(DISCARD_MESSAGE, proceed);
    else proceed();
  };

  function commit(key, kw) {
    if (key === 'tracking') {
      const value = draft.target.trim();
      let problem = '';
      if (value.length > MAX_URL) problem = `A target URL has ${MAX_URL.toLocaleString('en-US')} characters at most.`;
      else if (value !== '' && !/^https?:\/\//i.test(value)) problem = 'Enter a web address that starts with http:// or https://.';
      if (problem) {
        draft.error = problem;
        render();
        return;
      }
      updateRecords([kw.id], { target: value === '' ? null : value, priority: Number(draft.priority), intent: draft.intent, intentManual: kw.intentManual || draft.intent !== kw.intent, stage: draft.stage });
    } else {
      const tags = draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
      const unknown = tags.filter((tag) => !allTags().includes(tag));
      if (unknown.length > 0) {
        draft.error = `Not in the vocabularies: ${unknown.join(', ')}.`;
        render();
        return;
      }
      updateRecords([kw.id], { group: draft.group || null, tags });
    }
    toast({ title: 'Saved', tone: 'success' });
    stop();
  }

  function metricsCard(kw) {
    const hasMetrics = kw.volume !== null;
    const body = el('div', 'grid grid-cols-1 sm:grid-cols-3 gap-2');
    body.append(
      metricTile('Volume', hasMetrics ? formatInt(kw.volume) : 'Pending', hasMetrics ? `Per month, as of ${monthLabel(kw.metricsAt)}` : 'Waiting for the first read'),
      metricTile('Difficulty', hasMetrics ? String(kw.kd) : 'Pending', hasMetrics ? `${competitionLabel(kw.kd)} competition` : 'Waiting for the first read'),
      metricTile('CPC', hasMetrics ? formatCpc(kw.cpc) : 'Pending', 'Per click, USD'),
    );
    return card('Metrics', {}, body);
  }

  function groupsCard(kw) {
    if (editing === 'groups') {
      const group = selectField([['', 'No group'], ...groupList().filter((path) => childrenOf(path).length === 0).map((path) => [path, path])], draft.group, (value) => {
        draft.group = value;
      }, 'Group', 'w-full');
      group.classList.replace('h-control-sm', 'h-control');
      const tags = el('input', INPUT);
      tags.value = draft.tags;
      tags.placeholder = 'Topics: SEO, Services: SEO Audit';
      tags.setAttribute('aria-label', 'Tags');
      tags.addEventListener('input', () => {
        draft.tags = tags.value;
      });
      const body = cardBody(field('Group', group), field('Tags', tags, { hint: 'Separated by commas, from the vocabularies.' }), draft.error ? fieldError(draft.error) : null);
      return card('Groups and tags', { editing: true, onSave: () => commit('groups', kw), onCancel: stop }, body);
    }
    const body = el('div', 'flex flex-col');
    body.append(row('Group', kw.group ?? 'No group'), row('Tags', kw.tags.length > 0 ? kw.tags.join(', ') : 'No tags'));
    return card('Groups and tags', { onEdit: () => confirmLeave(() => start('groups', kw)) }, body);
  }

  function trackingCard(kw) {
    if (editing === 'tracking') {
      const url = el('input', INPUT);
      url.type = 'url';
      url.value = draft.target;
      url.placeholder = 'https://fynix.digital/';
      url.setAttribute('aria-label', 'Target URL');
      url.addEventListener('input', () => {
        draft.target = url.value;
      });
      const priority = selectField(PRIORITY_OPTIONS, draft.priority, (value) => {
        draft.priority = value;
      }, 'Priority', 'w-full');
      priority.classList.replace('h-control-sm', 'h-control');
      const intent = selectField(INTENTS, draft.intent, (value) => {
        draft.intent = value;
      }, 'Intent', 'w-full');
      intent.classList.replace('h-control-sm', 'h-control');
      const stage = selectField(STAGES, draft.stage, (value) => {
        draft.stage = value;
      }, 'Funnel stage', 'w-full');
      stage.classList.replace('h-control-sm', 'h-control');
      const body = cardBody(field('Target URL', url, { hint: 'An http or https address, at most 2,048 characters.' }), field('Priority', priority), field('Intent', intent), field('Funnel stage', stage), draft.error ? fieldError(draft.error) : null);
      return card('Tracking', { editing: true, onSave: () => commit('tracking', kw), onCancel: stop }, body);
    }
    const body = el('div', 'flex flex-col');
    body.append(
      row('Target URL', kw.target ?? 'No target set'),
      row('Priority', String(kw.priority)),
      row('Intent', `${labelOf(INTENTS, kw.intent)}${kw.intentManual ? ', set by hand' : ''}`),
      row('Funnel stage', labelOf(STAGES, kw.stage)),
      row('Depth', depthLabel(kw.depth), 'The profile sets how deep each rank check reads.'),
      row('Schedule', "The project's default"),
      row('Added through', labelOf(SOURCES, kw.source)),
      row('Added', formatDate(kw.added)),
    );
    const change = el('button', `${BUTTON_SM} mt-2 self-start text-foreground-secondary`, 'Change depth profile');
    change.type = 'button';
    change.addEventListener('click', () => openDepthDialog(kw));
    body.append(change);
    return card('Tracking', { onEdit: () => confirmLeave(() => start('tracking', kw)) }, body);
  }

  function historyCard(kw) {
    const versions = [...kw.history].reverse();
    const list = el('ol', 'flex flex-col');
    versions.slice(0, HISTORY_SHOWN).forEach((version, index) => {
      const item = el('li', 'py-2 border-t border-border-subtle first:border-t-0 flex flex-col gap-0.5');
      const head = el('div', 'flex items-center gap-2');
      head.append(el('span', 'type-body-strong text-foreground', `Version ${version.version}`));
      if (index === 0) head.append(badge('Current', 'positive'));
      head.append(el('span', 'type-meta text-foreground-tertiary ml-auto', formatDate(version.at)));
      item.append(head, el('span', 'type-body text-foreground-secondary', `${depthLabel(version.depth)} depth${version.reason ? `: ${version.reason}` : ''}`));
      list.append(item);
    });
    const body = el('div', 'flex flex-col');
    body.append(list);
    if (versions.length > HISTORY_SHOWN) body.append(el('p', 'type-meta text-foreground-tertiary pt-1', `${versions.length - HISTORY_SHOWN} earlier versions`));
    return card('Configuration history', {}, body);
  }

  function openMore(trigger, kw) {
    popover(trigger, (panel, api) => {
      const item = (text, onClick) => {
        const node = el('button', 'min-h-8 px-2 rounded-md flex items-center text-left type-body text-foreground hover:bg-surface-hover', text);
        node.type = 'button';
        node.addEventListener('click', () => {
          api.close();
          onClick();
        });
        return node;
      };
      panel.append(
        item('Change depth profile', () => openDepthDialog(byId(kw.id))),
        item(kw.archived ? 'Unarchive keyword' : 'Archive keyword', () => archiveKeywords([kw.id], !kw.archived, { byFilter: false })),
      );
    }, { label: 'Keyword actions' });
  }

  function render() {
    const kw = byId(id);
    if (!kw) return;
    root.replaceChildren();
    const head = el('header', 'px-4 py-3 border-b border-border flex flex-col gap-1 shrink-0');
    const top = el('div', 'flex items-start gap-2');
    title = el('h2', 'type-inspector-title min-w-0 flex-1 break-words outline-none', kw.keyword);
    title.tabIndex = -1;
    title.id = 'kw-inspector-title';
    const stepPrev = iconButton('chevron-up', 'Previous keyword', () => onStep(-1));
    stepPrev.disabled = !canStep(-1);
    const stepNext = iconButton('chevron-down', 'Next keyword', () => onStep(1));
    stepNext.disabled = !canStep(1);
    const more = iconButton('ellipsis', 'More actions', () => {});
    openMore(more, kw);
    top.append(title, stepPrev, stepNext, more, iconButton('x', 'Close', onClose));
    head.append(
      top,
      el('p', 'type-meta text-foreground-secondary', `${locationName(kw.location)} · ${labelOf(DEVICES, kw.device)}`),
      el('p', 'type-meta text-foreground-tertiary', `Google · ${labelOf(LANGUAGES, kw.language)}`),
      el('p', 'type-meta text-foreground-tertiary', `Depth: ${depthLabel(kw.depth)}`),
      el('p', 'type-meta text-foreground-tertiary', kw.metricsAt === null ? 'Metrics pending' : `Metrics updated ${relativeTime(kw.metricsAt)}`),
    );
    const scroll = el('div', 'flex-1 min-h-0 overflow-auto px-4 py-4 flex flex-col gap-3');
    if (kw.archived) scroll.append(badge('Archived', 'neutral'));
    if (rankOf(kw).kind === 'failed') scroll.append(badge('Check failed', 'warning'));
    scroll.append(
      metricsCard(kw),
      kw.volume === null ? card('Search volume by month', {}, el('p', 'type-body text-foreground-secondary', 'The monthly volume arrives with the metrics.')) : volumeCard(kw),
      groupsCard(kw),
      trackingCard(kw),
      historyCard(kw),
    );
    root.append(head, scroll);
  }

  // A data refresh waits while a card is being edited: a re-render would drop the focus and the field being typed in.
  // stop() draws the current data when the edit ends.
  const unsubscribe = subscribe(() => {
    if (byId(id) && editing === null) render();
  });
  render();
  return {
    root,
    focusTitle: () => title?.focus(),
    dispose: unsubscribe,
    dirty,
    confirmLeave,
  };
}
