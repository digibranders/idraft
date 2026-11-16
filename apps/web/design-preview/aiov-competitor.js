/* global window */
/**
 * The competitor drawer of the AI visibility Overview (440 px, the planned competitor inspector, inspect=entity:<id>).
 * Tabs: Overview (you against one competitor), Prompts (where they lead, where you lead, and where it is equal) and
 * Sources (which domains answers cite when each of you is named). Spec: docs/superpowers/specs/2026-11-16-ai-overview-
 * redesign-design.md section 7.1. It reads the scope of the page behind it, so its numbers match the cards, and it is
 * filled again when that scope changes.
 */
import { formatInteger } from './vendor/format/number.js';
import { COMPETITORS } from './prompts-data.js';
import { WEEK_LABELS, buildModel, competitorId, groupOf, headToHead, leadsFor, sourcesBehind } from './aiov-data.js';
import { chartHost, lineOption, mountChart } from './aiov-charts.js';
import { segmented } from './aiov-cards-core.js';
import { state } from './aiov-controls.js';
import { NEUTRAL_BADGE, cardFrame, el, emptyBody, engineName, pct0, pct1, platformLabel } from './aiov-parts.js';

const ui = window.PreviewUI;
const inspector = ui.$('#inspector');
const panel = (name) => ui.$(`[data-panel="${name}"]`, inspector);

const view = { id: null, lead: 'they', absent: false, group: null };
let disposeTrend = null;
const SHOWN = 10;

const ids = () => COMPETITORS.map(competitorId);
const indexOf = (id) => ids().indexOf(id);
const scope = () => ({ ...state });

/** Competitors in the order of the Competitor gap card (most prompts led by them first), for stepping. */
function order() {
  const { competitors } = leadsFor(buildModel(scope()));
  return [...competitors].sort((a, b) => b.lost - a.lost).map((competitor) => competitor.id);
}

const dot = (token) => {
  const mark = el('span', 'size-2 shrink-0 rounded-full');
  mark.style.background = `var(--${token})`;
  mark.setAttribute('aria-hidden', 'true');
  return mark;
};

/** "612 of 1,800 answers", or nothing when a count is missing. */
const countsOf = (total, part, noun) => (typeof total === 'number' && typeof part === 'number' ? `${formatInteger(part)} of ${formatInteger(total)} ${noun}` : undefined);

const signedPoints =(diff) => (Math.abs(diff) < 0.0005 ? '0 pts' : `${diff > 0 ? '+' : '−'}${(Math.abs(diff) * 100).toFixed(1)} pts`);

// -------------------------------------------------------------------------------------------------
// Overview: you against the competitor

function overviewTable(rival, rows) {
  const table = el('table', 'w-full type-table');
  const head = el('thead');
  const headRow = el('tr', 'border-t border-border-subtle bg-surface-subtle h-row-header');
  const youHead = el('th', 'px-3 text-right type-label whitespace-nowrap');
  youHead.append(el('span', 'inline-flex items-center gap-1.5', ''));
  youHead.firstChild.append(dot('chart-1'), 'You');
  const rivalHead = el('th', 'px-3 text-right type-label whitespace-nowrap');
  rivalHead.append(el('span', 'inline-flex items-center gap-1.5', ''));
  rivalHead.firstChild.append(dot(rival.token), rival.name);
  const first = el('th', 'pl-4 text-left type-label', 'Measure');
  const gapHead = el('th', 'px-3 pr-4 text-right type-label', 'Gap');
  [first, youHead, rivalHead, gapHead].forEach((th) => (th.scope = 'col'));
  headRow.append(first, youHead, rivalHead, gapHead);
  head.append(headRow);
  const body = el('tbody');
  rows.forEach((row) => {
    const tr = el('tr', 'h-row-compact border-t border-border-subtle');
    const name = el('th', 'pl-4 pr-2 text-left font-normal text-foreground whitespace-nowrap', row.label);
    name.scope = 'row';
    if (row.tip) name.dataset.tip = row.tip;
    const value = (ratio, decimals, tip) => {
      const cell = ratio === null ? el('td', 'px-3 text-right text-foreground-tertiary', 'n/a') : el('td', 'px-3 text-right num', decimals === 1 ? pct1(ratio) : pct0(ratio));
      if (tip) cell.dataset.tip = tip;
      return cell;
    };
    const gap = el('td', 'px-3 pr-4 text-right num text-foreground-secondary', row.own === null || row.rival === null ? 'n/a' : signedPoints(row.own - row.rival));
    gap.dataset.tip = 'Your value minus theirs, in points. Not tested for detectability';
    tr.append(name, value(row.own, row.decimals, row.ownTip), value(row.rival, row.decimals, row.rivalTip), gap);
    body.append(tr);
  });
  table.append(head, body);
  return table;
}

