/* global document, window, echarts */
/**
 * The prompt inspector (23 section 4.2, 24 section 9.5): 440 px, with the tabs Latest, History, Citations,
 * Competitors and Stats. The Explorer tells it where a prompt sits in the list; everything else comes from
 * the prompt's own counts.
 */
import { formatInteger, formatInterval, formatSampleCount } from './vendor/format/number.js';
import { rateState, wilsonInterval } from './vendor/stats/index.js';
import { COMPETITORS, ENGINES, NOT_CLASSIFIED, OWN, PROMPT_BY_ID, RELATED_KEYWORDS, TYPE_LABEL, WEEKS, answerFor, averageFor, countsOf, engineOf, observationsOf, measures, rollingCounts, seeded, shuffled, topicPath, updatedOf } from './prompts-data.js';
import { NEUTRAL_BADGE, el, insufficient, keywordRow, percent0, plural } from './prompts-parts.js';

const ui = window.PreviewUI;
const charts = window.PreviewCharts;
const { $, icon, setSelectValue, engineLogo } = ui;

// -------------------------------------------------------------------------------------------------
// ResponsePreview: one answer, as the Latest tab shows it

function evidenceText(text) {
  const block = el('div', 'type-table text-foreground-secondary whitespace-pre-line line-clamp-6');
  for (const part of text.split(/(\{[^}]+\}|\[\d\])/)) {
    if (part.startsWith('{')) {
      const name = part.slice(1, -1);
      block.append(el('mark', name === OWN ? 'px-0.5 rounded-xs bg-primary-subtle text-primary-text type-body-strong' : 'px-0.5 rounded-xs bg-neutral-subtle text-foreground', name));
    } else if (/^\[\d\]$/.test(part)) block.append(el('span', 'px-1 rounded-xs bg-neutral-subtle text-neutral-text type-micro', part));
    else block.append(part);
  }
  return block;
}

const fact = (label, value) => {
  const item = el('span', 'flex items-baseline gap-1.5 whitespace-nowrap');
  item.append(el('span', 'text-foreground-tertiary', label), el('span', 'type-body-strong text-foreground', value));
  return item;
};

/** ResponsePreview (23 section 5.1): the latest valid observation on one engine. */
function responsePreview(prompt, engine) {
  const card = el('article', 'rounded-lg border border-border bg-surface p-4 flex flex-col gap-2');
  const header = el('header', 'flex items-center gap-2 min-w-0');
  header.append(engineLogo(engine.name), el('h3', 'type-subsection-title', engine.name));
  const latest = observationsOf(prompt).find((observation) => observation.engine.code === engine.code);
  if (!latest) {
    card.append(header, el('p', 'type-meta', prompt.pending ? 'Not observed yet. The first answer arrives with the next run.' : 'Not observed in this window.'));
    return card;
  }
  header.append(el('span', 'type-meta num truncate', `${latest.day}, ${latest.time} · replicate ${latest.replicate}`));
  header.append(el('span', 'ml-auto shrink-0 h-badge inline-flex items-center px-2 rounded-sm bg-positive-subtle text-positive-text type-micro', 'Valid'));
  const answer = answerFor(prompt, latest);
  const facts = el('p', 'flex flex-wrap gap-x-4 gap-y-1 type-meta');
  facts.append(fact('Mentioned', latest.mentioned ? 'Yes' : 'No'), fact('Cited', latest.cited ? 'Yes' : 'No'));
  if (answer.rank) facts.append(fact('Rank', `${answer.rank} of ${answer.listed}`));
  else facts.append(fact('Recommended', latest.recommended === null ? 'n/a' : latest.recommended ? 'Yes' : 'No'));
  const footer = el('footer', 'flex flex-wrap items-center gap-1.5');
  answer.sources.slice(0, 3).forEach((domain) => footer.append(el('span', `${NEUTRAL_BADGE}`, domain)));
  if (answer.sources.length > 3) footer.append(el('span', 'h-badge inline-flex items-center px-2 rounded-sm border border-neutral-border bg-surface text-neutral-text type-micro', `+${answer.sources.length - 3}`));
  const open = el('button', 'ml-auto h-control-sm px-2 rounded-md border border-border bg-surface flex items-center gap-1.5 whitespace-nowrap type-body-strong text-foreground hover:bg-surface-hover', 'Open evidence');
  open.type = 'button';
  open.dataset.previewNote = 'The evidence viewer';
  footer.append(open);
  card.append(header, evidenceText(answer.text), facts, footer);
  return card;
}

