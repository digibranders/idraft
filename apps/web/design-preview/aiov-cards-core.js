/**
 * Cards of the AI visibility Overview, first half: the headline row, the trend, the outcome split, the metric
 * matrix and the competitor cards. Each builder takes the page context `{ model, scope, compare }` and returns a
 * card (or null when the card cannot exist for the scope). Card keys are those of the layout catalog
 * (src/lib/layouts/catalog.ts); `ai.visibility_split` and `ai.metric_matrix` are new.
 */
import { formatInteger } from './vendor/format/number.js';
import {
  MEASURES,
  PLATFORMS,
  PLATFORM_CODES,
  RUNS,
  WEEK_LABELS,
  aggregateFor,
  buildModel,
  domainsFor,
  entitiesFor,
  gapFor,
  lastRunOf,
  platformOf,
  seriesFor,
  sovSeries,
  trafficFor,
} from './aiov-data.js';
import { chartHost, lineOption, mountChart, shareAreaOption } from './aiov-charts.js';
import { HEAT_METRICS, setScope } from './aiov-controls.js';
import { NEUTRAL_BADGE, averageBadge, barList, cardFrame, countsText, deltaNode, el, emptyBody, engineName, icon, insufficient, insufficientText, pct0, plural, platformLabel, sampleBadge, sparkline, stackedRows, valueText } from './aiov-parts.js';
import { wilsonInterval } from './vendor/stats/index.js';

const ENGINE_TOKEN = { chatgpt_web: 'chart-1', gemini_web: 'chart-2', google_ai_mode: 'chart-3', google_ai_overview: 'chart-4' };
export const OUTCOME_SEGMENTS = [
  { key: 'both', label: 'Named and linked', token: 'seq-6' },
  { key: 'mentionedOnly', label: 'Named only (unlinked)', token: 'seq-4' },
  { key: 'citedOnly', label: 'Cited only', token: 'seq-3' },
  { key: 'neither', label: 'Neither', token: 'chart-bar-neutral' },
];

/** Outcome shares for the platform in scope, or the equal-weight average of the platforms for All platforms. */
function outcomesFor(model) {
  const rows = model.codes.map((code) => ({ code, aggregate: aggregateFor(model, code) })).filter(({ aggregate }) => aggregate.enough);
  return rows.map(({ code, aggregate }) => ({
    code,
    shares: OUTCOME_SEGMENTS.map((segment) => aggregate.outcomes[segment.key]),
    counts: OUTCOME_SEGMENTS.map((segment) => aggregate.outcomeCounts[segment.key]),
    observations: aggregate.observations,
  }));
}

function averageShares(rows) {
  if (rows.length === 0) return null;
  return OUTCOME_SEGMENTS.map((_, index) => rows.reduce((sum, row) => sum + row.shares[index], 0) / rows.length);
}

// -------------------------------------------------------------------------------------------------
// Headline: the AI Visibility hero and eight tiles

const TILE_LAYOUT = ['mention', 'sov', 'citation', 'position', 'recommendation', 'sentiment', 'prompts', 'runs'];

function contextOf(cell, ctx) {
  if (cell.state === 'unavailable') return cell.reason ?? 'not available';
  if (cell.state === 'insufficient' || cell.state === 'none') {
    const why = insufficientText(cell);
    return why === 'Too few' ? 'Too few for a rate' : `${why}, too few for a rate`;
  }
  const sample = MEASURES[cell.measure].sample ? ', sample data' : '';
  if (ctx.scope.platform === 'all') return `avg of ${cell.used}${sample}`;
  return `${countsText(cell)}${sample}`;
}

