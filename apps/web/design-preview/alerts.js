/* global document, window */
/**
 * Alerts mock: Settings > Alert rules (the rule list, the rule editor and the recent alerts) and the alert rows of the
 * notification popover. Version 1 sends alerts in the app only, after each run. Plan:
 * docs/superpowers/plans/2026-11-24-alerts.md. A reload starts from the fixtures.
 */
import { BUTTON, BUTTON_PRIMARY, BUTTON_SM, badge, button, icon, selectField, toast } from './perf-ui.js';
import { BUTTON_DANGER, INPUT, confirmDialog, field, fieldError } from './kw-dialog.js';
import { el } from './prompts-parts.js';
import { GROUPS, PLATFORMS, RULE_TYPES, SEVERITY, backtest, events, rules, typeOf, validate } from './alerts-data.js';

const PANEL = 'rounded-lg border border-border bg-surface overflow-x-auto';
const TH = 'border-b border-border bg-surface-subtle px-3 py-2 type-table-header text-foreground-tertiary font-normal text-left';
const TD = 'border-b border-border-subtle px-3 py-2 type-table text-foreground';

const section = () => document.querySelector('[data-settings-section="alert-rules"]');
const state = { editing: null };

const heading = (title, meta) => {
  const wrap = el('div');
  const h2 = el('h2', 'type-section-title', title);
  h2.id = 'set-alert-rules-title';
  wrap.append(h2, el('p', 'mt-1 type-meta', meta));
  return wrap;
};

const table = (labels, rows) => {
  const node = el('table', 'w-full border-collapse');
  const head = el('tr');
  labels.forEach((label) => {
    const th = el('th', TH, label);
    th.scope = 'col';
    head.append(th);
  });
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  body.append(...rows);
  node.append(thead, body);
  const panel = el('div', PANEL);
  panel.append(node);
  return panel;
};

function switchFor(rule) {
  const node = el('input', 'size-4 rounded-sm accent-primary');
  node.type = 'checkbox';
  node.checked = rule.active;
  node.setAttribute('aria-label', `${rule.name} is on`);
  node.addEventListener('change', () => {
    rule.active = node.checked;
    toast({ title: `${rule.name} is ${rule.active ? 'on' : 'off'}.` });
    render();
  });
  return node;
}

const scopeText = (rule) => [rule.group, typeOf(rule.type).area === 'AI' ? rule.platform : null].filter(Boolean).join(', ');
const unit = (rule) => (rule.type === 'rank_drop' ? ` by ${rule.positions} or more positions` : '');

// -------------------------------------------------------------------------------------------------
// Rule list and recent alerts

function ruleRow(rule) {
  const row = el('tr');
  const name = el('td', TD);
  const link = el('button', 'type-body-strong text-link hover:underline text-left', rule.name);
  link.type = 'button';
  link.addEventListener('click', () => {
    state.editing = { ...rule, isNew: false };
    render();
  });
  name.append(link, el('p', 'type-meta', `${typeOf(rule.type).label}${unit(rule)}`));
  const last = el('td', `${TD} text-right num`, String(rule.fired));
  const on = el('td', TD);
  on.append(switchFor(rule));
  row.append(name, el('td', `${TD} text-foreground-secondary`, scopeText(rule)), last, on);
  return row;
}

function eventRow(event) {
  const rule = rules.find((item) => item.id === event.rule);
  const [severityLabel, tone] = SEVERITY[event.severity];
  const row = el('tr');
  const severityCell = el('td', TD);
  severityCell.append(badge(severityLabel, tone));
  const what = el('td', TD);
  what.append(el('p', 'type-body-strong', event.subject), el('p', 'type-meta', event.detail));
  const state2 = el('td', TD);
  if (event.acknowledged) state2.append(el('span', 'type-meta', 'Acknowledged'));
  else
    state2.append(
      button('Acknowledge', {
        className: BUTTON_SM,
        onClick: () => {
          event.acknowledged = true;
          event.unread = false;
          render();
        },
      }),
    );
  row.append(el('td', `${TD} whitespace-nowrap`, event.when), what, el('td', TD, rule ? rule.name : ''), severityCell, state2);
  return row;
}

function renderList() {
  const add = button('Add alert rule', {
    className: BUTTON_PRIMARY,
    onClick: () => {
      state.editing = { id: `r${rules.length + 1}`, name: '', type: 'ai_mention_lost', group: GROUPS[0], platform: PLATFORMS[0], positions: 5, active: true, fired: 0, isNew: true };
      render();
    },
  });
  const top = el('div', 'flex items-start gap-3 flex-wrap');
  top.append(heading('Alert rules', 'An alert shows in the bell after a run finds a change. Each alert says what changed between two runs.'), el('span', 'ml-auto'));
  top.lastChild.append(add);
  const list = rules.length
    ? table(['Rule', 'Applies to', 'Alerts, last 30 days', 'On'], rules.map(ruleRow))
    : el('p', 'type-body text-foreground-secondary', 'No alert rules yet. Add one to hear about changes after each run.');
  const open = events.filter((event) => !event.acknowledged).length;
  const recent = el('div', 'flex flex-col gap-2');
  recent.append(
    el('h3', 'type-subsection-title', 'Recent alerts'),
    el('p', 'type-meta', `${open} to acknowledge. Alerts are kept for 90 days.`),
    events.length ? table(['When', 'What changed', 'Rule', 'Severity', ''], events.map(eventRow)) : el('p', 'type-body text-foreground-secondary', 'No alerts yet. The next run checks every rule.'),
  );
  section().replaceChildren(top, list, recent);
}