// -------------------------------------------------------------------------------------------------
// Prompt inspector (23 section 4.2, 440 px)

const inspector = $('#inspector');
let openPromptId = null;
/** What the Explorer knows and the inspector does not: where a prompt sits in the list, and which can be opened. */
let explorer = null;

function inspectorContext(prompt) {
  const updated = prompt.pending ? 'Not observed yet' : `Updated ${updatedOf(prompt).text}`;
  $('[data-inspector-context]', inspector).textContent = `Prompt · ${explorer.positionOf(prompt)} · ${updated}`;
}

function strengthCard(label, logo, value, note) {
  const card = el('div', 'rounded-lg border border-border bg-surface p-3 min-w-0');
  const dt = el('dt', 'flex items-center gap-1.5 min-w-0 type-label');
  if (logo) dt.append(engineLogo(logo));
  dt.append(el('span', 'truncate', label));
  const dd = el('dd', 'mt-1 flex items-baseline gap-2 min-w-0');
  dd.append(value, el('span', 'type-meta num truncate', note));
  card.append(dt, dd);
  return card;
}

function fillStrip(prompt) {
  const cards = ENGINES.map((engine) => {
    const counts = countsOf(prompt, engine.code, 'mention');
    const status = rateState(counts.n);
    const value = status === 'ok' ? el('span', 'type-metric-sm num shrink-0', percent0(counts.k / counts.n)) : el('span', 'type-metric-sm num shrink-0 text-foreground-tertiary', 'n/a');
    const note = status === 'ok' ? `${formatSampleCount(counts.k, counts.n)} obs` : status === 'insufficient' ? `${plural(counts.n, 'observation')}, too few` : 'not observed';
    return strengthCard(engine.name, engine.name, value, note);
  });
  const citation = averageFor(prompt, ENGINES.map((engine) => engine.code), 'citation');
  const value = el('span', `type-metric-sm num shrink-0${citation.value === null ? ' text-foreground-tertiary' : ''}`, citation.value === null ? 'n/a' : percent0(citation.value));
  cards.push(strengthCard('Citation rate', null, value, citation.used > 0 ? `avg of ${citation.used}` : ENGINES.some((engine) => prompt.engines[engine.code].n > 0) ? 'insufficient data' : 'not observed'));
  $('[data-prompt-kv]', inspector).replaceChildren(...cards);
}

/** Yes, no, or "n/a" where the engine's answers are not classified for it (null). */
const yesNo = (value, label) => {
  const cell = el('td', 'text-center');
  if (value === null) {
    const none = el('span', 'type-meta', 'n/a');
    none.dataset.tip = `${label}: ${NOT_CLASSIFIED}`;
    cell.append(none);
    return cell;
  }
  const mark = icon(value ? 'check' : 'minus', `inline size-icon-sm ${value ? 'text-foreground' : 'text-foreground-muted'}`);
  cell.append(mark, el('span', 'sr-only', `${label}: ${value ? 'yes' : 'no'}`));
  return cell;
};