function tileNode({ label, info, cell, ctx, series, plain, measure }) {
  const node = el('div', 'bg-surface px-4 py-3 flex flex-col gap-1 min-w-0');
  const name = el('span', 'type-label text-foreground-secondary truncate', label);
  if (info) name.dataset.tip = info;
  node.append(name);
  const line = el('div', 'flex items-baseline gap-2 min-w-0');
  if (plain) line.append(el('span', 'type-metric num text-foreground', plain.value));
  else {
    const missing = cell.state !== 'ok';
    line.append(el('span', `type-metric num ${missing ? 'text-foreground-tertiary' : 'text-foreground'}`, valueText(cell)));
    const delta = deltaNode(cell, ctx.compare);
    if (delta) line.append(delta);
  }
  node.append(line, el('span', 'type-meta', plain ? plain.context : contextOf(cell, ctx)));
  // With one group selected, the project value stands beside it (spec section 4)
  const base = measure && ctx.baseline ? ctx.baseline.shown(measure) : null;
  if (base && base.state === 'ok' && cell.state === 'ok') node.append(el('span', 'type-micro text-foreground-tertiary num', `All groups ${valueText(base)}`));
  if (series && series.filter((value) => value !== null).length > 1) node.append(sparkline(series, { token: 'chart-1', height: 24 }));
  return node;
}

export function headlineRow(ctx) {
  const { model } = ctx;
  const grid = el('div', 'grid grid-cols-1 xl:grid-cols-12 gap-4');
  grid.dataset.card = 'ai.visibility_split';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Headline numbers');

  // The hero: a plain rate, with the four outcomes that make it up (decision D1)
  const visibility = model.shown('visibility');
  const hero = el('section', 'xl:col-span-4 min-w-0 bg-surface border border-border rounded-lg p-4 flex flex-col gap-3');
  hero.setAttribute('aria-label', 'AI Visibility');
  const top = el('div', 'flex items-center gap-2');
  const title = el('h2', 'type-section-title', MEASURES.visibility.label);
  title.dataset.tip = MEASURES.visibility.info;
  top.append(title);
  if (ctx.scope.platform === 'all' && visibility.state === 'ok') top.append(averageBadge(visibility.used));
  hero.append(top);
  const value = el('div', 'flex items-baseline gap-2');
  value.append(el('span', `type-metric num ${visibility.state === 'ok' ? 'text-foreground' : 'text-foreground-tertiary'}`, valueText(visibility)));
  const delta = deltaNode(visibility, ctx.compare);
  if (delta) value.append(delta);
  hero.append(value);
  const projectValue = ctx.baseline?.shown('visibility');
  if (projectValue?.state === 'ok') hero.append(el('p', 'type-meta num', `All groups ${valueText(projectValue)}`));
  // The prompts that contribute: on one platform only those with a valid answer there (one denominator, R12)
  const contributing = ctx.scope.platform === 'all' ? model.prompts.length : aggregateFor(model, ctx.scope.platform).prompts;
  hero.append(el('p', 'type-meta', visibility.state === 'ok' ? `${ctx.scope.platform === 'all' ? `Average of ${visibility.used} platforms` : countsText(visibility)} · ${plural(contributing, 'prompt')}, each counted once` : 'Too few answers for a rate'));
  const outcomes = outcomesFor(model);
  const shares = ctx.scope.platform === 'all' ? averageShares(outcomes) : outcomes[0]?.shares ?? null;
  hero.append(
    stackedRows({
      rows: [{ label: ctx.scope.platform === 'all' ? 'Share of answers, average of platforms' : 'Share of answers', shares, counts: ctx.scope.platform === 'all' ? null : outcomes[0]?.counts }],
      segments: OUTCOME_SEGMENTS,
    }),
  );
  const names = el('p', 'type-meta');
  names.append('Visibility is named and linked, named only and cited only added together. ', el('span', 'text-foreground-secondary', 'Named only is an unlinked brand mention.'));
  hero.append(names);
  const spark = seriesFor(model, 'visibility', ctx.scope.platform);
  if (spark.some((point) => point !== null)) {
    const wrap = el('div', 'mt-auto');
    wrap.append(el('span', 'type-meta', 'Last 8 runs'), sparkline(spark, { token: 'chart-1', height: 36, label: `AI Visibility over the last 8 weekly runs, latest ${valueText(visibility)}` }));
    hero.append(wrap);
  }

  // The tiles share hairlines: a grid with a 1 px gap on the border color
  const strip = el('section', 'xl:col-span-8 min-w-0 border border-border rounded-lg overflow-hidden bg-border grid grid-cols-2 md:grid-cols-4 gap-px');
  strip.setAttribute('aria-label', 'Key numbers');
  const cell = (measure) => model.shown(measure);
  const tiles = {
    mention: () => tileNode({ label: MEASURES.mention.label, info: MEASURES.mention.info, cell: cell('mention'), ctx, measure: 'mention', series: seriesFor(model, 'mention', ctx.scope.platform) }),
    sov: () => tileNode({ label: MEASURES.sov.label, info: MEASURES.sov.info, cell: cell('sov'), ctx, measure: 'sov', series: seriesFor(model, 'sov', ctx.scope.platform) }),
    citation: () => tileNode({ label: MEASURES.citation.label, info: MEASURES.citation.info, cell: cell('citation'), ctx, measure: 'citation', series: seriesFor(model, 'citation', ctx.scope.platform) }),
    position: () => tileNode({ label: MEASURES.position.label, info: MEASURES.position.info, cell: cell('position'), ctx, measure: 'position', series: seriesFor(model, 'position', ctx.scope.platform) }),
    recommendation: () => tileNode({ label: MEASURES.recommendation.label, info: MEASURES.recommendation.info, cell: cell('recommendation'), ctx, measure: 'recommendation', series: seriesFor(model, 'recommendation', ctx.scope.platform) }),
    sentiment: () => {
      const sentiment = cell('sentiment');
      const node = tileNode({ label: 'Sentiment, positive share', info: MEASURES.sentiment.info, cell: sentiment, ctx, measure: 'sentiment', series: seriesFor(model, 'sentiment', ctx.scope.platform) });
      return node;
    },
    prompts: () => {
      const kind = { exclude: 'core prompts, not branded', include: 'core and branded prompts', only: 'branded prompts' }[ctx.scope.branded];
      const where = ctx.scope.group === 'all' ? kind : `${kind}, in ${ctx.scope.group.split(':')[1]}`;
      const withAnswers = ctx.scope.platform === 'all' ? null : aggregateFor(model, ctx.scope.platform).prompts;
      return tileNode({ label: MEASURES.prompts.label, info: MEASURES.prompts.info, ctx, plain: { value: formatInteger(model.prompts.length), context: withAnswers === null ? where : `${withAnswers} with answers on ${engineName(ctx.scope.platform)}` } });
    },
    runs: () => tileNode({ label: 'Runs in window', info: 'Weekly collection runs behind these numbers. Prompts are asked on the schedule of their panel.', ctx, plain: { value: String(RUNS.inWindow), context: `run ${RUNS.number}, last ${ctx.scope.platform === 'all' ? RUNS.last : lastRunOf(ctx.scope.platform)}` } }),
  };
  TILE_LAYOUT.forEach((key) => strip.append(tiles[key]()));
  grid.append(hero, strip);
  return grid;
}

