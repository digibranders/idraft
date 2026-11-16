/* global FileReader */
/**
 * Internal links dialogs: Tier rules (spec 5.2), Import tiers from CSV (5.3) and Crawl settings (7.8).
 * Each one changes the model in il-model.js and asks the page to draw again.
 */
import { BUTTON, button, checkRow, iconButton, toast } from './perf-ui.js';
import { INPUT, PRIMARY_DISABLED, confirmDialog, field, openDialog } from './kw-dialog.js';
import { el } from './prompts-parts.js';
import { crawlSettings, crawls, parseTierCsv, pages, plural, refresh, rulePreviewCount, rules, setTier, tierCode, tierLabel, tierOf, tiers } from './il-model.js';

const SELECT = `${INPUT} pr-8`;
const MATCH = [['exact', 'Path is'], ['prefix', 'Path starts with'], ['pattern', 'Path matches']];
const SCHEDULE = [['weekly', 'Weekly'], ['biweekly', 'Every two weeks'], ['monthly', 'Monthly'], ['off', 'Off']];

function select(options, value, label, onChange) {
  const node = el('select', SELECT);
  node.setAttribute('aria-label', label);
  options.forEach(([optionValue, text]) => {
    const option = el('option', '', text);
    option.value = optionValue;
    node.append(option);
  });
  node.value = value;
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

const tierOptions = () => [...tiers.map((tier) => [tier.id, tierLabel(tier.id)]), ['none', 'Untiered']];

// -------------------------------------------------------------------------------------------------
// Tier rules

export function openRules() {
  const original = JSON.stringify(rules);
  const draft = rules.map((rule) => ({ ...rule }));
  const errors = new Map();
  const dirty = () => JSON.stringify(draft) !== original;
  const frame = openDialog({
    title: 'Tier rules',
    description: 'Rules tag pages by URL. The first matching rule wins, and a tier set by hand always beats a rule.',
    width: 'lg',
    onCancel: () => {
      if (!dirty()) return true;
      confirmDialog({ title: 'Discard unsaved changes?', description: 'Your edits to the rules will be lost.', confirmLabel: 'Discard changes', danger: true, onConfirm: frame.close });
      return false;
    },
  });
  const list = el('ol', 'flex flex-col gap-3');
  const previewText = (rule) => (rule.value ? `Matches ${plural(rulePreviewCount(rule, draft), 'page')}` : 'Enter a path to see matches');

  const move = (index, delta) => {
    [draft[index], draft[index + delta]] = [draft[index + delta], draft[index]];
    draw();
  };
  const row = (rule, index) => {
    const item = el('li', 'flex flex-col gap-2 rounded-lg border border-border p-3');
    const line = el('div', 'flex flex-wrap items-start gap-2');
    const preview = el('span', 'type-meta text-foreground-secondary num', previewText(rule));
    const input = el('input', `${INPUT} min-w-40 flex-1`);
    input.placeholder = '/services/';
    input.value = rule.value;
    input.setAttribute('aria-label', `Rule ${index + 1} path`);
    input.addEventListener('input', () => {
      rule.value = input.value.trim();
      preview.textContent = previewText(rule);
      if (errors.delete(rule.id)) item.querySelector('[data-error]')?.remove();
    });
    const order = el('span', 'flex h-control w-6 shrink-0 items-center type-label text-foreground-tertiary num', String(index + 1));
    line.append(
      order,
      el('div', 'w-44 shrink-0', ''),
      input,
      el('div', 'w-52 shrink-0', ''),
    );
    line.children[1].append(select(MATCH, rule.match, `Rule ${index + 1} match type`, (value) => {
      rule.match = value;
      preview.textContent = previewText(rule);
    }));
    line.children[3].append(select(tierOptions(), rule.tier, `Rule ${index + 1} tier`, (value) => {
      rule.tier = value;
    }));
    const up = iconButton('chevron-up', `Move rule ${index + 1} up`, () => move(index, -1));
    up.disabled = index === 0;
    const down = iconButton('chevron-down', `Move rule ${index + 1} down`, () => move(index, 1));
    down.disabled = index === draft.length - 1;
    const remove = iconButton('trash-2', `Delete rule ${index + 1}`, () => {
      draft.splice(index, 1);
      errors.delete(rule.id);
      draw();
    });
    const actions = el('div', 'flex items-center gap-1');
    actions.append(up, down, remove);
    line.append(actions);
    item.append(line);
    const error = errors.get(rule.id);
    if (error) {
      const message = el('p', 'type-meta text-negative-text pl-8', error);
      message.dataset.error = '';
      message.setAttribute('role', 'alert');
      item.append(message);
    }
    item.append(el('div', 'pl-8', ''));
    item.lastChild.append(preview);
    return item;
  };
  function draw() {
    list.replaceChildren(...draft.map(row));
    if (draft.length === 0) list.append(el('li', 'rounded-lg border border-border-subtle bg-surface-subtle px-4 py-6 type-body text-foreground-secondary', 'No rules yet. Add a rule to tag pages by URL, for example everything under /services/.'));
  }
  const add = button('Add rule', { iconName: 'plus', onClick: () => {
    draft.push({ id: `r${Date.now()}`, match: 'prefix', value: '', tier: tiers[0]?.id ?? null });
    draw();
    list.lastElementChild.querySelector('input')?.focus();
  } });
  add.disabled = tiers.length === 0;
  frame.body.append(list, el('div', 'flex', ''));
  frame.body.lastChild.append(add);
  draw();

  const save = button('Save rules', { className: PRIMARY_DISABLED, onClick: () => {
    errors.clear();
    draft.forEach((rule) => {
      if (!rule.value) errors.set(rule.id, 'Enter a path.');
      else if (!rule.value.startsWith('/')) errors.set(rule.id, 'A path starts with /, for example /services/.');
    });
    if (errors.size > 0) {
      draw();
      list.querySelector('[data-error]')?.closest('li').querySelector('input')?.focus();
      return;
    }
    rules.splice(0, rules.length, ...draft);
    refresh();
    frame.close();
    const tagged = pages.filter((page) => tierOf(page).source === 'rule').length;
    toast({ title: 'Rules saved', description: `${plural(rules.length, 'rule')}, ${plural(tagged, 'page')} tagged by rule`, tone: 'success' });
  } });
  frame.footer.append(save, button('Cancel', { className: BUTTON, onClick: frame.dismiss }));
}

// -------------------------------------------------------------------------------------------------
// Import tiers from CSV

export function openImportTiers() {
  const frame = openDialog({ title: 'Import tiers from CSV', description: 'One page on each line: the URL, then the tier code or name. Pages you list get a tier set by hand.', width: 'md' });
  const text = el('textarea', `${INPUT} h-auto min-h-40 py-2 resize-y`);
  text.rows = 8;
  text.placeholder = 'url,tier\nhttps://eventussecurity.com/services/vapt,T1\n/blog/vapt-checklist,Content pages';
  text.setAttribute('aria-label', 'CSV text');
  const file = el('input', 'type-body text-foreground-secondary');
  file.type = 'file';
  file.accept = '.csv';
  file.setAttribute('aria-label', 'Choose a CSV file');
  const result = el('div', 'flex flex-col gap-2');
  result.setAttribute('aria-live', 'polite');
  let checked = null;
  const apply = button('Apply tiers', { className: PRIMARY_DISABLED });
  apply.disabled = true;
  const reset = () => {
    checked = null;
    apply.disabled = true;
    apply.querySelector('span').textContent = 'Apply tiers';
    result.replaceChildren();
  };
  text.addEventListener('input', reset);
  file.addEventListener('change', () => {
    const [chosen] = file.files;
    if (!chosen) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      text.value = String(reader.result);
      reset();
    });
    reader.readAsText(chosen);
  });
  const check = button('Check', { onClick: () => {
    checked = parseTierCsv(text.value);
    result.replaceChildren();
    const { accepted, pending, errors } = checked;
    if (accepted.length + pending.length + errors.length === 0) {
      result.append(el('p', 'type-body text-foreground-secondary', 'Nothing to import. Add one URL and tier on each line.'));
    }
    if (accepted.length > 0) result.append(el('p', 'type-body text-foreground num', `${plural(accepted.length, 'page')} will get a tier`));
    if (pending.length > 0) result.append(el('p', 'type-body text-foreground-secondary num', `${plural(pending.length, 'URL')} not in the latest crawl yet; they will be tagged when a crawl finds them`));
    if (errors.length > 0) {
      const box = el('div', 'rounded-md bg-negative-subtle px-3 py-2 flex flex-col gap-1');
      box.append(el('p', 'type-label text-negative-text', `${plural(errors.length, 'line')} to fix`));
      errors.forEach((message) => box.append(el('p', 'type-meta text-negative-text', message)));
      result.append(box);
    }
    apply.disabled = accepted.length === 0 || errors.length > 0;
    apply.querySelector('span').textContent = accepted.length > 0 ? `Apply ${plural(accepted.length, 'tier')}` : 'Apply tiers';
  } });
  apply.addEventListener('click', () => {
    if (!checked || checked.accepted.length === 0 || checked.errors.length > 0) return;
    const byTier = new Map();
    checked.accepted.forEach(({ id, tier }) => byTier.set(tier, [...(byTier.get(tier) ?? []), id]));
    byTier.forEach((ids, tier) => setTier(ids, tier));
    refresh();
    frame.close();
    toast({ title: 'Tiers imported', description: `${plural(checked.accepted.length, 'page')} tagged${byTier.size > 1 ? ` across ${plural(byTier.size, 'tier')}` : ` as ${tierCode([...byTier.keys()][0])}`}`, tone: 'success' });
  });
  const tools = el('div', 'flex flex-wrap items-center gap-3');
  tools.append(file, check);
  frame.body.append(field('Tiers as CSV', text), tools, result);
  frame.footer.append(apply, button('Cancel', { className: BUTTON, onClick: frame.dismiss }));
}

