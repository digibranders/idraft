/* global location, URLSearchParams */
/**
 * The Insights box of the AI visibility Overview (roadmap feature 4, plan docs/superpowers/plans/2026-11-24-opportunities-feed.md).
 * One line per finding: a count, a sentence and the screen that holds the work. Lines at zero are left out while
 * another has a count. Mock numbers; the real app reads them (see the plan for each read).
 *
 * States for review: add `?insights=loading`, `?insights=empty` or `?insights=error` to the page address.
 */
import { el, icon } from './aiov-parts.js';

const one = (n, singular, plural) => (n === 1 ? singular : plural);

/** Mock counts, one per line (the real feed reads them from the keywords, citations and sources routes). */
const COUNTS = { untracked: 14, gaps: 9, citingCompetitors: 23, newDomains: 6 };

/** The lines in order. `href` is a route of the preview; `action` is the button label where the line has one. */
const LINES = [
  {
    key: 'untracked',
    text: (n) => `${one(n, 'keyword shows', 'keywords show')} a Google AI Overview and ${one(n, 'is', 'are')} not tracked as prompts`,
    href: '#/prompts/explorer',
    action: 'Start tracking',
    note: 'Start tracking keywords as prompts',
  },
  {
    key: 'gaps',
    text: (n) => `${one(n, 'prompt', 'prompts')} where a competitor is cited and your site is not`,
    href: '#/citations',
    action: 'View gaps',
  },
  {
    key: 'citingCompetitors',
    text: (n) => `${one(n, 'cited domain cites', 'cited domains cite')} your tracked competitors, last 28 days`,
    href: '#/citations',
    action: 'View pages',
  },
  {
    key: 'newDomains',
    text: (n) => `${one(n, 'new cited domain', 'new cited domains')} this month`,
    href: '#/citations',
    action: 'View pages',
  },
];

function stateOf() {
  const query = location.hash.split('?')[1] ?? '';
  const value = new URLSearchParams(query).get('insights');
  return value === 'loading' || value === 'empty' || value === 'error' ? value : 'ready';
}

const ROW = 'min-h-row px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1';
const LINK = 'h-control-sm px-2.5 rounded-md border border-border bg-surface inline-flex items-center gap-1 whitespace-nowrap type-body-strong text-foreground hover:bg-surface-hover focus-visible:focus-ring';

function line(def, count) {
  const row = el('li', ROW);
  row.dataset.insight = def.key;
  row.append(el('span', 'type-metric-sm num min-w-10 text-foreground', String(count)), el('span', 'type-body text-foreground min-w-0 flex-1 basis-60', def.text(count)));
  const action = el('a', LINK, def.action);
  action.href = def.href;
  if (def.note) action.dataset.previewNote = def.note;
  action.setAttribute('aria-label', `${def.action}: ${def.text(count)}`);
  action.append(icon('chevron-right', 'size-icon-sm'));
  row.append(action);
  return row;
}

function skeletonRows() {
  return LINES.map(() => {
    const row = el('li', ROW);
    row.setAttribute('aria-hidden', 'true');
    row.append(el('span', 'h-5 w-8 rounded-sm bg-surface-subtle animate-pulse'), el('span', 'h-4 flex-1 max-w-md rounded-sm bg-surface-subtle animate-pulse'));
    return row;
  });
}

function message(title, text, retry) {
  const box = el('li', 'px-4 py-6 flex flex-col items-center gap-1 text-center');
  box.append(el('p', 'type-body-strong text-foreground', title), el('p', 'type-meta max-w-md', text));
  if (retry) {
    const button = el('button', LINK, 'Retry');
    button.type = 'button';
    button.dataset.previewNote = 'Reading the insights again';
    box.append(button);
  }
  return box;
}

/** The box, drawn for one scope. It does not depend on the Platform or Group select: it counts the whole project. */
export function insightsBox() {
  const section = el('section', 'min-w-0 bg-surface border border-border rounded-lg overflow-hidden');
  section.dataset.card = 'insights';
  section.setAttribute('aria-labelledby', 'aiov-insights-title');
  const head = el('div', 'min-h-12 px-4 py-3 flex items-center gap-2');
  head.append(icon('sparkles', 'size-icon text-foreground-secondary'));
  const title = el('h2', 'type-section-title', 'Insights');
  title.id = 'aiov-insights-title';
  head.append(title, el('span', 'type-meta', 'Whole project'));
  const list = el('ul', 'border-t border-border-subtle divide-y divide-border-subtle');
  const state = stateOf();
  const open = LINES.filter((def) => COUNTS[def.key] > 0);
  if (state === 'loading') list.append(...skeletonRows());
  else if (state === 'error') list.append(message('Could not load the insights', 'The reads did not answer. Nothing is lost.', true));
  else if (state === 'empty' || open.length === 0) list.append(message('Nothing to act on', 'Every keyword with a Google AI Overview is a prompt, and no competitor is cited where your site is not.'));
  else list.append(...open.map((def) => line(def, COUNTS[def.key])));
  section.append(head, list);
  return section;
}