// -------------------------------------------------------------------------------------------------
// Trend: the metric over the eight weekly runs, a line per platform

const METRIC_TABS = HEAT_METRICS.map((key) => ({ key, label: MEASURES[key].short }));

export function segmented(items, current, onPick, label) {
  const group = el('div', 'inline-flex rounded-md border border-border bg-surface p-0.5');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  items.forEach((item) => {
    const pressed = item.key === current;
    const button = el('button', `h-control-sm px-2.5 rounded-sm type-body whitespace-nowrap ${pressed ? 'bg-primary-subtle text-primary-text type-body-strong' : 'text-foreground-secondary hover:bg-surface-hover hover:text-foreground'}`, item.label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(pressed));
    button.addEventListener('click', () => onPick(item.key));
    group.append(button);
  });
  return group;
}

export function trendCard(ctx) {
  const { model, scope } = ctx;
  const measure = scope.metric;
  const codes = model.codes;
  const lines = codes.map((code) => ({ name: engineName(code), code, token: scope.platform === 'all' ? ENGINE_TOKEN[code] : 'chart-1', values: seriesFor(model, measure, code) })).filter((line) => line.values.some((value) => value !== null));
  if (scope.platform === 'all') lines.push({ name: 'Average', code: 'all', token: 'chart-other', dashed: true, width: 1.5, values: seriesFor(model, measure, 'all') });
  const one = scope.platform !== 'all' ? model.cells[measure][scope.platform] : null;
  let band = null;
  if (one?.state === 'ok' && lines[0]) {
    // The Wilson interval of the current window (R8) as a band around the current weeks; the earlier weeks have no counts here
    const interval = wilsonInterval(one.counts.k, one.counts.n);
    if (interval) {
      const half = (interval.high - interval.low) / 2;
      band = {
        low: lines[0].values.map((value, week) => (value === null || week < 4 ? null : Math.max(0, value - half))),
        high: lines[0].values.map((value, week) => (value === null || week < 4 ? null : Math.min(1, value + half))),
      };
    }
  }
  const state = { view: 'chart' };
  const body = el('div', 'flex flex-col gap-3');
  let dispose = null;
  const draw = () => {
    dispose?.();
    dispose = null;
    body.replaceChildren();
    if (lines.length === 0) return body.append(emptyBody('No rate yet', 'These prompts have fewer than 4 valid answers on this platform.'));
    if (state.view === 'table') {
      const table = el('table', 'w-full type-table');
      const head = el('thead');
      const headRow = el('tr', 'bg-surface-subtle h-row-compact');
      headRow.append(el('th', 'px-3 text-left type-label', 'Week of'), ...lines.map((line) => el('th', 'px-3 text-right type-label whitespace-nowrap', line.name)));
      head.append(headRow);
      const tbody = el('tbody');
      WEEK_LABELS.forEach((week, index) => {
        const row = el('tr', 'h-row-compact border-t border-border-subtle');
        row.append(el('th', 'px-3 text-left font-normal text-foreground', week), ...lines.map((line) => el('td', 'px-3 text-right num', line.values[index] === null ? 'No data' : `${(line.values[index] * 100).toFixed(1)}%`)));
        tbody.append(row);
      });
      table.append(head, tbody);
      return body.append(table);
    }
    const host = chartHost(284, `${MEASURES[measure].label} over the last 8 weekly runs, ${lines.map((line) => line.name).join(', ')}`);
    body.append(host);
    dispose = mountChart(host, () => lineOption({ labels: WEEK_LABELS, lines, band, boundary: ctx.compare ? WEEK_LABELS[4] : undefined }));
    const legend = el('div', 'flex flex-wrap gap-x-4 gap-y-1');
    lines.forEach((line) => {
      const item = el('span', 'inline-flex items-center gap-1.5 type-meta num');
      const swatch = el('span', `w-3 h-0.5 rounded-full ${line.dashed ? 'opacity-70' : ''}`);
      swatch.style.background = `var(--${line.token})`;
      const latest = line.values[line.values.length - 1];
      item.append(swatch, `${line.name} ${latest === null ? 'n/a' : pct0(latest)}`);
      legend.append(item);
    });
    body.append(legend);
  };
  const tools = [
    segmented(METRIC_TABS, measure, (key) => setScope({ metric: key }), 'Metric'),
    (() => {
      const button = el('button', 'h-control-sm px-2.5 rounded-md border border-border bg-surface flex items-center gap-1.5 whitespace-nowrap type-body text-foreground hover:bg-surface-hover');
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      button.append(icon('table-2', 'size-icon-sm'), 'Table');
      button.addEventListener('click', () => {
        state.view = state.view === 'chart' ? 'table' : 'chart';
        button.setAttribute('aria-pressed', String(state.view === 'table'));
        draw();
      });
      return button;
    })(),
  ];
  draw();
  return cardFrame({
    key: 'ai.rate_trend_by_engine',
    title: `${MEASURES[measure].label} over time`,
    meta: scope.platform === 'all' ? 'a line per platform, with their average' : `${engineName(scope.platform)}, with its 95% interval`,
    tools,
    body,
    footnote: ctx.compare
      ? 'Weeks to the right of the dashed line are the current 28 days; the weeks before it are the previous 28 days. Each point is a weekly run, prompt-weighted. The band is the 95% Wilson interval of the current window.'
      : 'Each point is a weekly run, prompt-weighted. The band is the 95% Wilson interval of the current window.',
  });
}

