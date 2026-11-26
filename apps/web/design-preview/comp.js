/* global window, document, location, history, URLSearchParams */
/**
 * The Competitors page of the static preview (route #/competitors, tabs #/competitors/mentions and so on), laid out as the
 * app's screen (WP-39): a toolbar with the Platform and Group selects, the comparison, saved views and Add competitor; six
 * underline tabs (Competitors, Mentions, Citations, Share of voice, AI visibility, SEO ranking); and on each tab a summary
 * strip, charts and one table. The numbers come from the Overview's fixture (aiov-data.js); the changes against the
 * previous period and the search ranks are drawn from seeded values, as the real reads are not collected for them here.
 */
import { formatInteger, formatPercent } from './vendor/format/number.js';
import { DEFAULTS, groupOptions, platformOptions, createSelect } from './aiov-controls.js';
import { WEEK_LABELS, buildModel, entitiesFor, gapFor, headToHead, sovWeeks, PLATFORMS } from './aiov-data.js';
import { chartHost, mountChart, disposeCharts } from './aiov-charts.js';
import { richLineOption } from './aiov-rich.js';
import { NEUTRAL_BADGE, cardFrame, el, icon, sampleBadge } from './aiov-parts.js';
import { na, table } from './tables.js';
import { seeded } from './prompts-data.js';

const ui = window.PreviewUI;
const charts = window.PreviewCharts;
const view = ui.$('[data-view="competitors"]');
const TABS = [['competitors', 'Competitors'], ['mentions', 'Mentions'], ['citations', 'Citations'], ['sov', 'Share of voice'], ['visibility', 'AI visibility'], ['seo', 'SEO ranking']];
const TAB_IDS = TABS.map(([id]) => id);

const MAX_TRACKED = 5;
const state = { platform: 'all', group: 'all', compare: true };
const pct = (value) => (value === null || value === undefined ? 'n/a' : formatPercent(value, { decimals: 1 }));
const points = (value) => (value === null ? 'n/a' : `${value >= 0 ? '+' : '-'}${Math.abs(value * 100).toFixed(1)} pts`);
const hash = (text) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
/** A change against the previous period: seeded per brand and measure, so it is the same on every load. */
const change = (name, measure) => (seeded(hash(`${name}|${measure}|${state.platform}|${state.group}`))() - 0.5) * 0.07;

function tabFromRoute() {
  const section = ui.currentRoute?.().section;
  return TAB_IDS.includes(section) ? section : 'competitors';
}

// -------------------------------------------------------------------------------------------------
// Pieces

const brand = (entity) => {
  const wrap = el('span', 'inline-flex items-center gap-2 min-w-0');
  wrap.append(el('span', `size-2 shrink-0 rounded-xs bg-${entity.token}`), el('span', 'truncate', entity.name));
  if (entity.own) wrap.append(el('span', NEUTRAL_BADGE, 'You'));
  return wrap;
};

const changeCell = (value) => {
  if (!state.compare) return el('span', 'text-foreground-secondary', 'n/a');
  return el('span', 'num', points(value));
};

function strip(items, label) {
  const dl = el('dl', 'grid grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-5 gap-px overflow-hidden rounded-lg border border-border bg-border');
  dl.setAttribute('aria-label', label);
  items.forEach(({ label: name, value, context }) => {
    const item = el('div', 'flex min-h-metric-strip min-w-0 flex-col justify-center gap-0.5 bg-surface px-4 py-2 @xl:[&:last-child:nth-child(odd)]:col-span-2 @4xl:[&:last-child:nth-child(odd)]:col-span-1');
    item.append(el('dt', 'type-meta text-foreground-secondary truncate', name), el('dd', 'num type-metric text-foreground', value));
    if (context) item.append(el('span', 'type-meta truncate', context));
    dl.append(item);
  });
  return dl;
}

function lineCard(title, labels, lines, meta) {
  const host = chartHost(240, title);
  const card = cardFrame({ key: `comp-${title}`, title, meta, body: host });
  queueMicrotask(() => mountChart(host, () => richLineOption({ labels, lines, format: (v) => `${Math.round(v * 100)}%` })));
  return card;
}

