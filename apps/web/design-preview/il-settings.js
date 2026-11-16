/* global document, window, location */
/**
 * Settings sections of Internal links: Workspace settings > Page tiers (spec 5.1, 7.7) and project settings >
 * Internal links (spec 7.8). They fill two empty sections of the Settings view in index.html and draw again each time
 * Settings opens, so counts are fresh after tier changes. Every change applies at once.
 */
import { BUTTON_SM, BUTTON_PRIMARY, button, checkRow, toast } from './perf-ui.js';
import { BUTTON_DANGER, INPUT, confirmDialog, field, fieldError, openDialog } from './kw-dialog.js';
import { el } from './prompts-parts.js';
import { ALERT_CHANNELS, ALERT_IMPORTANT, ALERT_THRESHOLD_ERROR, validThreshold } from './il-dialogs.js';
import { crawlSettings, crawls, deleteTier, pagesInTier, plural, refresh, rules, state, tierBadge, tierCode, tierLabel, tiers } from './il-model.js';

const MAX_TIERS = 8;
const SELECT = `${INPUT} pr-8`;
const SCHEDULE = [['weekly', 'Weekly'], ['biweekly', 'Every two weeks'], ['monthly', 'Monthly'], ['off', 'Off']];
const PANEL = 'rounded-lg border border-border bg-surface overflow-x-auto';
const TH = 'border-b border-border bg-surface-subtle px-3 py-2 type-table-header text-foreground-tertiary font-normal';
const TD = 'border-b border-border-subtle px-3 py-2 type-table text-foreground';

const section = (name) => document.querySelector(`[data-settings-section="${name}"]`);
const heading = (id, title, meta) => {
  const wrap = el('div');
  const h2 = el('h2', 'type-section-title', title);
  h2.id = id;
  wrap.append(h2, el('p', 'mt-1 type-meta', meta));
  return wrap;
};
const headCell = (label, align = 'text-left') => {
  const th = el('th', `${TH} ${align}`, label);
  th.scope = 'col';
  return th;
};
const table = (labels, rows) => {
  const node = el('table', 'w-full border-collapse');
  const tr = el('tr');
  labels.forEach(([label, align]) => tr.append(headCell(label, align)));
  const head = el('thead');
  head.append(tr);
  const body = el('tbody');
  body.append(...rows);
  node.append(head, body);
  const panel = el('div', PANEL);
  panel.append(node);
  return panel;
};

// -------------------------------------------------------------------------------------------------
// Page tiers

function openRename(tier) {
  const frame = openDialog({ title: 'Rename tier', description: `${tierCode(tier.id)} keeps its code. The name and description show wherever a tier is chosen.`, width: 'sm' });
  const name = el('input', INPUT);
  name.value = tier.name;
  name.maxLength = 80;
  name.autocomplete = 'off';
  const description = el('textarea', `${INPUT} h-auto min-h-20 py-2 resize-y`);
  description.value = tier.description;
  description.rows = 3;
  const nameSlot = el('div');
  const descSlot = el('div');
  const draw = (errors = {}) => {
    nameSlot.replaceChildren(field('Name', name, { hint: '1 to 60 characters', error: errors.name }));
    descSlot.replaceChildren(field('Description', description, { hint: 'Up to 200 characters', error: errors.description }));
  };
  draw();
  frame.body.append(nameSlot, descSlot);
  frame.footer.append(
    button('Save', { className: BUTTON_PRIMARY, onClick: () => {
      const errors = {};
      const trimmed = name.value.trim();
      if (trimmed.length < 1 || trimmed.length > 60) errors.name = 'Use 1 to 60 characters.';
      if (description.value.trim().length > 200) errors.description = 'Use 200 characters or fewer.';
      if (errors.name || errors.description) {
        draw(errors);
        (errors.name ? name : description).focus();
        return;
      }
      tier.name = trimmed;
      tier.description = description.value.trim();
      frame.close();
      renderTiers();
      refresh();
      toast({ title: 'Tier saved', description: tierLabel(tier.id), tone: 'success' });
    } }),
    button('Cancel', { onClick: frame.dismiss }),
  );
  name.focus();
}

