/* global FileReader */
/**
 * Internal links dialogs: Tier rules (spec 5.2), Import tiers from CSV (5.3) and Crawl settings (7.8).
 * Each one changes the model in il-model.js and asks the page to draw again.
 */
import { BUTTON, button, checkRow, icon, iconButton, toast } from './perf-ui.js';
import { INPUT, PRIMARY_DISABLED, confirmDialog, field, fieldError, openDialog } from './kw-dialog.js';
import { el } from './prompts-parts.js';
import { crawlSettings, crawls, parseTierCsv, pages, plural, refresh, rulePreviewPages, rules, setTier, state, tierCode, tierLabel, tierOf, tiers } from './il-model.js';

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
  const previewText = (rule) => (rule.value ? `Matches ${plural(rulePreviewPages(rule, draft).length, 'page')}` : 'Enter a path to see matches');
  const openLists = new Set();
  // Every row's count and path list depends on all the rules above it, so any change redraws them all
  let updaters = [];
  const updateAll = () => updaters.forEach((update) => update());

  const move = (index, delta) => {
    [draft[index], draft[index + delta]] = [draft[index + delta], draft[index]];
    draw();
  };
  const row = (rule, index) => {
    const item = el('li', 'flex flex-col gap-2 rounded-lg border border-border p-3');
    const line = el('div', 'flex flex-wrap items-start gap-2');
    const preview = el('button', 'self-start flex items-center gap-1 rounded-sm type-meta text-foreground-secondary num hover:text-foreground disabled:text-foreground-tertiary disabled:hover:text-foreground-tertiary');
    preview.type = 'button';
    const matches = el('ul', 'flex flex-col gap-0.5 pt-1');
    const update = () => {
      const matched = rulePreviewPages(rule, draft);
      const open = openLists.has(rule.id) && rule.value && matched.length > 0;
      preview.replaceChildren(el('span', '', previewText(rule)));
      preview.disabled = !rule.value || matched.length === 0;
      preview.setAttribute('aria-expanded', String(Boolean(open)));
      if (!preview.disabled) preview.append(icon(open ? 'chevron-down' : 'chevron-right', 'size-icon-xs'));
      matches.hidden = !open;
      matches.replaceChildren(...matched.slice(0, 8).map((page) => el('li', 'type-meta text-foreground truncate', page.path)));
      if (matched.length > 8) matches.append(el('li', 'type-meta text-foreground-tertiary', `and ${matched.length - 8} more`));
    };
    preview.addEventListener('click', () => {
      if (!openLists.delete(rule.id)) openLists.add(rule.id);
      update();
    });
    updaters.push(update);
    const input = el('input', `${INPUT} min-w-40 flex-1`);
    input.placeholder = '/services/';
    input.value = rule.value;
    input.setAttribute('aria-label', `Rule ${index + 1} path`);
    input.addEventListener('input', () => {
      rule.value = input.value.trim();
      updateAll();
      if (errors.delete(rule.id)) {
        item.querySelector('[data-error]')?.remove();
        input.removeAttribute('aria-describedby');
        input.removeAttribute('aria-invalid');
      }
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
      updateAll();
    }));
    line.children[3].append(select(tierOptions(), rule.tier, `Rule ${index + 1} tier`, (value) => {
      rule.tier = value;
      updateAll();
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
      const message = fieldError(error);
      message.classList.add('pl-8');
      message.dataset.error = '';
      message.id = `rule-error-${rule.id}`;
      input.setAttribute('aria-describedby', message.id);
      input.setAttribute('aria-invalid', 'true');
      item.append(message);
    }
    item.append(el('div', 'pl-8', ''));
    item.lastChild.append(preview, matches);
    update();
    return item;
  };
  function draw() {
    updaters = [];
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

// -------------------------------------------------------------------------------------------------
// Add website (spec 9: the first crawl starts when a website is added)

const DOMAIN = /^(https?:\/\/)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i;

export function openAddWebsite() {
  const frame = openDialog({ title: 'Add website', description: 'The site Internal links maps for this project.', width: 'sm' });
  const input = el('input', INPUT);
  input.type = 'text';
  input.placeholder = 'eventussecurity.com';
  input.autocomplete = 'off';
  input.required = true;
  let mapNow = true;
  const holder = el('div', 'flex flex-col gap-1');
  const errorId = 'add-website-error';
  const draw = (error) => {
    input.setAttribute('aria-invalid', String(Boolean(error)));
    holder.replaceChildren(field('Website', input));
    if (error) {
      const message = fieldError(error);
      message.id = errorId;
      input.setAttribute('aria-describedby', errorId);
      holder.append(message);
      input.focus();
    } else input.removeAttribute('aria-describedby');
  };
  draw();
  const submit = () => {
    const value = input.value.trim();
    if (!value) return draw('Enter the website address.');
    if (!DOMAIN.test(value)) return draw('Enter a domain such as eventussecurity.com.');
    frame.close();
    if (mapNow) {
      state.review = 'first';
      refresh();
      return;
    }
    state.review = 'ready';
    refresh();
    toast({ title: 'Website added', description: 'Internal links will map it on the next weekly crawl, or press Crawl now.', tone: 'success' });
  };
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  });
  frame.body.append(
    holder,
    checkRow("Map this site's internal links now", true, (on) => {
      mapNow = on;
    }),
    el('p', 'type-meta text-foreground-tertiary -mt-2 pl-2', 'Crawls the site in the background. About $0.15 per 1,000 pages.'),
  );
  frame.footer.append(button('Add website', { className: PRIMARY_DISABLED, onClick: submit }), button('Cancel', { className: BUTTON, onClick: frame.dismiss }));
  input.focus();
}
