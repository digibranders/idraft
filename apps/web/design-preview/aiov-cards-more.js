/**
 * Cards of the AI visibility Overview, second half: groups, citations, position and sentiment, traffic, fan-out,
 * key changes and the collection calendar. Same contract as aiov-cards-core.js.
 */
import { formatInteger } from './vendor/format/number.js';
import {
  GA4_CONNECTED,
  GROUPS,
  HAS_TREE,
  MEASURES,
  PARENTS,
  PLATFORM_CODES,
  RUNS,
  RUN_CALENDAR,
  WEEK_LABELS,
  buildModel,
  domainsFor,
  fanoutFor,
  gapFor,
  groupRows,
  ownPagesFor,
  platformOf,
  positionShares,
  promptRows,
  trafficFor,
  unlinkedPrompts,
} from './aiov-data.js';
import { chartHost, lineOption, mountChart, treemapOption } from './aiov-charts.js';
import { HEAT_METRICS, setScope } from './aiov-controls.js';
import { segmented } from './aiov-cards-core.js';
import { NEUTRAL_BADGE, barList, cardFrame, countsText, el, emptyBody, engineName, heatBin, icon, insufficientText, orderText, pct0, plural, platformLabel, sampleBadge, stackedRows } from './aiov-parts.js';

const ENGINE_TOKEN = { chatgpt_web: 'chart-1', gemini_web: 'chart-2', google_ai_mode: 'chart-3', google_ai_overview: 'chart-4' };
const HEAT_COLUMNS = ['chatgpt_web', 'gemini_web', 'google_ai_overview', 'google_ai_mode'];
const METRIC_TABS = HEAT_METRICS.map((key) => ({ key, label: MEASURES[key].short }));
const groupName = (id) => id.split(':')[1];

// -------------------------------------------------------------------------------------------------
// Groups

function heatCell(cell, onClick, label) {
  const td = el('td', 'p-0.5');
  if (!cell || cell.state === 'unavailable') {
    td.append(el('div', 'h-8 flex items-center justify-center type-table text-foreground-tertiary', 'n/a'));
    return td;
  }
  if (cell.state !== 'ok') {
    const box = el('div', 'h-8 rounded-xs bg-insufficient flex items-center justify-center type-micro text-foreground-tertiary', insufficientText(cell));
    box.dataset.tip = 'Too few valid answers for a rate (fewer than 4)';
    td.append(box);
    return td;
  }
  const bin = heatBin(cell.value);
  // `surface` is white in light and near-black in dark, and the dark bins are the other way round: it contrasts in both
  const button = el('button', `w-full h-8 rounded-xs type-table-strong num ${bin >= 5 ? 'text-surface' : 'text-foreground'} hover:outline hover:outline-2 hover:outline-primary`, pct0(cell.value));
  button.type = 'button';
  button.style.background = `var(--seq-${bin})`;
  const detail = cell.code === 'all' ? `average of ${cell.used} platforms` : countsText(cell);
  button.dataset.tip = `${label}: ${pct0(cell.value)}${detail ? `, ${detail}` : ''}`;
  button.setAttribute('aria-label', `${label}: ${pct0(cell.value)}. Open this group`);
  button.addEventListener('click', onClick);
  td.append(button);
  return td;
}

