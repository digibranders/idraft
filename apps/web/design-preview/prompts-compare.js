/* global window */
/**
 * Compare days: one prompt on one platform, one column per run. Each column lists the brands the answer
 * named in order, the domains it cited and the Google organic top 10 of the same day, so a brand that
 * enters or leaves an answer, or a page that ranks but is never cited, shows up at a glance.
 * Opened from the History tab of the prompt inspector. The mock has no stored brand lists, so they are
 * drawn from the prompt's own counts, the same way answerFor draws an answer.
 */
import { COMPETITORS, ENGINES, OWN, PROMPT_BY_ID, answerFor, observationsOf, seeded, shuffled } from './prompts-data.js';
import { el } from './prompts-parts.js';

const ui = window.PreviewUI;
const { $, icon, openModal, closeModal, trapFocus } = ui;

const OWN_DOMAIN = 'northwind.com';
const ORGANIC_POOL = ['g2.com', 'capterra.com', 'techradar.com', 'forbes.com', 'zapier.com', 'reddit.com', 'hubspot.com', 'pipedrive.com', 'salesforce.com', 'zoho.com', 'pcmag.com', 'softwareadvice.com'];
const ORGANIC_SIZE = 10;
const MAX_BRANDS = 8;

/** One entry per run of the engine, oldest first: brands in answer order, cited domains, organic top 10. */
function daysOf(prompt, engine) {
  const latestPerRun = new Map();
  for (const observation of observationsOf(prompt)) {
    if (observation.engine.code === engine.code && !latestPerRun.has(observation.run)) latestPerRun.set(observation.run, observation);
  }
  const counts = prompt.engines[engine.code];
  return [...latestPerRun.values()]
    .sort((a, b) => a.run - b.run)
    .map((observation) => {
      const random = seeded(prompt.seed + 53 * (observation.engineOrder + 1) + 211 * (observation.run + 1));
      const answer = answerFor(prompt, observation);
      const rivals = COMPETITORS.map((competitor, c) => ({ ...competitor, score: counts.competitors[c] + random() * 1.5 }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5 + Math.floor(random() * (MAX_BRANDS - 4)));
      const brands = rivals.map((rival) => rival.name);
      if (observation.mentioned) brands.splice(answer.rank ? answer.rank - 1 : Math.floor(random() * 4), 0, OWN);
      const cited = [...new Set([...answer.sources, ...rivals.slice(0, 2).map((rival) => rival.domain)])];
      const organic = shuffled(ORGANIC_POOL, random).slice(0, ORGANIC_SIZE - 1);
      const ownRank = observation.cited ? 2 + Math.floor(random() * 5) : random() < 0.4 ? 6 + Math.floor(random() * 5) : null;
      if (ownRank) organic.splice(ownRank - 1, 0, OWN_DOMAIN);
      return { day: observation.day, time: observation.time, mentioned: observation.mentioned, brands, cited, organic: organic.slice(0, ORGANIC_SIZE), ownRank };
    });
}

const mark = (text, kind) => {
  const tone = kind === 'new' ? 'bg-positive-subtle text-positive-text' : 'bg-neutral-subtle text-neutral-text';
  return el('span', `h-badge inline-flex items-center px-1.5 rounded-sm type-micro ${tone}`, text);
};

function brandList(day, previous) {
  const list = el('ol', 'flex flex-col');
  day.brands.forEach((name, i) => {
    const own = name === OWN;
    const item = el('li', `min-h-8 px-3 flex items-center gap-2 border-t border-border-subtle${own ? ' bg-primary-subtle' : ''}`);
    item.append(el('span', 'w-4 shrink-0 type-meta num', String(i + 1)), el('span', `min-w-0 truncate type-table${own ? ' type-body-strong text-primary-text' : ''}`, own ? `${name} (you)` : name));
    if (previous && !previous.brands.includes(name)) item.append(el('span', 'ml-auto', ''), mark('New', 'new'));
    list.append(item);
  });
  if (day.brands.length === 0) list.append(el('li', 'px-3 py-2 border-t border-border-subtle type-meta', 'No brand named.'));
  const left = previous ? previous.brands.filter((name) => !day.brands.includes(name)) : [];
  if (left.length > 0) list.append(el('li', 'px-3 py-2 border-t border-border-subtle type-meta', `Left since ${previous.day}: ${left.join(', ')}`));
  return list;
}

function plainList(items, highlight) {
  const list = el('ol', 'flex flex-col');
  items.forEach((domain, i) => {
    const own = domain === highlight;
    const item = el('li', `min-h-8 px-3 flex items-center gap-2 border-t border-border-subtle${own ? ' bg-primary-subtle' : ''}`);
    item.append(el('span', 'w-4 shrink-0 type-meta num', String(i + 1)), el('span', `min-w-0 truncate type-table${own ? ' type-body-strong text-primary-text' : ''}`, domain));
    list.append(item);
  });
  return list;
}

/** The one-line reading of a day: where the brand stood in the answer against Google. */
function verdict(day) {
  const cited = day.cited.includes(OWN_DOMAIN);
  if (day.mentioned && cited) return 'Named and cited.';
  if (day.mentioned) return 'Named, but your site was not cited.';
  if (day.ownRank) return `Not named, though ${OWN_DOMAIN} ranks ${day.ownRank} in Google.`;
  return 'Not named, and not in the Google top 10.';
}

function section(title, body) {
  const wrap = el('section', 'flex flex-col');
  wrap.append(el('h4', 'px-3 h-8 flex items-center type-label bg-surface-subtle', title), body);
  return wrap;
}

function column(day, previous) {
  const card = el('article', 'min-w-0 rounded-lg border border-border bg-surface overflow-hidden flex flex-col');
  const head = el('header', 'px-3 py-2 flex flex-col gap-0.5');
  head.append(el('h3', 'type-subsection-title', day.day), el('p', 'type-meta', day.time), el('p', 'type-table text-foreground-secondary', verdict(day)));
  card.append(head, section('Brands in the answer', brandList(day, previous)), section('Sites the answer cited', plainList(day.cited, OWN_DOMAIN)), section('Google top 10', plainList(day.organic, OWN_DOMAIN)));
  return card;
}

/** Builds the dialog inside `#dlg-compare-days`; returns `open(promptId, engineCode, opener)`. */
export function initCompareDays() {
  const dialog = $('#dlg-compare-days');
  const frame = $('[data-dialog-panel]', dialog);
  frame.style.width = 'min(80rem, 100%)';
  frame.style.maxHeight = 'calc(100dvh - 6rem)';
  let opener = null;
  let promptId = null;
  let engineCode = null;

  const title = el('h2', 'type-section-title', 'Compare days');
  title.id = 'dlg-compare-title';
  const subtitle = el('p', 'type-body text-foreground-secondary truncate');
  const close = el('button', 'ml-auto size-control-sm shrink-0 rounded-md flex items-center justify-center text-foreground-tertiary hover:bg-surface-hover hover:text-foreground');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.dataset.tip = 'Close (Esc)';
  close.append(icon('x', 'size-icon-md'));
  const header = el('div', 'shrink-0 px-6 pt-6 pb-3 flex items-start gap-4');
  const heading = el('div', 'flex min-w-0 flex-1 flex-col gap-1');
  heading.append(title, subtitle);
  header.append(heading, close);

  const tabs = el('div', 'shrink-0 px-6 pb-3 flex flex-wrap gap-1.5');
  tabs.setAttribute('role', 'radiogroup');
  tabs.setAttribute('aria-label', 'Platform');
  const body = el('div', 'flex-1 overflow-y-auto px-6 pb-6');
  frame.replaceChildren(header, tabs, body);

  const render = () => {
    const prompt = PROMPT_BY_ID.get(promptId);
    subtitle.textContent = `“${prompt.text}”`;
    tabs.replaceChildren(
      ...ENGINES.map((engine) => {
        const active = engine.code === engineCode;
        const tab = el('button', `h-control-sm px-3 rounded-md border whitespace-nowrap type-body-strong ${active ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border bg-surface text-foreground hover:bg-surface-hover'}`, engine.label);
        tab.type = 'button';
        tab.setAttribute('role', 'radio');
        tab.setAttribute('aria-checked', String(active));
        tab.dataset.engine = engine.code;
        tab.dataset.keepCase = '';
        return tab;
      }),
    );
    const days = daysOf(prompt, ENGINES.find((engine) => engine.code === engineCode));
    if (days.length === 0) {
      body.replaceChildren(el('p', 'type-body text-foreground-secondary', 'No answers on this platform yet. The first column appears after the next run.'));
      return;
    }
    const grid = el('div', 'grid gap-3 items-start');
    grid.style.gridTemplateColumns = `repeat(${Math.min(days.length, 4)}, minmax(14rem, 1fr))`;
    grid.append(...days.slice(-4).map((day, i, shown) => column(day, i > 0 ? shown[i - 1] : null)));
    body.replaceChildren(grid);
  };

  const requestClose = () => closeModal(dialog, () => opener?.focus());
  close.addEventListener('click', requestClose);
  $('[data-scrim]', dialog).addEventListener('click', requestClose);
  dialog.addEventListener('keydown', (event) => {
    trapFocus(dialog, event);
    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
    }
  });
  tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-engine]');
    if (!tab) return;
    engineCode = tab.dataset.engine;
    render();
    $(`[data-engine="${engineCode}"]`, tabs).focus();
  });

  return (id, code, from) => {
    promptId = id;
    engineCode = code;
    opener = from;
    render();
    openModal(dialog);
  };
}
