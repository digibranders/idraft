/* global window, location, URLSearchParams */
/**
 * The Insights page of the static preview (route #/insights): the four findings the Overview's Insights box used to
 * show in one line each, now as cards with the headline number, a sentence and the rows behind the number.
 * Gaps come from the Citations fixture; keywords and domains are mock rows. The real app reads each list from the
 * keywords, citation-gaps and sources routes.
 *
 * States for review: `?insights=loading`, `?insights=empty` or `?insights=error` in the page address.
 */
import { formatInteger } from './vendor/format/number.js';
import { DEFAULT_COMPETITORS, gapRows, trackedOf } from './cit-data.js';
import { NEUTRAL_BADGE, el, engineName } from './aiov-parts.js';
import { na, table } from './tables.js';

const ui = window.PreviewUI;
const view = ui.$('[data-view="insights"]');

const UNTRACKED = [
  ['soc 2 compliance checklist', 2400, true], ['managed detection and response pricing', 1300, false], ['what is a security operations center', 5400, false],
  ['penetration testing cost', 3600, false], ['vciso services for startups', 720, false], ['incident response retainer', 480, true],
  ['best siem tools for mid size companies', 1900, false], ['iso 27001 audit preparation', 2900, false], ['cyber insurance requirements', 4400, false],
  ['edr vs mdr', 3200, true], ['network security assessment', 2100, false], ['zero trust architecture explained', 6600, false],
  ['managed soc providers', null, false], ['vulnerability scanning frequency', 590, false],
];
const CITING = [
  ['gartner.com', 'Review site', 41, ['Brightwave']], ['g2.com', 'Review site', 37, ['Brightwave', 'Corevault']], ['csoonline.com', 'Publisher', 29, ['Corevault']],
  ['reddit.com', 'Community', 24, ['Brightwave']], ['techtarget.com', 'Publisher', 19, ['Sentrix']], ['crowdstrike.com', 'Competitor', 17, ['Corevault']],
  ['darkreading.com', 'Publisher', 14, ['Sentrix', 'Brightwave']], ['capterra.com', 'Review site', 12, ['Brightwave']],
];
const NEW_DOMAINS = [
  ['cybernews.com', 'Nov 3', 9], ['helpnetsecurity.com', 'Nov 6', 7], ['trustradius.com', 'Nov 8', 6], ['securityweek.com', 'Nov 12', 5],
  ['dev.to', 'Nov 15', 4], ['infosecurity-magazine.com', 'Nov 19', 3],
];

const FIRST = 10;
const pick = (n, singular, plural) => (n === 1 ? singular : plural);
const stateOf = () => {
  const value = new URLSearchParams(location.hash.split('?')[1] ?? '').get('insights');
  return value === 'loading' || value === 'empty' || value === 'error' ? value : 'ready';
};

const LINK = 'h-control-sm px-2.5 rounded-md border border-border bg-surface inline-flex items-center gap-1 whitespace-nowrap type-body-strong text-foreground hover:bg-surface-hover focus-visible:focus-ring';
const link = (label, href, aria) => {
  const a = el('a', LINK, label);
  a.href = href;
  if (aria) a.setAttribute('aria-label', aria);
  return a;
};
function card({ id, headline, explain, count, viewAll, columns, rows }) {
  const state = stateOf();
  const section = el('section', 'min-w-0 overflow-hidden rounded-lg border border-border bg-surface');
  section.dataset.insight = id;
  const head = el('div', 'flex min-h-12 flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3');
  const text = el('div', 'flex min-w-0 flex-1 basis-80 flex-col gap-1');
  const body = el('div', 'border-t border-border-subtle');
  if (state === 'error') {
    text.append(el('h2', 'type-section-title', headline(2).replace(/^\S+ /, '')), el('p', 'type-body text-foreground-secondary', `Could not count the ${id === 'gaps' ? 'citation gaps' : 'rows'}`));
    const retry = el('button', LINK, 'Try again');
    retry.type = 'button';
    body.append(el('div', 'px-4 py-3', ''));
    body.firstChild.append(retry);
    head.append(text);
  } else if (state === 'loading') {
    text.append(el('span', 'h-5 w-40 rounded-sm bg-surface-subtle animate-pulse'), el('p', 'type-meta text-foreground-secondary', explain));
    head.append(text);
    body.append(el('div', 'h-row-compact px-4 flex items-center', ''));
    body.firstChild.append(el('span', 'h-4 w-1/2 rounded-sm bg-surface-subtle animate-pulse'));
  } else if (state === 'empty' || count === 0) {
    text.append(el('h2', 'sr-only', headline(0)), el('p', 'type-meta text-foreground-secondary', explain));
    head.append(text);
    const empty = el('div', 'px-4 py-6 flex flex-col items-center gap-1 text-center');
    empty.append(el('p', 'type-body-strong text-foreground', 'Nothing here'), el('p', 'type-meta max-w-md', 'This list is empty for the whole project.'));
    body.append(empty);
  } else {
    const line = el('div', 'flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1');
    line.append(el('span', 'num type-metric text-foreground', formatInteger(count)), el('span', 'type-body-strong text-foreground', headline(count)));
    text.append(el('h2', 'sr-only', headline(count)), line, el('p', 'type-meta text-foreground-secondary', explain));
    head.append(text, el('div', 'shrink-0'));
    head.lastChild.append(link(viewAll[0], viewAll[1]));
    const holder = el('div', 'flex flex-col gap-2 p-3');
    let open = false;
    const draw = () => {
      holder.replaceChildren(table(columns, open ? rows : rows.slice(0, FIRST)));
      if (rows.length > FIRST) {
        const more = el('button', 'h-control-sm px-2.5 rounded-md self-start type-body-strong text-foreground-secondary hover:bg-surface-hover focus-visible:focus-ring', open ? 'Show fewer' : `Show ${rows.length - FIRST} more`);
        more.type = 'button';
        more.setAttribute('aria-expanded', String(open));
        more.addEventListener('click', () => { open = !open; draw(); });
        holder.append(more);
      }
    };
    draw();
    body.append(holder);
  }
  section.append(head, body);
  return section;
}