export function groupHeatmapCard(ctx) {
  const { scope } = ctx;
  const measure = scope.metric;
  const topics = groupRows(scope, measure);
  const parentModels = Object.fromEntries(PARENTS.map((parent) => [parent, buildModel({ ...scope, group: `parent:${parent}`, platform: 'all' })]));
  const table = el('table', 'w-full min-w-[34rem]');
  const head = el('thead');
  const headRow = el('tr', 'border-t border-border-subtle bg-surface-subtle h-row-header');
  headRow.append(el('th', 'pl-4 pr-3 text-left type-label', 'Group'), el('th', 'px-2 text-right type-label', 'Prompts'));
  HEAT_COLUMNS.forEach((code) => {
    const th = el('th', `px-1 type-label whitespace-nowrap ${scope.platform === code ? 'text-primary-text' : ''}`);
    th.scope = 'col';
    th.append(platformLabel(code));
    headRow.append(th);
  });
  const avg = el('th', 'px-1 pr-3 type-label whitespace-nowrap', 'Average');
  avg.scope = 'col';
  headRow.append(avg);
  head.append(headRow);
  const body = el('tbody');
  // One row for a topic: indented under its parent when the project has a tree, flush left when its topics are flat
  const topicRow = (topic, indent) => {
    const tr = el('tr', 'border-t border-border-subtle');
    const th = el('th', `${indent ? 'pl-8' : 'pl-4'} pr-3 py-1 text-left font-normal`);
    th.scope = 'row';
    const link = el('button', 'type-body text-foreground hover:underline truncate max-w-48 text-left');
    link.type = 'button';
    link.textContent = topic.name;
    link.addEventListener('click', () => setScope({ group: topic.id }));
    th.append(link);
    tr.append(th, el('td', 'px-2 text-right type-table num text-foreground-secondary', formatInteger(topic.prompts)));
    HEAT_COLUMNS.forEach((code) => tr.append(heatCell(topic.cells[code], () => setScope({ group: topic.id, platform: code }), `${topic.name}, ${engineName(code)}`)));
    tr.append(heatCell(topic.average, () => setScope({ group: topic.id }), `${topic.name}, average`));
    return tr;
  };
  if (!HAS_TREE) topics.forEach((topic) => body.append(topicRow(topic, false)));
  PARENTS.forEach((parent) => {
    const children = topics.filter((topic) => topic.parent === parent);
    if (children.length === 0) return;
    const model = parentModels[parent];
    const parentRow = el('tr', 'border-t border-border-subtle bg-surface-subtle');
    const name = el('th', 'pl-4 pr-3 py-1 text-left');
    name.scope = 'row';
    const open = el('button', 'type-subsection-title text-foreground hover:underline');
    open.type = 'button';
    open.textContent = parent;
    open.addEventListener('click', () => setScope({ group: `parent:${parent}` }));
    name.append(open);
    parentRow.append(name, el('td', 'px-2 text-right type-table num text-foreground-secondary', formatInteger(model.prompts.length)));
    HEAT_COLUMNS.forEach((code) => parentRow.append(heatCell(model.cells[measure][code], () => setScope({ group: `parent:${parent}`, platform: code }), `${parent}, ${engineName(code)}`)));
    parentRow.append(heatCell(model.average[measure], () => setScope({ group: `parent:${parent}` }), `${parent}, average`));
    body.append(parentRow);
    children.forEach((topic) => body.append(topicRow(topic, true)));
  });
  table.append(head, body);
  const wrap = el('div', 'relative overflow-x-auto');
  wrap.append(table);
  return cardFrame({
    key: 'ai.topic_heatmap',
    title: 'Groups by platform',
    meta: MEASURES[measure].label.toLowerCase(),
    tools: [segmented(METRIC_TABS, measure, (key) => setScope({ metric: key }), 'Metric')],
    body: wrap,
    flush: true,
  });
}

export function groupExtremesCard(ctx) {
  const measure = ctx.scope.metric;
  const rows = groupRows(ctx.scope, measure).filter((row) => row.average.state === 'ok');
  if (rows.length < 4) return cardFrame({ key: 'ai.topic_extremes', title: 'Top and bottom groups', body: emptyBody('Not enough groups', 'At least 4 groups with a rate are needed.') });
  const sorted = [...rows].sort((a, b) => b.average.value - a.average.value);
  const list = (items, token) => barList(items.map((row) => ({ label: row.name, value: row.average.value, barToken: token, strong: false, note: `${row.prompts} prompts` })), { max: sorted[0].average.value, always: true });
  // Never list a group on both sides: take at most half of the groups
  const count = Math.min(sorted.length >= 12 ? 5 : 3, Math.floor(sorted.length / 2));
  const strongest = el('div');
  strongest.append(el('p', 'type-label text-foreground-secondary mb-1', 'Strongest'), list(sorted.slice(0, count), 'chart-1'));
  const weakest = el('div', 'mt-3');
  weakest.append(el('p', 'type-label text-foreground-secondary mb-1', 'Weakest'), list(sorted.slice(-count).reverse(), 'chart-bar-neutral'));
  return cardFrame({ key: 'ai.topic_extremes', title: 'Top and bottom groups', meta: MEASURES[measure].label.toLowerCase(), body: [strongest, weakest] });
}