function fillOverview(model, index) {
  const data = headToHead(model, index);
  const rival = COMPETITORS[index];
  const target = panel('comp-overview');
  if (data.own.mention === null || data.rival.mention === null) {
    target.replaceChildren(cardFrame({ key: 'competitor.overview', title: `You against ${rival.name}`, body: emptyBody('No rate yet', 'Too few answers in this scope to compare.') }));
    return;
  }
  const rows = [
    // The counts behind each rate are in the tooltips (R1): pooled answers, while the rate is prompt-weighted
    { label: 'Mention rate', own: data.own.mention, rival: data.rival.mention, tip: 'Share of valid answers that name the brand. Each prompt counts once.', ownTip: countsOf(model.average.mention.counts?.n, data.own.answers, 'answers'), rivalTip: countsOf(model.average.mention.counts?.n, data.rival.answers, 'answers') },
    { label: 'Share of voice', own: data.own.sov, rival: data.rival.sov, tip: 'Share of tracked-brand mentions, within the tracked set.', ownTip: countsOf(data.own.answersOfTracked, data.own.answers, 'brand mentions'), rivalTip: countsOf(data.rival.answersOfTracked, data.rival.answers, 'brand mentions') },
    { label: 'Source share', own: data.sourceShare.own, rival: data.sourceShare.rival, decimals: 1, tip: 'Share of citation units that are pages of the brand’s own domain.' },
  ];
  const summary = cardFrame({
    key: 'competitor.summary',
    title: `You against ${rival.name}`,
    meta: view.scopeText,
    body: overviewTable(rival, rows),
    flush: true,
  });

  // The trend: both brands over the weekly runs
  const host = chartHost(180, `Mention rate of you and ${rival.name} over the last 8 weekly runs`);
  const legend = el('div', 'mt-2 flex flex-wrap gap-x-4 gap-y-1');
  [['You', 'chart-1'], [rival.name, rival.token]].forEach(([name, token]) => {
    const item = el('span', 'inline-flex items-center gap-1.5 type-meta');
    item.append(dot(token), name);
    legend.append(item);
  });
  disposeTrend?.();
  disposeTrend = null;
  const trend = cardFrame({ key: 'competitor.trend', title: 'Mention rate over time', meta: 'weekly runs', body: [host, legend] });

  // The same by platform
  const table = el('table', 'w-full type-table');
  const body = el('tbody');
  data.perPlatform.forEach((entry) => {
    const tr = el('tr', 'h-row-compact border-t border-border-subtle first:border-t-0');
    const name = el('th', 'pl-4 pr-2 text-left font-normal');
    name.scope = 'row';
    name.append(platformLabel(entry.code));
    const cell = (ratio) => (ratio === null ? el('td', 'px-3 text-right text-foreground-tertiary', 'n/a') : el('td', 'px-3 text-right num', pct0(ratio)));
    const gap = el('td', 'px-3 pr-4 text-right num text-foreground-secondary', entry.own === null || entry.rival === null ? 'n/a' : signedPoints(entry.own - entry.rival));
    tr.append(name, cell(entry.own), cell(entry.rival), gap);
    body.append(tr);
  });
  table.append(body);
  const byPlatform = cardFrame({ key: 'competitor.platforms', title: 'By platform', meta: 'mention rate, you · them · gap', body: table, flush: true });

  target.replaceChildren(summary, trend, byPlatform);
  disposeTrend = mountChart(host, () => lineOption({ labels: WEEK_LABELS, lines: [{ name: 'You', token: 'chart-1', values: data.series.own }, { name: rival.name, token: rival.token, values: data.series.rival }] }));
}

// -------------------------------------------------------------------------------------------------
// Prompts: where they lead, where you lead, where it is equal

const KIND_LABEL = { they: 'They lead', you: 'You lead', close: 'Equal' };

function rateText(count, answers) {
  return `${formatInteger(count)} of ${formatInteger(answers)}`;
}

