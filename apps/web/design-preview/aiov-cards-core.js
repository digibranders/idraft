/**
 * Cards of the AI visibility Overview, first half: the headline row, the trend, the outcome split and the
 * competitor cards. Each builder takes the page context `{ model, scope, compare }` and returns a card (or null when
 * the card cannot exist for the scope). Card keys are those of the layout catalog (src/lib/layouts/catalog.ts);
 * `ai.visibility_split` is new.
 */
import { formatInteger } from './vendor/format/number.js';
import { MEASURES, PLATFORMS, RUNS, WEEK_LABELS, aggregateFor, entitiesFor, gapFor, lastRunOf, platformOf, seriesFor, sovSeries } from './aiov-data.js';
import { chartHost, lineOption, mountChart, shareAreaOption } from './aiov-charts.js';
import { HEAT_METRICS, setScope } from './aiov-controls.js';
import { barList, cardFrame, countsText, el, emptyBody, engineName, icon, infoButton, insufficient, insufficientText, pct0, plural, platformLabel, sparkline, stackedRows, valueText } from './aiov-parts.js';
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

/**
 * What stands behind a number, for its tooltip and for screen readers (R1): the counts, or which platforms an average
 * covers. It is not printed on the card, which keeps the label, the value and the trend.
 */
function detailOf(cell, ctx) {
  if (cell.state !== 'ok') return cell.state === 'unavailable' ? cell.reason ?? '' : insufficientText(cell) === 'Too few' ? 'Too few answers for a rate' : `${insufficientText(cell)}, too few for a rate`;
  if (ctx.scope.platform === 'all') return `Average of ${cell.used} platforms: ${cell.platforms.map((code) => engineName(code)).join(', ')}`;
  return countsText(cell);
}

/** The one short line a tile may carry: why it has no value, or that it is sample data. */
function noteOf(cell) {
  if (cell.state === 'unavailable') return 'Not classified';
  if (cell.state !== 'ok') return 'Too few answers';
  return MEASURES[cell.measure].sample ? 'Sample data' : null;
}

function tileNode({ label, info, cell, ctx, series, plain, measure }) {
  const node = el('div', 'bg-surface px-3.5 py-3 flex flex-col justify-between gap-1 min-w-0');
  const name = el('span', 'type-label text-foreground-secondary truncate', label);
  if (info) name.dataset.tip = info;
  node.append(name);
  const row = el('div', 'flex items-center justify-between gap-3 min-w-0');
  const missing = !plain && cell.state !== 'ok';
  const value = el('span', `type-metric num ${missing ? 'text-foreground-tertiary' : 'text-foreground'}`, plain ? plain.value : valueText(cell));
  const detail = plain ? plain.detail : detailOf(cell, ctx);
  if (detail) {
    value.dataset.tip = detail;
    value.append(el('span', 'sr-only', `, ${detail}`));
  }
  row.append(value);
  if (series && series.filter((point) => point !== null).length > 1) {
    const trend = el('div', 'w-14 shrink-0');
    trend.append(sparkline(series, { token: 'chart-1', height: 22 }));
    row.append(trend);
  }
  node.append(row);
  const note = plain ? plain.note : noteOf(cell);
  // With one group selected, the project value stands beside it (spec section 4)
  const base = measure && ctx.baseline ? ctx.baseline.shown(measure) : null;
  const baseText = base && base.state === 'ok' && cell.state === 'ok' ? `All groups ${valueText(base)}` : null;
  const line = [note, baseText].filter(Boolean).join(' · ');
  if (line) node.append(el('span', 'type-micro text-foreground-tertiary truncate num', line));
  return node;
}

/** The four outcomes of an answer as one bar, with each share beside its name. The counts are in the tooltips. */
function splitBar(shares, counts) {
  const wrap = el('div', 'flex flex-col gap-2');
  if (shares === null) {
    wrap.append(insufficient('Too few answers'));
    return wrap;
  }
  const bar = el('div', 'h-2.5 flex gap-0.5 overflow-hidden rounded-xs');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', OUTCOME_SEGMENTS.map((segment, index) => `${segment.label} ${pct0(shares[index])}`).join(', '));
  const total = counts ? counts.reduce((a, b) => a + b, 0) : 0;
  const legend = el('div', 'grid grid-cols-2 gap-x-4 gap-y-1');
  OUTCOME_SEGMENTS.forEach((segment, index) => {
    if (shares[index] > 0) {
      const part = el('div', 'h-full min-w-0');
      part.style.width = `${shares[index] * 100}%`;
      part.style.background = `var(--${segment.token})`;
      part.dataset.tip = `${segment.label}: ${pct0(shares[index])}${total ? `, ${formatInteger(counts[index])} of ${formatInteger(total)} answers` : ''}`;
      bar.append(part);
    }
    const item = el('span', 'flex items-center gap-1.5 min-w-0 type-table');
    const dot = el('span', 'size-2 shrink-0 rounded-2xs');
    dot.style.background = `var(--${segment.token})`;
    dot.setAttribute('aria-hidden', 'true');
    item.append(dot, el('span', 'truncate text-foreground-secondary', segment.label.replace(' (unlinked)', '')), el('span', 'ml-auto num text-foreground', pct0(shares[index])));
    legend.append(item);
  });
  wrap.append(bar, legend);
  return wrap;
}

