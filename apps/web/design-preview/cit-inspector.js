/* global window, navigator */
/**
 * The two drawers of the Citations page, in the right inspector (440 px, inspect=cited-page:<url> and
 * inspect=gap-prompt:<id>). Their tab lists and empty panels are in index.html, because interactions.js wires inspector
 * tabs once at load.
 *
 * - Cited page: which prompts cite the page, on which platforms (Prompts), and its trend, platforms and the domains
 *   cited beside it (Overview). A prompt opens the prompt inspector with its answers.
 * - Gap prompt: who is cited for the prompt, the competitor pages that win it, your closest page and the third-party
 *   pages in its answers (Gap), and the same per platform (By platform).
 *
 * Both read the scope of the page behind them, so their numbers match the table, and fill again when it changes.
 */
import { formatInteger, formatPercent, formatSignedInteger } from './vendor/format/number.js';
import { OWN_NAME, RUN_DAYS, gapRows, pageDetail, pageOf, pageRows, promptDetail, trackedOf } from './cit-data.js';
import { PLATFORMS, groupOf } from './aiov-data.js';
import { NEUTRAL_BADGE, cardFrame, el, emptyBody, engineName, icon, plural, sparkline } from './aiov-parts.js';

const ui = window.PreviewUI;
const inspector = ui.$('#inspector');
const panel = (name) => ui.$(`[data-panel="${name}"]`, inspector);
const platformName = (code) => PLATFORMS.find((platform) => platform.code === code).name;
const pct0 = (ratio) => formatPercent(ratio, { decimals: 0 });

let page = null;

const dot = (token) => {
  const mark = el('span', 'size-2 shrink-0 rounded-full');
  mark.style.background = `var(--${token})`;
  mark.setAttribute('aria-hidden', 'true');
  return mark;
};
const tokenOf = (pageInfo) => (pageInfo.owner === 'own' ? 'chart-1' : pageInfo.owner === 'competitor' ? trackedOf(pageInfo.brand.toLowerCase())?.token ?? 'chart-other' : 'chart-other');
const ownerText = (pageInfo) => (pageInfo.owner === 'own' ? 'Your page' : pageInfo.owner === 'competitor' ? pageInfo.brand : 'Third-party');

function scopeParts() {
  const scope = page.scope();
  return [engineName(scope.platform), groupOf(scope.group).label, scope.runs === 1 ? 'Last run' : `Last ${scope.runs} runs`];
}

function header({ title, badges, context }) {
  ui.$('#inspector-title').textContent = title;
  ui.$('[data-inspector-badges]', inspector).replaceChildren(...badges, ...scopeParts().map((part) => ui.badge(part)));
  ui.$('[data-inspector-context]', inspector).textContent = context;
}

/** A small table of the inspector (Compact rows, 12 section 6). */
function table(heads, rows) {
  const node = el('table', 'w-full table-fixed type-table');
  const head = el('thead');
  const headRow = el('tr', 'border-t border-border-subtle bg-surface-subtle h-row-compact');
  heads.forEach(({ label, className = '', node: content }) => {
    const th = el('th', `px-2 first:pl-4 last:pr-4 text-left font-normal type-label whitespace-nowrap ${className}`);
    th.scope = 'col';
    if (content) th.append(content);
    else th.textContent = label;
    headRow.append(th);
  });
  head.append(headRow);
  const body = el('tbody');
  body.append(...rows);
  node.append(head, body);
  return node;
}

/** Opens the prompt inspector on a prompt, with the list the person sees for J and K. */
function openPrompt(id, ids) {
  window.PreviewPrompts?.openPrompt(id, undefined, ids);
}

// -------------------------------------------------------------------------------------------------
// Cited page