function removeTier(tier) {
  const pagesUsing = pagesInTier(tier.id);
  const rulesUsing = rules.filter((rule) => rule.tier === tier.id).length;
  const label = tierLabel(tier.id);
  const done = () => {
    // A filter or a Links pair that named the deleted tier would match nothing
    state.filters = state.filters.filter((filter) => !(filter.field === 'tier' && filter.value === tier.id));
    const { pair } = state.links;
    if (pair && (pair.from === tier.id || pair.to === tier.id)) state.links.pair = null;
    renderTiers();
    refresh();
    toast({ title: 'Tier deleted', description: label, tone: 'success' });
  };
  if (pagesUsing === 0 && rulesUsing === 0) {
    confirmDialog({ title: `Delete ${tierCode(tier.id)}?`, description: `${label} has no pages and no rules.`, confirmLabel: `Delete ${tierCode(tier.id)}`, danger: true, onConfirm: () => {
      deleteTier(tier.id, null);
      done();
    } });
    return;
  }
  const code = tierCode(tier.id);
  const later = tiers[tiers.indexOf(tier) + 1];
  const frame = openDialog({ title: `Delete ${code}?`, description: `${plural(pagesUsing, 'page')} and ${plural(rulesUsing, 'rule')} use ${label}. Move them to:`, width: 'sm' });
  const target = el('select', SELECT);
  target.setAttribute('aria-label', 'Move pages and rules to');
  [...tiers.filter((other) => other !== tier).map((other) => [other.id, tierLabel(other.id)]), ['', 'Untiered']].forEach(([value, text]) => {
    const option = el('option', '', text);
    option.value = value;
    target.append(option);
  });
  frame.body.append(target);
  if (later) frame.body.append(el('p', 'type-meta text-foreground-secondary', `Codes close up: ${tierCode(later.id)} becomes ${code}.`));
  frame.footer.append(
    button(`Delete ${code}`, { className: BUTTON_DANGER, onClick: () => {
      deleteTier(tier.id, target.value || null);
      frame.close();
      done();
    } }),
    button('Cancel', { onClick: frame.dismiss }),
  );
}

function tierRow(tier) {
  const row = el('tr');
  const badge = el('td', TD);
  badge.append(tierBadge(tier.id));
  const actions = el('td', `${TD} text-right`);
  const group = el('div', 'flex items-center justify-end gap-2');
  const rename = button('Rename', { className: BUTTON_SM, onClick: () => openRename(tier) });
  rename.setAttribute('aria-label', `Rename ${tierLabel(tier.id)}`);
  const remove = button('Delete', { className: BUTTON_SM, onClick: () => removeTier(tier) });
  remove.setAttribute('aria-label', `Delete ${tierLabel(tier.id)}`);
  group.append(rename, remove);
  actions.append(group);
  row.append(
    badge,
    el('td', `${TD} whitespace-nowrap`, tier.name),
    el('td', `${TD} text-foreground-secondary`, tier.description || 'No description'),
    el('td', `${TD} text-right num`, pagesInTier(tier.id).toLocaleString('en-US')),
    actions,
  );
  return row;
}

function untieredRow() {
  const row = el('tr');
  const badge = el('td', TD);
  badge.append(tierBadge(null));
  row.append(
    badge,
    el('td', `${TD} whitespace-nowrap`, 'Untiered'),
    el('td', `${TD} text-foreground-secondary`, 'Pages with no tier set and no matching rule'),
    el('td', `${TD} text-right num`, pagesInTier(null).toLocaleString('en-US')),
    el('td', `${TD} text-right type-meta text-foreground-tertiary`, 'Always there'),
  );
  return row;
}

function renderTiers() {
  const host = section('page-tiers');
  if (!host) return;
  const full = tiers.length >= MAX_TIERS;
  const add = button('Add tier', { iconName: 'plus', onClick: () => {
    const tier = { id: `tier-${Date.now()}`, name: 'New tier', description: '' };
    tiers.push(tier);
    renderTiers();
    refresh();
    openRename(tier);
  } });
  add.disabled = full;
  if (full) add.title = `A workspace can have up to ${MAX_TIERS} tiers`;
  const bar = el('div', 'flex flex-wrap items-center gap-3');
  bar.append(add, el('p', 'type-meta', 'Changes apply as soon as you make them.'));
  host.replaceChildren(
    heading('set-page-tiers-title', 'Page tiers', 'Every project in this workspace uses these tiers. T1 is the most important. Names and descriptions show wherever a tier is chosen.'),
    table([['Tier'], ['Name'], ['Description'], ['Pages', 'text-right'], ['', 'text-right']], [...tiers.map(tierRow), untieredRow()]),
    bar,
  );
  host.querySelector('thead tr').lastChild.innerHTML = '<span class="sr-only">Actions</span>';
}

// -------------------------------------------------------------------------------------------------
// Internal links (project settings)

