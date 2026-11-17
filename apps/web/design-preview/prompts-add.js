/* global window, navigator, setTimeout, clearTimeout */
/**
 * The Add prompts dialog of the Prompts page, as the app has it (src/features/prompts/add-prompts-dialog.tsx and
 * add/, prompt-dialogs 4): one field for a pasted list with its live counter, "Check the list" with the lines
 * grouped by outcome, country and language, optional topics, the collapsible details, the plan of the add and the
 * result view. The numbers and findings come from prompts-add-model.js; the wording is the app's catalog.
 *
 * The app asks the API to lint the list and to create the prompts. Here the fixture answers (one shortcut: a prompt
 * added meanwhile by a teammate, RACE_TEXT below, is skipped as already tracked, which is the only way the result
 * view shows in a mock with no server), and an added prompt joins the fixture's PROMPTS.
 */
import { formatInteger } from './vendor/format/number.js';
import { COMPETITORS, ENGINES, OWN, PROMPTS, PROMPT_BY_ID, TOPIC_PARENT, measures, seeded } from './prompts-data.js';
import {
  ADD_ENGINES,
  ALL_TRACKED,
  BULK_MAX,
  BULK_RUN_MAX,
  COUNTRIES,
  DEFAULT_COUNTRY,
  DEFAULT_LANGUAGE,
  GROUP_TITLES,
  LANGUAGES,
  MANUAL_RUN_CAP,
  NEXT_RUN,
  askCostText,
  checkList,
  checkSummary,
  count,
  counterText,
  dollars,
  engineReach,
  formatList,
  groupRows,
  lineCounts,
  planOf,
  submitLabel,
  suggestType,
} from './prompts-add-model.js';
import { el } from './prompts-parts.js';
import { state } from './prompts-state.js';

const ui = window.PreviewUI;
const { $, $$, icon, toast, openModal, closeModal, trapFocus, askDiscard, setSelectValue, openPopup, closePopup } = ui;

/** A prompt a teammate added while the dialog was open: adding it again is skipped as already tracked. */
const RACE_TEXT = 'What CRM do small sales teams of ten people choose?';
/** A list shows this many lines of a group before the rest are asked for. */
const SHOWN_LINES = 5;
const MAX_TOPIC_TERMS = 20;
const MAX_TOPIC_DEPTH = 10;
const MAX_TOPIC_NAME = 200;
/** Above this many prompts, asking or archiving confirms with the count. */
const CONFIRM_ABOVE = 100;
/** The mock's fixture gives every prompt a topic; the app has a "No topic" group for a prompt added with none. */
const FALLBACK_TOPIC = 'Startups';

const TONE_ICON = { error: 'circle-alert', warning: 'triangle-alert', note: 'info' };
const TONE_CLASS = { error: 'text-negative-text', warning: 'text-warning-text', note: 'text-foreground-secondary' };
const TONE_WORD = { error: 'Cannot be added:', warning: 'Warning:', note: 'Note:' };

const PROMPT_TYPES = [
  ['question', 'Question'],
  ['comparison', 'Comparison'],
  ['recommendation', 'Recommendation'],
  ['how_to', 'How to'],
  ['definition', 'Definition'],
  ['local', 'Local'],
  ['transactional', 'Transactional'],
  ['other', 'Other'],
];
const INTENTS = [['unknown', 'Not set'], ['informational', 'Informational'], ['commercial', 'Commercial'], ['transactional', 'Transactional'], ['navigational', 'Navigational'], ['local', 'Local']];
const STAGES = [['unknown', 'Not set'], ['tofu', 'Top (tofu)'], ['mofu', 'Middle (mofu)'], ['bofu', 'Bottom (bofu)'], ['retention', 'Retention']];
const IMPORTANCES = [['1', '1, highest'], ['2', '2'], ['3', '3, default'], ['4', '4'], ['5', '5, lowest']];
const BRANDED = [['auto', 'Set from brand names (recommended)'], ['always', 'Always branded'], ['never', 'Never branded']];
const label = (list, value) => list.find(([key]) => key === value)[1];

// -------------------------------------------------------------------------------------------------
// Small builders

/** An element with its children: strings become text. */
function h(tag, className, ...children) {
  const node = el(tag, className);
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}
const BUTTON_BASE = 'inline-flex shrink-0 items-center justify-center gap-2 rounded-md border type-body-strong whitespace-nowrap select-none';
const BUTTON_GHOST = `${BUTTON_BASE} h-control-sm px-2 self-start border-transparent bg-transparent text-foreground-secondary hover:bg-surface-hover hover:text-foreground`;
const BUTTON_SECONDARY = `${BUTTON_BASE} h-control px-3 border-border bg-surface text-foreground hover:bg-surface-hover`;
const BUTTON_PRIMARY = `${BUTTON_BASE} h-control px-3 border-transparent bg-primary text-primary-foreground hover:bg-primary-hover aria-disabled:bg-surface-disabled aria-disabled:text-foreground-disabled aria-disabled:cursor-not-allowed aria-disabled:hover:bg-surface-disabled`;
const LINK_BUTTON = 'inline-flex shrink-0 items-center rounded-md type-body-strong whitespace-nowrap text-link underline-offset-2 hover:underline';