function promptRow(row, rival) {
  const button = el('button', 'w-full px-4 py-2.5 flex items-start gap-3 text-left border-t border-border-subtle first:border-t-0 hover:bg-surface-hover focus-visible:bg-surface-hover outline-none');
  button.type = 'button';
  button.dataset.compPrompt = row.id;
  const text = el('span', 'min-w-0 flex-1 flex flex-col gap-1');
  text.append(el('span', 'type-body text-foreground line-clamp-2', row.text));
  const meta = el('span', 'flex flex-wrap items-center gap-x-2 gap-y-1 type-meta num');
  meta.append(el('span', NEUTRAL_BADGE, row.topic), `You ${rateText(row.own, row.answers)} · ${rival.name} ${rateText(row.rival, row.answers)}`);
  text.append(meta);
  // The rates side by side: two thin bars of the same scale, yours above theirs
  const bars = el('span', 'w-24 shrink-0 flex flex-col gap-1 pt-1.5');
  bars.setAttribute('role', 'img');
  bars.setAttribute('aria-label', `You ${pct0(row.own / row.answers)}, ${rival.name} ${pct0(row.rival / row.answers)}`);
  [[row.own, 'chart-1'], [row.rival, rival.token]].forEach(([count, token]) => {
    const track = el('span', 'block h-1.5 rounded-full bg-neutral-subtle overflow-hidden');
    const fill = el('span', 'block h-full rounded-full');
    fill.style.width = `${Math.max(2, (count / row.answers) * 100)}%`;
    fill.style.background = `var(--${token})`;
    track.append(fill);
    bars.append(track);
  });
  button.append(text, bars);
  return button;
}