/** With one group selected the comparison cards give way to that group's own prompts. */
export function groupPromptsCard(ctx) {
  const rows = promptRows(ctx.model);
  const table = el('table', 'w-full type-table');
  const head = el('thead');
  const headRow = el('tr', 'border-t border-border-subtle bg-surface-subtle h-row-header');
  ['Prompt', 'Visibility', 'Mention', 'Citation', 'Answers'].forEach((text, index) => {
    const th = el('th', `px-3 type-label whitespace-nowrap ${index === 0 ? 'pl-4 text-left' : 'text-right'} ${index === 4 ? 'pr-4 hidden md:table-cell' : ''}`, text);
    th.scope = 'col';
    headRow.append(th);
  });
  head.append(headRow);
  const body = el('tbody');
  rows.slice(0, 10).forEach((row) => {
    const tr = el('tr', 'h-row-compact border-t border-border-subtle');
    const text = el('th', 'pl-4 pr-3 text-left font-normal text-foreground max-w-0 w-1/2');
    text.scope = 'row';
    text.append(el('span', 'block truncate', row.text));
    tr.append(text, el('td', 'px-3 text-right num', pct0(row.visibility)), el('td', 'px-3 text-right num', pct0(row.mention)), el('td', 'px-3 text-right num', pct0(row.citation)), el('td', 'px-3 pr-4 text-right num hidden md:table-cell', formatInteger(row.answers)));
    body.append(tr);
  });
  table.append(head, body);
  const wrap = el('div', 'relative overflow-x-auto');
  wrap.append(table);
  const link = el('a', 'type-body text-link hover:underline', `View all ${rows.length} prompts`);
  link.href = '#/prompts/explorer';
  return cardFrame({
    key: 'ai.top_prompts',
    title: `Prompts in ${groupName(ctx.scope.group)}`,
    meta: `${plural(rows.length, 'prompt')} with a rate, by mention rate`,
    tools: [link],
    body: wrap,
    flush: true,
  });
}

// -------------------------------------------------------------------------------------------------
// Citations

const ROLE_BADGE = {
  Own: 'h-badge inline-flex items-center px-2 rounded-sm bg-primary-subtle text-primary-text type-micro whitespace-nowrap',
  Competitor: NEUTRAL_BADGE,
  'Third party': NEUTRAL_BADGE,
};

export function domainsCard(ctx) {
  const domains = domainsFor(ctx.model);
  if (domains.rows.length === 0) return cardFrame({ key: 'sources.top_domains', title: 'Top cited domains', body: emptyBody('No citations yet', 'No answers cited a page in this scope.') });
  const rows = domains.rows.slice(0, 8).map((row) => {
    const badge = el('span', ROLE_BADGE[row.role], row.role);
    return { label: row.domain, value: row.share, strong: row.role === 'Own', badge, barToken: row.role === 'Own' ? 'chart-1' : 'chart-bar-neutral', valueText: (v) => `${(v * 100).toFixed(1)}%` };
  });
  return cardFrame({
    key: 'sources.top_domains',
    title: 'Top cited domains',
    meta: `of ${formatInteger(domains.total)} citation units`,
    body: barList(rows, { valueText: (value) => `${(value * 100).toFixed(1)}%` }),
  });
}

export function sourceTypesCard(ctx) {
  const domains = domainsFor(ctx.model);
  if (domains.rows.length === 0) return cardFrame({ key: 'ai.citation_share_by_domain_type', title: 'Sources by type', body: emptyBody('No citations yet', 'No answers cited a page in this scope.') });
  const host = chartHost(232, `Citation units by source type: ${domains.types.map((entry) => `${entry.type} ${((entry.units / domains.total) * 100).toFixed(0)}%`).join(', ')}`);
  mountChart(host, () => treemapOption({ types: domains.types, total: domains.total }));
  return cardFrame({ key: 'ai.citation_share_by_domain_type', title: 'Sources by type', meta: 'area is share of citation units', body: host });
}

