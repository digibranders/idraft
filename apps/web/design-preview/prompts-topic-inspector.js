/* global window, echarts */
/**
 * The topic inspector (440 px): what the prompts of one topic add up to. Tabs: Overview (rates, visibility
 * trend against competitors, engines, top prompts), Prompts, Competitors, Related. The Topics tab tells it
 * which topics are in scope and in what order.
 */
import { formatInteger, formatPercent, formatSampleCount } from './vendor/format/number.js';
import { WEEKS, averageFor, changeFor, clamp, groupAverage, groupChange, groupEntities, groupRate, seeded, topicKeywords } from './prompts-data.js';
import { el, keywordRow, percent0, plural } from './prompts-parts.js';
import { deltaNode, scopeCodes, scopeEngines, scopeText } from './prompts-state.js';

const ui = window.PreviewUI;
const charts = window.PreviewCharts;
const { $, engineLogo } = ui;

const inspector = $('#inspector');
const trendEl = $('#chart-topic-trend');
let host = null;
let openTopicId = null;
let trendChart = null;

const topicOf = (id) => host.topics().find((topic) => topic.id === id);
const hash = (text) => [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) | 0, 7);

// -------------------------------------------------------------------------------------------------
// Overview

function metricCard(label, value, change, note) {
  const card = el('div', 'rounded-lg border border-border bg-surface p-3 min-w-0');
  const dd = el('dd', 'mt-1 flex flex-col min-w-0');
  dd.append(el('span', `type-metric-sm num truncate${value === null ? ' text-foreground-tertiary' : ''}`, value === null ? 'n/a' : percent0(value)));
  // The change and the note each get a line: side by side they do not fit a third of the drawer
  const delta = deltaNode(change, 1);
  if (delta) {
    delta.classList.add('mt-0.5', 'type-body-strong');
    dd.append(delta);
  }
  dd.append(el('span', 'mt-0.5 type-meta num truncate', note));
  card.append(el('dt', 'type-label truncate', label), dd);
  return card;
}

function fillNumbers(topic) {
  const scope = scopeCodes();
  const note = scope.length > 1 ? `avg of ${scope.length}` : scopeEngines()[0].name;
  const sov = groupAverage(topic.prompts, scope, 'sov');
  $('[data-topic-kv]', inspector).replaceChildren(
    metricCard('Mention rate', topic.mention.value, topic.mentionChange, note),
    metricCard('Citation rate', topic.citation.value, groupChange(topic.prompts, scope, 'citation'), note),
    metricCard('Share of voice', sov.value, null, note),
  );
}

/** One engine: name, share bar, rate, and the counts behind it. */
function engineRow(topic, engine) {
  const { rate, pooled } = groupRate(topic.prompts, engine.code, 'mention');
  const row = el('li', 'h-9 flex items-center gap-3');
  const label = el('span', 'w-28 shrink-0 flex items-center gap-2 min-w-0 type-body text-foreground');
  label.append(engineLogo(engine.name), el('span', 'truncate', engine.name));
  const track = el('span', 'flex-1 h-2 rounded-full bg-neutral-subtle overflow-hidden');
  track.setAttribute('aria-hidden', 'true');
  const fill = el('span', 'block h-full rounded-full bg-primary');
  fill.style.width = `${(rate ?? 0) * 100}%`;
  track.append(fill);
  row.append(
    label,
    track,
    el('span', `w-10 shrink-0 text-right type-table num${rate === null ? ' text-foreground-tertiary' : ''}`, rate === null ? 'n/a' : percent0(rate)),
    el('span', 'w-20 shrink-0 text-right type-meta num', pooled.n === 0 ? 'no data' : formatSampleCount(pooled.k, pooled.n)),
  );
  return row;
}