// -------------------------------------------------------------------------------------------------
// Rule editor (a full page in the real app: docs/design-system/16 section 1.1)

function renderEditor() {
  const draft = state.editing;
  const back = button('Back to alert rules', {
    className: `${BUTTON_SM} w-fit`,
    onClick: () => {
      state.editing = null;
      render();
    },
  });
  const name = el('input', INPUT);
  name.value = draft.name;
  name.maxLength = 80;
  name.placeholder = 'For example: Brand lost in event security';
  name.addEventListener('input', () => {
    draft.name = name.value;
  });
  const kind = selectField(
    RULE_TYPES.map((type) => [type.id, type.label]),
    draft.type,
    (value) => {
      draft.type = value;
      renderEditor();
    },
    'Alert me when',
  );
  const group = selectField(GROUPS.map((value) => [value, value]), draft.group, (value) => {
    draft.group = value;
    renderEditor();
  }, 'Group');
  const platform = selectField(PLATFORMS.map((value) => [value, value]), draft.platform, (value) => {
    draft.platform = value;
    renderEditor();
  }, 'Platform');
  const positions = el('input', `${INPUT} w-24 num`);
  positions.type = 'number';
  positions.min = '1';
  positions.max = '50';
  positions.value = String(draft.positions);
  positions.addEventListener('input', () => {
    draft.positions = Number(positions.value);
    preview.textContent = previewText();
  });
  const preview = el('p', 'type-body text-foreground-secondary');
  const previewText = () => `This rule would have fired ${backtest(draft)} times in the last 30 days.`;
  preview.textContent = previewText();
  const error = el('div');
  const save = button(draft.isNew ? 'Add rule' : 'Save changes', {
    className: BUTTON_PRIMARY,
    onClick: () => {
      const message = validate(draft);
      error.replaceChildren(...(message ? [fieldError(message)] : []));
      if (message) return;
      const { isNew, ...saved } = draft;
      if (isNew) rules.push(saved);
      else Object.assign(rules.find((rule) => rule.id === saved.id), saved);
      toast({ title: `${saved.name} saved.`, tone: 'success' });
      state.editing = null;
      render();
    },
  });
  const actions = el('div', 'flex items-center gap-2');
  actions.append(save, button('Cancel', { className: BUTTON, onClick: () => { state.editing = null; render(); } }));
  if (!draft.isNew)
    actions.append(
      button('Delete rule', {
        className: `${BUTTON_DANGER} ml-auto`,
        onClick: () =>
          confirmDialog({
            title: `Delete ${draft.name}?`,
            description: 'Its alerts are deleted too. This cannot be undone.',
            confirmLabel: 'Delete rule',
            danger: true,
            onConfirm: () => {
              rules.splice(rules.findIndex((rule) => rule.id === draft.id), 1);
              state.editing = null;
              render();
            },
          }),
      }),
    );
  const form = el('div', 'flex flex-col gap-4 max-w-form');
  form.append(
    field('Name', name),
    field('Alert me when', kind, { hint: typeOf(draft.type).text }),
    field('Group', group, { hint: 'Only prompts or keywords in this group count.' }),
  );
  if (typeOf(draft.type).area === 'AI') form.append(field('Platform', platform));
  else form.append(field('Drops by at least (positions)', positions, { hint: 'Compares one check with the one before it.' }));
  form.append(
    el('p', 'type-meta', 'Sent: in the app, after each run. Email and Slack come later.'),
    preview,
    error,
    actions,
  );
  section().replaceChildren(heading(draft.isNew ? 'Add alert rule' : draft.name || 'Alert rule', 'Alert rules'), back, form);
  section().querySelector('input')?.focus();
}

// -------------------------------------------------------------------------------------------------
// Notification popover rows

function renderBell() {
  const list = document.querySelector('#pop-notifications .overflow-y-auto');
  if (!list) return;
  const ICON = { info: ['info', 'text-info-text'], warning: ['triangle-alert', 'text-warning-text'], critical: ['triangle-alert', 'text-negative-text'] };
  list.replaceChildren(
    ...events.map((event) => {
      const row = el('a', 'flex gap-3 px-3 py-2 hover:bg-surface-hover');
      row.href = '#/settings/alert-rules';
      if (event.unread) row.setAttribute('data-unread', '');
      const [iconName, tone] = ICON[event.severity];
      row.append(el('span', `mt-1.5 size-1.5 shrink-0 ${event.unread ? 'rounded-full bg-primary' : ''}`));
      row.lastChild.setAttribute('aria-hidden', 'true');
      const text = el('span', 'min-w-0 flex flex-col');
      text.append(el('span', 'type-body-strong truncate', event.subject), el('span', 'type-meta', event.detail), el('span', 'type-meta', `${event.when}, ${event.run}`));
      row.append(icon(iconName, `mt-0.5 size-icon shrink-0 ${tone}`), text);
      return row;
    }),
  );
}

function render() {
  if (!section()) return;
  if (state.editing) renderEditor();
  else renderList();
  renderBell();
}

export function mountAlerts() {
  render();
  window.addEventListener('preview-route', (event) => {
    if (event.detail.view === 'settings' && event.detail.section === 'alert-rules') {
      state.editing = null;
      render();
    }
  });
}

mountAlerts();