export function ownPagesCard(ctx) {
  const domains = domainsFor(ctx.model);
  const pages = ownPagesFor(ctx.model, domains);
  if (pages.length === 0) return cardFrame({ key: 'sources.own_pages', title: 'Your pages cited', body: emptyBody('None of your pages was cited', 'No answer in this scope cited a page of your domain.') });
  const rows = pages.map((page) => ({ label: page.url.replace('northwind.com', ''), value: page.units / domains.own, barToken: 'chart-1', note: `${formatInteger(page.units)} units`, tip: `${page.url}, ${page.topic}` }));
  return cardFrame({
    key: 'sources.own_pages',
    title: 'Your pages cited',
    meta: `${formatInteger(domains.own)} units from ${domains.rows.find((row) => row.role === 'Own')?.domain}`,
    body: barList(rows, { always: true, valueText: (value) => `${Math.round(value * 100)}%` }),
  });
}

export function unlinkedCard(ctx) {
  const rows = unlinkedPrompts(ctx.model);
  if (rows.length === 0) return cardFrame({ key: 'ai.unlinked_mentions', title: 'Unlinked brand mentions', body: emptyBody('No unlinked mentions', 'Every answer that names the brand also cites it, or there are too few answers.') });
  const link = el('a', 'type-body text-link hover:underline whitespace-nowrap', 'View prompts');
  link.href = '#/prompts/explorer';
  const list = el('ul', 'flex flex-col');
  rows.forEach((row) => {
    const li = el('li', 'py-2 border-t border-border-subtle first:border-t-0 flex flex-col gap-1');
    li.append(el('span', 'type-body text-foreground truncate', row.text));
    const meta = el('div', 'flex items-center gap-2');
    const track = el('div', 'h-1.5 flex-1 rounded-full bg-neutral-subtle overflow-hidden');
    const fill = el('div', 'h-full rounded-full');
    fill.style.width = `${row.rate * 100}%`;
    fill.style.background = 'var(--seq-4)';
    track.append(fill);
    // One platform with a rate: its own "x of y answers", which is the percent. Several: the average and how many took part,
    // with no pooled count beside it (each platform's counts are in the row's tooltip)
    const [only] = row.counts;
    const figure = row.counts.length === 1 ? `${only.k} of ${only.n} answers` : `${pct0(row.rate)}, average of ${row.counts.length}`;
    const names = (codes) => codes.map(engineName).join(' and ');
    const countsText = row.counts.map((count) => `${engineName(count.code)} ${count.k} of ${count.n}`).join(' and ');
    const head = row.counts.length === 1 ? `${only.k} of ${only.n} answers on ${engineName(only.code)} mention you and cite none of your pages` : `${countsText} answers mention you and cite none of your pages. Average of ${names(row.counts.map((count) => count.code))}, each platform counting once`;
    li.dataset.tip = row.leftOut.length === 0 ? head : `${head}. Left out, fewer than 4 valid answers: ${names(row.leftOut)}`;
    meta.append(track, el('span', 'type-table num text-foreground-secondary whitespace-nowrap', figure), el('span', NEUTRAL_BADGE, row.topic));
    li.append(meta);
    list.append(li);
  });
  return cardFrame({ key: 'ai.unlinked_mentions', title: 'Unlinked brand mentions', meta: 'prompts that name you without citing you', tools: [link], body: list });
}

// -------------------------------------------------------------------------------------------------
// Position and sentiment

const POSITION_SEGMENTS = [
  { label: 'Named first', token: 'seq-6' },
  { label: 'Named second', token: 'seq-4' },
  { label: 'Named third', token: 'seq-3' },
  { label: 'Fourth or later', token: 'chart-bar-neutral' },
];

export function positionCard(ctx) {
  const { model } = ctx;
  const rows = model.codes.map((code) => {
    const cell = model.cells.position[code];
    if (cell.state !== 'ok') return { label: platformLabel(code), shares: null, note: 'too few mentions' };
    return { label: platformLabel(code), shares: positionShares(cell.value), note: `mean ${orderText(cell.value)}` };
  });
  return cardFrame({
    key: 'ai.position_distribution',
    title: 'Mention position',
    meta: 'order among tracked brands',
    body: stackedRows({ segments: POSITION_SEGMENTS, rows, empty: 'Too few mentions' }),
  });
}