function barCard(title, rows, format, meta) {
  const host = chartHost(240, title);
  const card = cardFrame({ key: `comp-${title}`, title, meta, body: host });
  queueMicrotask(() =>
    mountChart(host, () => {
      const axes = charts.axisTheme();
      return {
        animation: false,
        grid: { left: 44, right: 16, top: 12, bottom: 28, outerBoundsMode: 'none' },
        xAxis: { type: 'category', data: rows.map((r) => r.name), ...axes.x, axisLabel: { ...axes.x.axisLabel, interval: 0 } },
        yAxis: { type: 'value', ...axes.y, axisLabel: { ...axes.y.axisLabel, formatter: format } },
        tooltip: charts.tooltipTheme((list) => list.map((p) => ({ color: p.color, name: p.name, value: format(p.value) }))),
        series: [{ type: 'bar', barMaxWidth: 28, data: rows.map((r) => ({ value: r.value, itemStyle: { color: charts.token(r.token), borderRadius: [4, 4, 0, 0] } })) }],
      };
    }),
  );
  return card;
}

function donutCard(title, rows, center) {
  const host = chartHost(240, title);
  const card = cardFrame({ key: `comp-${title}`, title, body: host });
  queueMicrotask(() =>
    mountChart(
      host,
      () => ({
        animation: false,
        tooltip: charts.tooltipTheme((list) => list.map((p) => ({ color: p.color, name: p.name, value: formatPercent(p.value, { decimals: 1 }) }))),
        legend: { orient: 'vertical', right: 8, top: 'middle', textStyle: { color: charts.token('chart-label') }, icon: 'roundRect', itemWidth: 8, itemHeight: 8 },
        title: { text: center.value, subtext: center.label, left: '28%', top: '38%', textAlign: 'center', textStyle: { color: charts.token('foreground'), fontSize: 22, fontWeight: 600 }, subtextStyle: { color: charts.token('chart-label'), fontSize: 12 } },
        series: [{ type: 'pie', radius: ['52%', '78%'], center: ['28%', '50%'], label: { show: false }, itemStyle: { borderColor: charts.token('surface'), borderWidth: 2 }, data: rows.map((r) => ({ name: r.name, value: r.value, itemStyle: { color: charts.token(r.token) } })) }],
      }),
      { redrawOnResize: true },
    ),
  );
  return card;
}

const panel = (...nodes) => {
  const grid = el('div', 'flex flex-col gap-3');
  grid.append(...nodes);
  return grid;
};
const grid3 = (...cards) => {
  const g = el('div', 'grid grid-cols-1 gap-3 @4xl:grid-cols-3');
  g.append(...cards);
  return g;
};

// -------------------------------------------------------------------------------------------------
// Tabs

function data() {
  const model = buildModel({ ...DEFAULTS, platform: state.platform, group: state.group });
  // The page tracks at most five competitors: you and the first five
  const entities = entitiesFor(model).slice(0, MAX_TRACKED + 1);
  const weeks = sovWeeks(model, entities);
  return { model, entities, weeks };
}

const rankedBy = (entities, key) => [...entities].sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1));

function competitorsTab({ entities, weeks }) {
  const ranked = rankedBy(entities, 'sov');
  const own = entities[0];
  const rivals = ranked.filter((e) => !e.own);
  const leader = rivals[0];
  const rank = ranked.indexOf(own) + 1;
  const gap = own.sov === null || leader?.sov == null ? null : own.sov - leader.sov;
  const mover = [...entities].sort((a, b) => Math.abs(change(b.name, 'sov')) - Math.abs(change(a.name, 'sov')))[0];
  const lines = entities.slice(0, 6).map((e, i) => ({ name: e.name, token: e.token, values: weeks.map((w) => w.shares[i]) }));
  const rows = [own, ...rivals];
  return panel(
    strip(
      [
        { label: 'Your share of voice', value: pct(own.sov), context: 'of all brand mentions' },
        { label: 'Your rank', value: `#${rank}`, context: `of ${entities.length} brands` },
        { label: 'Top competitor', value: pct(leader?.sov ?? null), context: leader?.name },
        { label: 'Gap to the top competitor', value: points(gap), context: gap === null ? null : gap >= 0 ? 'You lead' : 'You trail' },
        { label: 'Biggest mover', value: points(change(mover.name, 'sov')), context: mover.name },
      ],
      'Competitor summary',
    ),
    grid3(
      donutCard('Share of voice', rows.map((e) => ({ name: e.name, value: e.sov ?? 0, token: e.token })), { value: pct(own.sov), label: 'You' }),
      barCard('Mention rate by brand', rows.map((e) => ({ name: e.name, value: e.mention ?? 0, token: e.token })), (v) => `${Math.round(v * 100)}%`),
      lineCard('Share of voice over time', WEEK_LABELS, lines),
    ),
    table(
      [
        { header: 'Brand', cell: (e) => brand(e) },
        { header: 'Share of voice', cell: (e) => el('span', 'num', pct(e.sov)) },
        { header: 'Share of voice change', cell: (e) => changeCell(change(e.name, 'sov')) },
        { header: 'Mention rate', cell: (e) => el('span', 'num', pct(e.mention)) },
        { header: 'Citation share', cell: (e) => el('span', 'num', pct(citationOf(e))) },
        { header: 'Platforms with data', cell: (e) => el('span', 'num', `${e.platforms} / ${PLATFORMS.length}`) },
      ],
      rows,
    ),
  );
}