export function renderInsights() {
  const scope = { platform: 'all', group: 'all', runs: 4, competitors: DEFAULT_COMPETITORS };
  const gaps = gapRows(scope).filter((row) => row.gap > 0).sort((a, b) => b.gap - a.gap);
  const bar = el('div', 'flex min-h-control items-center gap-2');
  bar.append(el('h1', 'type-page-title', 'Insights'), el('span', 'type-meta', 'Whole project'));
  const keywordRows = UNTRACKED.map(([text, volume, cited]) => ({ text, volume, cited }));
  view.replaceChildren(
    bar,
    card({
      id: 'untracked', count: keywordRows.length, rows: keywordRows, viewAll: ['View prompts', '#/prompts/explorer'],
      headline: (n) => `${pick(n, 'keyword shows', 'keywords show')} a Google AI Overview and ${pick(n, 'is', 'are')} not tracked as ${pick(n, 'a prompt', 'prompts')}`,
      explain: 'Your latest checks show a Google AI Overview for these keywords, and no prompt asks the same question yet.',
      columns: [
        { header: 'Keyword', cell: (r) => r.text },
        { header: 'Volume', cell: (r) => (r.volume === null ? na('Search volume is not collected for this keyword yet.') : el('span', 'num', formatInteger(r.volume))) },
        { header: 'Your site', cell: (r) => (r.cited ? 'Cited' : 'Not cited') },
        { header: 'Action', actions: true, cell: (r) => link('Start tracking', '#/prompts/explorer', `Start tracking: ${r.text}`) },
      ],
    }),
    card({
      id: 'gaps', count: gaps.length, rows: gaps, viewAll: ['View all gaps', '#/citations/gaps'],
      headline: (n) => `${pick(n, 'prompt', 'prompts')} where a competitor is cited and your site is not`,
      explain: 'AI answers cite a tracked competitor on these prompts and leave your site out, on the platforms listed.',
      columns: [
        { header: 'Prompt', cell: (r) => r.prompt.text },
        { header: 'Platforms', cell: (r) => { const s = el('span', 'flex flex-wrap gap-1'); r.lostOn.forEach((code) => s.append(el('span', NEUTRAL_BADGE, engineName(code)))); return s; } },
        { header: 'Competitors cited', cell: (r) => r.lostTo.map((id) => trackedOf(id).name).join(', ') },
        { header: 'Action', actions: true, cell: (r) => link('View prompt', '#/citations/gaps', `View prompt: ${r.prompt.text}`) },
      ],
    }),
    card({
      id: 'citing', count: CITING.length, rows: CITING.map(([domain, role, answers, rivals]) => ({ domain, role, answers, rivals })), viewAll: ['View all cited domains', '?owner=third#/citations'],
      headline: (n) => `${pick(n, 'cited domain cites', 'cited domains cite')} your tracked competitors, last 28 days`,
      explain: 'These websites are cited in answers that mention a tracked competitor, so they are places to earn a citation too.',
      columns: [
        { header: 'Domain', cell: (r) => r.domain },
        { header: 'Role', cell: (r) => r.role },
        { header: 'Answers', cell: (r) => el('span', 'num', formatInteger(r.answers)) },
        { header: 'Competitors', cell: (r) => r.rivals.join(', ') },
      ],
    }),
    card({
      id: 'new', count: NEW_DOMAINS.length, rows: NEW_DOMAINS.map(([domain, first, citations]) => ({ domain, first, citations })), viewAll: ['View all cited domains', '#/citations'],
      headline: (n) => `${pick(n, 'new cited domain', 'new cited domains')} this month`,
      explain: 'Domains that AI answers cite this month and did not cite in the month before.',
      columns: [
        { header: 'Domain', cell: (r) => r.domain },
        { header: 'First seen', cell: (r) => r.first },
        { header: 'Citations', cell: (r) => el('span', 'num', formatInteger(r.citations)) },
      ],
    }),
  );
}

renderInsights();
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#/insights')) renderInsights(); });