const SENTIMENT_SEGMENTS = [
  { label: 'Positive', token: 'chart-positive' },
  { label: 'Neutral', token: 'chart-bar-neutral' },
  { label: 'Negative', token: 'chart-negative' },
  { label: 'Mixed', token: 'chart-other' },
];

export function sentimentCard(ctx) {
  const { model } = ctx;
  const rows = model.codes.map((code) => {
    const cell = model.cells.sentiment[code];
    if (cell.state === 'unavailable') return { label: platformLabel(code), shares: null, note: 'not classified' };
    if (cell.state !== 'ok') return { label: platformLabel(code), shares: null, note: 'too few mentions' };
    const { positive, neutral, negative, mixed } = cell.shares;
    return { label: platformLabel(code), shares: [positive, neutral, negative, mixed], note: `${Math.round(cell.coverage * 100)}% of mentions classified` };
  });
  if (rows.every((row) => row.shares === null)) {
    return cardFrame({ key: 'ai.sentiment_by_engine', title: 'Brand sentiment', body: emptyBody('Not classified on this platform', 'Sentiment is classified on ChatGPT and Gemini answers. Pick another platform to see it.') });
  }
  return cardFrame({
    key: 'ai.sentiment_by_engine',
    title: 'Brand sentiment',
    meta: 'tone of the mentions',
    tools: [sampleBadge()],
    body: stackedRows({ segments: SENTIMENT_SEGMENTS, rows, empty: 'Not classified' }),
  });
}

// -------------------------------------------------------------------------------------------------
// Traffic and fan-out

export function referralCard(ctx) {
  const traffic = trafficFor(ctx.model);
  if (traffic.unavailable) return null;
  const lines = traffic.sources.map((source) => ({ name: source.name, token: ENGINE_TOKEN[source.code], values: source.series }));
  const host = chartHost(200, `AI referral sessions by source over the last 8 weeks: ${traffic.sources.map((source) => `${source.name} ${formatInteger(source.sessions)}`).join(', ')}`);
  mountChart(host, () => lineOption({ labels: WEEK_LABELS, lines, min: 0, format: (value) => formatInteger(value), tooltipFormat: (value) => (value === null ? 'No data' : formatInteger(value)) }));
  const legend = el('div', 'mt-2 flex flex-wrap gap-x-4 gap-y-1');
  traffic.sources.forEach((source) => {
    const item = el('span', 'inline-flex items-center gap-1.5 type-meta num');
    const swatch = el('span', 'w-3 h-0.5 rounded-full');
    swatch.style.background = `var(--${ENGINE_TOKEN[source.code]})`;
    item.append(swatch, `${source.name} · ${source.host} · ${formatInteger(source.sessions)} sessions`);
    legend.append(item);
  });
  const pages = el('table', 'w-full type-table');
  const head = el('thead');
  const headRow = el('tr', 'border-t border-border-subtle bg-surface-subtle h-row-header');
  ['Landing page', 'Sessions', 'Key events'].forEach((text, index) => {
    const th = el('th', `px-3 type-label whitespace-nowrap ${index === 0 ? 'pl-4 text-left' : 'text-right'} ${index === 2 ? 'pr-4' : ''}`, text);
    th.scope = 'col';
    headRow.append(th);
  });
  head.append(headRow);
  const body = el('tbody');
  traffic.pages.forEach((page) => {
    const tr = el('tr', 'h-row-compact border-t border-border-subtle');
    const url = el('th', 'pl-4 pr-3 text-left font-normal text-foreground max-w-0 w-full');
    url.scope = 'row';
    url.append(el('span', 'block truncate', page.path));
    tr.append(url, el('td', 'px-3 text-right num', formatInteger(page.sessions)), el('td', 'px-3 pr-4 text-right num', formatInteger(page.events)));
    body.append(tr);
  });
  pages.append(head, body);
  const grid = el('div', 'grid grid-cols-1 xl:grid-cols-5 gap-4 items-start');
  const left = el('div', 'xl:col-span-3 min-w-0 px-4 pb-4');
  left.append(host, legend);
  const right = el('div', 'xl:col-span-2 min-w-0 overflow-x-auto');
  right.append(pages);
  grid.append(left, right);
  const connect = el('button', 'h-control-sm px-2.5 rounded-md border border-border bg-surface flex items-center gap-1.5 whitespace-nowrap type-body-strong text-foreground hover:bg-surface-hover');
  connect.type = 'button';
  connect.dataset.previewNote = 'Connecting Google Analytics';
  connect.append(icon('plug', 'size-icon-sm'), GA4_CONNECTED ? 'Manage GA4' : 'Connect GA4');
  return cardFrame({
    key: 'traffic.ai_referrals',
    title: 'AI referral traffic',
    meta: `${formatInteger(traffic.total)} sessions in 28 days`,
    tools: [sampleBadge('Sample until GA4 is connected'), connect],
    body: grid,
    flush: true,
  });
}