// -------------------------------------------------------------------------------------------------
// Outcome split per platform

export function outcomeCard(ctx) {
  const { model } = ctx;
  const rows = outcomesFor(model);
  if (rows.length === 0) return cardFrame({ key: 'ai.outcome_mix', title: 'Outcome split', body: emptyBody('No rate yet', 'These prompts have too few valid answers.') });
  const body = stackedRows({
    segments: OUTCOME_SEGMENTS,
    rows: rows.map((row) => ({ label: platformLabel(row.code), shares: row.shares, counts: row.counts, note: `${formatInteger(row.observations)} answers` })),
  });
  return cardFrame({
    key: 'ai.outcome_mix',
    title: 'What answers do with the brand',
    meta: ctx.scope.platform === 'all' ? 'by platform' : engineName(ctx.scope.platform),
    body,
    footnote: 'The four shares add up to 100% of valid answers. Named only means the brand is named and none of its pages is cited.',
  });
}

// -------------------------------------------------------------------------------------------------
// Metric matrix: the senior's sheet, every metric by platform

const MATRIX_COLUMNS = ['all', 'chatgpt_web', 'gemini_web', 'google_ai_overview', 'google_ai_mode'];

function matrixCell(content, { selected = false, align = 'right' } = {}) {
  const td = el('td', `px-3 py-1.5 align-top whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'} ${selected ? 'bg-primary-subtle' : ''}`);
  td.append(...(Array.isArray(content) ? content : [content]));
  return td;
}