function fillPage(url) {
  const scope = page.scope();
  const row = pageRows(scope).find((entry) => entry.id === url);
  const detail = pageDetail(url, scope);
  const info = pageOf(url);
  const order = page.order.page();
  const at = order.indexOf(url);
  const ownerBadge = el('span', `${NEUTRAL_BADGE} gap-1.5`);
  ownerBadge.append(dot(tokenOf(info)), ownerText(info));
  header({ title: info.title, badges: [ownerBadge], context: `Cited page${at >= 0 ? ` · ${at + 1} of ${order.length}` : ''} · ${plural(row.citations, 'citation')}` });

  // Prompts: every prompt that cites the page, with its answers per platform
  const codes = scope.platform === 'all' ? PLATFORMS.map((platform) => platform.code) : [scope.platform];
  const ids = detail.prompts.map((entry) => entry.prompt.id);
  const rows = detail.prompts.map((entry) => {
    const tr = el('tr', 'h-row-compact border-t border-border-subtle hover:bg-surface-hover');
    const name = el('td', 'pl-4 pr-2 min-w-0');
    const button = el('button', 'w-full min-w-0 text-left truncate text-foreground rounded-sm hover:underline focus-visible:focus-ring', entry.prompt.text);
    button.type = 'button';
    button.dataset.tip = `${entry.prompt.text}. Open its answers`;
    button.addEventListener('click', () => openPrompt(entry.prompt.id, ids));
    name.append(button);
    // The platforms that cite it, the others faded; the counts per platform are in the tooltip, so the prompt keeps its width
    const platforms = el('td', 'px-2');
    const logos = el('span', 'flex items-center gap-1');
    codes.forEach((code) => {
      const cell = entry.engines[code] ?? { k: 0, n: 0 };
      const logo = ui.engineLogo(platformName(code));
      if (cell.k === 0) logo.classList.add('opacity-25');
      logos.append(logo);
    });
    platforms.dataset.tip = codes
      .map((code) => {
        const cell = entry.engines[code] ?? { k: 0, n: 0 };
        return cell.n === 0 ? `${platformName(code)}: no answers` : `${platformName(code)}: ${cell.k} of ${cell.n} answers`;
      })
      .join('. ');
    platforms.append(logos);
    const cited = el('td', 'px-2 pr-4 num text-right whitespace-nowrap');
    cited.append(el('span', 'text-foreground', formatInteger(entry.cited)), el('span', 'text-foreground-tertiary', `/${entry.answers}`));
    cited.dataset.tip = `Cited in ${entry.cited} of the prompt’s ${plural(entry.answers, 'answer')}`;
    tr.append(name, platforms, cited);
    return tr;
  });
  const heads = [{ label: 'Prompt' }, { label: 'Platforms', className: codes.length > 1 ? 'w-24' : 'w-20' }, { label: 'Cited', className: 'w-20 text-right' }];
  panel('cit-page-prompts').replaceChildren(
    cardFrame({
      key: 'cit.page.prompts',
      title: 'Prompts that cite this page',
      meta: `${plural(detail.prompts.length, 'prompt')} · cited in ${plural(detail.citations, 'answer')}`,
      body: detail.prompts.length === 0 ? emptyBody('No prompt cites this page', 'Nothing in this scope. Choose more runs or another group.') : table(heads, rows),
      flush: true,
    }),
  );

  // Overview: the address, the trend, the platforms and what is cited beside it
  const summary = el('dl', 'grid grid-cols-3 gap-3');
  const kv = (label, value, extra) => {
    const item = el('div', 'flex min-w-0 flex-col');
    item.append(el('dt', 'type-label text-foreground-tertiary', label));
    const dd = el('dd', 'flex items-baseline gap-1.5 num type-body-strong text-foreground', value);
    if (extra) dd.append(extra);
    item.append(dd);
    return item;
  };
  summary.append(
    kv('Citations', formatInteger(row.citations), el('span', 'type-meta', formatSignedInteger(row.citations - row.previous))),
    kv('Prompts', formatInteger(row.promptCount)),
    kv('Last cited', row.lastCited ?? 'n/a'),
  );
  const address = el('div', 'mt-3 flex items-center gap-2 min-w-0 rounded-md border border-border-subtle bg-surface-subtle px-2 h-control-sm');
  address.append(icon('link', 'size-icon-sm shrink-0 text-foreground-tertiary'), el('span', 'min-w-0 flex-1 truncate type-body text-foreground', url));
  const copy = el('button', 'size-6 shrink-0 rounded-md flex items-center justify-center text-foreground-tertiary hover:bg-surface-hover hover:text-foreground focus-visible:focus-ring');
  copy.type = 'button';
  copy.dataset.tip = 'Copy address';
  copy.setAttribute('aria-label', 'Copy address');
  copy.append(icon('copy', 'size-icon-sm'));
  copy.addEventListener('click', () => {
    navigator.clipboard?.writeText(`https://${url}`).then(
      () => ui.toast({ title: 'Address copied', tone: 'success' }),
      () => ui.toast({ title: 'Could not copy the address', description: 'Copy it from the field instead.', tone: 'error' }),
    );
  });
  const open = el('button', 'size-6 shrink-0 rounded-md flex items-center justify-center text-foreground-tertiary hover:bg-surface-hover hover:text-foreground focus-visible:focus-ring');
  open.type = 'button';
  open.dataset.tip = 'Open the page';
  open.dataset.previewNote = 'Opening the cited page';
  open.setAttribute('aria-label', 'Open the page in a new tab');
  open.append(icon('external-link', 'size-icon-sm'));
  address.append(copy, open);

  const trend = el('div', 'flex flex-col gap-1');
  trend.append(sparkline(row.trend, { token: tokenOf(info), height: 56, label: `Citations per weekly run, oldest first: ${row.trend.join(', ')}` }));
  const axis = el('div', 'flex justify-between type-meta num');
  axis.append(el('span', '', 'Aug 10'), el('span', '', RUN_DAYS[3]));
  trend.append(axis);

  const platformRows = codes.map((code) => {
    const count = row.engines[code] ?? 0;
    const tr = el('tr', 'h-row-compact border-t border-border-subtle');
    const name = el('td', 'pl-4 pr-2');
    const label = el('span', 'inline-flex items-center gap-2');
    label.append(ui.engineLogo(platformName(code)), el('span', 'truncate', platformName(code)));
    name.append(label);
    tr.append(name, el('td', 'px-2 num text-right', formatInteger(count)), el('td', 'px-2 pr-4 num text-right text-foreground-secondary', row.citations > 0 ? pct0(count / row.citations) : 'n/a'));
    return tr;
  });

  const alongsideRows = detail.alongside.map((entry) => {
    const tr = el('tr', 'h-row-compact border-t border-border-subtle');
    const name = el('td', 'pl-4 pr-2 min-w-0');
    const label = el('span', 'flex items-center gap-2 min-w-0');
    label.append(dot(entry.owner === 'own' ? 'chart-1' : entry.owner === 'competitor' ? trackedOf(entry.brand.toLowerCase())?.token ?? 'chart-other' : 'chart-other'), el('span', 'truncate', entry.domain));
    if (entry.owner !== 'third') label.append(el('span', `${NEUTRAL_BADGE} shrink-0`, entry.owner === 'own' ? 'Your site' : 'Competitor'));
    name.append(label);
    const count = el('td', 'px-2 pr-4 num text-right text-foreground-secondary', `${entry.count} of ${detail.citations}`);
    count.dataset.tip = `Cited in ${entry.count} of the ${plural(detail.citations, 'answer')} that cite this page`;
    tr.append(name, count);
    return tr;
  });

  panel('cit-page-overview').replaceChildren(
    cardFrame({ key: 'cit.page.summary', title: 'Summary', meta: 'change against the runs before', body: [summary, address] }),
    cardFrame({ key: 'cit.page.trend', title: 'Citations per run', meta: 'last 8 weekly runs', body: trend }),
    cardFrame({ key: 'cit.page.platforms', title: 'By platform', meta: 'citations · share', body: table([{ label: 'Platform' }, { label: 'Citations', className: 'w-24 text-right' }, { label: 'Share', className: 'w-20 text-right' }], platformRows), flush: true }),
    cardFrame({
      key: 'cit.page.alongside',
      title: 'Cited alongside',
      meta: 'domains in the same answers',
      body: alongsideRows.length === 0 ? emptyBody('Cited alone', 'No other domain is cited in the answers that cite this page.') : table([{ label: 'Domain' }, { label: 'Answers', className: 'w-24 text-right' }], alongsideRows),
      flush: true,
    }),
  );
}