/** Weekly mention rate of each entity: the own brand's real trend, and a steady line around each competitor's rate. */
function entitySeries(topic) {
  const entities = groupEntities(topic.prompts, scopeCodes()).filter((entity) => entity.rate !== null);
  const own = entities.find((entity) => entity.own);
  const rivals = entities
    .filter((entity) => !entity.own)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 3);
  const random = seeded(hash(topic.id));
  return [
    ...(own ? [{ ...own, name: `${own.name} (you)`, values: topic.trend.map((point) => (point === null ? null : point * 100)) }] : []),
    ...rivals.map((rival) => ({ ...rival, values: WEEKS.map((_, week) => (week === WEEKS.length - 1 ? rival.rate * 100 : clamp(rival.rate + (random() - 0.5) * 0.06, 0, 1) * 100)) })),
  ];
}

function renderTrend() {
  if (!openTopicId || trendEl.clientWidth === 0) return;
  const topic = topicOf(openTopicId);
  if (!topic) return;
  const series = entitySeries(topic);
  trendChart ??= echarts.init(trendEl, null, { renderer: 'canvas' });
  const axes = charts.axisTheme();
  // The axis ends on a multiple of 20 above the highest value, so its middle tick is a round number
  const top = Math.min(100, Math.ceil((Math.max(10, ...series.flatMap((entry) => entry.values.filter((value) => value !== null))) + 5) / 20) * 20);
  trendEl.setAttribute('aria-label', `Mention rate in ${topic.name} over 8 weeks: ${series.map((entry) => `${entry.name} ${Math.round(entry.values.at(-1) ?? 0)}%`).join(', ')}`);
  trendChart.setOption(
    {
      animation: false,
      grid: charts.GRID,
      xAxis: { type: 'category', data: WEEKS, boundaryGap: false, ...axes.x, axisLabel: { ...axes.x.axisLabel, interval: 1 } },
      yAxis: { type: 'value', min: 0, max: top, interval: top / 2, ...axes.y, axisLabel: { ...axes.y.axisLabel, formatter: (v) => `${v}%` } },
      tooltip: charts.tooltipTheme((rows) => rows.map((row) => ({ color: row.color, name: row.seriesName, value: row.value === null || row.value === undefined ? 'n/a' : `${Math.round(row.value)}%` }))),
      series: series.map((entry) => ({
        name: entry.name,
        type: 'line',
        data: entry.values,
        connectNulls: false,
        color: charts.token(entry.token),
        lineStyle: { width: entry.own ? 2 : 1.5, join: 'round' },
        symbol: 'circle',
        symbolSize: 5,
        showSymbol: false,
        emphasis: { disabled: true },
      })),
    },
    true,
  );
  trendChart.resize();
  $('[data-topic-legend]', inspector).replaceChildren(
    ...series.map((entry) => {
      const item = el('li', 'flex items-center gap-1.5');
      const dot = el('span', `size-2 shrink-0 rounded-full ${entry.swatch}`);
      dot.setAttribute('aria-hidden', 'true');
      item.append(dot, entry.name);
      return item;
    }),
  );
}

const row = (cells, className = '') => {
  const tr = el('tr', `h-row-compact border-t border-border-subtle${className}`);
  tr.append(...cells);
  return tr;
};
const rateText = (value) => el('span', value === null ? 'text-foreground-tertiary' : '', value === null ? 'n/a' : percent0(value));

function promptCells(prompt, withChange) {
  const scope = scopeCodes();
  // The prompt is a button in its cell, so the row keeps its cells for assistive technology
  const name = el('td', 'pl-4 max-w-0 w-full');
  const text = el('button', 'block w-full truncate text-left text-foreground hover:underline', prompt.text);
  text.type = 'button';
  text.dataset.tip = prompt.text;
  name.append(text);
  const mention = el('td', 'px-2 num');
  mention.append(rateText(averageFor(prompt, scope, 'mention').value));
  const citation = el('td', `${withChange ? 'px-2' : 'pl-2 pr-4'} num`);
  citation.append(rateText(averageFor(prompt, scope, 'citation').value));
  const cells = [name, mention, citation];
  if (withChange) {
    const change = el('td', 'pl-2 pr-4');
    change.append(deltaNode(changeFor(prompt, scope, 'mention')) ?? el('span', 'text-foreground-tertiary', 'n/a'));
    cells.push(change);
  }
  return cells;
}