function measureCell(cell, ctx, { text } = {}) {
  const stack = el('div', 'flex flex-col items-end');
  if (!cell || cell.state === 'unavailable') {
    const node = el('span', 'type-table text-foreground-tertiary', 'n/a');
    node.dataset.tip = cell?.reason ?? 'Not available on this platform';
    stack.append(node);
    return stack;
  }
  if (cell.state === 'insufficient' || cell.state === 'none') {
    stack.append(insufficient(cell.state === 'none' ? 'No data' : insufficientText(cell)));
    return stack;
  }
  // Every number carries its counts (R1): an average says which platforms it averages, a platform its answers
  stack.dataset.tip = cell.code === 'all' ? `Average of ${cell.used} platforms: ${cell.platforms.map((code) => engineName(code)).join(', ')}` : countsText(cell);
  const top = el('div', 'flex items-baseline justify-end gap-2');
  top.append(el('span', 'type-table-strong num text-foreground', text ?? valueText(cell)));
  const delta = deltaNode(cell, ctx.compare);
  if (delta) {
    delta.classList.add('type-micro');
    top.append(delta);
  }
  stack.append(top);
  return stack;
}

export function matrixCard(ctx) {
  const { model, scope } = ctx;
  const columns = MATRIX_COLUMNS;
  // The matrix compares platforms, so it reads every platform in the group and branded scope, not only the selected one
  const allModel = buildModel({ ...scope, platform: 'all' });
  const platformModels = Object.fromEntries(PLATFORM_CODES.map((code) => [code, buildModel({ ...scope, platform: code })]));
  const modelOf = (code) => (code === 'all' ? allModel : platformModels[code]);
  const traffic = trafficFor(allModel);
  const trafficOf = (code) => traffic.sources.find((source) => source.code === code);
  const topDomain = (code) => {
    const domains = domainsFor(modelOf(code));
    return domains.rows[0] ? { domain: domains.rows[0].domain, share: domains.rows[0].share } : null;
  };

  const rows = [
    {
      label: MEASURES.prompts.label,
      cell: (code) => {
        const count = code === 'all' ? model.prompts.length : aggregateFor(platformModels[code], code).prompts;
        return { measure: 'prompts', state: 'ok', value: count, counts: null, text: formatInteger(count) };
      },
      text: (cell) => cell.text,
    },
    { label: MEASURES.visibility.label, measure: 'visibility' },
    { label: MEASURES.mention.label, measure: 'mention' },
    { label: MEASURES.position.label, measure: 'position' },
    { label: MEASURES.recommendation.label, measure: 'recommendation' },
    { label: MEASURES.rank.label, measure: 'rank' },
    { label: MEASURES.sov.label, measure: 'sov' },
    { label: MEASURES.citation.label, measure: 'citation' },
    { label: MEASURES.sentiment.label, measure: 'sentiment', suffix: 'positive' },
    { label: MEASURES.unlinked.label, measure: 'unlinked' },
    {
      label: MEASURES.referral.label,
      cell: (code) => {
        if (code === 'google_ai_mode' || code === 'google_ai_overview') return { measure: 'referral', state: 'unavailable', reason: 'Google AI sessions cannot be separated from Google organic in GA4' };
        const sessions = code === 'all' ? traffic.total : trafficOf(code)?.sessions ?? 0;
        return { measure: 'referral', state: 'ok', value: sessions, text: formatInteger(sessions) };
      },
      text: (cell) => cell.text,
      sub: (cell, code) => (code === 'all' && cell.state === 'ok' ? '2 of 4 platforms' : null),
      sample: true,
    },
    {
      label: MEASURES.domain.label,
      cell: (code) => {
        const top = topDomain(code);
        return top ? { measure: 'domain', state: 'ok', value: top.share, text: top.domain, share: top.share } : { measure: 'domain', state: 'none' };
      },
      text: (cell) => cell.text,
      sub: (cell) => `${(cell.share * 100).toFixed(1)}% of citations`,
      noAverageLabel: true,
    },
  ];

  const table = el('table', 'w-full type-table');
  table.dataset.matrix = '';
  const caption = el('caption', 'sr-only', 'Every metric by platform. All platforms is the equal-weight average of the platforms that have the metric.');
  const head = el('thead');
  const headRow = el('tr', 'bg-surface-subtle border-t border-border-subtle h-row-header');
  headRow.append(el('th', 'pl-4 pr-3 text-left type-label', 'Metric'));
  columns.forEach((code) => {
    const th = el('th', `px-3 text-right type-label whitespace-nowrap ${scope.platform === code ? 'bg-primary-subtle text-primary-text' : ''}`);
    th.scope = 'col';
    if (scope.platform === code) th.setAttribute('aria-current', 'true');
    const wrap = el('span', 'inline-flex items-center gap-2 justify-end');
    if (code === 'all') wrap.append('All platforms', el('span', NEUTRAL_BADGE, 'avg'));
    else wrap.append(platformLabel(code));
    th.append(wrap);
    headRow.append(th);
  });
  head.append(headRow);
  const body = el('tbody');
  rows.forEach((row) => {
    const tr = el('tr', 'border-t border-border-subtle hover:bg-surface-hover');
    const label = el('th', 'pl-4 pr-3 py-1.5 text-left font-normal text-foreground whitespace-nowrap align-top');
    label.scope = 'row';
    const wrap = el('span', 'inline-flex items-center gap-2');
    wrap.append(row.label);
    if (row.sample || MEASURES[row.measure ?? '']?.sample) wrap.append(sampleBadge());
    label.append(wrap);
    tr.append(label);
    columns.forEach((code) => {
      const resolved = row.cell ? row.cell(code) : code === 'all' ? allModel.average[row.measure] : platformModels[code].cells[row.measure][code];
      const text = row.text ? row.text(resolved) : row.suffix && resolved.state === 'ok' ? `${pct0(resolved.value)} ${row.suffix}` : undefined;
      const content = measureCell(resolved, ctx, { text });
      const sub = row.sub && resolved.state === 'ok' ? row.sub(resolved, code) : null;
      if (sub) content.append(el('span', 'type-micro text-foreground-tertiary', sub));
      if (resolved?.state === 'ok' && code === 'all' && resolved.used && !row.noAverageLabel && !row.cell) content.append(el('span', 'type-micro text-foreground-tertiary', `avg of ${resolved.used}`));
      tr.append(matrixCell(content, { selected: scope.platform === code }));
    });
    body.append(tr);
  });
  // The run rows of the sheet: how many runs are behind a column, and when the last one finished
  const runRow = (label, valueOf) => {
    const tr = el('tr', 'border-t border-border-subtle bg-surface-subtle');
    const th = el('th', 'pl-4 pr-3 py-1.5 text-left font-normal text-foreground-secondary whitespace-nowrap');
    th.scope = 'row';
    th.append(label);
    tr.append(th, ...columns.map((code) => matrixCell(el('span', 'type-table num text-foreground-secondary', valueOf(code)), { selected: scope.platform === code })));
    return tr;
  };
  body.append(
    runRow('Runs in window', () => `${RUNS.inWindow} of ${RUNS.inWindow}`),
    runRow('Last run', (code) => (code === 'all' ? RUNS.last : lastRunOf(code))),
  );
  table.append(caption, head, body);
  const wrap = el('div', 'overflow-x-auto');
  wrap.append(table);
  return cardFrame({
    key: 'ai.metric_matrix',
    title: 'Metrics by platform',
    meta: scope.group === 'all' ? 'all groups' : `group: ${scope.group.split(':')[1]}`,
    tools: [],
    body: wrap,
    flush: true,
    footnote: 'Rates are prompt-weighted, each prompt counting once; the counts in the tooltips are the pooled answers behind them. All platforms is the equal-weight average of the platforms that have the metric. Recommendation, sentiment and referral traffic use sample data until their collectors ship. AI Overview is read from rank checks and counts only checks that showed one.',
  });
}