// -------------------------------------------------------------------------------------------------
// Gap prompt

function brandLabel(name, token) {
  const label = el('span', 'flex items-center gap-2 min-w-0');
  label.append(dot(token), el('span', 'truncate', name));
  return label;
}

/** A list of pages: address, owner dot, how often, on which platforms. */
function pageList(entries, { token, note }) {
  const list = el('ul', 'flex flex-col');
  entries.forEach((entry) => {
    const item = el('li', 'min-h-9 px-4 py-1.5 flex items-center gap-2 border-t border-border-subtle');
    item.append(dot(token(entry)));
    const text = el('span', 'min-w-0 flex-1 flex flex-col');
    text.append(el('span', 'truncate type-body text-foreground', entry.url));
    if (note) text.append(el('span', 'truncate type-meta', note(entry)));
    item.append(text);
    if (entry.codes) {
      const logos = el('span', 'flex shrink-0 items-center gap-1');
      [...entry.codes].forEach((code) => logos.append(ui.engineLogo(platformName(code))));
      logos.dataset.tip = `Cited on ${[...entry.codes].map(platformName).join(', ')}`;
      item.append(logos);
    }
    item.append(el('span', 'shrink-0 w-10 text-right type-meta num', `${entry.count}×`));
    list.append(item);
  });
  return list;
}

