/* global setTimeout */
/**
 * The page detail of Page Performance (docs/32-page-performance.md section 5.3), shown as a drawer or as a page.
 * Order: header, verdict, indexing, filters, metric tiles, chart, What changed.
 *
 * `createDetail` returns `{ root, update, dispose }`. `update` redraws everything from the shared state.
 */
import {
  CORE_METRICS, HEALTH, HEALTH_VERSION, METRICS, PROVISIONAL_DAYS, SOURCES, FINAL_THROUGH, compareName, formatDay, formatInt, formatMetric, rangeText, signed,
} from './perf-calc.js';
import { appearanceRows, breakdownOf, countryName, deviceName, getPage, hasType, queryRows, urlOf } from './perf-data.js';
import { build as buildFilters } from './perf-filters.js';
import { bucketSeries, granularityFor, renderChartArea } from './perf-chart.js';
import { comparable, filtersOf, pageModel, rangesOf, tileOf } from './perf-model.js';
import {
  BUTTON_SM, TEXT_TONES, badge, button, checkRow, copyText, downloadCsv, icon, iconButton, popover, segmented, skeletonRows, toast,
} from './perf-ui.js';
import { el } from './prompts-parts.js';

const SERIES_COLORS = ['chart-1', 'chart-2', 'chart-3', 'chart-4'];
const INDEX_LABEL = { indexed: ['Indexed', 'positive'], not_indexed: ['Not indexed', 'negative'], warning: ['Canonical differs', 'warning'] };
const MORE_NOTES = {
  rank: 'No tracked keywords point to this page yet.',
  aiCitations: 'No AI answers have cited this page.',
};
const liveCache = new Map(); // the Redis cache of docs/32 section 7.5, kept for the session

export const healthBadge = (verdict) => badge(HEALTH[verdict].label, HEALTH[verdict].tone);

/** Change text with its color; neutral changes say why ("Within normal range") in the tooltip. */
export function changeSpan(change, className = '') {
  const node = el('span', `type-body-strong num whitespace-nowrap ${TEXT_TONES[change.tone] ?? TEXT_TONES.neutral} ${className}`.trim(), change.text);
  if (change.note) node.dataset.tip = change.note;
  return node;
}