// -------------------------------------------------------------------------------------------------
// Competitors: share of voice, share of voice over time, the gap

function entityLabel(entity) {
  return entity.own ? `${entity.name} (you)` : entity.name;
}

export function sovCard(ctx) {
  const entities = entitiesFor(ctx.model);
  if (entities[0].sov === null) return cardFrame({ key: 'ai.share_of_voice', title: 'Share of voice', body: emptyBody('No rate yet', 'Too few answers on this platform.') });
  const rows = [...entities]
    .sort((a, b) => (b.sov ?? 0) - (a.sov ?? 0))
    .map((entity) => ({ label: entityLabel(entity), value: entity.sov, strong: entity.own, token: entity.token, barToken: entity.own ? 'chart-1' : 'chart-bar-neutral', tip: `${entity.name}: ${formatInteger(entity.answers)} of ${formatInteger(entity.answersOfTracked)} brand mentions` }));
  const total = entities[0].answersOfTracked;
  return cardFrame({
    key: 'ai.share_of_voice',
    title: 'Share of voice',
    meta: ctx.scope.platform === 'all' ? `avg of ${entities[0].platforms} platforms` : `of ${formatInteger(total)} brand mentions`,
    body: barList(rows),
    footnote: `Tracked set: ${entities[0].name} and ${entities.length - 1} competitors. Adding a competitor lowers every other share.`,
  });
}