function fillHistory(prompt) {
  $('[data-prompt-observations]', inspector).replaceChildren(
    ...observationsOf(prompt)
      .slice(0, 10)
      .map((observation) => {
        const row = el('tr', 'h-row-compact border-t border-border-subtle');
        const first = el('td', 'pl-4');
        const line = el('span', 'flex items-center gap-2 min-w-0');
        line.append(el('span', 'w-12 shrink-0 type-meta num', observation.day), engineLogo(observation.engine.name), el('span', 'truncate', observation.engine.name));
        first.append(line);
        first.dataset.tip = `${observation.day}, ${observation.time} · replicate ${observation.replicate}`;
        const recommended = yesNo(observation.recommended, 'Recommended');
        recommended.classList.add('pr-4');
        row.append(first, yesNo(observation.mentioned, 'Mentioned'), yesNo(observation.cited, 'Cited'), recommended);
        return row;
      }),
  );
  if (observationsOf(prompt).length === 0) {
    const row = el('tr', 'h-row-compact border-t border-border-subtle');
    const cell = el('td', 'px-4 type-meta', 'No observations yet.');
    cell.colSpan = 4;
    row.append(cell);
    $('[data-prompt-observations]', inspector).replaceChildren(row);
  }

  const events = [];
  if (prompt.pending) events.push(['Sep 30', 'plus', `Added to the ${prompt.panel} panel by Ana Brandt`]);
  if (prompt.versionChanged) events.push([prompt.versionDay, 'git-commit-vertical', `Version ${prompt.version}: wording changed. Charts show a boundary here`]);
  if (prompt.stale) events.push(['Sep 28', 'triangle-alert', 'No valid observation in the weekly run']);
  if (!prompt.pending) events.push(['Aug 31', 'sparkles', 'Gemini reported a new model']);
  if (prompt.panel === 'Core') events.push(['Jun 1', 'lock', 'Added to the core panel']);
  else if (!prompt.pending) events.push(['Aug 4', 'plus', `Added to the ${prompt.panel} panel`]);
  $('[data-prompt-events]', inspector).replaceChildren(
    ...events.map(([day, glyph, text]) => {
      const item = el('li', 'min-h-9 px-4 py-2 flex items-center gap-3 border-t border-border-subtle');
      item.append(el('span', 'w-12 shrink-0 type-meta num', day), icon(glyph, 'size-icon shrink-0 text-foreground-tertiary'), el('span', 'min-w-0 type-table', text));
      return item;
    }),
  );
}

function simpleRow(cells) {
  const row = el('tr', 'h-row-compact border-t border-border-subtle');
  row.append(...cells);
  return row;
}

function fillCitations(prompt) {
  const random = seeded(prompt.seed + 301);
  const observed = ENGINES.reduce((sum, engine) => sum + prompt.engines[engine.code].n, 0);
  const own = ENGINES.reduce((sum, engine) => sum + prompt.engines[engine.code].citation, 0);
  $('[data-prompt-citation-scope]', inspector).textContent = `${plural(observed, 'observation')}, all engines`;
  const domains = [
    { domain: 'northwind.com', role: 'Own', count: own, page: '/crm/startups' },
    { domain: 'hubspot.com', role: 'Competitor', count: Math.round(observed * (0.2 + random() * 0.35)), page: '/products/crm' },
    { domain: 'pipedrive.com', role: 'Competitor', count: Math.round(observed * (0.1 + random() * 0.25)), page: '/en/features' },
    { domain: 'g2.com', role: 'Third party', count: Math.round(observed * (0.25 + random() * 0.4)), page: '/categories/crm' },
    { domain: 'techradar.com', role: 'Third party', count: Math.round(observed * (0.15 + random() * 0.3)), page: '/best/best-crm-for-startups' },
    { domain: 'capterra.com', role: 'Third party', count: Math.round(observed * (0.1 + random() * 0.3)), page: '/customer-relationship-management-software' },
    { domain: 'reddit.com', role: 'Third party', count: Math.round(observed * random() * 0.3), page: '/r/sales' },
  ]
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const none = (columns, text) => {
    const cell = el('td', 'px-4 type-meta', text);
    cell.colSpan = columns;
    return simpleRow([cell]);
  };
  $('[data-prompt-domains]', inspector).replaceChildren(
    ...(domains.length === 0
      ? [none(3, 'No citations in this window.')]
      : domains.map((entry) => {
          const name = el('td', `pl-4 truncate max-w-40${entry.role === 'Own' ? ' text-primary-text type-body-strong' : ''}`, entry.domain);
          const role = el('td', '');
          role.append(el('span', entry.role === 'Own' ? 'h-badge inline-flex items-center px-2 rounded-sm bg-positive-subtle text-positive-text type-micro' : NEUTRAL_BADGE, entry.role));
          return simpleRow([name, role, el('td', 'pr-4 text-right num whitespace-nowrap', `${formatSampleCount(entry.count, observed)} obs`)]);
        })),
  );
  $('[data-prompt-pages]', inspector).replaceChildren(
    ...(domains.length === 0
      ? [none(2, 'No cited pages in this window.')]
      : domains.map((entry) => {
          const page = el('td', 'pl-4 max-w-60');
          page.append(el('span', `block truncate type-mono ${entry.role === 'Own' ? 'text-primary-text' : 'text-foreground-secondary'}`, `${entry.domain}${entry.page}`));
          return simpleRow([page, el('td', 'pr-4 text-right num', formatInteger(Math.max(1, Math.round(entry.count * 0.7))))]);
        })),
  );
}