function promptRow(prompt, withChange) {
  const tr = row(promptCells(prompt, withChange), ' hover:bg-surface-hover cursor-pointer');
  tr.dataset.topicPrompt = prompt.id;
  return tr;
}

/** The search side of the topic: its tracked keywords, which the prompt filters do not reach. */
function fillSearch(topic) {
  const stat = (label, value, note) => {
    const item = el('div', 'min-w-0');
    const dd = el('dd', 'mt-0.5 flex flex-col min-w-0');
    dd.append(el('span', 'type-body-strong num text-foreground truncate', value), el('span', 'type-meta num truncate', note));
    item.append(el('dt', 'type-label truncate', label), dd);
    return item;
  };
  $('[data-topic-seo]', inspector).replaceChildren(
    stat('Keywords', formatInteger(topic.seo.tracked), `${formatInteger(topic.seo.checked)} checked`),
    stat('SEO visibility', formatPercent(topic.seo.visibility), 'volume-weighted'),
    stat('Top 10', formatInteger(topic.seo.top10), `of ${formatInteger(topic.seo.checked)} checked`),
  );
}

function fillOverview(topic) {
  fillNumbers(topic);
  fillSearch(topic);
  $('[data-topic-trend-note]', inspector).textContent = `mention rate, ${scopeCodes().length > 1 ? `avg of ${scopeCodes().length} engines` : scopeEngines()[0].name}`;
  $('[data-topic-engines]', inspector).replaceChildren(...scopeEngines().map((engine) => engineRow(topic, engine)));
  $('[data-topic-top-prompts]', inspector).replaceChildren(...host.promptsOf(topic).slice(0, 5).map((prompt) => promptRow(prompt, true)));
}

// -------------------------------------------------------------------------------------------------
// Prompts, Competitors, Related

function fillPrompts(topic) {
  const prompts = host.promptsOf(topic);
  $('[data-topic-prompts-tab]', inspector).textContent = `Prompts (${formatInteger(prompts.length)})`;
  $('[data-topic-prompts-note]', inspector).textContent = `${scopeText()}, most mentioned first`;
  $('[data-topic-prompts]', inspector).replaceChildren(...prompts.map((prompt) => promptRow(prompt, false)));
}

function fillCompetitors(topic) {
  const engines = scopeEngines();
  const headRow = el('tr', 'text-left border-t border-border-subtle bg-surface-subtle');
  headRow.append(el('th', 'pl-4 h-row-compact type-label whitespace-nowrap', 'Entity'));
  engines.forEach((engine, i) => headRow.append(el('th', `${i === engines.length - 1 ? 'pr-4 ' : ''}h-row-compact type-label whitespace-nowrap`, engine.name)));
  $('[data-topic-entities-head]', inspector).replaceChildren(headRow);
  // One set of entities per engine, so each column is that engine's own rate
  const perEngine = engines.map((engine) => groupEntities(topic.prompts, [engine.code]));
  const names = perEngine[0].map((entity) => entity);
  $('[data-topic-entities]', inspector).replaceChildren(
    ...names.map((entity, e) => {
      const name = el('td', 'pl-4');
      const line = el('span', 'flex items-center gap-2 min-w-0');
      const swatch = el('span', `size-2 shrink-0 rounded-full ${entity.swatch}`);
      swatch.setAttribute('aria-hidden', 'true');
      line.append(swatch, el('span', `truncate${entity.own ? ' type-body-strong text-foreground' : ''}`, entity.own ? `${entity.name} (you)` : entity.name));
      name.append(line);
      return row([
        name,
        ...engines.map((_, i) => {
          const cell = el('td', `${i === engines.length - 1 ? 'pr-4 ' : ''}num`);
          cell.append(rateText(perEngine[i][e].rate));
          return cell;
        }),
      ]);
    }),
  );
}