/** Citation share by brand: the share of the scope's cited units that point at the brand's domain, from the head to head read. */
function citationOf(entity) {
  const index = entity.own ? null : data.cache.entities.indexOf(entity) - 1;
  const h = headToHead(data.cache.model, Math.max(index ?? 0, 0));
  return entity.own ? h.sourceShare.own : h.sourceShare.rival;
}

function platformRates() {
  return PLATFORMS.map((p) => ({ code: p.code, name: p.name, entities: entitiesFor(buildModel({ ...DEFAULTS, platform: p.code, group: state.group })).slice(0, MAX_TRACKED + 1) }));
}

function metricTab({ entities, weeks }, kind) {
  const label = { mentions: 'Mention rate', citations: 'Citation share', sov: 'Share of voice' }[kind];
  const key = kind === 'mentions' ? 'mention' : kind === 'sov' ? 'sov' : 'citation';
  const value = (e) => (kind === 'citations' ? citationOf(e) : e[key]);
  const own = entities[0];
  const rows = rankedBy(entities, 'sov').map((e) => ({ ...e, value: value(e) }));
  const ownValue = value(own);
  const best = rows.filter((e) => !e.own && e.value !== null)[0];
  const mover = [...entities].sort((a, b) => Math.abs(change(b.name, kind)) - Math.abs(change(a.name, kind)))[0];
  const ahead = rows.filter((e) => !e.own && e.value !== null && ownValue !== null && e.value > ownValue).length;
  const per = platformRates();
  const platformRows = per.flatMap((p) => p.entities.slice(0, 4).map((e) => ({ platform: p.name, ...e })));
  const lines = entities.slice(0, 5).map((e, i) => ({
    name: e.name,
    token: e.token,
    values: weeks.map((w, wi) => {
      if (kind === 'sov') return w.shares[i];
      const base = value(e) ?? 0;
      return Math.max(0, base + (seeded(hash(`${e.name}|${kind}|${wi}`))() - 0.5) * 0.04);
    }),
  }));
  return panel(
    strip(
      [
        { label: `Your ${label.toLowerCase()}`, value: pct(ownValue), context: { mentions: 'of answers mention your brand', citations: 'of citations point to your pages', sov: 'of all brand mentions' }[kind] },
        { label: 'Top competitor', value: pct(best?.value ?? null), context: best?.name },
        { label: 'Competitors ahead of you', value: String(ahead), context: `of ${entities.length - 1} competitors` },
        { label: 'Biggest mover', value: points(change(mover.name, kind)), context: mover.name },
        { label: 'Platforms with data', value: `${own.platforms} / ${PLATFORMS.length}`, context: null },
      ],
      `${label} summary`,
    ),
    grid3(
      barCard(`${label} by brand`, rows.map((e) => ({ name: e.name, value: e.value ?? 0, token: e.token })), (v) => `${Math.round(v * 100)}%`),
      barCard(`${label} by platform`, per.map((p) => ({ name: p.name, value: kind === 'citations' ? (p.entities[0].mention ?? 0) * 0.6 : (p.entities[0][key === 'citation' ? 'mention' : key] ?? 0), token: 'chart-1' })), (v) => `${Math.round(v * 100)}%`, 'Your brand, one bar per platform'),
      lineCard(`${label} over time`, WEEK_LABELS, lines),
    ),
    table(
      [
        { header: 'Brand', cell: (e) => brand(e) },
        { header: label, cell: (e) => el('span', 'num', pct(e.value)) },
        { header: 'Change', cell: (e) => changeCell(change(e.name, kind)) },
        ...per.map((p) => ({ header: p.name, cell: (e) => { const hit = p.entities.find((x) => x.name === e.name); const v = hit ? (kind === 'sov' ? hit.sov : hit.mention) : null; return v === null || v === undefined ? na(`${p.name} has too few answers for ${e.name}.`) : el('span', 'num', pct(v)); } })),
      ],
      rows,
    ),
    el('span', 'hidden', String(platformRows.length)),
  );
}