function countCell(counts, className) {
  const cell = el('td', `${className} text-right num whitespace-nowrap`);
  const status = rateState(counts.n);
  if (counts.reason) {
    const none = el('span', 'text-foreground-tertiary', 'n/a');
    none.dataset.tip = counts.reason;
    cell.append(none);
  } else if (status === 'none') cell.append(el('span', 'text-foreground-tertiary', 'n/a'));
  else if (status === 'insufficient') cell.append(el('span', 'text-foreground-tertiary', `${counts.n} obs`));
  else cell.textContent = formatSampleCount(counts.k, counts.n);
  return cell;
}

function fillCompetitors(prompt) {
  const metric = $('[data-prompt-entity-metric] [aria-checked="true"]', inspector).dataset.value;
  const headRow = el('tr', 'text-left border-t border-border-subtle bg-surface-subtle');
  headRow.append(el('th', 'pl-4 h-row-compact type-label whitespace-nowrap', 'Entity'));
  ENGINES.forEach((engine, i) => headRow.append(el('th', `${i === ENGINES.length - 1 ? 'pr-4 ' : ''}h-row-compact type-label whitespace-nowrap text-right`, engine.name)));
  $('[data-prompt-entities-head]', inspector).replaceChildren(headRow);

  const entities = [
    { name: `${OWN} (you)`, own: true, counts: (code) => countsOf(prompt, code, metric) },
    ...COMPETITORS.map((competitor, c) => ({
      name: competitor.name,
      swatch: competitor.swatch,
      // Roughly half of a competitor's mentions are recommendations in this fixture
      counts: (code) => {
        const mentions = prompt.engines[code].competitors[c];
        if (!measures(code, metric)) return { k: 0, n: 0, observations: prompt.engines[code].n, reason: NOT_CLASSIFIED };
        return { k: metric === 'mention' ? mentions : Math.round(mentions * 0.5), n: prompt.engines[code].n };
      },
    })),
  ];
  $('[data-prompt-entities]', inspector).replaceChildren(
    ...entities.map((entity) => {
      const name = el('td', 'pl-4');
      const line = el('span', 'flex items-center gap-2 min-w-0');
      const swatch = el('span', `size-2 shrink-0 rounded-full ${entity.own ? 'bg-chart-1' : entity.swatch}`);
      swatch.setAttribute('aria-hidden', 'true');
      line.append(swatch, el('span', `truncate${entity.own ? ' type-body-strong text-foreground' : ''}`, entity.name));
      name.append(line);
      return simpleRow([name, ...ENGINES.map((engine, i) => countCell(entity.counts(engine.code), i === ENGINES.length - 1 ? 'pr-4' : ''))]);
    }),
  );

  const random = seeded(prompt.seed + 401);
  const keywords = shuffled(RELATED_KEYWORDS, random).slice(0, prompt.branded ? 1 : 3);
  $('[data-prompt-keywords]', inspector).replaceChildren(...keywords.map(keywordRow));
}

inspector.addEventListener('click', (event) => {
  if (event.target.closest('[data-prompt-entity-metric] [role="radio"]') && openPromptId) fillCompetitors(PROMPT_BY_ID.get(openPromptId));
});

/** ConfidenceIndicator (23 section 8.2): a 48 x 12 px interval bar on the shared scale 0% to 100%, with its text. */
function confidenceIndicator(counts) {
  const interval = wilsonInterval(counts.k, counts.n);
  const wrap = el('span', 'flex items-center gap-2');
  const bar = el('span', 'relative w-12 h-3 shrink-0');
  bar.setAttribute('aria-hidden', 'true');
  const axis = el('span', 'absolute inset-x-0 top-1/2 h-px bg-border-strong');
  const segment = el('span', 'absolute top-1/2 h-0.5 -translate-y-1/2 bg-foreground-secondary');
  segment.style.left = `${interval.low * 100}%`;
  segment.style.width = `${(interval.high - interval.low) * 100}%`;
  const point = el('span', 'absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground');
  point.style.left = `${(counts.k / counts.n) * 100}%`;
  bar.append(axis, segment, point);
  const text = el('span', 'type-meta num whitespace-nowrap', formatInterval(interval.low, interval.high));
  wrap.append(bar, text);
  wrap.setAttribute('aria-label', `95% interval ${formatInterval(interval.low, interval.high)}`);
  wrap.setAttribute('role', 'img');
  return wrap;
}