function fillPrompts(model, index) {
  const leads = leadsFor(model);
  const rival = leads.competitors[index];
  const target = panel('comp-prompts');
  const ofKind = (kind) => rival.rows.filter((row) => row.lead === kind);
  const counts = { they: rival.lost, you: rival.ahead, close: rival.close };
  // A narrowing that the scope no longer supports is dropped, so the list never goes empty behind a hidden control
  if (groupOf(state.group).kind !== 'all') view.group = null;
  if (view.group && !ofKind(view.lead).some((row) => row.topic === view.group)) view.group = null;
  if (view.absent && (view.lead !== 'they' || !ofKind('they').some((row) => row.absent))) view.absent = false;

  const controls = el('div', 'flex flex-col gap-2');
  controls.append(
    segmented(
      ['they', 'you', 'close'].map((key) => ({ key, label: `${KIND_LABEL[key]} ${counts[key]}` })),
      view.lead,
      (key) => {
        Object.assign(view, { lead: key, absent: false, group: null });
        fillPrompts(buildModel(scope()), indexOf(view.id));
      },
      'Who leads',
    ),
  );

  // Rows of the chosen kind, then the narrowing the person made
  let rows = ofKind(view.lead);
  const absentCount = rows.filter((row) => row.absent).length;
  if (view.lead === 'they' && absentCount > 0) {
    const chip = el('button', `h-control-sm px-2.5 self-start rounded-md border type-body whitespace-nowrap ${view.absent ? 'border-primary-border bg-primary-subtle text-primary-text type-body-strong' : 'border-border bg-surface text-foreground hover:bg-surface-hover'}`, `You are absent ${absentCount}`);
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(view.absent));
    chip.dataset.tip = `${rival.name} is named and you are not named at all: the plan’s “lost to” prompts`;
    chip.addEventListener('click', () => {
      view.absent = !view.absent;
      fillPrompts(model, index);
    });
    controls.append(chip);
  }
  if (view.absent) rows = rows.filter((row) => row.absent);

  // Where it happens: the groups with the most prompts of this kind. Hidden when the page is already one group.
  const sections = [];
  if (groupOf(state.group).kind === 'all' && rows.length > 0) {
    const byGroup = new Map();
    rows.forEach((row) => byGroup.set(row.topic, (byGroup.get(row.topic) ?? 0) + 1));
    const list = [...byGroup].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const top = list[0][1];
    const strip = el('div', 'flex flex-col');
    list.forEach(([name, count]) => {
      const row = el('button', `h-9 px-4 flex items-center gap-3 text-left hover:bg-surface-hover outline-none focus-visible:bg-surface-hover ${view.group === name ? 'bg-primary-subtle' : ''}`);
      row.type = 'button';
      row.setAttribute('aria-pressed', String(view.group === name));
      row.dataset.compGroup = name;
      const label = el('span', `w-32 shrink-0 truncate type-body ${view.group === name ? 'text-primary-text type-body-strong' : 'text-foreground'}`, name);
      const track = el('span', 'flex-1 h-2 rounded-full bg-neutral-subtle overflow-hidden');
      track.setAttribute('aria-hidden', 'true');
      const fill = el('span', 'block h-full rounded-full');
      fill.style.width = `${(count / top) * 100}%`;
      fill.style.background = view.lead === 'you' ? 'var(--chart-1)' : `var(--${COMPETITORS[index].token})`;
      track.append(fill);
      row.append(label, track, el('span', 'w-8 shrink-0 text-right type-table num', String(count)));
      row.addEventListener('click', () => {
        view.group = view.group === name ? null : name;
        fillPrompts(model, index);
      });
      strip.append(row);
    });
    sections.push(
      cardFrame({
        key: 'competitor.groups',
        title: view.lead === 'you' ? 'Where you lead most' : view.lead === 'they' ? `Where ${rival.name} leads most` : 'Where it is equal most',
        meta: 'groups, prompts',
        body: strip,
        flush: true,
      }),
    );
  }
  if (view.group) rows = rows.filter((row) => row.topic === view.group);

  // The list: the largest differences first
  rows = [...rows].sort((a, b) => (view.lead === 'close' ? b.answers - a.answers : Math.abs(b.diff) - Math.abs(a.diff) || b.answers - a.answers));
  const shown = rows.slice(0, SHOWN);
  const list = el('div', 'flex flex-col');
  if (shown.length === 0) list.append(emptyBody('No prompts here', view.absent || view.group ? 'No prompt matches this narrowing. Clear it to see the rest.' : 'None of the compared prompts falls in this group.'));
  shown.forEach((row) => list.append(promptRow(row, rival)));
  const footer = el('div', 'px-4 py-3 border-t border-border-subtle flex flex-wrap items-center gap-x-3 gap-y-1');
  footer.append(el('span', 'type-meta num', rows.length === 0 ? '' : `Showing ${shown.length} of ${formatInteger(rows.length)}`));
  const all = el('button', 'ml-auto type-body text-link hover:underline whitespace-nowrap', 'View all in Prompts');
  all.type = 'button';
  all.dataset.previewNote = `The prompt list filtered to ${KIND_LABEL[view.lead].toLowerCase()} against ${rival.name} (opp=lost_to:${rival.id})`;
  footer.append(all);
  const listCard = cardFrame({
    key: 'competitor.prompts',
    title: view.lead === 'they' ? `Prompts where ${rival.name} leads` : view.lead === 'you' ? 'Prompts where you lead' : 'Prompts that are equal or too close',
    meta: `${formatInteger(rows.length)} ${rows.length === 1 ? 'prompt' : 'prompts'}`,
    body: [list, footer],
    flush: true,
  });
  target.replaceChildren(controls, ...sections, listCard);
}

// -------------------------------------------------------------------------------------------------
// Sources: which domains answers cite when each of you is named

function sourceList(title, rows, token) {
  const table = el('table', 'w-full type-table');
  const body = el('tbody');
  const top = rows[0]?.share || 1;
  rows.forEach((row) => {
    const tr = el('tr', 'h-9');
    const name = el('th', 'pl-4 pr-2 text-left font-normal text-foreground whitespace-nowrap');
    name.scope = 'row';
    name.append(row.domain);
    const barCell = el('td', 'pr-3 w-full');
    const track = el('div', 'h-2 rounded-full bg-neutral-subtle overflow-hidden');
    track.setAttribute('aria-hidden', 'true');
    const fill = el('div', 'h-full rounded-full');
    fill.style.width = `${(row.share / top) * 100}%`;
    fill.style.background = `var(--${token})`;
    track.append(fill);
    barCell.append(track);
    tr.append(name, barCell, el('td', 'pr-4 text-right num whitespace-nowrap', pct1(row.share)));
    body.append(tr);
  });
  table.append(body);
  return table;
}