function fillGap(id) {
  const scope = page.scope();
  const row = gapRows(scope).find((entry) => entry.id === id);
  const detail = promptDetail(id, scope);
  const order = page.order.gap();
  const at = order.indexOf(id);
  const lost = row.gap > 0 ? `lost on ${row.lostOn.map(platformName).join(', ')}` : 'not lost on any platform';
  header({ title: row.prompt.text, badges: [ui.badge(row.prompt.topic)], context: `Prompt${at >= 0 ? ` · ${at + 1} of ${order.length}` : ''} · ${lost}` });
  const competitors = scope.competitors.map(trackedOf);

  // Who is cited: you and the selected competitors, over the platforms in scope
  const whoRows = [
    { name: OWN_NAME, token: 'chart-1', cell: row.you, own: true },
    ...competitors.map((competitor) => ({ name: competitor.name, token: competitor.token, cell: row.rivals[competitor.id], own: false })),
  ].map((entry) => {
    const tr = el('tr', 'h-row-compact border-t border-border-subtle');
    const name = el('td', 'pl-4 pr-2 min-w-0');
    name.append(brandLabel(entry.name, entry.token));
    const state = el('td', 'px-2');
    state.append(page.statePill(entry.cell, { own: entry.own, lost: entry.own ? row.gap : 0 }));
    const answers = el('td', 'px-2 pr-4 num text-right text-foreground-secondary', `${entry.cell.k} of ${entry.cell.n}`);
    answers.dataset.tip = `Cited in ${entry.cell.k} of ${plural(entry.cell.n, 'answer')}`;
    tr.append(name, state, answers);
    return tr;
  });

  const openAnswers = el('button', 'h-control-sm px-2 rounded-md border border-border bg-surface flex items-center gap-1.5 whitespace-nowrap type-body-strong text-foreground hover:bg-surface-hover focus-visible:focus-ring');
  openAnswers.type = 'button';
  openAnswers.append(icon('message-square', 'size-icon-sm'), el('span', '', 'Open answers'));
  openAnswers.addEventListener('click', () => openPrompt(id, order));

  const brandToken = (entry) => trackedOf(entry.id)?.token ?? 'chart-other';
  const closest = detail.ownHere.length > 0 ? detail.ownHere : detail.closest;
  const closestNote = detail.ownHere.length > 0 ? () => 'Cited in some answers to this prompt' : () => `Cited for other ${row.prompt.topic} prompts`;

  panel('cit-gap').replaceChildren(
    cardFrame({ key: 'cit.gap.who', title: 'Who is cited', meta: `${plural(detail.answers, 'answer')}`, tools: [openAnswers], body: table([{ label: 'Brand' }, { label: 'State', className: 'w-36' }, { label: 'Answers', className: 'w-20 text-right' }], whoRows), flush: true }),
    cardFrame({
      key: 'cit.gap.rivals',
      title: 'Pages competitors win with',
      meta: 'what to answer better',
      body:
        detail.rivalPages.length === 0
          ? emptyBody('No competitor page is cited', 'None of the selected competitors is cited for this prompt in this scope.')
          : pageList(detail.rivalPages, { token: brandToken, note: (entry) => entry.brand }),
      flush: true,
    }),
    cardFrame({
      key: 'cit.gap.closest',
      title: 'Your closest page',
      meta: 'update it before writing a new one',
      body:
        closest.length === 0
          ? emptyBody(`No page of yours is cited for ${row.prompt.topic}`, 'This prompt needs a page of its own. Start from the competitor pages above.')
          : pageList(closest, { token: () => 'chart-1', note: closestNote }),
      flush: true,
    }),
    cardFrame({
      key: 'cit.gap.third',
      title: 'Third-party pages in these answers',
      meta: 'where to be listed',
      body: detail.thirdPages.length === 0 ? emptyBody('No third-party page', 'The answers cite no third-party page.') : pageList(detail.thirdPages, { token: () => 'chart-other' }),
      flush: true,
    }),
  );

  // By platform: the same states, one row per platform, so a loss on one platform is visible
  const codes = Object.keys(row.you.perCode);
  const single = (cell, code) => ({ ...cell, platforms: 1, citedOn: cell.k > 0 ? 1 : 0, perCode: { [code]: cell } });
  const platformRows = codes.map((code) => {
    const tr = el('tr', 'h-row-compact border-t border-border-subtle');
    const name = el('td', 'pl-4 pr-2');
    const label = el('span', 'inline-flex items-center gap-2');
    label.append(ui.engineLogo(platformName(code)), el('span', 'truncate', platformName(code)));
    name.append(label);
    const you = el('td', 'px-2');
    you.append(page.statePill(single(row.you.perCode[code], code), { own: true, lost: row.lostOn.includes(code) ? 1 : 0 }));
    const rivals = competitors.map((competitor) => {
      const td = el('td', 'px-2');
      td.append(page.statePill(single(row.rivals[competitor.id].perCode[code], code), { own: false }));
      return td;
    });
    tr.append(name, you, ...rivals);
    return tr;
  });
  const wide = el('div', 'overflow-x-auto');
  const grid = table([{ label: 'Platform', className: 'w-32' }, { label: OWN_NAME, className: 'w-28' }, ...competitors.map((competitor) => ({ label: competitor.name, className: 'w-28' }))], platformRows);
  grid.classList.remove('w-full');
  grid.classList.add('min-w-full');
  wide.append(grid);
  panel('cit-gap-platforms').replaceChildren(cardFrame({ key: 'cit.gap.platforms', title: 'By platform', meta: 'answers that cite each brand', body: wide, flush: true }));
}