function fillStats(prompt) {
  for (const metric of ['mention', 'citation']) {
    $(`[data-prompt-stats-${metric}]`, inspector).replaceChildren(
      ...ENGINES.map((engine) => {
        const counts = countsOf(prompt, engine.code, metric);
        const name = el('td', 'pl-4');
        const line = el('span', 'flex items-center gap-2 min-w-0');
        line.append(engineLogo(engine.name), el('span', 'truncate', engine.name));
        name.append(line);
        const status = rateState(counts.n);
        if (status !== 'ok') {
          const gap = el('td', 'pr-4 pl-3');
          gap.colSpan = 3;
          gap.append(status === 'none' ? el('span', 'type-meta', 'Not observed in this window') : insufficient(`Insufficient data: ${plural(counts.n, 'observation')}`));
          return simpleRow([name, gap]);
        }
        const interval = el('td', 'pl-3');
        interval.append(confidenceIndicator(counts));
        return simpleRow([name, el('td', 'text-right num', percent0(counts.k / counts.n)), interval, el('td', 'pr-4 text-right type-meta num whitespace-nowrap', `${formatSampleCount(counts.k, counts.n)} obs`)]);
      }),
    );
  }
}

// History chart: the 28-day rolling mention rate at each weekly run, with its Wilson interval (17 section 7.3)
const historyEngine = $('#prompt-history-engine');
const historyEl = $('#chart-prompt-history');
let historyChart = null;

function renderHistoryChart() {
  if (!openPromptId) return;
  const prompt = PROMPT_BY_ID.get(openPromptId);
  const engine = engineOf(historyEngine.dataset.value);
  const counts = prompt.engines[engine.code];
  const note = $('[data-prompt-history-note]', inspector);
  const usable = rateState(counts.n) === 'ok';
  historyEl.hidden = !usable;
  if (!usable) {
    note.textContent = counts.n === 0 ? `${engine.name} has not observed this prompt in the window.` : `${plural(counts.n, 'observation')} on ${engine.name}: too few for a trend.`;
    return;
  }
  note.textContent = `28-day rolling rate at each weekly run, with its 95% interval. ${plural(counts.n, 'observation')} per point.`;
  if (historyEl.clientWidth === 0) return;
  historyChart ??= echarts.init(historyEl, null, { renderer: 'canvas' });
  const series = rollingCounts(prompt, engine.code);
  const intervals = series.map((point) => wilsonInterval(point.k, point.n));
  const axes = charts.axisTheme();
  const color = charts.token('chart-1');
  const value = (ratio) => Math.round(ratio * 1000) / 10;
  historyEl.setAttribute('aria-label', `Mention rate on ${engine.name} over 8 weeks, now ${percent0(counts.mention / counts.n)}`);
  historyChart.setOption(
    {
      animation: false,
      grid: { ...charts.GRID, right: prompt.versionChanged ? 28 : 16 },
      xAxis: { type: 'category', data: WEEKS, boundaryGap: false, ...axes.x, axisLabel: { ...axes.x.axisLabel, interval: 1 } },
      yAxis: { type: 'value', min: 0, max: 100, interval: 50, ...axes.y, axisLabel: { ...axes.y.axisLabel, formatter: (v) => `${v}%` } },
      tooltip: charts.tooltipTheme((rows) =>
        rows
          .filter((row) => row.seriesId === 'value')
          .flatMap((row) => {
            const point = series[row.dataIndex];
            const interval = intervals[row.dataIndex];
            return [
              { color: row.color, name: 'Mention rate', value: `${percent0(point.k / point.n)} (${formatSampleCount(point.k, point.n)})` },
              { color: charts.token('chart-reference'), name: '95% interval', value: formatInterval(interval.low, interval.high) },
            ];
          }),
      ),
      series: [
        { id: 'ci-low', type: 'line', stack: 'ci', data: intervals.map((interval) => value(interval.low)), lineStyle: { opacity: 0 }, symbol: 'none', silent: true, tooltip: { show: false } },
        { id: 'ci-band', type: 'line', stack: 'ci', data: intervals.map((interval) => value(interval.high - interval.low)), lineStyle: { opacity: 0 }, areaStyle: { color: charts.token('chart-1', 0.14) }, symbol: 'none', silent: true, tooltip: { show: false } },
        {
          id: 'value',
          type: 'line',
          data: series.map((point) => value(point.k / point.n)),
          color,
          lineStyle: { width: 2, join: 'round' },
          symbol: 'circle',
          symbolSize: 6,
          showSymbol: false,
          emphasis: { disabled: true },
          // A version boundary: the rates before and after it are not compared (17 section 9)
          markLine: prompt.versionChanged
            ? {
                silent: true,
                symbol: 'none',
                lineStyle: { color: charts.token('chart-axis'), type: 'dashed', width: 1 },
                label: { color: charts.token('chart-label'), fontFamily: charts.fontFamily(), fontSize: 12, formatter: `v${prompt.version}`, position: 'end', distance: 4 },
                data: [{ xAxis: prompt.versionDay }],
              }
            : undefined,
        },
      ],
    },
    true,
  );
  historyChart.resize();
}
historyEngine.addEventListener('change', renderHistoryChart);
inspector.addEventListener('inspector-tab', (event) => {
  if (event.detail.tab === 'history') window.requestAnimationFrame(renderHistoryChart);
});
if (window.ResizeObserver) new window.ResizeObserver(() => historyChart?.resize()).observe(historyEl);
new window.MutationObserver(() => !inspector.hidden && renderHistoryChart()).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