export function sovOverTimeCard(ctx) {
  const entities = entitiesFor(ctx.model);
  if (entities[0].sov === null) return cardFrame({ key: 'ai.sov_over_time', title: 'Share of voice over time', body: emptyBody('No rate yet', 'Too few answers on this platform.') });
  const weeks = sovSeries(ctx.model, entities);
  const layers = entities.map((entity, index) => ({ name: entityLabel(entity), token: entity.token, values: weeks.map((week) => week[index]), alpha: entity.own ? 0.95 : 0.55 }));
  const host = chartHost(240, `Share of voice of ${entities.map((entity) => entity.name).join(', ')} over the last 8 weekly runs`);
  mountChart(host, () => shareAreaOption({ labels: WEEK_LABELS, layers }));
  const legend = el('div', 'mt-3 flex flex-wrap gap-x-4 gap-y-1');
  entities.forEach((entity) => {
    const item = el('span', 'inline-flex items-center gap-1.5 type-meta');
    const dot = el('span', 'size-2 rounded-full');
    dot.style.background = `var(--${entity.token})`;
    item.append(dot, entity.name);
    legend.append(item);
  });
  return cardFrame({ key: 'ai.sov_over_time', title: 'Share of voice over time', meta: 'stacked to 100%', body: [host, legend], footnote: 'Each week adds up to 100% of tracked-brand mentions on the set of competitors named above.' });
}