// -------------------------------------------------------------------------------------------------
// Registration and entry points

/** Opens the page drawer, on the Prompts tab unless another one is asked for. */
export function openCitedPage(url, opener, tab) {
  ui.openInspector(url, opener, 'cited-page');
  if (tab) ui.selectInspectorTab(tab);
}

export function openGapPrompt(id, opener) {
  ui.openInspector(id, opener, 'gap-prompt');
}

/** Fills an open drawer again after the page drew, so its numbers follow the scope. */
export function refreshCitationInspector() {
  const open = ui.inspectorState();
  if (!open.open) return;
  if (open.type === 'cited-page' && pageRows(page.scope()).some((row) => row.id === open.id)) fillPage(open.id);
  else if (open.type === 'gap-prompt' && gapRows(page.scope()).some((row) => row.id === open.id)) fillGap(open.id);
  else if (open.type === 'cited-page' || open.type === 'gap-prompt') ui.closeInspector(true);
}

export function initCitationInspector(options) {
  page = options;
  ui.registerInspectorType('cited-page', {
    noun: 'page',
    back: 'Citations',
    width: 440,
    defaultTab: 'cit-page-prompts',
    has: (url) => pageRows(page.scope()).some((row) => row.id === url),
    fill: fillPage,
    order: () => page.order.page(),
  });
  ui.registerInspectorType('gap-prompt', {
    noun: 'prompt',
    back: 'Citations',
    width: 440,
    defaultTab: 'cit-gap',
    has: (id) => gapRows(page.scope()).some((row) => row.id === id),
    fill: fillGap,
    order: () => page.order.gap(),
  });
}