const fieldWrap = (control, label, hint) => {
  const wrap = el('div', 'flex flex-col gap-1.5 max-w-90');
  const id = `set-il-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  control.id = id;
  const labelNode = el('label', 'type-label', label);
  labelNode.htmlFor = id;
  wrap.append(labelNode, control);
  if (hint) wrap.append(el('p', 'type-meta', hint));
  return wrap;
};
const saved = () => toast({ title: 'Saved', tone: 'success' });

function renderInternalLinks() {
  const host = section('internal-links');
  if (!host) return;
  const schedule = el('select', SELECT);
  SCHEDULE.forEach(([value, text]) => {
    const option = el('option', '', text);
    option.value = value;
    schedule.append(option);
  });
  schedule.value = crawlSettings.schedule;
  schedule.addEventListener('change', () => {
    crawlSettings.schedule = schedule.value;
    saved();
  });
  const subdomains = el('input', INPUT);
  subdomains.value = crawlSettings.subdomains;
  subdomains.placeholder = 'blog.eventussecurity.com';
  subdomains.autocomplete = 'off';
  subdomains.addEventListener('change', () => {
    crawlSettings.subdomains = subdomains.value.trim();
    saved();
  });
  const toggles = el('div', 'flex flex-col max-w-90');
  toggles.append(
    checkRow('Render JavaScript', crawlSettings.renderJs, (on) => {
      crawlSettings.renderJs = on;
      saved();
    }),
    el('p', 'type-meta pl-8 pb-2', 'For sites that build their pages in the browser. Costs 10 times as much per page.'),
    checkRow('Map internal links when a website is added', crawlSettings.mapOnAdd, (on) => {
      crawlSettings.mapOnAdd = on;
      saved();
    }),
  );
  const alerts = crawlSettings.alerts;
  const optionSelect = (options, value, apply) => {
    const node = el('select', SELECT);
    options.forEach(([optionValue, text]) => {
      const option = el('option', '', text);
      option.value = optionValue;
      node.append(option);
    });
    node.value = value;
    node.addEventListener('change', () => {
      apply(node.value);
      saved();
    });
    return node;
  };
  const importance = optionSelect(ALERT_IMPORTANT, String(alerts.maxPosition), (value) => {
    alerts.maxPosition = Number(value);
  });
  const channel = optionSelect(ALERT_CHANNELS, alerts.channel, (value) => {
    alerts.channel = value;
  });
  const threshold = el('input', INPUT);
  threshold.type = 'number';
  threshold.min = '1';
  threshold.max = '50';
  threshold.step = '1';
  threshold.value = String(alerts.threshold);
  const thresholdWrap = fieldWrap(threshold, 'Alert when at least N links are lost', 'From 1 to 50');
  threshold.addEventListener('change', () => {
    thresholdWrap.querySelector('[role="alert"]')?.remove();
    const valid = validThreshold(threshold.value);
    threshold.setAttribute('aria-invalid', String(!valid));
    if (!valid) {
      const message = fieldError(ALERT_THRESHOLD_ERROR);
      message.id = 'set-il-threshold-error';
      threshold.setAttribute('aria-describedby', message.id);
      thresholdWrap.append(message);
      return;
    }
    threshold.removeAttribute('aria-describedby');
    alerts.threshold = Number(threshold.value);
    saved();
  });
  const alertToggle = el('div', 'flex flex-col max-w-90');
  alertToggle.append(checkRow('Alert me when links to important pages are lost', alerts.lostTop, (on) => {
    alerts.lostTop = on;
    saved();
  }));
  const alertSection = el('div', 'flex flex-col gap-4');
  alertSection.append(el('h3', 'type-subsection-title', 'Alerts'), alertToggle, fieldWrap(importance, 'Important pages'), thresholdWrap, fieldWrap(channel, 'Send the alert'));
  const recent = el('div', 'flex flex-col gap-2');
  recent.append(
    el('h3', 'type-subsection-title', 'Recent crawls'),
    table(
      [['When'], ['Started by'], ['Pages', 'text-right'], ['Cost', 'text-right']],
      crawls.map((crawl) => {
        const row = el('tr');
        row.append(
          el('td', TD, crawl.when),
          el('td', `${TD} text-foreground-secondary`, crawl.trigger),
          el('td', `${TD} text-right num`, crawl.pages.toLocaleString('en-US')),
          el('td', `${TD} text-right num`, `$${crawl.cost.toFixed(3)} est.`),
        );
        return row;
      }),
    ),
  );
  const open = el('a', `${BUTTON_SM} w-fit`, 'Open Internal links');
  open.href = '#/internal-links';
  host.replaceChildren(
    heading('set-internal-links-title', 'Internal links', 'How this project\'s website is crawled to map the links between its pages. Changes apply as soon as you make them.'),
    fieldWrap(schedule, 'Schedule', "Runs at night in the project's time zone"),
    toggles,
    fieldWrap(subdomains, 'Allowed subdomains', 'Comma separated, for example blog.eventussecurity.com. Leave empty to crawl only eventussecurity.com.'),
    alertSection,
    recent,
    open,
  );
}

export function mountSettings() {
  renderTiers();
  renderInternalLinks();
  window.addEventListener('preview-route', (event) => {
    if (event.detail.view !== 'settings') return;
    if (event.detail.section === 'page-tiers') renderTiers();
    else if (event.detail.section === 'internal-links') renderInternalLinks();
  });
}