// -------------------------------------------------------------------------------------------------
// Crawl settings

export function openCrawlSettings() {
  const frame = openDialog({ title: 'Crawl settings', description: 'How often the website is crawled and what the crawl covers.', width: 'md' });
  const draft = { ...crawlSettings };
  const schedule = select(SCHEDULE, draft.schedule, 'Schedule', (value) => {
    draft.schedule = value;
  });
  const subdomains = el('input', INPUT);
  subdomains.value = draft.subdomains;
  subdomains.placeholder = 'blog.eventussecurity.com';
  subdomains.autocomplete = 'off';
  subdomains.addEventListener('input', () => {
    draft.subdomains = subdomains.value;
  });
  const recent = el('table', 'w-full border-collapse');
  const head = el('tr');
  [['When', 'text-left'], ['Trigger', 'text-left'], ['Pages', 'text-right'], ['Cost', 'text-right']].forEach(([label, align]) => {
    const th = el('th', `border-b border-border bg-surface-subtle px-3 py-2 type-table-header text-foreground-tertiary font-normal ${align}`, label);
    th.scope = 'col';
    head.append(th);
  });
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  crawls.forEach((crawl) => {
    const row = el('tr');
    ['', ' text-foreground-secondary', ' num text-right', ' num text-right'].forEach((extra, index) => {
      const value = [crawl.when, crawl.trigger, crawl.pages.toLocaleString('en-US'), `$${crawl.cost.toFixed(3)} est.`][index];
      row.append(el('td', `border-b border-border-subtle px-3 py-2 type-table text-foreground${extra}`, value));
    });
    body.append(row);
  });
  recent.append(thead, body);
  const panel = el('div', 'overflow-x-auto rounded-lg border border-border bg-surface');
  panel.append(recent);
  frame.body.append(
    field('Schedule', schedule, { hint: "Runs at night in the project's time zone" }),
    checkRow('Render JavaScript', draft.renderJs, (on) => {
      draft.renderJs = on;
    }),
    el('p', 'type-meta text-foreground-tertiary -mt-2 pl-2', 'For sites that build their pages in the browser. Costs 10 times as much per page.'),
    field('Allowed subdomains', subdomains, { hint: 'Comma separated, for example blog.eventussecurity.com. Leave empty to crawl only eventussecurity.com.' }),
    checkRow('Map internal links when a website is added', draft.mapOnAdd, (on) => {
      draft.mapOnAdd = on;
    }),
    el('h3', 'type-subsection-title pt-2', 'Recent crawls'),
    panel,
  );
  frame.footer.append(
    button('Save settings', { className: PRIMARY_DISABLED, onClick: () => {
      Object.assign(crawlSettings, { ...draft, subdomains: draft.subdomains.trim() });
      refresh();
      frame.close();
      toast({ title: 'Crawl settings saved', tone: 'success' });
    } }),
    button('Cancel', { className: BUTTON, onClick: frame.dismiss }),
  );
}