export function fanoutCard(ctx) {
  const fanout = fanoutFor(ctx.model);
  if (!fanout.available) return null;
  const table = el('table', 'w-full type-table');
  const head = el('thead');
  const headRow = el('tr', 'border-t border-border-subtle bg-surface-subtle h-row-header');
  ['Searched query', 'Answers', 'Prompts', 'Top cited'].forEach((text, index) => {
    const th = el('th', `px-3 type-label whitespace-nowrap ${index === 0 ? 'pl-4 text-left' : 'text-right'} ${index === 3 ? 'pr-4 hidden md:table-cell' : ''}`, text);
    th.scope = 'col';
    headRow.append(th);
  });
  head.append(headRow);
  const body = el('tbody');
  fanout.rows.slice(0, 7).forEach((row) => {
    const tr = el('tr', 'h-row-compact border-t border-border-subtle');
    const query = el('th', 'pl-4 pr-3 text-left font-normal text-foreground max-w-0 w-full');
    query.scope = 'row';
    query.append(el('span', 'block truncate', row.query));
    tr.append(query, el('td', 'px-3 text-right num', formatInteger(row.answers)), el('td', 'px-3 text-right num', formatInteger(row.prompts)), el('td', 'px-3 pr-4 text-right hidden md:table-cell text-foreground-secondary', row.domain));
    body.append(tr);
  });
  table.append(head, body);
  const wrap = el('div', 'relative overflow-x-auto');
  wrap.append(table);
  return cardFrame({
    key: 'ai.fanout_top',
    title: 'Fan-out queries',
    meta: `ChatGPT only · ${fanout.meanQueries.toFixed(1)} searches per answer`,
    body: wrap,
    flush: true,
  });
}

// -------------------------------------------------------------------------------------------------
// Key changes and the collection calendar