function visibilityTab({ model, entities }) {
  const own = entities[0];
  const lost = gapFor(model).slice(0, MAX_TRACKED);
  const top = [...lost].sort((a, b) => b.lost - a.lost)[0];
  const cells = PLATFORMS.map((p) => ({ name: p.name, value: model.cells.visibility[p.code]?.value ?? null }));
  const best = [...cells].filter((c) => c.value !== null).sort((a, b) => b.value - a.value)[0];
  const totalLost = lost.reduce((sum, e) => sum + e.lost, 0);
  return panel(
    strip(
      [
        { label: 'Your mention rate', value: pct(own.mention), context: 'of answers mention your brand' },
        { label: 'Your strongest platform', value: best?.name ?? 'n/a', context: best ? `${pct(best.value)} visibility` : null },
        { label: 'Prompts lost', value: formatInteger(totalLost), context: 'a competitor leads' },
        { label: 'Most prompts lost to', value: top?.name ?? 'n/a', context: top ? `${formatInteger(top.lost)} prompts` : null },
        { label: 'Platforms with data', value: `${own.platforms} / ${PLATFORMS.length}`, context: null },
      ],
      'AI visibility summary',
    ),
    grid3(
      barCard('AI visibility by platform', cells.map((c) => ({ name: c.name, value: c.value ?? 0, token: 'chart-1' })), (v) => `${Math.round(v * 100)}%`),
      barCard('Prompts lost by competitor', lost.map((e) => ({ name: e.name, value: e.lost, token: e.token })), (v) => String(Math.round(v))),
      donutCard('Prompts compared', [{ name: 'You lead', value: lost.reduce((s, e) => s + e.ahead, 0) || 1, token: 'chart-1' }, { name: 'Close', value: lost.reduce((s, e) => s + e.close, 0) || 1, token: 'chart-other' }, { name: 'They lead', value: totalLost || 1, token: 'chart-3' }], { value: formatInteger(totalLost), label: 'lost' }),
    ),
    table(
      [
        { header: 'Brand', cell: (e) => brand(e) },
        { header: 'Mention rate', cell: (e) => el('span', 'num', pct(e.mention)) },
        { header: 'Prompts lost', cell: (e) => el('span', 'num', formatInteger(e.lost)) },
        { header: 'Prompts ahead', cell: (e) => el('span', 'num', formatInteger(e.ahead)) },
        { header: 'Prompts checked', cell: (e) => el('span', 'num', formatInteger(e.compared)) },
      ],
      lost,
    ),
  );
}

const KEYWORDS = ['crm for small business', 'best crm software', 'sales pipeline software', 'crm pricing', 'free crm', 'crm with email automation', 'crm for startups', 'customer database software'];
function seoTab({ entities }) {
  const brands = entities.slice(0, 4);
  const rows = KEYWORDS.map((keyword) => ({ keyword, ranks: brands.map((e, i) => { const r = seeded(hash(`${keyword}|${e.name}`))(); return r > (i === 0 ? 0.88 : 0.93) ? null : Math.max(1, Math.round(r * (i === 0 ? 22 : 16)) + 1); }) }));
  const top10 = brands.map((e, i) => ({ name: e.name, token: e.token, value: rows.filter((r) => r.ranks[i] !== null && r.ranks[i] <= 10).length }));
  const trail = rows.filter((r) => r.ranks[0] === null || r.ranks.slice(1).some((x) => x !== null && x < r.ranks[0])).length;
  const ranked = rows.map((r) => r.ranks[0]).filter((x) => x !== null);
  const buckets = [['Top 3', 1, 3], ['4 to 10', 4, 10], ['11 to 20', 11, 20], ['21 and below', 21, 100]].map(([name, lo, hi], i) => ({ name, value: ranked.filter((x) => x >= lo && x <= hi).length / KEYWORDS.length, token: `chart-${i + 1}` }));
  buckets.push({ name: 'Not ranked', value: rows.filter((r) => r.ranks[0] === null).length / KEYWORDS.length, token: 'chart-other' });
  const rankCell = (r) => (r === null ? na('This brand is not in the top 100 at the latest check.') : el('span', 'num', `#${r}`));
  return panel(
    strip(
      [
        { label: 'Your keywords in the top 10', value: String(top10[0].value), context: `of ${KEYWORDS.length} keywords` },
        { label: 'Keywords where you trail', value: String(trail), context: 'a competitor ranks higher' },
        { label: 'Top competitor', value: String([...top10.slice(1)].sort((a, b) => b.value - a.value)[0].value), context: [...top10.slice(1)].sort((a, b) => b.value - a.value)[0].name },
        { label: 'Your average position', value: ranked.length ? (ranked.reduce((a, b) => a + b, 0) / ranked.length).toFixed(1) : 'n/a', context: 'over the keywords you rank for' },
        { label: 'Keywords tracked', value: String(KEYWORDS.length), context: null },
      ],
      'SEO ranking summary',
    ),
    grid3(
      barCard('Keywords in the top 10', top10, (v) => String(Math.round(v))),
      donutCard('Your rank distribution', buckets, { value: `${top10[0].value}`, label: 'in the top 10' }),
      barCard('Rank distribution', buckets, (v) => `${Math.round(v * 100)}%`),
    ),
    table([{ header: 'Keyword', cell: (r) => r.keyword }, ...brands.map((e, i) => ({ header: e.name, cell: (r) => rankCell(r.ranks[i]) })), { header: 'Competitors ahead', cell: (r) => el('span', 'num', String(r.ranks.slice(1).filter((x) => x !== null && (r.ranks[0] === null || x < r.ranks[0])).length)) }], rows),
  );
}

