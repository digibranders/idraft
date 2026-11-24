/* global window */
/**
 * Reports: the page a guest sees (the same layout the real app serves at /public/reports/<token>). Read only:
 * numbers per engine with their counts, a weekly trend per engine, the brand against its competitors and the most
 * cited domains. There is nothing to click that changes anything, and no costs, prompts or answers.
 */
import { badge } from './perf-ui.js';
import { el } from './prompts-parts.js';

const fmt = (value) => value.toLocaleString('en-US');
/** "37% (71 of 192 answers)": a percentage always comes with its counts. Share of voice counts brand mentions. */
export const rate = ({ n, d }, unit = 'answers') => (d === 0 ? 'No valid answers yet' : d < 4 ? `Too few ${unit} (${fmt(n)} of ${fmt(d)})` : `${Math.round((n / d) * 100)}% (${fmt(n)} of ${fmt(d)} ${unit})`);
const longDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const ROLE = { own: 'Your site', competitor: 'Competitor', third_party: 'Other' };

function section(title, note) {
  const wrap = el('section', 'flex flex-col gap-2');
  const head = el('div', 'flex flex-col gap-0.5');
  head.append(el('h2', 'type-section-title', title));
  if (note) head.append(el('p', 'type-meta text-foreground-tertiary', note));
  wrap.append(head);
  return wrap;
}

function table(head, rows) {
  const scroller = el('div', 'overflow-x-auto rounded-lg border border-border');
  const node = el('table', 'w-full min-w-max type-body');
  const header = el('tr', 'bg-surface-subtle');
  head.forEach((cell) => header.append(el('th', 'px-3 h-9 text-left type-label text-foreground-secondary whitespace-nowrap', cell)));
  const thead = el('thead', '');
  thead.append(header);
  node.append(thead);
  const body = el('tbody', 'divide-y divide-border');
  rows.forEach((cells) => {
    const row = el('tr', '');
    cells.forEach((cell, index) => {
      const td = el('td', `px-3 h-control align-middle ${index === 0 ? 'type-body-strong' : 'num whitespace-nowrap'}`);
      if (cell instanceof window.Node) td.append(cell);
      else td.textContent = cell;
      row.append(td);
    });
    body.append(row);
  });
  node.append(body);
  scroller.append(node);
  return scroller;
}

/** A row of bars, one per week, each as tall as its rate; the counts are in the label of every bar. */
function trend(engine) {
  const wrap = el('div', 'flex items-end gap-2');
  wrap.style.height = '4rem';
  const rates = engine.weeks.map((w) => (w.mentioned.d ? w.mentioned.n / w.mentioned.d : 0));
  const top = Math.max(...rates, 0.01);
  engine.weeks.forEach((w, index) => {
    const bar = el('div', 'flex-1 rounded-sm bg-primary');
    bar.style.height = `${Math.max(4, Math.round((rates[index] / top) * 100))}%`;
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `Week of ${longDate(w.start)}: ${rate(w.mentioned)}`);
    bar.title = `Week of ${longDate(w.start)}: ${rate(w.mentioned)}`;
    wrap.append(bar);
  });
  return wrap;
}

/** @param {HTMLElement} host @param {object} report @param {{expiresAt?: Date}} [options] */
export function renderGuest(host, report, { expiresAt } = {}) {
  const page = el('article', 'flex flex-col gap-6');
  const head = el('header', 'flex flex-col gap-1');
  head.append(el('h1', 'type-page-title', `AI visibility report for ${report.host}`));
  head.append(el('p', 'type-body text-foreground-secondary', `${longDate(report.from)} to ${longDate(report.to)}, ${fmt(report.promptCount)} prompts, as answered by AI platforms.`));
  page.append(head);

  const numbers = section('Mention rate, Citation rate and Share of voice', 'Each percent is shown with the answers behind it. Platforms are never added together.');
  numbers.append(table(['Platform', 'Mention rate', 'Citation rate', 'Share of voice'], report.engines.map((e) => [e.name, rate(e.mentioned), rate(e.cited), rate(e.sov, 'brand mentions')])));
  page.append(numbers);

  const weekly = section('Mention rate by week', 'One bar for each week, as tall as that week\'s Mention rate. Point at a bar for its counts.');
  const grid = el('div', 'grid grid-cols-1 md:grid-cols-2 gap-4');
  report.engines.forEach((engine) => {
    const card = el('div', 'rounded-lg border border-border p-3 flex flex-col gap-2');
    card.append(el('p', 'type-body-strong', engine.name), trend(engine));
    const labels = el('div', 'flex gap-2');
    engine.weeks.forEach((w) => labels.append(el('span', 'flex-1 type-micro text-foreground-tertiary text-center', longDate(w.start).replace(/ \d{4}$/, ''))));
    card.append(labels);
    grid.append(card);
  });
  weekly.append(grid);
  page.append(weekly);

  const brands = section('Your brand and its competitors', 'The share of the answers on each platform that mention the brand.');
  brands.append(table(['Brand', ...report.engines.map((e) => `${e.name} mention rate`)],
    report.brands.map((b) => {
      const name = el('span', 'flex items-center gap-2');
      name.append(el('span', '', b.name));
      if (b.role !== 'own') name.append(badge('Competitor', 'neutral'));
      return [name, ...report.engines.map((e) => {
        const cell = b.engines.find((x) => x.code === e.code);
        return cell ? rate(cell.mentioned) : '';
      })];
    })));
  page.append(brands);

  const domains = section('Cited domains', 'The websites AI answers cite most, with their share of all citations.');
  domains.append(table(['Domain', 'Type', 'Citations', 'Citation share'], report.domains.map((d) => [d.domain, ROLE[d.role], fmt(d.units), rate(d.share)])));
  page.append(domains);

  const foot = el('footer', 'pt-3 border-t border-border type-meta text-foreground-tertiary');
  foot.textContent = expiresAt
    ? `Read only. This link stops working on ${expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}, or sooner if its owner revokes it.`
    : 'Read only. This link stops working when it expires or its owner revokes it.';
  page.append(foot);
  host.replaceChildren(page);
}
