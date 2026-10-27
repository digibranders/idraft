/* global document, setTimeout, URL */
/**
 * The "Add pages" dialog of Page Performance (docs/32-page-performance.md section 5.9): paste URLs, pick from
 * the pages Search Console shows most, or read a sitemap. Each pasted URL is checked first, so nothing is added
 * that Search Console cannot see, and a page that Google reports under two URL forms says so.
 */
import { formatInt } from './perf-calc.js';
import { GROUP_NAMES, HOST_NAME, SUGGESTED, addPages, listPages, probePath } from './perf-data.js';
import { BUTTON, BUTTON_PRIMARY, FIELD, badge, button, checkRow, iconButton, selectField } from './perf-ui.js';
import { el } from './prompts-parts.js';

export const WATCH_LIMIT = 200;

const SITEMAP_FOUND = [
  { path: '/features/forecasting', clicks28: 74, impressions28: 3100 },
  { path: '/features/reporting', clicks28: 52, impressions28: 2800 },
  { path: '/blog/crm-roi-calculator', clicks28: 131, impressions28: 7600 },
  { path: '/integrations/hubspot-import', clicks28: 66, impressions28: 2200 },
  { path: '/templates/crm-requirements-template', clicks28: 39, impressions28: 1900 },
];

/** Turns one pasted line into a result (docs/32 section 8, the `validate` route). */
export function checkLine(line, taken) {
  const text = line.trim();
  if (/\s/.test(text)) return { line: text, outcome: 'invalid_url' };
  let path = text;
  if (/^https?:\/\//i.test(text)) {
    let url;
    try {
      url = new URL(text);
    } catch {
      return { line: text, outcome: 'invalid_url' };
    }
    if (url.hostname.replace(/^www\./, '') !== HOST_NAME) return { line: text, outcome: 'wrong_host' };
    path = `${url.pathname}`;
  } else if (!text.startsWith('/')) path = `/${text}`;
  path = path.replace(/[?#].*$/, '') || '/';
  if (taken.has(path)) return { line: text, path, outcome: 'already_watched' };
  taken.add(path);
  return { line: text, path, outcome: 'ok', probe: probePath(path) };
}

const OUTCOME = {
  already_watched: ['Already watched', 'neutral'],
  wrong_host: [`Not on ${HOST_NAME}`, 'negative'],
  invalid_url: ['Not a valid URL', 'negative'],
  over_quota: [`Over the ${WATCH_LIMIT} page limit`, 'negative'],
};

function resultRow(result) {
  const row = el('li', 'min-h-9 py-1.5 flex flex-wrap items-center gap-2 border-t border-border-subtle first:border-t-0');
  row.append(el('span', 'type-body text-foreground truncate min-w-0 flex-1', result.path ?? result.line));
  if (result.outcome === 'ok') {
    const { found, forms, clicks28 } = result.probe;
    if (!found) row.append(badge('No search data yet', 'warning'), el('span', 'type-meta basis-full', 'Allowed. The page shows "No data" until Google reports impressions for it.'));
    else if (forms > 1) row.append(badge('Found in 2 URL forms', 'info'), el('span', 'type-meta basis-full', `${formatInt(clicks28)} clicks in 28 days. With and without a trailing slash: added together.`));
    else row.append(badge('Found', 'positive'), el('span', 'type-meta num', `${formatInt(clicks28)} clicks in 28 days`));
  } else row.append(badge(OUTCOME[result.outcome][0], OUTCOME[result.outcome][1]));
  return row;
}

/** @param {{onAdded: (outcomes: Array<{path:string, outcome:string, id?:number}>) => void}} options */
export function openAddDialog({ onAdded }) {
  const dialog = el('dialog', 'm-auto rounded-xl border border-border bg-surface text-foreground shadow-dialog p-0 w-full max-w-(--container-dialog-md) backdrop:bg-(--scrim)');
  dialog.setAttribute('aria-labelledby', 'perf-add-title');
  const shell = el('form', 'flex flex-col');
  shell.method = 'dialog';
  shell.style.maxHeight = '85dvh';
  dialog.append(shell);

  const head = el('header', 'px-4 py-3 border-b border-border flex items-center gap-3');
  const heading = el('h2', 'type-section-title flex-1', 'Add pages');
  heading.id = 'perf-add-title';
  head.append(heading, iconButton('x', 'Close', () => dialog.close()));

  let tab = 'paste';
  let checked = [];
  let ready = [];
  let sitemapRows = null;
  const picked = new Set();
  let group = '';

  const tabs = el('div', 'px-4 flex items-end gap-5 border-b border-border');
  tabs.setAttribute('role', 'tablist');
  const content = el('div', 'flex-1 min-h-0 overflow-auto px-4 py-4 flex flex-col gap-3');
  const foot = el('footer', 'px-4 py-3 border-t border-border flex items-center gap-2');
  const count = el('span', 'type-meta mr-auto');
  const cancel = button('Cancel', { className: BUTTON, onClick: () => dialog.close() });
  const add = el('button', `${BUTTON_PRIMARY} disabled:bg-surface-disabled disabled:text-foreground-disabled`, 'Add pages');
  add.type = 'button';
  foot.append(count, cancel, add);

  const watchedPaths = () => new Set(listPages().map((page) => page.path));
  const groupField = () => {
    const wrap = el('label', 'flex items-center gap-2 type-body');
    wrap.append(el('span', 'text-foreground-secondary', 'Group'), selectField([['', 'No group'], ...GROUP_NAMES.map((name) => [name, name])], group, (value) => (group = value), 'Group for the added pages'));
    return wrap;
  };

  function selection() {
    if (tab === 'paste') return ready.map((result) => ({ path: result.path, hint: result.probe.clicks28 ? { clicks28: result.probe.clicks28 } : undefined }));
    const source = tab === 'suggested' ? SUGGESTED : sitemapRows ?? [];
    return source.filter((item) => picked.has(item.path)).map((item) => ({ path: item.path, hint: item }));
  }

  function refreshFooter() {
    const entries = selection();
    const room = WATCH_LIMIT - listPages().length;
    count.textContent = `${listPages().length} of ${WATCH_LIMIT} pages watched`;
    add.textContent = entries.length === 1 ? 'Add 1 page' : `Add ${entries.length} pages`;
    add.disabled = entries.length === 0 || entries.length > room;
  }

  function drawPaste() {
    const label = el('label', 'flex flex-col gap-1');
    label.append(el('span', 'type-label', 'URLs'), el('span', 'type-meta', `One per line, up to 500. Paths or full URLs on ${HOST_NAME}.`));
    const area = el('textarea', 'h-40 px-2 py-2 rounded-md border border-border bg-surface text-foreground type-table placeholder:text-foreground-tertiary');
    area.setAttribute('aria-label', 'URLs to watch');
    area.placeholder = `/pricing\nhttps://${HOST_NAME}/features/lead-scoring\n/blog/crm-data-migration`;
    area.value = tab === 'paste' && checked.length > 0 ? checked.map((r) => r.line).join('\n') : '';
    label.append(area);
    const run = button('Check pages', { className: BUTTON, onClick: () => {
      const taken = watchedPaths();
      checked = area.value.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 500).map((line) => checkLine(line, taken));
      ready = checked.filter((result) => result.outcome === 'ok');
      const room = WATCH_LIMIT - listPages().length;
      ready.slice(room).forEach((result) => { result.outcome = 'over_quota'; });
      ready = ready.filter((result) => result.outcome === 'ok');
      draw();
    } });
    content.append(label, el('div', 'flex items-center gap-3'));
    content.lastElementChild.append(run, groupField());
    if (checked.length > 0) {
      const list = el('ul', 'flex flex-col rounded-md border border-border px-3');
      checked.forEach((result) => list.append(resultRow(result)));
      content.append(list);
    }
  }

  function candidateList(items, intro) {
    content.append(el('p', 'type-body text-foreground-secondary', intro));
    const watched = watchedPaths();
    const open = items.filter((item) => !watched.has(item.path));
    if (open.length === 0) content.append(el('p', 'type-body text-foreground', 'Every page found is already on the watchlist.'));
    const list = el('div', 'flex flex-col');
    open.forEach((item) => list.append(checkRow(item.path, picked.has(item.path), (on) => { if (on) picked.add(item.path); else picked.delete(item.path); refreshFooter(); }, { hint: `${formatInt(item.clicks28)} clicks, ${formatInt(item.impressions28)} impressions` })));
    content.append(list, groupField());
  }

  function drawSitemap() {
    const row = el('div', 'flex items-end gap-2');
    const field = el('label', 'flex flex-col gap-1 flex-1 min-w-0');
    field.append(el('span', 'type-label', 'Sitemap URL'));
    const input = el('input', `${FIELD} w-full`);
    input.type = 'url';
    input.value = `https://${HOST_NAME}/sitemap.xml`;
    input.setAttribute('aria-label', 'Sitemap URL');
    field.append(input);
    const fetchButton = button(sitemapRows ? 'Fetch again' : 'Fetch sitemap', { className: BUTTON });
    fetchButton.addEventListener('click', () => {
      fetchButton.disabled = true;
      fetchButton.textContent = 'Fetching...';
      setTimeout(() => {
        sitemapRows = SITEMAP_FOUND;
        draw();
      }, 700);
    });
    row.append(field, fetchButton);
    content.append(row);
    if (sitemapRows) candidateList(sitemapRows, `Found ${sitemapRows.length} pages with Search Console data that are not watched yet, out of 48 URLs in the sitemap.`);
    else content.append(el('p', 'type-meta', 'Only URLs on this property that Search Console already reports are offered, so every page you add has data.'));
  }

  function draw() {
    tabs.replaceChildren();
    [['paste', 'Paste URLs'], ['suggested', 'Suggested from Search Console'], ['sitemap', 'From a sitemap']].forEach(([value, text]) => {
      const node = el('button', `h-10 px-0.5 border-b-2 ${tab === value ? 'border-primary type-body-strong text-primary-text' : 'border-transparent type-body text-foreground-secondary hover:text-foreground'}`, text);
      node.type = 'button';
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-selected', String(tab === value));
      node.addEventListener('click', () => { tab = value; picked.clear(); draw(); });
      tabs.append(node);
    });
    content.replaceChildren();
    if (tab === 'paste') drawPaste();
    else if (tab === 'suggested') candidateList(SUGGESTED, 'The pages that got the most clicks in the last 28 days and are not watched yet.');
    else drawSitemap();
    refreshFooter();
  }

  add.addEventListener('click', () => {
    const outcomes = addPages(selection(), group || null);
    dialog.close();
    onAdded(outcomes);
  });
  dialog.addEventListener('close', () => dialog.remove());
  shell.append(head, tabs, content, foot);
  document.body.append(dialog);
  draw();
  dialog.showModal();
  dialog.querySelector('textarea, input, button')?.focus();
}