export function gapCard(ctx) {
  const gaps = gapFor(ctx.model).filter((entry) => entry.gap !== null).sort((a, b) => b.lost - a.lost);
  if (gaps.length === 0) return cardFrame({ key: 'ai.lost_to_competitor', title: 'Gap to competitors', body: emptyBody('No rate yet', 'Too few answers on this platform.') });
  const limit = Math.max(...gaps.map((entry) => Math.abs(entry.gap)), 0.05);
  const table = el('table', 'w-full type-table');
  const head = el('thead');
  const headRow = el('tr', 'border-t border-border-subtle bg-surface-subtle h-row-header');
  ['Competitor', 'Mention rate gap to you', 'Prompts where they lead', 'Prompts where you lead'].forEach((text, index) => {
    const th = el('th', `px-3 ${index === 0 ? 'pl-4 text-left' : index === 1 ? 'text-left' : 'text-right'} type-label whitespace-nowrap ${index > 1 ? 'hidden md:table-cell' : ''}`, text);
    th.scope = 'col';
    headRow.append(th);
  });
  head.append(headRow);
  const body = el('tbody');
  gaps.forEach((entry) => {
    const tr = el('tr', 'h-row-compact border-t border-border-subtle');
    const name = el('th', 'pl-4 pr-3 text-left font-normal text-foreground whitespace-nowrap');
    name.scope = 'row';
    const wrap = el('span', 'inline-flex items-center gap-2');
    const dot = el('span', 'size-2 rounded-full');
    dot.style.background = `var(--${entry.token})`;
    wrap.append(dot, entry.name);
    name.append(wrap);
    // A diverging bar: left of the middle they are ahead of us, right of it we are ahead
    const barCell = el('td', 'px-3 w-1/2');
    const row = el('div', 'flex items-center gap-3');
    const value = el('span', 'w-36 shrink-0 type-table num text-foreground-secondary whitespace-nowrap', `${entry.gap > 0 ? '+' : '−'}${(Math.abs(entry.gap) * 100).toFixed(1)} pts ${entry.gap > 0 ? 'ahead of you' : 'behind you'}`);
    const track = el('div', 'relative h-4 flex-1 min-w-24');
    track.setAttribute('aria-hidden', 'true');
    const middle = el('div', 'absolute left-1/2 top-0 bottom-0 w-px');
    middle.style.background = 'var(--border-strong)';
    const bar = el('div', 'absolute top-0.5 h-3 rounded-2xs');
    bar.style.width = `${(Math.abs(entry.gap) / limit) * 50}%`;
    if (entry.gap > 0) {
      bar.style.right = '50%';
      bar.style.background = 'var(--chart-negative)';
    } else {
      bar.style.left = '50%';
      bar.style.background = 'var(--chart-positive)';
    }
    track.append(middle, bar);
    row.append(value, track);
    barCell.append(row);
    tr.append(name, barCell, el('td', 'px-3 text-right num hidden md:table-cell', `${formatInteger(entry.lost)} of ${formatInteger(entry.compared)}`), el('td', 'px-3 pr-4 text-right num hidden md:table-cell', `${formatInteger(entry.ahead)} of ${formatInteger(entry.compared)}`));
    body.append(tr);
  });
  table.append(head, body);
  const wrap = el('div', 'overflow-x-auto');
  wrap.append(table);
  return cardFrame({
    key: 'ai.lost_to_competitor',
    title: 'Competitor gap',
    meta: 'mention rate, same answers',
    body: wrap,
    flush: true,
    footnote: 'The gap is the competitor’s mention rate minus yours. A prompt counts as led when one brand is named in more of its answers.',
  });
}

export { PLATFORMS, platformOf };