function fillPrompt(id) {
  const prompt = PROMPT_BY_ID.get(id);
  openPromptId = id;
  $('#inspector-title').textContent = `“${prompt.text}”`;
  const panel = ui.badge(prompt.panel);
  if (prompt.locked) panel.prepend(icon('lock', 'size-icon-xs mr-1'));
  const topic = el('button', `${NEUTRAL_BADGE} hover:bg-surface-hover disabled:hover:bg-neutral-subtle`, topicPath(prompt.topic));
  topic.type = 'button';
  topic.dataset.promptTopic = prompt.topic;
  topic.disabled = !explorer.hasTopic(prompt.topic);
  if (!topic.disabled) topic.dataset.tip = 'Open the topic';
  $('[data-inspector-badges]', inspector).replaceChildren(topic, ui.badge(TYPE_LABEL[prompt.type]), panel, ui.badge(`v${prompt.version}`), ...(prompt.branded ? [ui.badge('Branded')] : []));
  inspectorContext(prompt);
  fillStrip(prompt);
  $('[data-prompt-latest]', inspector).replaceChildren(...ENGINES.map((engine) => responsePreview(prompt, engine)));
  fillHistory(prompt);
  fillCitations(prompt);
  fillCompetitors(prompt);
  fillStats(prompt);
  // The engine with the most observations is the one worth a trend
  const busiest = [...ENGINES].sort((a, b) => prompt.engines[b.code].n - prompt.engines[a.code].n)[0];
  setSelectValue(historyEngine, busiest.code);
  window.requestAnimationFrame(renderHistoryChart);
}

/** After the list changed under an open inspector: its position line and the active row follow. */
export function refreshPromptInspector() {
  const open = ui.inspectorState();
  if (!open.open || open.type !== 'prompt') return;
  inspectorContext(PROMPT_BY_ID.get(open.id));
  ui.syncActiveRow();
}

/**
 * Registers the prompt type with the inspector shell. `host` is the Explorer's side of the contract:
 * positionOf(prompt) for the "3 of 250" line, order() for stepping with J and K, canOpen(id),
 * hasTopic(name) and openTopic(name) for the topic badge.
 */
export function initPromptInspector(host) {
  explorer = host;
  ui.registerInspectorType('prompt', {
    noun: 'prompt',
    back: 'Prompts',
    width: 440,
    defaultTab: 'latest',
    has: (id) => PROMPT_BY_ID.has(id) && host.canOpen(id),
    fill: fillPrompt,
    order: host.order,
  });
  window.addEventListener('inspector-close', () => {
    openPromptId = null;
  });
  inspector.addEventListener('click', (event) => {
    const topic = event.target.closest('[data-prompt-topic]');
    if (topic) host.openTopic(topic.dataset.promptTopic);
  });
}
