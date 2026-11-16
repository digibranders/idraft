/* global document, window */
/**
 * Cells of the Prompts and Groups tables for the measures of prompts-extra.js, the list popover that two of them open
 * (brands and cited links), the answer screenshot dialog, and the Engine select of the page. Values come from
 * prompts-extra.js; the scope comes from prompts-state.js.
 */
import { formatDecimal, formatInteger, formatSampleCount } from './vendor/format/number.js';
import { ENGINES, engineOf } from './prompts-data.js';
import { INTENT_TIP, intentOf } from './prompts-extra.js';
import { CELL } from './prompts-cells.js';
import { NEUTRAL_BADGE, el, insufficient, percent0, plural } from './prompts-parts.js';
import { state } from './prompts-state.js';

const ui = window.PreviewUI;
const { $, icon, openPopup, closePopup, engineLogo } = ui;

// -------------------------------------------------------------------------------------------------
// Plain cells

const unknown = (text, tip) => {
  const cell = el('td', CELL);
  cell.append(el('span', 'text-foreground-tertiary', text));
  if (tip) cell.dataset.tip = tip;
  return cell;
};

export function textCell(text, tip) {
  const cell = el('td', `${CELL} whitespace-nowrap`, text);
  if (tip) cell.dataset.tip = tip;
  return cell;
}

export function intentCell(prompt) {
  const intent = intentOf(prompt);
  const cell = el('td', CELL);
  cell.append(el('span', NEUTRAL_BADGE, intent));
  cell.dataset.tip = INTENT_TIP[intent];
  return cell;
}

/** Search volume of a prompt (its linked keyword) or of a group (its linked keywords, each once). */
export function volumeCell({ value, keyword, keywords, prompts }) {
  if (value === null) return unknown('n/a', prompts === undefined ? 'No linked keyword. Volume is the monthly searches of the keyword a prompt is linked to.' : 'No prompt in this group has a linked keyword');
  const cell = el('td', CELL);
  cell.append(el('span', 'num', formatInteger(value)));
  cell.dataset.tip =
    prompts === undefined
      ? `Monthly searches of "${keyword}", the keyword this prompt is linked to. Sample values.`
      : `Monthly searches of ${plural(keywords, 'linked keyword')} across ${plural(prompts, 'prompt')}, each keyword counted once. Sample values.`;
  return cell;
}

export function positionCell({ value, lists, mentions }) {
  if (mentions === 0) return unknown('n/a', 'Your brand was not named, so there is no position');
  if (value === null) {
    const cell = el('td', CELL);
    cell.append(insufficient(`${plural(lists, 'list')}`));
    cell.dataset.tip = `Only answers that are an ordered list have a position, and a mean needs at least 3. ${plural(mentions, 'mention')}, ${plural(lists, 'ordered answer')}.`;
    return cell;
  }
  const cell = el('td', CELL);
  cell.append(el('span', 'num', formatDecimal(value, 1)));
  cell.dataset.tip = `Mean position over ${plural(lists, 'ordered answer')} of ${plural(mentions, 'mention')}. 1 means named first, so lower is better.`;
  return cell;
}

const SENTIMENT = [
  { key: 'positive', label: 'Positive', token: 'chart-positive' },
  { key: 'neutral', label: 'Neutral', token: 'chart-bar-neutral' },
  { key: 'negative', label: 'Negative', token: 'chart-negative' },
  { key: 'mixed', label: 'Mixed', token: 'chart-other' },
];

/** The share of positive mentions with the four shares as a bar. Never one score: the split is the value. */
export function sentimentCell(sentiment) {
  if (sentiment.state === 'none') return unknown('n/a', 'Sentiment is classified on ChatGPT and Gemini answers, and none of them is in view');
  const cell = el('td', CELL);
  if (sentiment.state === 'insufficient') {
    cell.append(insufficient(`${plural(sentiment.mentions, 'mention')}`));
    cell.dataset.tip = `${plural(sentiment.mentions, 'classified mention')}. The shares need at least 4.`;
    return cell;
  }
  const line = el('span', 'inline-flex items-center gap-2 whitespace-nowrap');
  const bar = el('span', 'flex h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-neutral-subtle');
  bar.setAttribute('aria-hidden', 'true');
  SENTIMENT.forEach(({ key, token }) => {
    if (sentiment[key] === 0) return;
    const part = el('span', 'h-full');
    part.style.width = `${(sentiment[key] / sentiment.mentions) * 100}%`;
    part.style.background = `var(--${token})`;
    bar.append(part);
  });
  line.append(el('span', 'num', `${percent0(sentiment.positive / sentiment.mentions)}`), el('span', 'type-label text-foreground-tertiary', 'positive'), bar);
  cell.append(line);
  const parts = SENTIMENT.map(({ key, label }) => `${label} ${percent0(sentiment[key] / sentiment.mentions)}`).join(', ');
  cell.dataset.tip = `${parts}, of ${plural(sentiment.mentions, 'classified mention')}. Four shares, never one score. Sample values until sentiment is collected.`;
  return cell;
}