export function headlineRow(ctx) {
  const { model } = ctx;
  const grid = el('div', 'grid grid-cols-1 xl:grid-cols-12 gap-4');
  grid.dataset.card = 'ai.visibility_split';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Headline numbers');

  // The hero: a plain rate, with the four outcomes that make it up (decision D1)
  const visibility = model.shown('visibility');
  const hero = el('section', 'xl:col-span-4 min-w-0 bg-surface border border-border rounded-lg px-4 py-3.5 flex flex-col justify-between gap-3');
  hero.setAttribute('aria-label', 'AI Visibility');
  const title = el('h2', 'type-section-title', MEASURES.visibility.label);
  // What the rate is, said once in the tooltip instead of in paragraphs on the card
  title.dataset.tip = `${MEASURES.visibility.info} Named and linked, named only (an unlinked brand mention) and cited only added together. Each prompt counts once.`;
  // The prompts that contribute: on one platform only those with a valid answer there (one denominator, R12)
  const contributing = ctx.scope.platform === 'all' ? model.prompts.length : aggregateFor(model, ctx.scope.platform).prompts;
  const top = el('div', 'flex items-center justify-between gap-4');
  const value = el('div', 'min-w-0');
  const number = el('span', `type-metric num ${visibility.state === 'ok' ? 'text-foreground' : 'text-foreground-tertiary'}`, valueText(visibility));
  const detail = visibility.state === 'ok' ? `${detailOf(visibility, ctx)}. ${plural(contributing, 'prompt')}, each counted once` : 'Too few answers for a rate';
  number.dataset.tip = detail;
  number.append(el('span', 'sr-only', `, ${detail}`));
  value.append(number);
  const projectValue = ctx.baseline?.shown('visibility');
  if (projectValue?.state === 'ok') value.append(el('span', 'ml-2 type-micro text-foreground-tertiary num', `All groups ${valueText(projectValue)}`));
  top.append(value);
  const spark = seriesFor(model, 'visibility', ctx.scope.platform);
  if (spark.some((point) => point !== null)) {
    const trend = el('div', 'w-28 shrink-0');
    trend.append(sparkline(spark, { token: 'chart-1', height: 32, label: `AI Visibility over the last 8 weekly runs, latest ${valueText(visibility)}` }));
    top.append(trend);
  }
  const outcomes = outcomesFor(model);
  const shares = ctx.scope.platform === 'all' ? averageShares(outcomes) : outcomes[0]?.shares ?? null;
  // The explanation sits behind an info button, as on every card; the tiles keep theirs on hover
  const heading = el('div', 'flex items-center justify-between gap-2 -my-1');
  const explanation = `${title.dataset.tip} The tiles beside it show the other key numbers; hover a tile name for its definition.`;
  delete title.dataset.tip;
  heading.append(title, infoButton(MEASURES.visibility.label, explanation));
  hero.append(heading, top, splitBar(shares, ctx.scope.platform === 'all' ? null : outcomes[0]?.counts));

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
      return tileNode({ label: MEASURES.prompts.label, info: MEASURES.prompts.info, ctx, plain: { value: formatInteger(model.prompts.length), detail: withAnswers === null ? where : `${where}. ${withAnswers} with answers on ${engineName(ctx.scope.platform)}`, note: null } });
    },
    runs: () => tileNode({ label: 'Runs in window', info: 'Weekly collection runs behind these numbers. Prompts are asked on the schedule of their panel.', ctx, plain: { value: String(RUNS.inWindow), detail: `Run ${RUNS.number}, last ${ctx.scope.platform === 'all' ? RUNS.last : lastRunOf(ctx.scope.platform)}`, note: null } }),
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