// -------------------------------------------------------------------------------------------------
// Page

function toolbar(tab, count) {
  const wrap = el('div', 'flex flex-col gap-2');
  wrap.append(el('h1', 'sr-only', 'Competitors'));
  const row = el('div', 'flex flex-wrap items-center gap-x-3 gap-y-2');
  const platform = createSelect({ name: 'Platform', options: platformOptions, get: () => state.platform, set: (v) => { state.platform = v; render(); } });
  const group = createSelect({ name: 'Group', options: groupOptions, get: () => state.group, set: (v) => { state.group = v; render(); }, searchable: true });
  const compareOptions = [{ id: 'previous', label: 'vs previous period' }, { id: 'off', label: 'No comparison' }];
  const compare = createSelect({ name: 'Compare with', options: compareOptions, get: () => (state.compare ? 'previous' : 'off'), set: (v) => { state.compare = v === 'previous'; render(); } });
  row.append(platform.trigger, group.trigger);
  if (tab !== 'seo') row.append(compare.trigger);
  else row.append(el('p', 'type-meta', 'Search rankings are not AI answers, so the platform, branded and group filters do not apply here.'));
  const status = el('span', 'type-meta ml-auto', `${count} tracked ${count === 1 ? 'competitor' : 'competitors'}`);
  const add = el('button', 'h-control px-3 rounded-md bg-primary text-primary-foreground type-body-strong inline-flex items-center gap-1.5 hover:bg-primary-hover focus-visible:focus-ring', '');
  add.type = 'button';
  add.dataset.previewNote = 'Adding a competitor is turned off in this preview';
  add.append(icon('plus', 'size-icon'), el('span', '', 'Add competitor'));
  row.append(status, add);
  wrap.append(row);
  return wrap;
}

function tabs(active) {
  const bar = el('div', 'flex gap-5 border-b border-border overflow-x-auto');
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Competitor views');
  TABS.forEach(([id, label]) => {
    const on = id === active;
    const link = el('a', `h-tab px-0.5 border-b-2 shrink-0 inline-flex items-center focus-visible:focus-ring-inset ${on ? 'border-primary type-body-strong text-primary-text' : 'border-transparent type-body text-foreground-secondary hover:text-foreground'}`, label);
    link.href = id === 'competitors' ? '#/competitors' : `#/competitors/${id}`;
    link.setAttribute('role', 'tab');
    link.setAttribute('aria-selected', String(on));
    bar.append(link);
  });
  return bar;
}

function render() {
  disposeCharts();
  const tab = tabFromRoute();
  const d = data();
  data.cache = d;
  const body = { competitors: () => competitorsTab(d), mentions: () => metricTab(d, 'mentions'), citations: () => metricTab(d, 'citations'), sov: () => metricTab(d, 'sov'), visibility: () => visibilityTab(d), seo: () => seoTab(d) }[tab]();
  view.replaceChildren(toolbar(tab, d.entities.length - 1), tabs(tab), el('div', 'flex items-center gap-2', ''), body);
  view.children[2].append(sampleBadge('Sample data'));
}

render();
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#/competitors')) render();
});