// -------------------------------------------------------------------------------------------------
// The list popover: brands named, links cited

let panel = null;
function listPanel() {
  if (panel) return panel;
  panel = el('div', 'hidden fixed z-(--z-dropdown) w-88 max-w-[calc(100vw-1.5rem)] max-h-96 overflow-y-auto rounded-lg border border-border bg-surface-elevated shadow-popover');
  panel.setAttribute('role', 'dialog');
  panel.tabIndex = -1;
  document.body.append(panel);
  return panel;
}

/** One line of a list: the place, what it is, and its value. */
function listRow({ place, main, value, own = false }) {
  const row = el('li', `grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 min-h-control-sm px-2 py-1 rounded-md${own ? ' bg-primary-subtle' : ''}`);
  row.append(el('span', 'num type-meta text-foreground-tertiary', String(place)), main, value);
  return row;
}

function openList(trigger, { title, subtitle, rows, ownRow, note }) {
  const node = listPanel();
  node.setAttribute('aria-label', title);
  const list = el('ol', 'flex flex-col px-1 pb-1');
  list.append(...rows);
  const body = [el('div', 'px-3 pt-3 pb-2'), list];
  body[0].append(el('p', 'type-body-strong text-foreground', title), el('p', 'type-meta', subtitle));
  if (ownRow) {
    const own = el('ol', 'flex flex-col border-t border-border-subtle px-1 py-1');
    own.append(ownRow);
    body.push(own);
  }
  body.push(el('p', 'border-t border-border-subtle px-3 py-2 type-meta', note));
  node.replaceChildren(...body);
  openPopup(node, trigger, { align: 'start', focus: node });
}

function opener(trigger, build) {
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', () => {
    if (trigger.getAttribute('aria-expanded') === 'true') return closePopup();
    openList(trigger, build());
    return undefined;
  });
}

const LINK_BUTTON = 'flex min-w-0 max-w-full items-center gap-1.5 rounded-sm text-left type-body text-foreground hover:underline focus-visible:focus-ring';

/** Which engines a list rests on, as a sentence. */
const scopeSentence = (names, answers) => `${names.length === 1 ? `${names[0]} only` : `Equal-weight average of ${names.join(', ')}`} · ${plural(answers, 'answer')}`;

export function brandsCell(brands, label) {
  const cell = el('td', CELL);
  if (brands.shown.length === 0) {
    cell.append(el('span', 'text-foreground-tertiary', 'n/a'));
    cell.dataset.tip = 'Too few answers to list the brands they name';
    return cell;
  }
  const names = brands.shown.slice(0, 3).map((row) => row.name).join(', ');
  const more = brands.shown.length - 3;
  const button = el('button', LINK_BUTTON);
  button.type = 'button';
  button.setAttribute('aria-label', `Brands named in the answers for ${label}: ${plural(brands.total, 'brand')}. Open the list`);
  button.append(el('span', 'truncate', names), more > 0 ? el('span', 'shrink-0 type-label text-foreground-tertiary', `+${more}`) : '');
  opener(button, () => ({
    title: 'Brands named in answers',
    subtitle: `${label} · ${scopeSentence(brands.names, brands.answers)}`,
    rows: brands.shown.map((row) => brandRow(row, brands.names.length === 1)),
    ownRow: brands.own ? brandRow(brands.own, brands.names.length === 1) : null,
    note: 'The share of answers that name each brand. A brand marked Not tracked is not in your competitor set yet.',
  }));
  cell.append(button);
  return cell;
}

/**
 * One brand of the list. The rate is an equal-weight average when several engines are in view, so the pooled answer
 * count would not match it: it is shown only for one engine, and is in the tooltip otherwise (one denominator, R12).
 */
function brandRow(row, single) {
  const main = el('span', 'flex min-w-0 items-center gap-2');
  if (row.swatch) main.append(el('span', `size-2.5 shrink-0 rounded-xs ${row.swatch}`));
  main.append(el('span', 'truncate type-body text-foreground', row.name));
  if (row.own) main.append(el('span', `${NEUTRAL_BADGE} shrink-0`, 'You'));
  else if (!row.tracked) main.append(el('span', 'shrink-0 type-meta', 'Not tracked'));
  const value = el('span', 'flex items-baseline gap-2 whitespace-nowrap');
  value.append(el('span', 'num type-body-strong text-foreground', percent0(row.rate)));
  if (single) value.append(el('span', 'type-meta num', formatSampleCount(row.k, row.n)));
  const item = listRow({ place: row.place, main, value, own: row.own });
  if (!single) item.dataset.tip = `Named in ${formatSampleCount(row.k, row.n)} answers across the engines`;
  return item;
}