function button(className, text, onClick, attributes = {}) {
  const node = h('button', className, text);
  node.type = 'button';
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

let uid = 0;
const nextId = (name) => `add-${name}-${(uid += 1)}`;

/** A checkbox with its text as one label (the table checkbox of prompts-parts, with the words beside it). */
function checkField(text, description) {
  const input = el('input', 'peer size-4 cursor-pointer appearance-none rounded-sm border border-border-strong bg-surface checked:border-primary checked:bg-primary focus-visible:focus-ring disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-disabled disabled:checked:bg-foreground-disabled');
  input.type = 'checkbox';
  const box = h('span', 'relative inline-flex size-6 shrink-0 items-center justify-center', input, icon('check', 'pointer-events-none absolute hidden size-icon-xs text-primary-foreground peer-checked:block'));
  const words = h('span', 'flex min-w-0 flex-col py-0.5');
  const main = el('span', 'type-body text-foreground', text);
  words.append(main);
  if (description) words.append(el('span', 'type-meta text-foreground-secondary', description));
  const root = h('label', 'flex items-start gap-2 cursor-pointer', box, words);
  return { root, input, setText: (value) => (main.textContent = value) };
}

/** A radio with its text, in the look of the checkbox. */
function radioField(name, value, text, checked) {
  const input = el('input', 'peer size-4 cursor-pointer appearance-none rounded-full border border-border-strong bg-surface checked:border-primary checked:bg-primary focus-visible:focus-ring');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  const box = h('span', 'relative inline-flex size-6 shrink-0 items-center justify-center', input, el('span', 'pointer-events-none absolute hidden size-1.5 rounded-full bg-primary-foreground peer-checked:block'));
  return { root: h('label', 'flex items-start gap-2 cursor-pointer', box, el('span', 'py-0.5 type-body text-foreground', text)), input };
}

const CHECK_SLOT = () => h('span', 'size-icon-sm shrink-0 text-primary-text invisible group-aria-checked:visible group-aria-selected:visible', icon('check', 'size-icon-sm'));
const OPTION = 'group w-full h-control-sm px-2 rounded-md flex items-center gap-2 whitespace-nowrap type-body text-foreground text-left outline-none hover:bg-surface-hover focus-visible:bg-surface-hover';
const LISTBOX = 'hidden fixed z-(--z-dropdown) max-h-72 overflow-y-auto rounded-lg border border-border bg-surface-elevated shadow-popover p-1';

// -------------------------------------------------------------------------------------------------
// Topics: the terms of the taxonomy, and the rules a chosen list passes

/** The terms of the fixture's taxonomy: each parent, then its topics as "CRM / Startups". */
const TERMS = [...new Set(Object.values(TOPIC_PARENT))].sort().flatMap((parent) => [
  { key: `parent:${parent}`, path: parent, label: parent, topic: null, parent },
  ...Object.keys(TOPIC_PARENT)
    .filter((name) => TOPIC_PARENT[name] === parent)
    .sort()
    .map((name) => ({ key: `topic:${name}`, path: `${parent} / ${name}`, label: `${parent} / ${name}`, topic: name, parent })),
]);
const splitPath = (text) => text.split('/').map((name) => name.trim());
const displayPath = (text) => splitPath(text).join(' / ');
const foldPath = (text) => splitPath(text).map((name) => name.toLowerCase()).join('/');
const termOfTopic = (name) => TERMS.find((term) => term.topic === name) ?? null;

function pathProblem(text) {
  const names = splitPath(text);
  if (names.some((name) => name === '')) return 'Each level of a group needs a name.';
  if (names.length > MAX_TOPIC_DEPTH) return `Groups go ${MAX_TOPIC_DEPTH} levels deep at most.`;
  return names.some((name) => name.length > MAX_TOPIC_NAME) ? `A group name has ${MAX_TOPIC_NAME} characters at most.` : null;
}

// -------------------------------------------------------------------------------------------------

/**
 * Builds the dialog inside `#dlg-add-prompts` and returns `open(opener, topicName)`.
 * @param {{update: () => void, showPrompt: (id: string) => void}} host `update` redraws the page after the
 *   fixture changed; `showPrompt` opens the inspector of a prompt ("Show it").
 */
export function initAddPrompts({ update, showPrompt }) {
  const dialog = $('#dlg-add-prompts');
  const frame = $('[data-dialog-panel]', dialog);
  dialog.setAttribute('aria-describedby', 'add-desc');
  frame.className = 'relative w-140 max-w-full rounded-xl bg-surface-elevated shadow-dialog flex flex-col';

  let opener = null;
  let form;
  let initial = '';
  let restoreOn = true;
  let askOn = false;
  let checking = false;
  let checkTimer = null;
  let fieldError = null;
  let alertText = null;
  let topicProblem = null;
  let checkChosen = null;
  let detailsOpen = false;
  let draftKept = false;
  let moreLines = new Set();
  let moreReasons = new Set();
  let outcome = null;
  let lastSpoken = '';

  const freshForm = (topicName) => {
    const term = topicName ? termOfTopic(topicName) : null;
    return { text: '', country: DEFAULT_COUNTRY, language: DEFAULT_LANGUAGE, topics: term ? [{ kind: 'existing', key: term.key, label: term.label, topic: term.topic, parent: term.parent }] : [], type: 'auto', intent: 'unknown', stage: 'unknown', importance: '3', branded: 'auto' };
  };
  const snapshot = () => JSON.stringify({ ...form, topics: form.topics.map((topic) => topic.key ?? topic.path) });
  const isDirty = () => outcome === null && snapshot() !== initial;

  // ---------------------------------------------------------------------------------------------
  // The form view

  const formView = h('div', 'contents');
  const resultView = h('div', 'hidden');
  frame.replaceChildren(formView, resultView);

  const heading = h('h2', 'type-section-title', 'Add prompts');
  heading.id = 'dlg-prompts-title';
  const description = h('p', 'type-body text-foreground-secondary', `Asked on ${formatList(ADD_ENGINES.map((engine) => engine.label))} twice a week (Monday and Thursday).`);
  description.id = 'add-desc';
  const closeButton = button('ml-auto size-control-sm shrink-0 rounded-md flex items-center justify-center text-foreground-tertiary hover:bg-surface-hover hover:text-foreground', icon('x', 'size-icon-md'), null, { 'aria-label': 'Close', 'data-tip': 'Close (Esc)', 'data-dialog-close': '' });
  const header = h('div', 'shrink-0 px-6 pt-6 pb-4 flex items-start gap-4', h('div', 'flex min-w-0 flex-1 flex-col gap-1', heading, description), closeButton);

  // Prompts
  const textarea = el('textarea', 'field-sizing-content min-h-19 max-h-44 w-full overflow-y-auto resize-none rounded-md border border-border bg-surface px-3 py-2 type-body text-foreground placeholder:text-foreground-tertiary focus-visible:focus-ring aria-invalid:border-negative-solid');
  textarea.id = 'prompt-input';
  textarea.spellcheck = false;
  textarea.name = 'text';
  const promptsLabel = h('label', 'type-label', 'Prompts');
  promptsLabel.htmlFor = textarea.id;
  const counter = el('p', 'self-end num type-meta');
  counter.id = 'add-counter';
  const hint = el('p', 'type-meta', `One prompt per line, up to ${formatInteger(BULK_MAX)} at once.`);
  hint.id = 'add-hint';
  const promptsError = h('div', 'flex items-start gap-1 type-meta text-negative-text');
  promptsError.id = 'add-error';
  promptsError.hidden = true;
  textarea.setAttribute('aria-describedby', 'add-counter add-hint add-error');
  const promptsField = h('div', 'flex min-w-0 w-full flex-col gap-1.5', promptsLabel, textarea, counter, hint, promptsError);

  const alertBox = h('div', 'flex items-start gap-2 rounded-md border border-negative-border bg-negative-subtle px-3 py-2 type-body text-foreground');
  alertBox.setAttribute('role', 'alert');
  alertBox.hidden = true;

  // Check the list
  const checkId = nextId('check');
  const checkToggle = button(BUTTON_GHOST, '', () => {
    checkChosen = !checkIsOpen();
    refresh();
  }, { 'aria-controls': checkId });
  const checkBody = h('div', 'flex flex-col gap-2');
  checkBody.id = checkId;
  const checkWrap = h('div', 'flex flex-col gap-2', checkToggle, checkBody);
  let lastCounts = lineCounts([]);
  const checkIsOpen = () => checkChosen ?? lastCounts.refused > 0;

  // Country and language
  const selects = {};
  function selectField(key, text, options, value) {
    const labelId = nextId('label');
    const triggerId = nextId('select');
    const listId = nextId('list');
    const trigger = h('button', 'h-control w-full px-3 rounded-md border border-border bg-surface type-body text-foreground flex items-center justify-between gap-2 text-left hover:bg-surface-hover focus-visible:focus-ring', el('span', 'truncate'), icon('chevron-down', 'size-icon-sm shrink-0 text-foreground-muted'));
    trigger.firstElementChild.setAttribute('data-select-value', '');
    Object.entries({ type: 'button', id: triggerId, role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': listId, 'data-select': listId, 'data-value': value, 'aria-labelledby': `${labelId} ${triggerId}`, 'data-add-field': key }).forEach(([name, v]) => trigger.setAttribute(name, v));
    const list = h('div', LISTBOX, options.map(([optionValue, text2]) => {
      const option = h('button', OPTION, CHECK_SLOT(), el('span', 'truncate', text2));
      Object.entries({ type: 'button', role: 'option', 'aria-selected': 'false', 'data-value': optionValue }).forEach(([name, v]) => option.setAttribute(name, v));
      return option;
    }));
    Object.entries({ id: listId, role: 'listbox', 'aria-label': text, 'data-listbox': '' }).forEach(([name, v]) => list.setAttribute(name, v));
    dialog.append(list);
    setSelectValue(trigger, value);
    const labelNode = h('span', 'type-label', text);
    labelNode.id = labelId;
    selects[key] = trigger;
    return h('div', 'flex min-w-0 w-full flex-col gap-1.5', labelNode, trigger);
  }
  const marketHint = h('p', 'type-meta text-foreground-secondary');
  const settingsLink = h('a', 'rounded-xs underline-offset-2 focus-visible:focus-ring underline text-link', 'Platform settings ', el('span', 'sr-only', '(opens in a new tab)'));
  settingsLink.href = '#/settings/engines';
  settingsLink.target = '_blank';
  settingsLink.rel = 'noopener noreferrer';
  marketHint.append(`Only countries every enabled platform asks in. ${formatList(engineReach().map((entry) => `${entry.label} asks in ${count(entry.count, 'country', 'countries')}`))}. `, settingsLink);
  const market = h('div', 'flex flex-col gap-2', h('div', 'grid grid-cols-1 gap-4 sm:grid-cols-2', selectField('country', 'Location', COUNTRIES.map((c) => [c.value, c.label]), DEFAULT_COUNTRY), selectField('language', 'Language', LANGUAGES.map((l) => [l.value, l.label]), DEFAULT_LANGUAGE)), marketHint);

  // Topics
  const topicInput = el('input', 'h-badge min-w-24 flex-1 bg-transparent px-1.5 type-body text-foreground outline-none placeholder:text-foreground-tertiary');
  topicInput.type = 'text';
  topicInput.autocomplete = 'off';
  topicInput.spellcheck = false;
  topicInput.placeholder = 'Choose or type a group';
  topicInput.setAttribute('role', 'combobox');
  topicInput.setAttribute('aria-expanded', 'false');
  topicInput.setAttribute('aria-autocomplete', 'list');
  const topicList = h('div', LISTBOX.replace('max-h-72', 'max-h-100'));
  Object.entries({ id: 'add-topic-list', role: 'listbox', 'aria-label': 'Groups', 'aria-multiselectable': 'true' }).forEach(([name, v]) => topicList.setAttribute(name, v));
  topicInput.setAttribute('aria-controls', 'add-topic-list');
  dialog.append(topicList);
  const chips = h('div', 'flex w-full min-w-0 flex-wrap items-center gap-1');
  chips.setAttribute('role', 'toolbar');
  chips.setAttribute('aria-label', 'Chosen groups and tags');
  const topicBox = h('div', 'flex max-h-24 min-h-control w-full min-w-0 cursor-text items-center overflow-y-auto rounded-md border border-border bg-surface px-1.5 py-1 has-[input:focus-visible]:focus-ring', chips);
  topicBox.setAttribute('role', 'group');
  const topicLabel = h('label', 'type-label', 'Groups ', el('span', 'type-meta', '(optional)'));
  topicLabel.htmlFor = topicInput.id = nextId('topics');
  const topicMessage = el('p', 'type-meta text-negative-text');
  topicMessage.hidden = true;
  const topicField = h('div', 'flex min-w-0 w-full flex-col gap-1.5', topicLabel, h('div', 'flex flex-col gap-1.5', topicBox, topicMessage, el('p', 'type-meta text-foreground-secondary', 'A prompt counts under its group and the groups above it.')));

  // Details
  const detailsId = nextId('details');
  const detailsToggle = button(BUTTON_GHOST, '', () => {
    detailsOpen = !detailsOpen;
    refresh();
  }, { 'aria-controls': detailsId });
  const detailsGrid = h('div', 'grid grid-cols-1 gap-4 sm:grid-cols-2', selectField('type', 'Type', [['auto', 'Set from wording'], ...PROMPT_TYPES], 'auto'), selectField('intent', 'Intent', INTENTS, 'unknown'), selectField('stage', 'Funnel stage', STAGES, 'unknown'), selectField('importance', 'Importance', IMPORTANCES, '3'));
  const brandedGroup = h('div', 'flex min-w-0 flex-col gap-1.5');
  brandedGroup.setAttribute('role', 'radiogroup');
  brandedGroup.setAttribute('aria-label', 'Branded');
  brandedGroup.append(el('div', 'type-label', 'Branded'), h('div', 'flex flex-col gap-2', BRANDED.map(([value, text]) => {
    const radio = radioField('add-branded', value, text, value === 'auto');
    radio.input.addEventListener('change', () => {
      form.branded = value;
      refresh();
    });
    return radio.root;
  })));
  const detailsBody = h('div', 'flex flex-col gap-4', detailsGrid, brandedGroup);
  detailsBody.id = detailsId;
  const details = h('div', 'flex flex-col gap-3', detailsToggle, detailsBody);

  // The plan
  const planId = nextId('plan');
  const planBlock = h('div', 'flex flex-col gap-1 rounded-md border border-border-subtle bg-surface-subtle px-3 py-2 type-meta text-foreground-secondary');
  planBlock.id = planId;
  planBlock.setAttribute('role', 'group');
  planBlock.setAttribute('aria-label', 'What this add takes');
  const askCheck = checkField('');
  const restoreCheck = checkField('', 'Restored prompts keep their history and answers, and count against the workspace limit.');
  askCheck.input.addEventListener('change', () => {
    askOn = askCheck.input.checked;
    refresh();
  });
  restoreCheck.input.addEventListener('change', () => {
    restoreOn = restoreCheck.input.checked;
    refresh();
  });

  const body = h('div', 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6', h('div', 'flex flex-col gap-4', alertBox, promptsField, checkWrap, market, topicField, details, planBlock));

  // Footer
  const summaryNode = el('p', 'line-clamp-3 min-w-0 type-meta text-foreground-secondary sm:hidden');
  const cancelButton = button(BUTTON_SECONDARY, 'Cancel', () => requestClose());
  const submitButton = h('button', BUTTON_PRIMARY, 'Add prompts');
  submitButton.type = 'submit';
  submitButton.setAttribute('aria-describedby', planId);
  const footer = h('div', 'flex shrink-0 items-center gap-2 border-t border-transparent px-6 py-4', summaryNode, h('div', 'ml-auto flex items-center gap-2', cancelButton, submitButton));
  const live = el('div', 'sr-only');
  live.setAttribute('aria-live', 'polite');
  formView.append(header, body, footer, live);

  // ---------------------------------------------------------------------------------------------
  // Drawing

  function reasonNode(reason) {
    return h('p', `flex items-start gap-1.5 type-meta ${TONE_CLASS[reason.tone]}`, icon(TONE_ICON[reason.tone], 'mt-0.5 size-icon-sm shrink-0'), h('span', '', el('span', 'sr-only', TONE_WORD[reason.tone]), ` ${reason.text}`));
  }

  function lineRow(row, groupId) {
    const [first, ...rest] = row.reasons;
    const key = `${groupId}:${row.line}`;
    const open = moreReasons.has(key);
    const top = h('div', 'flex min-w-0 items-baseline gap-2', el('span', 'shrink-0 num type-label text-foreground-secondary', `Line ${row.line}`));
    const text = el('span', 'block min-w-0 flex-1 truncate type-body', row.text);
    text.lang = form.language;
    top.append(text);
    // An archived prompt does not open in the inspector of this mock
    if (row.target !== null && row.group !== 'archived') {
      top.append(button(LINK_BUTTON, 'Show it', () => leaveTo(row.target), { 'aria-label': `Show it, line ${row.line}` }));
    }
    return h(
      'li',
      'flex flex-col gap-1 py-1.5',
      top,
      first ? reasonNode(first) : null,
      open ? rest.map(reasonNode) : null,
      rest.length === 0 ? null : button(`${LINK_BUTTON} self-start`, open ? 'Show fewer checks' : `And ${count(rest.length, 'more check')}`, () => toggle(moreReasons, key, `r:${key}`), { 'aria-expanded': String(open), 'data-focus-key': `r:${key}` }),
      row.suggestedType ? el('p', 'type-meta text-foreground-tertiary', row.suggestedType) : null,
    );
  }

  function groupNode(group) {
    const all = moreLines.has(group.id);
    const hold = group.id !== 'refused' && !all;
    const shown = hold ? group.rows.slice(0, SHOWN_LINES) : group.rows;
    const hidden = group.rows.length - SHOWN_LINES;
    return h(
      'li',
      'flex flex-col gap-1',
      el('h3', 'type-subsection-title', GROUP_TITLES[group.id](group.rows.length)),
      group.id === 'archived' ? restoreBox(group.rows.length) : null,
      h('ul', 'flex flex-col divide-y divide-border-subtle', shown.map((row) => lineRow(row, group.id))),
      hidden > 0 && group.id !== 'refused' ? button(`${LINK_BUTTON} self-start`, all ? 'Show fewer' : `Show ${formatInteger(hidden)} more`, () => toggle(moreLines, group.id, `g:${group.id}`), { 'aria-expanded': String(all), 'data-focus-key': `g:${group.id}` }) : null,
    );
  }
  function restoreBox(archivedCount) {
    restoreCheck.setText(`Restore archived (${formatInteger(archivedCount)})`);
    restoreCheck.input.checked = restoreOn;
    return restoreCheck.root;
  }
  /** Opens or closes one "show more", and keeps the focus on its button, which is drawn again. */
  function toggle(set, key, focusKey) {
    if (set.has(key)) set.delete(key);
    else set.add(key);
    refresh();
    $(`[data-focus-key="${focusKey}"]`, checkBody)?.focus();
  }

  function render() {
    const rows = checkList({ text: form.text, country: form.country, language: form.language, type: form.type, branded: form.branded, archived: state.archived });
    const counts = lineCounts(rows);
    lastCounts = counts;
    const restore = restoreOn ? counts.archived : 0;
    const used = PROMPTS.filter((prompt) => !state.archived.has(prompt.id)).length;
    const plan = planOf({ rows, counts, checking, restore, used });
    const askTicked = askOn && plan.ask !== null && plan.askReason === null;

    // The counter, the hint and the error of the field
    const counterWords = counterText(counts);
    counter.textContent = counterWords ?? '';
    counter.hidden = counterWords === null;
    counter.classList.toggle('text-negative-text', counts.lines - counts.repeats > BULK_MAX);
    promptsError.hidden = fieldError === null;
    hint.hidden = fieldError !== null;
    textarea.toggleAttribute('aria-invalid', fieldError !== null);
    if (fieldError !== null) promptsError.replaceChildren(icon('circle-x', 'mt-1 size-icon-xs shrink-0'), el('span', '', fieldError));
    alertBox.hidden = alertText === null;
    if (alertText !== null) alertBox.replaceChildren(icon('circle-x', 'mt-0.5 size-icon-sm shrink-0 text-negative-text'), el('span', 'min-w-0', alertText));

    // Check the list
    checkWrap.hidden = rows.length === 0;
    const open = checkIsOpen();
    const summary = checkSummary(rows, counts, checking);
    checkToggle.setAttribute('aria-expanded', String(open));
    checkToggle.replaceChildren(icon(open ? 'chevron-down' : 'chevron-right', 'size-icon-sm shrink-0'), 'Check the list', el('span', `type-meta ${TONE_CLASS[summary.tone]}`, summary.text));
    checkBody.hidden = !open;
    checkBody.replaceChildren();
    if (open && rows.length > 0) {
      const list = h('ul', 'flex flex-col gap-3', groupRows(rows).map(groupNode));
      list.setAttribute('aria-label', 'Checks of the list');
      list.setAttribute('aria-busy', String(checking));
      checkBody.append(list);
    }

    // Details
    detailsToggle.setAttribute('aria-expanded', String(detailsOpen));
    detailsToggle.replaceChildren(icon(detailsOpen ? 'chevron-down' : 'chevron-right', 'size-icon-sm shrink-0'), 'Details', el('span', 'type-meta text-foreground-secondary', detailsSummary()));
    detailsBody.hidden = !detailsOpen;

    // The plan block
    askCheck.setText(plan.ask === null ? '' : `Ask them now as well (${plan.ask.runs === 1 ? 'one manual run' : `${plan.ask.runs} manual runs`} of today's ${formatInteger(plan.ask.limit)} (${formatInteger(plan.ask.used)} used), ${askCostText(plan.ask)})`);
    askCheck.input.disabled = plan.askReason !== null;
    askCheck.input.checked = askTicked;
    planBlock.setAttribute('aria-busy', String(checking));
    planBlock.replaceChildren(...plan.lines.map((line) => (line.slot === 'ask' ? askCheck.root : el('p', line.tone === 'negative' ? 'text-negative-text' : '', line.text))));

    // The footer
    summaryNode.textContent = plan.summary ?? '';
    summaryNode.hidden = plan.summary === null;
    const sendCount = counts.new + counts.refused + restore;
    submitButton.textContent = submitLabel(sendCount);
    submitButton.setAttribute('aria-disabled', String(plan.blocked !== null));
    if (plan.reason) submitButton.dataset.tip = plan.reason;
    else delete submitButton.dataset.tip;
    footer.classList.toggle('border-border-subtle', body.scrollHeight > body.clientHeight);
    footer.classList.toggle('border-transparent', body.scrollHeight <= body.clientHeight);
    return { rows, counts, plan, restore, askTicked };
  }

  function detailsSummary() {
    return [
      form.type === 'auto' ? 'Type: set from wording' : `Type: ${label(PROMPT_TYPES, form.type)}`,
      ...(form.intent === 'unknown' ? [] : [`Intent: ${label(INTENTS, form.intent)}`]),
      ...(form.stage === 'unknown' ? [] : [`Funnel stage: ${label(STAGES, form.stage)}`]),
      ...(form.importance === '3' ? [] : [`Importance: ${label(IMPORTANCES, form.importance)}`]),
      ...(form.branded === 'auto' ? [] : [`Branded: ${form.branded}`]),
    ].join(', ');
  }

  function renderChips() {
    chips.replaceChildren(
      ...form.topics.map((topic) => {
        const remove = button('relative -mr-1 flex size-4 shrink-0 items-center justify-center rounded-xs text-neutral-text outline-none hover:bg-neutral-border focus-visible:focus-ring', icon('x', 'size-icon-xs'), () => {
          form.topics = form.topics.filter((entry) => entry !== topic);
          topicProblem = null;
          afterTopicsChange();
        }, { 'aria-label': `Remove ${topic.label}` });
        return h('div', 'inline-flex h-badge max-w-full min-w-0 shrink-0 items-center gap-1 rounded-sm border border-neutral-border bg-neutral-subtle px-2 pr-1 type-micro text-neutral-text', el('span', 'truncate', topic.label), remove);
      }),
      topicInput,
    );
    topicInput.placeholder = form.topics.length === 0 ? 'Choose or type a group' : '';
    topicMessage.hidden = topicProblem === null;
    topicMessage.textContent = topicProblem ?? '';
  }

  /** The rows of the topic list for what is typed: terms not chosen that contain it, and a row that makes it. */
  function topicRows() {
    const query = topicInput.value.trim();
    const chosen = new Set(form.topics.map((topic) => topic.key ?? `new:${foldPath(topic.path)}`));
    const matches = TERMS.filter((term) => !chosen.has(term.key) && term.label.toLowerCase().includes(displayPath(query).toLowerCase()));
    const taken = query === '' || TERMS.some((term) => foldPath(term.path) === foldPath(query)) || form.topics.some((topic) => foldPath(topic.path ?? topic.label) === foldPath(query));
    return { query, matches, create: taken ? null : query };
  }

  function renderTopicList() {
    const { query, matches, create } = topicRows();
    const options = matches.map((term) => topicOption(term.label, () => chooseTerm(term)));
    if (create !== null) {
      const text = splitPath(create).length > 1 ? `Create “${create}”` : `Create group “${create}”`;
      options.unshift(h('button', OPTION, icon('plus', 'size-icon-sm shrink-0 text-foreground-tertiary'), el('span', 'truncate', text)));
      options[0].type = 'button';
      options[0].setAttribute('role', 'option');
      options[0].dataset.create = '';
      options[0].addEventListener('click', () => chooseNew(create));
    }
    if (options.length === 0) {
      const empty = query !== '' ? `No groups match “${query}”.` : 'Every group is chosen.';
      topicList.replaceChildren(el('p', 'px-2 py-1.5 type-meta text-foreground-secondary', empty));
    } else topicList.replaceChildren(...options);
    return options;
  }
  function topicOption(text, onChoose) {
    const option = h('button', OPTION, el('span', 'size-icon-sm shrink-0'), el('span', 'truncate', text));
    option.type = 'button';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.addEventListener('click', onChoose);
    return option;
  }
  function openTopics() {
    if (skipOpen) return;
    renderTopicList();
    topicList.style.minWidth = `${topicBox.getBoundingClientRect().width}px`;
    if (topicsOpen) return;
    openPopup(topicList, topicInput, { anchor: topicBox, focus: topicInput, onClose: closedTopics });
    topicsOpen = true;
    topicInput.setAttribute('aria-expanded', 'true');
  }
  // Closing the list gives the focus back to the field, which must not open it again
  let skipOpen = false;
  // Whether the list is up: its element stays marked while it fades out, so the mark is no answer
  let topicsOpen = false;
  function closedTopics() {
    topicsOpen = false;
    topicInput.setAttribute('aria-expanded', 'false');
    skipOpen = true;
    setTimeout(() => (skipOpen = false), 0);
  }
  function afterTopicsChange() {
    topicInput.value = '';
    renderChips();
    if (topicsOpen) renderTopicList();
    topicInput.focus();
    refresh();
  }
  function addTopic(topic) {
    if (form.topics.length >= MAX_TOPIC_TERMS) {
      topicProblem = `A prompt takes at most ${MAX_TOPIC_TERMS} groups and tags.`;
      renderChips();
      return;
    }
    topicProblem = null;
    form.topics = [...form.topics, topic];
    afterTopicsChange();
  }
  const chooseTerm = (term) => addTopic({ kind: 'existing', key: term.key, label: term.label, topic: term.topic, parent: term.parent, path: term.path });
  function chooseNew(text) {
    const problem = pathProblem(text);
    if (problem !== null) {
      topicProblem = problem;
      renderChips();
      return;
    }
    const path = displayPath(text);
    addTopic({ kind: 'new', key: null, path, label: `${path} (new)` });
  }

  function leaveTo(promptId) {
    // The list is kept for a peek at the prompt, and comes back when the dialog opens again
    draftKept = true;
    closeAdd(false);
    showPrompt(promptId);
  }

  function refresh() {
    const result = render();
    const spoken = [counterText(result.counts), result.plan.summary].filter(Boolean).join('. ');
    if (!checking && spoken !== lastSpoken) {
      lastSpoken = spoken;
      live.textContent = spoken;
    }
    return result;
  }

  // ---------------------------------------------------------------------------------------------
  // Events

  textarea.addEventListener('input', () => {
    form.text = textarea.value;
    // The field's own error goes once there is something to add
    if (fieldError !== null && lineCounts(checkList({ text: form.text, country: form.country, language: form.language, type: form.type, branded: form.branded, archived: state.archived })).lines > 0) fieldError = null;
    alertText = null;
    checking = true;
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      checking = false;
      refresh();
    }, 300);
    refresh();
  });
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      frame.requestSubmit();
    }
  });
  frame.addEventListener('change', (event) => {
    const field = event.target.closest?.('[data-add-field]')?.dataset.addField;
    if (!field) return;
    form[field] = event.target.closest('[data-add-field]').dataset.value;
    alertText = null;
    refresh();
  });
  topicBox.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    topicInput.focus();
    openTopics();
  });
  topicInput.addEventListener('focus', openTopics);
  topicInput.addEventListener('input', openTopics);
  topicInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      // Never submits the form: Enter chooses the row that makes the typed topic, or the one match
      event.preventDefault();
      const { matches, create, query } = topicRows();
      if (create !== null) chooseNew(create);
      else if (query !== '' && matches.length > 0) chooseTerm(matches[0]);
    } else if (event.key === 'Backspace' && topicInput.value === '' && form.topics.length > 0) {
      form.topics = form.topics.slice(0, -1);
      afterTopicsChange();
    }
  });
  // Typing while an option has the focus goes on in the field
  topicList.addEventListener('keydown', (event) => {
    if ((event.key.length === 1 && !event.metaKey && !event.ctrlKey) || event.key === 'Backspace') topicInput.focus();
  });
  $$('[data-dialog-close]', dialog).forEach((node) => node.addEventListener('click', requestClose));
  $('[data-scrim]', dialog).addEventListener('click', requestClose);
  dialog.addEventListener('keydown', (event) => {
    trapFocus(dialog, event);
    // Escape closes an open list first; only then the dialog
    if (event.key === 'Escape' && !ui.popupOpen() && $('#dlg-discard').hidden) {
      event.preventDefault();
      requestClose();
    }
  });
  frame.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });

  // ---------------------------------------------------------------------------------------------
  // Closing

  function closeAdd(reset = true) {
    closePopup({ restoreFocus: false });
    closeModal(dialog, () => {
      if (reset) resetForm();
      opener?.focus();
    });
  }
  function requestClose() {
    if (!isDirty()) {
      closeAdd();
      return;
    }
    askDiscard('The prompts you typed will be lost.', {
      onKeep: () => textarea.focus(),
      onDiscard: () => closeAdd(),
    });
  }

  function resetForm(topicName) {
    form = freshForm(topicName);
    initial = snapshot();
    restoreOn = true;
    askOn = false;
    checking = false;
    clearTimeout(checkTimer);
    fieldError = null;
    alertText = null;
    topicProblem = null;
    checkChosen = null;
    detailsOpen = false;
    moreLines = new Set();
    moreReasons = new Set();
    outcome = null;
    lastSpoken = '';
    draftKept = false;
    textarea.value = '';
    topicInput.value = '';
    for (const [key, trigger] of Object.entries(selects)) setSelectValue(trigger, form[key]);
    $$('input[name="add-branded"]', brandedGroup).forEach((input) => (input.checked = input.value === 'auto'));
    resultView.classList.add('hidden');
    resultView.classList.remove('contents');
    formView.classList.add('contents');
    formView.classList.remove('hidden');
    renderChips();
    refresh();
  }

  // ---------------------------------------------------------------------------------------------
  // Submitting: the fixture is the server

  function createPrompt(text, random, choice, topic) {
    const type = choice.type === 'auto' ? suggestType(text) : choice.type;
    const named = [OWN, ...COMPETITORS.map((competitor) => competitor.name)].some((name) => text.toLowerCase().includes(name.toLowerCase()));
    const prompt = {
      id: `p${PROMPTS.length + 1}`,
      text,
      type,
      topic,
      panel: 'Core',
      branded: choice.branded === 'auto' ? named : choice.branded === 'always',
      locked: false,
      version: 1,
      versionChanged: false,
      stale: false,
      pending: true,
      linked: false,
      seed: Math.floor(random() * 2 ** 31),
      engines: Object.fromEntries(
        ENGINES.map((engine) => [engine.code, { n: 0, mention: 0, citation: 0, recommendation: measures(engine.code, 'recommendation') ? 0 : null, prevMention: 0, prevCitation: 0, competitors: COMPETITORS.map(() => 0) }]),
      ),
    };
    PROMPTS.push(prompt);
    PROMPT_BY_ID.set(prompt.id, prompt);
    return prompt;
  }

  /** The topic of the fixture's prompt: the first topic chosen, else the first one under a chosen parent. */
  function topicOfForm() {
    const existing = form.topics.filter((topic) => topic.kind === 'existing');
    const direct = existing.find((topic) => topic.topic !== null);
    if (direct) return direct.topic;
    const parent = existing[0]?.parent;
    return Object.keys(TOPIC_PARENT).find((name) => TOPIC_PARENT[name] === parent) ?? FALLBACK_TOPIC;
  }

  function submit() {
    const { rows, counts, plan, askTicked } = refresh();
    if (plan.blocked === 'cannotAdd') {
      alertText = 'Some lines cannot be added. Fix or remove them first.';
      refresh();
      return;
    }
    if (counts.lines === 0) {
      fieldError = 'Enter at least one prompt.';
      refresh();
      textarea.focus();
      return;
    }
    if (plan.tooMany) {
      fieldError = `Add at most ${formatInteger(BULK_MAX)} prompts at once. This list has ${formatInteger(counts.new)}.`;
      refresh();
      textarea.focus();
      return;
    }
    if (plan.blocked === 'allTracked') {
      alertText = ALL_TRACKED;
      refresh();
      return;
    }
    if (plan.blocked === 'overQuota') {
      alertText = `The workspace has ${formatInteger(plan.quota.used)} of ${formatInteger(plan.quota.limit)} active prompts, so these do not fit. Archive prompts you no longer need, then try again.`;
      refresh();
      return;
    }
    alertText = null;
    const random = seeded(PROMPTS.length + 1);
    const topic = topicOfForm();
    const created = [];
    const skipped = [];
    for (const row of rows.filter((entry) => entry.group === 'new')) {
      if (row.text.toLowerCase() === RACE_TEXT.toLowerCase()) {
        // Someone else added it first: it is theirs, and this line is skipped as already tracked
        const theirs = createPrompt(row.text, random, { type: 'auto', branded: 'auto' }, topic);
        skipped.push({ line: row.line, text: row.text, target: theirs.id });
      } else created.push(createPrompt(row.text, random, form, topic).id);
    }
    let restored = 0;
    if (restoreOn) {
      for (const row of rows.filter((entry) => entry.group === 'archived')) {
        state.archived.delete(row.target);
        restored += 1;
      }
    }
    update();
    const pieces = {
      created,
      restored,
      tracked: [...rows.filter((row) => row.group === 'tracked').map((row) => ({ line: row.line, text: row.text, target: row.target })), ...skipped].sort((a, b) => a.line - b.line),
      archived: restoreOn ? [] : rows.filter((row) => row.group === 'archived').map((row) => ({ line: row.line, text: row.text, target: row.target })),
    };
    const resultNeeded = skipped.length > 0;
    announceAdded(pieces, askTicked, resultNeeded, plan);
    if (!resultNeeded) {
      closeAdd();
      return;
    }
    outcome = pieces;
    showResult(pieces, plan);
  }

  // ---------------------------------------------------------------------------------------------
  // What follows an add: the toast with Undo, and asking the new prompts now

  function announceAdded({ created, restored }, askTicked, resultNeeded, plan) {
    if (created.length === 0 && restored === 0) return;
    const title = created.length === 0 ? `${count(restored, 'archived prompt')} restored` : restored === 0 ? `${count(created.length, 'prompt')} added` : `${count(created.length, 'prompt')} added and ${count(restored, 'archived prompt')} restored`;
    toast({
      title,
      description: created.length === 0 ? undefined : `First scheduled answers: ${NEXT_RUN}. They can be undone: Undo archives them.`,
      action: created.length === 0 ? undefined : { label: 'Undo', run: () => undo(created) },
    });
    if (!askTicked || created.length === 0) return;
    if (created.length <= CONFIRM_ABOVE) askNow(created, plan);
    else if (!resultNeeded) confirmAsk(created, plan);
  }

  async function undo(ids) {
    if (ids.length > CONFIRM_ABOVE) {
      const ok = await ui.confirmAction({ title: `Archive ${count(ids.length, 'prompt')}?`, body: 'They are no longer asked and leave the tables. Their answers stay, and Undo brings them back.', confirmLabel: `Archive ${count(ids.length, 'prompt')}` });
      if (!ok) return;
    }
    ids.forEach((id) => state.archived.add(id));
    update();
    toast({ title: `${count(ids.length, 'prompt')} archived`, description: 'They stay in Archived.' });
  }

  function askNow(ids, plan) {
    const cost = plan?.ask && plan.ask.cost !== null && ids.length === plan.prompts ? ` About ${dollars(plan.ask.cost)}.` : '';
    toast({ title: `Run started: ${count(ids.length, 'prompt')} on ${count(ADD_ENGINES.length, 'platform')}`, description: `${cost.trim()} Answers arrive within minutes. A run the AI budget blocks waits in Runs.`.trim() });
  }
  async function confirmAsk(ids, plan) {
    const runs = Math.ceil(ids.length / BULK_RUN_MAX);
    const answers = plan?.ask && ids.length === plan.prompts ? ` ${count(plan.ask.answers, 'answer')}, ${askCostText(plan.ask)}.` : '';
    const ok = await ui.confirmAction({
      title: `Ask ${count(ids.length, 'prompt')} now?`,
      body: `${runs <= 1 ? `This is one manual run of ${count(ids.length, 'prompt')}.` : `${formatInteger(ids.length)} prompts are more than one run takes, so this makes ${runs} manual runs of up to ${BULK_RUN_MAX} prompts.`} ${plan?.ask ? `You have used ${plan.ask.used} of ${plan.ask.limit} manual runs today.` : `${runs <= 1 ? 'It counts as one' : `They count as ${runs}`} of your ${MANUAL_RUN_CAP} manual runs a day.`}${answers}`,
      confirmLabel: `Ask ${count(ids.length, 'prompt')}`,
    });
    if (ok) askNow(ids, plan);
  }

  // ---------------------------------------------------------------------------------------------
  // The result view: what an add that skipped a line says in place of the form

  function linesList(lines) {
    return h('ul', 'flex flex-col divide-y divide-border-subtle', lines.map((entry) => {
      const text = el('span', 'block min-w-0 flex-1 truncate type-body', entry.text);
      return h('li', 'flex min-w-0 items-baseline gap-2 py-1.5', el('span', 'shrink-0 num type-label text-foreground-secondary', `Line ${entry.line}`), text, entry.target ? button(LINK_BUTTON, 'Show it', () => {
        closeAdd();
        showPrompt(entry.target);
      }, { 'aria-label': `Show it, line ${entry.line}` }) : null);
    }));
  }

  function showResult(result, plan) {
    const section = (title, lines) => h('section', 'flex flex-col gap-1', el('h3', 'type-subsection-title', title), linesList(lines));
    const notAdded = [...result.tracked, ...result.archived].sort((a, b) => a.line - b.line).map((entry) => entry.text).join('\n');
    const done = button(BUTTON_PRIMARY, 'Done', () => closeAdd());
    const canAsk = result.created.length > 0 && !askOn;
    const resultBody = h(
      'div',
      'min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6',
      h(
        'div',
        'flex flex-col gap-4',
        el('p', 'type-body', result.created.length === 0 ? 'No prompt was added.' : `${count(result.created.length, 'prompt')} added.`),
        result.restored === 0 ? null : el('p', 'type-body', `${result.restored === 1 ? '1 archived prompt was' : `${formatInteger(result.restored)} archived prompts were`} brought back.`),
        result.tracked.length === 0 ? null : section(`${formatInteger(result.tracked.length)} already tracked`, result.tracked),
        result.archived.length === 0 ? null : section(`${formatInteger(result.archived.length)} archived and left archived`, result.archived),
      ),
    );
    const heading2 = h('div', 'shrink-0 px-6 pt-6 pb-4 flex items-start gap-4', h('div', 'flex min-w-0 flex-1 flex-col gap-1', el('h2', 'type-section-title', 'Result of the add')), button('ml-auto size-control-sm shrink-0 rounded-md flex items-center justify-center text-foreground-tertiary hover:bg-surface-hover hover:text-foreground', icon('x', 'size-icon-md'), () => closeAdd(), { 'aria-label': 'Close', 'data-tip': 'Close (Esc)' }));
    const resultFooter = h(
      'div',
      'flex shrink-0 items-center gap-2 border-t border-transparent px-6 py-4',
      h(
        'div',
        'ml-auto flex items-center gap-2',
        notAdded === '' ? null : button(BUTTON_SECONDARY, 'Copy the lines not added', () => {
          navigator.clipboard?.writeText(notAdded).then(
            () => toast({ title: 'Lines copied' }),
            () => toast({ title: 'Could not copy', tone: 'info' }),
          );
        }),
        canAsk ? button(BUTTON_SECONDARY, 'Ask them now', () => {
          const ids = result.created;
          closeAdd();
          confirmAsk(ids, plan);
        }) : null,
        done,
      ),
    );
    resultView.replaceChildren(heading2, resultBody, resultFooter);
    formView.classList.remove('contents');
    formView.classList.add('hidden');
    resultView.classList.remove('hidden');
    resultView.classList.add('contents');
    done.focus();
  }

  // ---------------------------------------------------------------------------------------------

  /** Opens the dialog. From a topic, that topic is already chosen. */
  function open(from, topicName) {
    opener = from;
    if (topicName !== undefined || !draftKept) resetForm(topicName);
    draftKept = false;
    refresh();
    openModal(dialog);
    textarea.focus();
  }

  resetForm();
  return { open };
}