export function changesCard(ctx) {
  const { model, scope } = ctx;
  const items = [];
  const platforms = scope.platform === 'all' ? PLATFORM_CODES : [scope.platform];
  platforms.forEach((code) => {
    const cell = model.cells.mention[code];
    if (cell.state === 'ok' && cell.change?.detectable) {
      const points = (cell.change.value * 100).toFixed(1);
      items.push({ level: cell.change.value < 0 ? 'attention' : 'change', text: `${engineName(code)} mention rate is ${pct0(cell.value)}, ${cell.change.value < 0 ? 'down' : 'up'} ${Math.abs(points)} points (detectable)`, detail: `${formatInteger(cell.counts.k)} of ${formatInteger(cell.counts.n)} answers` });
    }
  });
  const leading = gapFor(model).filter((entry) => entry.lost > 0).sort((a, b) => b.lost - a.lost)[0];
  if (leading) items.push({ level: 'change', text: `${leading.lost} prompts name ${leading.name} more often than you`, detail: `of ${leading.compared} compared` });
  const domains = domainsFor(model);
  const fresh = domains.rows.filter((row) => row.isNew);
  if (fresh.length > 0) items.push({ level: 'notice', text: `${fresh.length} new cited domains: ${fresh.map((row) => row.domain).join(', ')}`, detail: 'cited at least twice, none before' });
  Object.entries(RUN_CALENDAR.notes).forEach(([key, note]) => {
    const [code, week] = key.split(':');
    if (platforms.includes(code)) items.push({ level: 'attention', text: `${engineName(code)} run of ${WEEK_LABELS[Number(week)]} was partial`, detail: note });
  });
  if (platforms.includes('chatgpt_web')) items.push({ level: 'notice', text: 'ChatGPT reported a new model on Sep 21', detail: 'Rates before and after are marked on the trend' });
  if (items.length === 0) items.push({ level: 'notice', text: 'No change beyond normal variation in these 28 days', detail: '' });
  const order = { attention: 0, change: 1, notice: 2 };
  items.sort((a, b) => order[a.level] - order[b.level]);
  const list = el('ul', 'flex flex-col');
  const LEVEL_LABEL = { attention: 'Needs attention', change: 'Change', notice: 'Notice' };
  const LEVEL_ICON = { attention: 'triangle-alert', change: 'trending-up', notice: 'info' };
  items.slice(0, 7).forEach((item) => {
    const li = el('li', 'py-2 border-t border-border-subtle first:border-t-0 flex items-start gap-2.5');
    const mark = el('span', `mt-0.5 shrink-0 ${item.level === 'attention' ? 'text-warning-text' : 'text-foreground-tertiary'}`);
    mark.append(icon(LEVEL_ICON[item.level], 'size-icon-sm'), el('span', 'sr-only', `${LEVEL_LABEL[item.level]}: `));
    const text = el('div', 'min-w-0');
    text.append(el('p', 'type-body text-foreground', item.text));
    if (item.detail) text.append(el('p', 'type-meta', item.detail));
    li.append(mark, text);
    list.append(li);
  });
  return cardFrame({ key: 'activity.key_changes', title: 'Key changes', meta: 'last 28 days', body: list });
}

export function calendarCard() {
  const table = el('table', 'w-full');
  const head = el('thead');
  const headRow = el('tr');
  headRow.append(el('th', 'text-left pb-1'));
  RUN_CALENDAR.weeks.forEach((week) => {
    const th = el('th', 'type-micro text-foreground-tertiary font-normal pb-1', week.replace(' ', ' '));
    th.scope = 'col';
    headRow.append(th);
  });
  head.append(headRow);
  const body = el('tbody');
  const STATUS = {
    ok: { label: 'Complete', cls: 'bg-positive-subtle border border-positive-border text-positive-text', glyph: 'circle-check' },
    partial: { label: 'Partial', cls: 'bg-warning-subtle border border-warning-border text-warning-text', glyph: 'triangle-alert' },
    missed: { label: 'Missed', cls: 'bg-negative-subtle border border-negative-border text-negative-text', glyph: 'circle-alert' },
  };
  PLATFORM_CODES.forEach((code) => {
    const tr = el('tr');
    const th = el('th', 'text-left pr-3 py-1 font-normal whitespace-nowrap');
    th.scope = 'row';
    th.append(platformLabel(code));
    tr.append(th);
    RUN_CALENDAR.status[code].forEach((status, week) => {
      const td = el('td', 'p-0.5');
      const cell = el('div', `h-7 rounded-xs flex items-center justify-center ${STATUS[status].cls}`);
      const note = RUN_CALENDAR.notes[`${code}:${week}`];
      cell.dataset.tip = `${platformOf(code).name}, ${RUN_CALENDAR.weeks[week]}: ${STATUS[status].label.toLowerCase()}${note ? `, ${note}` : ''}`;
      cell.append(icon(STATUS[status].glyph, 'size-icon-sm'), el('span', 'sr-only', STATUS[status].label));
      td.append(cell);
      tr.append(td);
    });
    body.append(tr);
  });
  table.append(head, body);
  const wrap = el('div', 'relative overflow-x-auto');
  wrap.append(table);
  return cardFrame({
    key: 'ops.answer_calendar',
    title: 'Collection runs',
    meta: `run ${RUNS.number}, weekly`,
    body: wrap,
  });
}

export { GROUPS };