/** The links one engine cited: the most cited as text, the rest in the popover. */
export function citedLinksCell({ links, answers }, label) {
  const cell = el('td', CELL);
  if (links.length === 0) {
    cell.append(el('span', 'text-foreground-tertiary', 'None'));
    cell.dataset.tip = 'No answer in this window cited a link';
    return cell;
  }
  const button = el('button', LINK_BUTTON);
  button.type = 'button';
  button.setAttribute('aria-label', `Links cited in the answers for ${label}: ${plural(links.length, 'link')}. Open the list`);
  button.append(el('span', 'truncate', links[0].url), links.length > 1 ? el('span', 'shrink-0 type-label text-foreground-tertiary', `+${links.length - 1}`) : '');
  opener(button, () => ({
    title: 'Links cited in answers',
    subtitle: `${label} · ${plural(answers, 'answer')}`,
    rows: links.slice(0, 10).map((link, index) => {
      const main = el('span', 'flex min-w-0 items-center gap-2');
      main.append(el('span', 'truncate type-body text-foreground', link.url));
      if (link.own) main.append(el('span', `${NEUTRAL_BADGE} shrink-0`, 'Your site'));
      const value = el('span', 'type-meta num whitespace-nowrap', formatSampleCount(link.count, answers));
      return listRow({ place: index + 1, main, value, own: link.own });
    }),
    note: 'How many of the answers cite each link, most cited first.',
  }));
  cell.append(button);
  return cell;
}

// -------------------------------------------------------------------------------------------------
// Answer screenshot: the latest answer of the engine in view, as the page the engine showed

let shotDialog = null;
let shotOpener = null;

function dialogNode() {
  if (shotDialog) return shotDialog;
  shotDialog = el('div', 'fixed inset-0 z-(--z-dialog) flex items-start justify-center px-4');
  shotDialog.setAttribute('role', 'dialog');
  shotDialog.setAttribute('aria-modal', 'true');
  shotDialog.setAttribute('aria-labelledby', 'shot-title');
  shotDialog.hidden = true;
  const scrim = el('div', 'absolute inset-0 bg-(--scrim)');
  scrim.dataset.scrim = '';
  const box = el('div', 'relative flex w-160 max-w-full flex-col rounded-xl bg-surface-elevated shadow-dialog');
  box.dataset.dialogPanel = '';
  const header = el('div', 'flex shrink-0 items-start gap-3 px-6 pt-6 pb-4');
  const heading = el('div', 'min-w-0');
  const title = el('h2', 'type-section-title', 'Answer screenshot');
  title.id = 'shot-title';
  const sub = el('p', 'mt-1 type-body text-foreground-secondary');
  sub.dataset.shotSub = '';
  heading.append(title, sub);
  const close = el('button', 'ml-auto flex size-control-sm shrink-0 items-center justify-center rounded-md text-foreground-tertiary hover:bg-surface-hover hover:text-foreground');
  close.type = 'button';
  close.dataset.dialogCancel = '';
  close.dataset.tip = 'Close (Esc)';
  close.setAttribute('aria-label', 'Close');
  close.append(icon('x', 'size-icon-md'));
  header.append(heading, close);
  const body = el('div', 'flex flex-col gap-3 overflow-y-auto px-6 pb-6');
  body.dataset.shotBody = '';
  box.append(header, body);
  shotDialog.append(scrim, box);
  document.body.append(shotDialog);
  const dismiss = () => {
    ui.closeModal(shotDialog, () => shotOpener?.focus?.());
  };
  shotDialog.querySelectorAll('[data-dialog-cancel], [data-scrim]').forEach((node) => node.addEventListener('click', dismiss));
  shotDialog.addEventListener('keydown', (event) => {
    ui.trapFocus(shotDialog, event);
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  });
  return shotDialog;
}

/** The text of an answer as the engine page shows it: entity marks lose their braces, citation markers stay. */
const plainAnswer = (text) => text.replace(/\{([^}]+)\}/g, '$1');