function fillSources(model, index) {
  const rival = COMPETITORS[index];
  const data = sourcesBehind(model, index);
  const target = panel('comp-sources');
  if (data.theirs.length === 0) {
    target.replaceChildren(cardFrame({ key: 'competitor.sources', title: 'Sources', body: emptyBody('No citations in this scope', 'No answer in this scope cited a page, so there is nothing to compare.') }));
    return;
  }
  const theirs = cardFrame({ key: 'competitor.sources.theirs', title: `When ${rival.name} is named`, meta: 'top domains cited', body: sourceList('theirs', data.theirs, rival.token), flush: true });
  const yours = cardFrame({ key: 'competitor.sources.yours', title: 'When you are named', meta: 'top domains cited', body: sourceList('yours', data.yours, 'chart-1'), flush: true });
  const only = el('div', 'px-4 pb-4 flex flex-col gap-3');
  only.append(el('p', 'type-body text-foreground-secondary', `The top 8 of the two lists share ${pct0(data.overlap)} of their domains (Jaccard overlap).`));
  const chips = el('div', 'flex flex-wrap gap-1.5');
  if (data.onlyTheirs.length === 0) chips.append(el('span', 'type-meta', 'Every third-party domain in their top 8 is also in yours.'));
  data.onlyTheirs.forEach((domain) => chips.append(el('span', NEUTRAL_BADGE, domain)));
  const gapTitle = el('p', 'type-label text-foreground-secondary', 'Third-party domains in their top 8 and not in yours');
  only.append(gapTitle, chips);
  const gap = cardFrame({ key: 'competitor.sources.gap', title: 'Where they are cited and you are not', body: only, flush: true });
  target.replaceChildren(gap, theirs, yours);
}

// -------------------------------------------------------------------------------------------------
// The shell: header, registration, entry points

function fill(id) {
  const index = indexOf(id);
  const model = buildModel(scope());
  const competitor = COMPETITORS[index];
  if (id !== view.id) Object.assign(view, { id, absent: false, group: null });
  view.id = id;
  const scopeParts = [state.platform === 'all' ? 'All platforms' : engineName(state.platform), groupOf(state.group).label];
  view.scopeText = scopeParts.join(' · ');
  ui.$('#inspector-title').textContent = competitor.name;
  ui.$('[data-inspector-badges]', inspector).replaceChildren(ui.badge(competitor.domain), ...scopeParts.map((part) => ui.badge(part)));
  const at = order().indexOf(id);
  ui.$('[data-inspector-context]', inspector).textContent = `Competitor · ${at + 1} of ${COMPETITORS.length} · tracked in AI answers`;
  fillOverview(model, index);
  fillPrompts(model, index);
  fillSources(model, index);
}

const resetView = (lead = 'they') => Object.assign(view, { lead, absent: false, group: null });

/** Opens the drawer on a competitor, optionally on its Prompts tab with one kind of lead chosen. */
export function openCompetitor(id, opener, { lead } = {}) {
  // Every opening starts from its own view: the lead it was asked for, or "They lead" with nothing narrowed
  resetView(lead ?? 'they');
  view.id = id;
  ui.openInspector(id, opener, 'competitor');
  ui.selectInspectorTab(lead ? 'comp-prompts' : 'comp-overview');
}

/** Draws the open drawer again. The page calls it after every render, which clears the charts (the trend with them). */
export function refreshCompetitorDrawer() {
  const open = ui.inspectorState();
  if (open.open && open.type === 'competitor') fill(open.id);
}

export function initCompetitorDrawer() {
  ui.registerInspectorType('competitor', {
    noun: 'competitor',
    back: 'Overview',
    width: 440,
    defaultTab: 'comp-overview',
    has: (id) => indexOf(id) >= 0,
    fill,
    order,
  });
  // Opening a prompt from the list leaves this drawer, so the type changes and the list is not kept: nothing to clear
  inspector.addEventListener('click', (event) => {
    const row = event.target.closest('[data-comp-prompt]');
    if (!row || ui.inspectorState().type !== 'competitor') return;
    // The list the prompt sits in is the one on screen, so J and K step through the same prompts
    const idsOnScreen = [...inspector.querySelectorAll('[data-comp-prompt]')].map((button) => button.dataset.compPrompt);
    // No opener: the row lives in a panel this drawer is about to hide, so focus returns to the page card on close
    window.PreviewPrompts?.openPrompt(row.dataset.compPrompt, undefined, idsOnScreen);
  });
  window.addEventListener('inspector-close', () => {
    disposeTrend?.();
    disposeTrend = null;
    // Nothing of this drawer is kept: the next one opens on its own view
    resetView();
    view.id = null;
  });
  // The scope of the page changing, or the page drawing again, refills an open drawer through the page's render
  // (aiov.js calls refreshCompetitorDrawer), so its numbers still match the cards.
}