function fillRelated(topic) {
  const related = host.topics().filter((other) => other.parent === topic.parent && other.id !== topic.id);
  $('[data-topic-related-note]', inspector).textContent = `also under ${topic.parent}`;
  const none = el('td', 'px-4 type-meta', `No other topic under ${topic.parent} is in this scope.`);
  none.colSpan = 3;
  $('[data-topic-related]', inspector).replaceChildren(
    ...(related.length === 0
      ? [row([none])]
      : related.map((other) => {
          const name = el('td', 'pl-4');
          const open = el('button', 'block w-full truncate text-left text-foreground hover:underline', other.name);
          open.type = 'button';
          name.append(open);
          const tr = row([name, el('td', 'px-2 num', formatInteger(other.prompts.length)), el('td', 'pl-2 pr-4 num')], ' hover:bg-surface-hover cursor-pointer');
          tr.lastElementChild.append(rateText(other.mention.value));
          tr.dataset.topicRelated = other.id;
          return tr;
        })),
  );
  $('[data-topic-keywords]', inspector).replaceChildren(...topicKeywords(topic.name).map(keywordRow));
}

// -------------------------------------------------------------------------------------------------
// Shell

function context(topic) {
  const at = host.order().indexOf(topic.id);
  const position = at === -1 ? 'not in this list' : `${at + 1} of ${host.order().length}`;
  $('[data-inspector-context]', inspector).textContent = `Topic · ${position} · Updated ${topic.updated.text}`;
}

function fillTopic(id) {
  const topic = topicOf(id);
  openTopicId = id;
  $('#inspector-title').textContent = topic.name;
  $('[data-inspector-badges]', inspector).replaceChildren(ui.badge(topic.parent), ui.badge(plural(topic.prompts.length, 'prompt')), ui.badge(scopeText()));
  context(topic);
  fillOverview(topic);
  fillPrompts(topic);
  fillCompetitors(topic);
  fillRelated(topic);
  window.requestAnimationFrame(renderTrend);
}

/** After the filters or the list changed under an open topic: refill it, or close it when it left the scope. */
export function refreshTopicInspector() {
  const open = ui.inspectorState();
  if (!open.open || open.type !== 'topic') return;
  if (!topicOf(open.id)) {
    ui.closeInspector(true);
    return;
  }
  fillTopic(open.id);
  ui.syncActiveRow();
}

/**
 * Registers the topic type with the inspector shell. `page` is the Topics tab's side of the contract:
 * topics() in scope, order() of the ids on screen, promptsOf(topic) most mentioned first,
 * openPrompt(id, opener, ids), openTopic(id, opener), addPrompt(topicName).
 */
export function initTopicInspector(page) {
  host = page;
  ui.registerInspectorType('topic', {
    noun: 'topic',
    back: 'Topics',
    width: 440,
    defaultTab: 'topic-overview',
    has: (id) => topicOf(id) !== undefined,
    fill: fillTopic,
    order: host.order,
  });

  const activate = (event) => {
    const promptRowEl = event.target.closest('[data-topic-prompt]');
    const relatedRow = event.target.closest('[data-topic-related]');
    const topic = topicOf(openTopicId);
    if (promptRowEl && topic) host.openPrompt(promptRowEl.dataset.topicPrompt, undefined, host.promptsOf(topic).map((prompt) => prompt.id));
    else if (relatedRow) host.openTopic(relatedRow.dataset.topicRelated);
  };
  // A click anywhere in the row opens it; the button in its first cell is what the keyboard reaches
  inspector.addEventListener('click', activate);
  $('[data-topic-view-all]', inspector).addEventListener('click', () => {
    ui.selectInspectorTab('topic-prompts');
    $('[data-topic-prompts-tab]', inspector).focus();
  });
  $('[data-topic-add]', inspector).addEventListener('click', () => {
    const topic = topicOf(openTopicId);
    if (topic) host.addPrompt(topic.name, $('[data-topic-add]', inspector));
  });

  inspector.addEventListener('inspector-tab', (event) => {
    if (event.detail.tab === 'topic-overview') window.requestAnimationFrame(renderTrend);
  });
  if (window.ResizeObserver) new window.ResizeObserver(() => trendChart?.resize()).observe(trendEl);
  new window.MutationObserver(() => !inspector.hidden && renderTrend()).observe(window.document.documentElement, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('inspector-close', () => {
    openTopicId = null;
  });
}