function openShot(prompt, code, latest, trigger) {
  const dialog = dialogNode();
  shotOpener = trigger;
  const engine = engineOf(code);
  const { observation, answer } = latest;
  $('[data-shot-sub]', dialog).textContent = `${engine.name} · ${observation.day}, ${observation.time}`;
  const frame = el('div', 'flex flex-col gap-3 rounded-lg border border-border bg-surface p-4');
  const top = el('div', 'flex items-center gap-2');
  top.append(engineLogo(engine.name), el('span', 'type-body-strong text-foreground', engine.name));
  frame.append(top, el('p', 'type-body-strong text-foreground', prompt.text), el('p', 'whitespace-pre-line type-body text-foreground', plainAnswer(answer.text)));
  const sources = el('ol', 'flex flex-col gap-1 border-t border-border-subtle pt-3');
  answer.sources.forEach((domain, index) => sources.append(el('li', 'type-meta num', `[${index + 1}] ${domain}`)));
  frame.append(sources);
  $('[data-shot-body]', dialog).replaceChildren(frame, el('p', 'type-meta', 'A sample of the capture. The app stores an image of the answer page for every observation.'));
  ui.openModal(dialog);
  dialog.querySelector('[data-dialog-cancel]').focus();
}

export function screenshotCell(prompt, code, latest) {
  const cell = el('td', CELL);
  if (!latest) {
    cell.append(el('span', 'text-foreground-tertiary', 'No answer'));
    cell.dataset.tip = 'No answer in this window yet';
    return cell;
  }
  const button = el('button', 'inline-flex h-6 items-center gap-1.5 rounded-sm border border-border bg-surface px-1.5 type-body text-foreground hover:bg-surface-hover focus-visible:focus-ring');
  button.type = 'button';
  button.setAttribute('aria-label', `Open the latest ${engineOf(code).name} answer screenshot for ${prompt.text}`);
  button.append(icon('image', 'size-icon-sm text-foreground-tertiary'), el('span', 'num', latest.observation.day));
  button.addEventListener('click', () => openShot(prompt, code, latest, button));
  cell.append(button);
  return cell;
}

// -------------------------------------------------------------------------------------------------
// The Engine select: one engine or all of them. The Engines filter still takes any set; the select shows "2 engines"
// for a set that is neither.

/**
 * Builds the select beside the filters and returns `refresh`, which brings its label up to date with the filter.
 * `choose(codes)` receives the engine codes of the choice.
 */
export function initEngineSelect({ before, choose }) {
  const wrap = el('div', 'w-44 shrink-0');
  const trigger = el('button', 'flex h-control-sm w-full min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-2 text-left type-body text-foreground hover:bg-surface-hover aria-expanded:bg-surface-hover focus-visible:focus-ring');
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  wrap.append(trigger);
  const menu = el('div', 'hidden fixed z-(--z-dropdown) min-w-52 rounded-lg border border-border bg-surface-elevated p-1 shadow-popover');
  const list = el('div');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Engine in view');
  menu.append(list);
  document.body.append(menu);
  const options = [{ id: 'all', label: 'All engines' }, ...ENGINES.map((engine) => ({ id: engine.code, label: engine.name, logo: engine.name }))];
  const buttons = options.map((option) => {
    const button = el('button', 'group flex h-control-sm w-full items-center gap-2 whitespace-nowrap rounded-md px-2 text-left type-body text-foreground outline-none hover:bg-surface-hover focus-visible:bg-surface-hover');
    button.type = 'button';
    button.setAttribute('role', 'option');
    const check = el('span', 'size-icon-sm shrink-0 text-primary-text invisible group-aria-selected:visible');
    check.setAttribute('aria-hidden', 'true');
    check.append(icon('check', 'size-icon-sm'));
    button.append(check);
    if (option.logo) button.append(engineLogo(option.logo));
    button.append(el('span', 'truncate', option.label));
    button.addEventListener('click', () => {
      closePopup();
      choose(option.id === 'all' ? ENGINES.map((engine) => engine.code) : [option.id]);
    });
    list.append(button);
    return { button, option };
  });
  trigger.addEventListener('click', () => {
    if (!menu.classList.contains('hidden')) return closePopup();
    openPopup(menu, trigger, { align: 'start', focus: buttons.find(({ button }) => button.getAttribute('aria-selected') === 'true')?.button });
    return undefined;
  });
  before.before(wrap);

  return function refresh() {
    const codes = state.engines;
    const selected = codes.length === ENGINES.length ? 'all' : codes.length === 1 ? codes[0] : 'custom';
    const current = options.find((option) => option.id === selected);
    const label = current?.label ?? `${codes.length} engines`;
    trigger.replaceChildren(el('span', 'shrink-0 text-foreground-secondary', 'Engine:'), el('span', 'min-w-0 flex-1 truncate', label), icon('chevron-down', 'size-icon-sm shrink-0 text-foreground-muted'));
    trigger.setAttribute('aria-label', `Engine: ${label}`);
    buttons.forEach(({ button, option }) => button.setAttribute('aria-selected', String(option.id === selected)));
  };
}