export function createDetail({ get, set, shell, pageId, onClose, onStep, canStep }) {
  const root = el('div', 'flex flex-col min-h-0 flex-1');
  let chart = null;
  let renderToken = 0;
  let lastLiveKey = '';
  let filters = null;
  let dead = false;

  // --- Header
  const header = el('header', 'shrink-0 px-4 py-3 border-b border-border flex items-start gap-3 bg-background');
  const titleBlock = el('div', 'min-w-0 flex-1 flex flex-col gap-0.5');
  const title = el('h2', 'type-inspector-title break-all outline-none');
  title.tabIndex = -1;
  title.id = `perf-detail-title-${shell}`;
  const subtitle = el('p', 'type-meta');
  titleBlock.append(title, subtitle);
  const actions = el('div', 'flex items-center gap-1.5 shrink-0');
  const previous = iconButton('chevron-left', 'Previous page (K)', () => onStep(-1));
  const next = iconButton('chevron-right', 'Next page (J)', () => onStep(1));
  const copy = iconButton('copy', 'Copy URL', () => copyText(urlOf(getPage(pageId)), 'URL copied'));
  const open = iconButton('external-link', 'Open page', null);
  open.dataset.previewNote = 'Opening the live page';
  const exportButton = iconButton('download', 'Export this page as CSV', () => exportCsv());
  actions.append(previous, next, copy, open, exportButton);
  if (shell === 'drawer') actions.append(iconButton('x', 'Close', onClose));
  else header.append(button('All pages', { className: `${BUTTON_SM} shrink-0`, iconName: 'chevron-left', onClick: onClose }));
  header.append(titleBlock, actions);

  // --- Body
  const body = el('div', 'flex-1 min-h-0 overflow-auto px-4 py-4 flex flex-col gap-4');
  const verdictCard = el('section', 'rounded-lg border border-border bg-surface p-4 flex flex-col gap-2');
  verdictCard.setAttribute('aria-label', 'Health');
  const indexRow = el('section', 'rounded-lg border border-border bg-surface px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2');
  indexRow.setAttribute('aria-label', 'Indexing');
  filters = buildFilters({ get, set, scope: 'detail' });
  const notices = el('div', 'flex flex-col gap-2');
  const tiles = el('section', 'flex flex-col gap-2');
  tiles.setAttribute('aria-label', 'Metrics');
  const chartBlock = el('section', 'flex flex-col gap-2');
  chartBlock.setAttribute('aria-label', 'Chart');
  const chartBar = el('div', 'flex items-center gap-2 flex-wrap');
  const chartHost = el('div', 'w-full');
  chartBlock.append(chartBar, chartHost);
  const changed = el('section', 'flex flex-col gap-2');
  changed.setAttribute('aria-label', 'What changed');
  const footnote = el('p', 'type-meta pb-4');
  body.append(verdictCard, indexRow, filters.root, notices, tiles, chartBlock, changed, footnote);
  root.append(header, body);

  // -------------------------------------------------------------------------------------------------
  // Pieces

  function renderVerdict(model) {
    verdictCard.replaceChildren();
    const top = el('div', 'flex flex-wrap items-center gap-2');
    top.append(healthBadge(model.verdict.verdict), el('span', 'type-meta', `${HEALTH_VERSION}`));
    verdictCard.append(top, el('p', 'type-body-strong text-foreground', model.verdict.headline));
    const flags = model.verdict.flags.filter((flag) => flag.code !== 'provisional_excluded');
    if (flags.length > 0) {
      const list = el('ul', 'flex flex-col gap-1');
      flags.forEach((flag) => {
        const item = el('li', 'flex items-start gap-2 type-body text-foreground-secondary');
        item.append(icon(flag.code.includes('improved') ? 'trending-up' : flag.code === 'index_status_changed' || flag.code === 'url_form_changed' ? 'triangle-alert' : 'info', 'size-icon-sm mt-1 shrink-0 text-foreground-tertiary'), el('span', '', flag.text));
        list.append(item);
      });
      verdictCard.append(list);
    }
  }

  function renderIndexing(model) {
    indexRow.replaceChildren();
    const info = model.index;
    const [label, tone] = INDEX_LABEL[info.state];
    indexRow.append(el('span', 'type-label text-foreground-tertiary', 'Indexing'), badge(label, tone), el('span', 'type-body text-foreground', info.detail));
    const facts = [`Last crawl ${formatDay(info.lastCrawl)}`, info.changedOn ? `Changed ${formatDay(info.changedOn)}` : null, `Checked ${info.checkedAt}`].filter(Boolean);
    indexRow.append(el('span', 'type-meta', facts.join(', ')));
    if (info.canonical) indexRow.append(el('span', 'type-meta truncate max-w-80', `Google picked ${info.canonical.replace('https://', '')}`));
    const recheck = button('Check now', { className: `${BUTTON_SM} ml-auto`, iconName: 'refresh-cw' });
    recheck.addEventListener('click', () => {
      recheck.disabled = true;
      recheck.querySelector('svg')?.classList.add('animate-spin');
      setTimeout(() => {
        if (dead) return;
        recheck.disabled = false;
        recheck.querySelector('svg')?.classList.remove('animate-spin');
        toast({ title: 'Index status checked', description: `${label}. Google allows 2,000 checks a day per property.`, tone: 'success' });
      }, 900);
    });
    indexRow.append(recheck);
  }

  function renderNotices(ranges, state) {
    notices.replaceChildren();
    // Warnings are boxed because they change what the numbers mean; the rest is a quiet line (principle S6)
    const note = (text, tone = 'info') => {
      const warn = tone === 'warning';
      const row = el('div', warn ? 'rounded-md px-3 py-2 flex items-start gap-2 type-body border border-warning-border bg-warning-subtle text-foreground' : 'flex items-start gap-1.5 type-meta');
      row.append(icon(warn ? 'triangle-alert' : 'info', `size-icon-sm mt-1 shrink-0 ${warn ? 'text-warning-text' : 'text-foreground-tertiary'}`), el('span', '', text));
      notices.append(row);
    };
    if (ranges.compare?.unavailable) note(`The comparison range starts before our history (earliest day ${formatDay('2025-06-27', true)}). Pick a later range or no comparison.`, 'warning');
    if (!state.provisional) note(`${PROVISIONAL_DAYS.length} days (${formatDay(PROVISIONAL_DAYS[0])} to ${formatDay(PROVISIONAL_DAYS[1])}) are provisional and left out, so a half-finished day cannot look like a drop. Switch them on in the period menu.`);
    if (ranges.compare && !ranges.compare.unavailable && ranges.current.days !== ranges.compare.days) note(`The two ranges have ${ranges.current.days} and ${ranges.compare.days} days, so clicks and impressions are compared per day.`);
    if (!hasType(getPage(pageId), state.type)) note(`This page has no ${state.type} search data.`, 'warning');
  }

  function tileNode(key, tile, state, picked) {
    const info = METRICS[key];
    const colorIndex = state.metrics.indexOf(key);
    const checked = colorIndex >= 0;
    const disabled = !tile || (!checked && state.metrics.length >= 4);
    const card = el('label', `min-w-0 rounded-lg border px-3 py-2 flex flex-col gap-0.5 ${disabled ? 'border-border-subtle bg-surface-subtle' : 'border-border bg-surface hover:bg-surface-hover cursor-pointer'} ${checked ? 'border-border-strong' : ''}`);
    const head = el('span', 'flex items-center gap-2 min-w-0');
    const box = el('input', 'size-4 rounded-sm accent-primary shrink-0');
    box.type = 'checkbox';
    box.checked = checked;
    box.disabled = disabled;
    box.setAttribute('aria-label', `Show ${info.label} in the chart`);
    if (!tile) box.dataset.tip = MORE_NOTES[key] ?? 'No data for this page';
    else if (disabled) box.dataset.tip = 'Up to 4 metrics at once';
    box.addEventListener('change', () => {
      const metrics = box.checked ? [...state.metrics, key] : state.metrics.filter((item) => item !== key);
      if (metrics.length === 0) return picked();
      set({ metrics });
    });
    head.append(box);
    if (checked) {
      const swatch = el('span', 'size-2 rounded-xs shrink-0');
      swatch.style.background = `var(--${SERIES_COLORS[colorIndex]})`;
      head.append(swatch);
    }
    head.append(el('span', 'type-label truncate', info.label));
    card.append(head);
    if (info.source !== 'gsc') card.append(el('span', 'type-micro text-foreground-tertiary truncate', SOURCES[info.source]));
    if (!tile) {
      card.append(el('span', 'type-body text-foreground-tertiary', 'No data'), el('span', 'type-meta', MORE_NOTES[key] ?? 'Nothing recorded for this page.'));
      return card;
    }
    card.append(el('span', 'type-metric num', formatMetric(key, tile.cur)));
    if (tile.prev !== null) card.append(el('span', 'type-meta num', `vs ${formatMetric(key, tile.prev)}`));
    if (tile.change && tile.change.text !== 'No data') card.append(changeSpan(tile.change));
    return card;
  }

  function renderTiles(state, ranges, options) {
    tiles.replaceChildren();
    const keys = [...CORE_METRICS, ...[...state.extras]];
    const grid = el('div', 'grid grid-cols-2 lg:grid-cols-4 gap-2');
    const models = keys.map((key) => [key, tileOf(pageId, key, state, ranges, options)]);
    // A metric with no data cannot stay in the chart
    const usable = state.metrics.filter((key) => models.find(([name]) => name === key)?.[1]);
    if (usable.join() !== state.metrics.join() && usable.length > 0) {
      set({ metrics: usable });
      return null;
    }
    models.forEach(([key, tile]) => grid.append(tileNode(key, tile, state, () => toast({ title: 'Keep at least one metric', tone: 'info' }))));
    const bar = el('div', 'flex items-center gap-2');
    bar.append(el('h3', 'type-subsection-title', 'Metrics'), el('span', 'type-meta', 'Tick up to 4 to draw them'));
    const more = button('More metrics', { className: `${BUTTON_SM} ml-auto`, iconName: 'settings-2' });
    popover(more, (panel) => {
      ['gsc', 'rank', 'ai', 'ga4'].forEach((source) => {
        const keysOfSource = Object.keys(METRICS).filter((key) => METRICS[key].optional && METRICS[key].source === source);
        if (keysOfSource.length === 0) return;
        panel.append(el('p', 'px-2 pt-1.5 type-label text-foreground-tertiary', SOURCES[source]));
        keysOfSource.forEach((key) => panel.append(checkRow(METRICS[key].label, get().extras.has(key), (checked) => {
          const extras = new Set(get().extras);
          if (checked) extras.add(key); else extras.delete(key);
          set({ extras, metrics: checked ? get().metrics : get().metrics.filter((item) => item !== key) });
        })));
      });
      panel.append(el('p', 'px-2 py-1 type-meta', 'Each source is labeled and never added to Google numbers.'));
    }, { label: 'More metrics' });
    bar.append(more);
    tiles.append(bar, grid);
    return models;
  }

  function renderChart(state, ranges, models) {
    chart?.dispose();
    chart = null;
    chartBar.replaceChildren();
    const picked = state.metrics.map((key, index) => ({ key, color: SERIES_COLORS[index], tile: models.find(([name]) => name === key)?.[1] })).filter((item) => item.tile);
    chartBar.append(el('h3', 'type-subsection-title', 'Over time'));
    if (picked.length === 0) return;
    const layout = picked.length === 1 ? 'single' : picked.length === 2 ? state.layout : 'stack';
    const granularity = granularityFor(ranges.current.days);
    if (picked.length === 2) chartBar.append(segmented([['stack', 'Stacked'], ['overlay', 'Overlay']], state.layout, (value) => set({ layout: value }), 'Chart layout'));
    chartBar.append(el('span', 'type-meta', `By ${granularity}`));
    const toggle = segmented([['chart', 'Chart'], ['table', 'Table']], state.view, (value) => set({ view: value }), 'View');
    toggle.classList.add('ml-auto');
    chartBar.append(toggle);
    const buckets = {};
    for (const item of picked) buckets[item.key] = bucketSeries(item.key, item.tile.series.cur, item.tile.series.prev, granularity, state.provisional ? PROVISIONAL_DAYS : []);
    chartHost.replaceChildren();
    chart = renderChartArea(chartHost, { layout, metrics: picked.map(({ key, color }) => ({ key, color })), buckets, view: state.view });
    const legend = el('p', 'type-meta flex items-center gap-4 flex-wrap');
    legend.append(el('span', '', `Solid: ${ranges.current.label}`));
    if (ranges.compare && !ranges.compare.unavailable) legend.append(el('span', '', `Dashed: ${ranges.compare.label}, lined up by day number`));
    chartHost.append(legend);
  }

  // --- What changed
  const BREAKDOWN_TABS = [['countries', 'Countries'], ['devices', 'Devices'], ['queries', 'Queries'], ['appearance', 'Search appearance']];

  function renderChanged(state, ranges) {
    changed.replaceChildren();
    const bar = el('div', 'flex items-center gap-4 border-b border-border');
    bar.append(el('h3', 'type-subsection-title pb-2', 'What changed'));
    const tabs = el('div', 'flex items-end gap-4 ml-auto', '');
    tabs.setAttribute('role', 'tablist');
    BREAKDOWN_TABS.forEach(([value, text]) => {
      const live = value === 'queries' || value === 'appearance';
      const node = el('button', `h-9 px-0.5 border-b-2 flex items-center gap-1.5 ${state.tab === value ? 'border-primary type-body-strong text-primary-text' : 'border-transparent type-body text-foreground-secondary hover:text-foreground'}`, text);
      node.type = 'button';
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-selected', String(state.tab === value));
      if (live) node.append(el('span', 'size-1.5 rounded-full bg-info-text'));
      if (live) node.dataset.tip = 'Live from Google';
      node.addEventListener('click', () => set({ tab: value }));
      tabs.append(node);
    });
    bar.append(tabs);
    const content = el('div', 'flex flex-col gap-2');
    changed.append(bar, content);
    if (state.tab === 'countries' || state.tab === 'devices') storedBreakdown(content, state, ranges);
    else liveBreakdown(content, state, ranges);
  }

  const metricForBreakdown = (state) => (['clicks', 'impressions', 'ctr', 'position'].includes(state.metrics[0]) ? state.metrics[0] : 'clicks');

  function valueOfAcc(metric, acc) {
    if (!acc) return null;
    if (metric === 'clicks') return acc.clicks;
    if (metric === 'impressions') return acc.impressions;
    if (acc.impressions === 0) return null;
    return metric === 'ctr' ? acc.clicks / acc.impressions : acc.posSum / acc.impressions;
  }

  function tableShell(columns) {
    const table = el('table', 'w-full border-collapse type-table');
    const head = el('tr', 'h-row-header text-left bg-surface-subtle');
    columns.forEach(([text, align]) => head.append(el('th', `px-3 type-label whitespace-nowrap ${align === 'right' ? 'text-right' : ''}`, text)));
    const thead = el('thead');
    thead.append(head);
    const tbody = el('tbody');
    table.append(thead, tbody);
    const wrap = el('div', 'rounded-lg border border-border overflow-x-auto');
    wrap.append(table);
    return { wrap, tbody };
  }

  function shareBar(share) {
    const wrap = el('div', 'flex items-center gap-2 justify-end');
    const track = el('span', 'relative block h-2 w-24 shrink-0');
    const fill = el('span', `absolute top-0 h-2 rounded-2xs ${share < 0 ? 'right-1/2 bg-negative-solid' : 'left-1/2 bg-positive-solid'}`);
    fill.style.width = `${Math.min(50, Math.abs(share) * 50)}%`;
    const axis = el('span', 'absolute left-1/2 top-0 h-2 w-px bg-border-strong');
    track.append(axis, fill);
    wrap.append(track, el('span', 'w-10 text-right type-meta num', `${Math.round(Math.abs(share) * 100)}%`));
    return wrap;
  }

  function storedBreakdown(content, state, ranges) {
    const dimension = state.tab === 'countries' ? 'country' : 'device';
    const metric = metricForBreakdown(state);
    const f = filtersOf(state);
    const now = breakdownOf(pageId, state.type, ranges.current.from, ranges.current.to, dimension, f);
    const before = comparable(ranges) ? breakdownOf(pageId, state.type, ranges.compare.from, ranges.compare.to, dimension, f) : null;
    const additive = metric === 'clicks' || metric === 'impressions';
    const scale = before ? ranges.current.days / ranges.compare.days : 1;
    const rows = [...new Set([...now.keys(), ...(before?.keys() ?? [])])].map((key) => {
      const a = now.get(key);
      const b = before?.get(key);
      const cur = valueOfAcc(metric, a);
      const prev = valueOfAcc(metric, b);
      const delta = additive ? (cur ?? 0) - (prev ?? 0) * scale : cur !== null && prev !== null ? cur - prev : 0;
      return { key, cur, prev, delta };
    });
    rows.sort((a, b) => (additive ? Math.abs(b.delta) - Math.abs(a.delta) : (b.cur ?? 0) - (a.cur ?? 0)));
    const net = rows.reduce((sum, row) => sum + row.delta, 0);
    const { wrap, tbody } = tableShell([[state.tab === 'countries' ? 'Country' : 'Device'], [`${METRICS[metric].label} now`, 'right'], ['Before', 'right'], ['Change', 'right'], [additive ? 'Share of the change' : '', 'right']]);
    const visible = rows.filter((row) => row.cur !== null || row.prev !== null).slice(0, 12);
    if (visible.length === 0) content.append(el('p', 'type-body text-foreground-secondary py-4', 'No data for these filters.'));
    visible.forEach((row) => {
      const tr = el('tr', 'h-row-compact border-t border-border-subtle hover:bg-surface-hover');
      const name = state.tab === 'countries' ? countryName(row.key) : deviceName(row.key);
      const pick = el('button', 'type-body text-link hover:underline text-left', name);
      pick.type = 'button';
      pick.dataset.tip = `Filter to ${name}`;
      pick.addEventListener('click', () => {
        const key = state.tab === 'countries' ? 'countries' : 'devices';
        set({ [key]: new Set([row.key]) });
      });
      const first = el('td', 'px-3');
      first.append(pick);
      const change = before && row.cur !== null && row.prev !== null && additive
        ? { text: row.prev > 0 ? signed(row.delta, `${Math.abs((row.cur / ranges.current.days / (row.prev / ranges.compare.days) - 1) * 100).toFixed(0)}%`) : 'New', tone: row.delta > 0 ? 'positive' : row.delta < 0 ? 'negative' : 'neutral' }
        : before && row.cur !== null && row.prev !== null
          ? { text: metric === 'position' ? `${row.delta < 0 ? 'improved' : 'slipped'} ${Math.abs(row.delta).toFixed(1)}` : signed(row.delta, `${Math.abs(row.delta * 100).toFixed(1)} pts`), tone: Math.abs(row.delta) < 0.001 ? 'neutral' : (metric === 'position' ? row.delta < 0 : row.delta > 0) ? 'positive' : 'negative' }
          : null;
      const cells = [first, el('td', 'px-3 text-right num', row.cur === null ? 'No data' : formatMetric(metric, row.cur)), el('td', 'px-3 text-right num text-foreground-secondary', row.prev === null ? '' : formatMetric(metric, row.prev))];
      const changeCell = el('td', 'px-3 text-right');
      if (change) changeCell.append(changeSpan({ ...change, note: null }));
      const shareCell = el('td', 'px-3');
      if (additive && net !== 0 && before) shareCell.append(shareBar(row.delta / Math.abs(net)));
      tr.append(...cells, changeCell, shareCell);
      tbody.append(tr);
    });
    if (visible.length > 0) content.append(wrap);
    if (rows.length > 12) content.append(el('p', 'type-meta', `Showing the 12 biggest of ${rows.length}.`));
    if (additive && before) content.append(el('p', 'type-meta', 'The bar shows each row as a share of the net change. Green rows added clicks, red rows lost them. Click a name to filter the whole screen to it.'));
  }

  // Live: queries and search appearance. A short wait, a cache, and a retry state (docs/32 section 7.5)
  async function liveBreakdown(content, state, ranges) {
    const token = renderToken;
    const isQueries = state.tab === 'queries';
    const key = `${pageId}|${state.tab}|${state.type}|${state.period}|${state.compare}|${state.provisional}|${[...state.countries]}|${[...state.devices]}|${state.query?.op}:${state.query?.value}`;
    if (state.review === 'quota') {
      const retry = el('div', 'rounded-lg border border-warning-border bg-warning-subtle px-4 py-3 flex items-center gap-3');
      retry.append(icon('triangle-alert', 'size-icon text-warning-text shrink-0'), el('span', 'type-body text-foreground', 'Google is busy. Retrying in 20 seconds. The countries and devices tabs keep working.'), button('Retry now', { className: `${BUTTON_SM} ml-auto`, onClick: () => set({ review: 'connected' }) }));
      content.append(retry);
      return;
    }
    const cached = liveCache.get(key);
    let result = cached?.result;
    if (!result) {
      const skeleton = tableShell([['Query'], ['Clicks now', 'right'], ['Before', 'right'], ['Change', 'right'], ['Position', 'right']]);
      skeleton.tbody.append(skeletonRows(6, 5));
      content.append(skeleton.wrap, el('p', 'type-meta', 'Asking Google for this page and these filters...'));
      const f = filtersOf(state);
      const data = await (isQueries ? queryRows(pageId, state.type, ranges.current, ranges.compare, f) : appearanceRows(pageId, state.type, ranges.current, ranges.compare, f));
      result = isQueries ? data : { rows: data, coverage: 1 };
      if (token !== renderToken || dead) return;
      liveCache.set(key, { result, at: Date.now() });
    }
    content.replaceChildren();
    const { rows } = result;
    const scale = ranges.compare && !ranges.compare.unavailable ? ranges.current.days / ranges.compare.days : 1;
    const hasBefore = comparable(ranges);
    const withDelta = rows.map((row) => ({ ...row, delta: row.now.clicks - (row.before?.clicks ?? 0) * scale }));
    const modes = [['losers', 'Biggest losers'], ['gainers', 'Biggest gainers'], ['new', 'New'], ['lost', 'Lost'], ['all', 'All']];
    const mode = hasBefore ? state.mode : 'all';
    if (isQueries && hasBefore) content.append(segmented(modes, mode, (value) => set({ mode: value }), 'Queries to show'));
    const filtered = withDelta
      .filter((row) => (mode === 'losers' ? row.delta < 0 && row.before : mode === 'gainers' ? row.delta > 0 && row.before : mode === 'new' ? row.now.clicks > 0 && (!row.before || row.before.clicks === 0) : mode === 'lost' ? row.now.clicks === 0 && row.before?.clicks > 0 : true))
      .sort((a, b) => (mode === 'gainers' ? b.delta - a.delta : mode === 'losers' ? a.delta - b.delta : mode === 'all' ? b.now.clicks - a.now.clicks : Math.abs(b.delta) - Math.abs(a.delta)))
      .slice(0, 15);
    const { wrap, tbody } = tableShell([[isQueries ? 'Query' : 'Appearance'], ['Clicks now', 'right'], ['Before', 'right'], ['Change', 'right'], [isQueries ? 'Position' : 'Impressions', 'right']]);
    if (filtered.length === 0) content.append(el('p', 'type-body text-foreground-secondary py-4', hasBefore ? 'Nothing in this group for these filters.' : 'No rows for these filters.'));
    filtered.forEach((row) => {
      const tr = el('tr', 'h-row-compact border-t border-border-subtle hover:bg-surface-hover');
      const first = el('td', 'px-3 max-w-64');
      if (isQueries) {
        const pick = el('button', 'type-body text-link hover:underline text-left truncate max-w-full', row.text);
        pick.type = 'button';
        pick.dataset.tip = 'Filter the whole screen to this query';
        pick.addEventListener('click', () => set({ query: { op: 'equals', value: row.text } }));
        first.append(pick);
      } else first.append(el('span', 'type-body', row.text));
      const change = !hasBefore ? null : !row.before || row.before.clicks === 0 ? (row.now.clicks > 0 ? { text: 'New', tone: 'positive' } : null) : row.now.clicks === 0 ? { text: 'Lost', tone: 'negative' } : { text: signed(row.delta, `${Math.abs((row.now.clicks / ranges.current.days / (row.before.clicks / ranges.compare.days) - 1) * 100).toFixed(0)}%`), tone: row.delta > 0 ? 'positive' : row.delta < 0 ? 'negative' : 'neutral' };
      const changeCell = el('td', 'px-3 text-right');
      if (change) changeCell.append(changeSpan({ ...change, note: null }));
      tr.append(first, el('td', 'px-3 text-right num', formatInt(row.now.clicks)), el('td', 'px-3 text-right num text-foreground-secondary', row.before ? formatInt(row.before.clicks) : ''), changeCell, el('td', 'px-3 text-right num', isQueries ? (row.now.position ? row.now.position.toFixed(1) : '') : formatInt(row.now.impressions)));
      tbody.append(tr);
    });
    if (filtered.length > 0) content.append(wrap);
    const stamp = el('p', 'type-meta flex items-center gap-2 flex-wrap');
    stamp.append(badge(cached ? 'From cache' : 'Live from Google', cached ? 'neutral' : 'info'), el('span', '', cached ? 'Cached for 6 hours, the same request is not sent to Google again.' : 'Cached for 6 hours.'));
    if (isQueries) stamp.append(el('span', '', `The query list covers ${Math.round((result.coverage ?? 0.88) * 100)}% of this page's clicks. The rest are anonymized queries Google does not report.`));
    content.append(stamp);
  }

  // --- Export
  function exportCsv() {
    const state = get();
    const ranges = rangesOf(state);
    const picked = state.metrics;
    const rowsOut = [['Date', ...picked.map((key) => METRICS[key].label), ...(comparable(ranges) ? picked.map((key) => `${METRICS[key].label} before`) : [])]];
    const series = picked.map((key) => tileOf(pageId, key, state, ranges)?.series);
    const days = series[0]?.cur.days ?? [];
    days.forEach((iso, index) => {
      const value = (part, key) => {
        if (!part) return '';
        const top = part.num[index];
        const bottom = part.den ? part.den[index] : 1;
        if (METRICS[key].kind === 'sum') return Math.round(top);
        return bottom > 0 ? Number((top / bottom).toFixed(4)) : '';
      };
      rowsOut.push([iso, ...picked.map((key, i) => value(series[i]?.cur, key)), ...(comparable(ranges) ? picked.map((key, i) => value(series[i]?.prev, key)) : [])]);
    });
    downloadCsv(`${getPage(pageId).path.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'page'}-${ranges.current.from}-${ranges.current.to}.csv`, rowsOut);
  }

  // -------------------------------------------------------------------------------------------------
  // Update

  function update() {
    if (dead) return;
    renderToken += 1;
    const state = get();
    const page = getPage(pageId);
    if (!page) {
      onClose();
      return;
    }
    const ranges = rangesOf(state);
    const model = pageModel(pageId, state, { query: true, full: true });
    title.textContent = page.path;
    subtitle.textContent = `${urlOf(page).replace('https://', '').replace(page.path, '')}${page.group ? `, ${page.group}` : ''}`;
    previous.disabled = !canStep(-1);
    next.disabled = !canStep(1);
    filters.sync();
    renderVerdict(model);
    renderIndexing(model);
    renderNotices(ranges, state);

    // A query filter is a live call: show the wait the first time, then answer from the cache
    const queryKey = `${pageId}|${state.query?.op}:${state.query?.value}`;
    const waiting = Boolean(state.query) && queryKey !== lastLiveKey && !liveCache.has(`q|${queryKey}`);
    lastLiveKey = queryKey;
    const draw = () => {
      const models = renderTiles(state, ranges, { query: true });
      if (!models) return;
      renderChart(state, ranges, models);
      renderChanged(state, ranges);
      footnote.textContent = `${SOURCES.gsc}. Dates are Pacific Time. Final data through ${formatDay(FINAL_THROUGH, true)}. ${state.provisional ? `${PROVISIONAL_DAYS.length} provisional days are included and hatched.` : `${PROVISIONAL_DAYS.length} provisional days are excluded.`} ${compareName(state.compare, ranges.current)}${ranges.compare ? `: ${rangeText(ranges.compare)}` : ''}. Health method ${HEALTH_VERSION}.`;
    };
    if (waiting) {
      const token = renderToken;
      tiles.replaceChildren(el('p', 'type-meta py-3', 'Asking Google for this query filter...'));
      chart?.dispose();
      chart = null;
      chartHost.replaceChildren();
      setTimeout(() => {
        if (token !== renderToken || dead) return;
        liveCache.set(`q|${queryKey}`, { at: Date.now() });
        draw();
      }, 700);
    } else draw();
  }

  function dispose() {
    dead = true;
    chart?.dispose();
  }

  update();
  return { root, update, dispose, focusTitle: () => title.focus() };
}
