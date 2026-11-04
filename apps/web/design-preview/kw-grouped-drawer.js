/* global document, window */
/**
 * The drawer of the grouped Rankings mock: a keyword (its ranks on each device, metrics and group) or a group (how
 * its keywords are spread over the ranks, who moved most). It opens from a row, closes with Escape and steps through
 * the keywords of the table in its order.
 */
import { UNGROUPED, archiveKeywords, deleteKeywords, groupNames, moveKeywords, recheck, series, store } from './kw-grouped-data.js';
import { BUTTON_SM, icon, iconButton, toast } from './perf-ui.js';
import { confirmDialog } from './kw-dialog.js';
import { el } from './prompts-parts.js';
import { derived, devicesIn, gained, groupOf, isRank, measures, plural, rankText, refresh, shown, sparkline, state, volumeText } from './kw-grouped-model.js';
import { openAdd, openRename, confirmDeleteGroup } from './kw-grouped-dialogs.js';

let host = null;

export function closeDrawer() {
  state.open = null;
  host?.remove();
  host = null;
}

export function openKeyword(id) {
  state.open = { type: 'keyword', id };
  draw();
}

export function openGroup(name) {
  state.open = { type: 'group', name };
  draw();
}

function section(title, ...children) {
  const wrap = el('section', 'flex flex-col gap-2');
  wrap.append(el('h3', 'type-label text-foreground-tertiary uppercase', title), ...children);
  return wrap;
}

function facts(pairs) {
  const list = el('dl', 'grid grid-cols-2 gap-x-4 gap-y-2');
  pairs.forEach(([label, value]) => {
    const item = el('div', 'flex flex-col');
    item.append(el('dt', 'type-label text-foreground-tertiary', label), el('dd', 'type-body num text-foreground', value));
    list.append(item);
  });
  return list;
}

function deviceCard(keyword, device) {
  const rank = keyword.ranks[device];
  const card = el('div', 'rounded-md border border-border p-3 flex flex-col gap-2');
  card.append(el('span', 'type-label text-foreground-tertiary', device === 'desktop' ? 'Desktop' : 'Mobile'));
  const line = el('div', 'flex items-baseline gap-2');
  line.append(el('span', `type-section-title num ${isRank(rank) ? '' : 'text-foreground-tertiary'}`, rankText(rank)));
  const move = gained(keyword, device);
  if (move !== 0 && isRank(rank)) line.append(el('span', `type-label num ${move > 0 ? 'text-positive-text' : 'text-negative-text'}`, `${move > 0 ? '↑' : '↓'}${Math.abs(move)} since the last check`));
  card.append(line);
  if (isRank(rank)) card.append(sparkline(series(rank, keyword.keyword.length + (device === 'mobile' ? 3 : 0)), `Rank over 30 days on ${device}`, 'w-full h-8 text-primary'));
  return card;
}

function keywordBody(keyword) {
  const info = derived(keyword);
  const body = el('div', 'flex flex-col gap-5');
  const cards = el('div', 'grid grid-cols-2 gap-3');
  devicesIn().forEach((device) => cards.append(deviceCard(keyword, device)));
  body.append(section('Rank', cards));
  body.append(section('Metrics', facts([['Search volume', volumeText(keyword.volume)], ['Keyword difficulty', keyword.kd === null ? 'No data' : String(keyword.kd)], ['CPC (USD)', keyword.cpc ? `$${keyword.cpc.toFixed(2)}` : 'No data'], ['Intent', keyword.intent[0].toUpperCase() + keyword.intent.slice(1)], ['Priority', String(keyword.priority)], ['Country', keyword.country]])));
  const choose = el('select', 'h-control px-3 pr-8 rounded-md border border-border bg-surface type-body text-foreground w-full');
  choose.setAttribute('aria-label', 'Group');
  [UNGROUPED, ...groupNames()].forEach((name) => {
    const option = el('option', '', name === UNGROUPED ? 'No group' : name);
    option.value = name;
    choose.append(option);
  });
  choose.value = groupOf(keyword);
  choose.addEventListener('change', () => {
    moveKeywords(new Set([keyword.id]), choose.value);
    toast({ title: 'Keyword moved', description: `${keyword.keyword} is in ${choose.value === UNGROUPED ? 'no group' : choose.value}.`, tone: 'success' });
    refresh();
  });
  body.append(section('Group', choose));
  const page = info.url ? Object.assign(el('a', 'type-body text-link hover:underline break-all', info.url.replace('https://', '')), { href: info.url, target: '_blank', rel: 'noopener noreferrer' }) : el('span', 'type-body text-foreground-tertiary', 'Not ranking yet');
  body.append(section('Ranking page', page));
  return body;
}

function bucket(items, test) {
  return items.flatMap((keyword) => devicesIn().map((device) => keyword.ranks[device])).filter(test).length;
}

function groupBody(name) {
  const items = shown().filter((keyword) => groupOf(keyword) === name);
  const m = measures(items);
  const body = el('div', 'flex flex-col gap-5');
  body.append(section('Summary', facts([['Keywords', plural(items.length, 'keyword')], ['Tracked', String(m.tracked)], ['Top 10', `${m.top10} of ${m.tracked}`], ['Top 10 reach', `${Math.round(m.reach * 100)}% of volume`], ['Search volume', `${m.volume.toLocaleString('en-US')} a month`], ['Average KD', m.kd === null ? 'No data' : String(m.kd)]])));
  const spread = [['Top 3', (rank) => isRank(rank) && rank <= 3], ['4 to 10', (rank) => isRank(rank) && rank >= 4 && rank <= 10], ['11 to 20', (rank) => isRank(rank) && rank >= 11 && rank <= 20], ['21 to 100', (rank) => isRank(rank) && rank >= 21], ['Over 100', (rank) => rank === 'b']].map(([label, test]) => [label, bucket(items, test)]);
  const total = Math.max(1, spread.reduce((sum, [, count]) => sum + count, 0));
  const bar = el('div', 'flex h-3 overflow-hidden rounded-sm bg-surface-subtle');
  const shades = ['bg-positive-text', 'bg-primary', 'bg-info-text', 'bg-neutral-text', 'bg-border-strong'];
  spread.forEach(([label, count], index) => {
    if (count === 0) return;
    const part = el('span', shades[index]);
    part.style.width = `${(count / total) * 100}%`;
    part.title = `${label}: ${count}`;
    bar.append(part);
  });
  const legend = el('ul', 'grid grid-cols-2 gap-x-4 gap-y-1');
  spread.forEach(([label, count], index) => {
    const row = el('li', 'flex items-center gap-2 type-body');
    row.append(el('span', `size-2 rounded-full ${shades[index]}`), el('span', 'flex-1', label), el('span', 'num', String(count)));
    legend.append(row);
  });
  body.append(section('Where its keywords rank', bar, legend));
  const moves = items.map((keyword) => [keyword, Math.max(...devicesIn().map((device) => gained(keyword, device))), Math.min(...devicesIn().map((device) => gained(keyword, device)))]);
  const list = (label, picked, key) => {
    const wrap = el('ul', 'flex flex-col');
    if (picked.length === 0) wrap.append(el('li', 'type-body text-foreground-tertiary py-1', 'None since the last check'));
    picked.forEach(([keyword, up, down]) => {
      const value = key === 'up' ? up : down;
      const item = el('li', 'py-1 border-b border-border-subtle');
      const link = el('button', 'w-full flex items-center gap-2 text-left hover:text-primary-text');
      link.type = 'button';
      link.append(el('span', 'min-w-0 flex-1 truncate type-body', keyword.keyword), el('span', `type-label num ${value > 0 ? 'text-positive-text' : 'text-negative-text'}`, `${value > 0 ? '↑' : '↓'}${Math.abs(value)}`));
      link.addEventListener('click', () => openKeyword(keyword.id));
      item.append(link);
      wrap.append(item);
    });
    return section(label, wrap);
  };
  body.append(list('Moved up most', moves.filter(([, up]) => up > 0).sort((a, b) => b[1] - a[1]).slice(0, 3), 'up'));
  body.append(list('Moved down most', moves.filter(([, , down]) => down < 0).sort((a, b) => a[2] - b[2]).slice(0, 3), 'down'));
  return body;
}

function actions(open) {
  const bar = el('div', 'flex flex-wrap gap-2');
  const add = (label, iconName, run, className = BUTTON_SM) => {
    const node = el('button', className);
    node.type = 'button';
    node.append(icon(iconName, 'size-icon-sm text-foreground-tertiary'), el('span', '', label));
    node.addEventListener('click', run);
    bar.append(node);
  };
  const check = (ids) => () => {
    recheck(ids);
    toast({ title: 'Check finished', description: `${plural(ids.size, 'keyword')} checked. The ranks are up to date.`, tone: 'success' });
    refresh();
  };
  if (open.type === 'keyword') {
    const keyword = store.keywords.find((candidate) => candidate.id === open.id);
    add('Check now', 'refresh-cw', check(new Set([keyword.id])));
    add(keyword.archived ? 'Restore' : 'Archive', keyword.archived ? 'archive-restore' : 'archive', () => {
      archiveKeywords(new Set([keyword.id]), !keyword.archived);
      closeDrawer();
      refresh();
    });
    add('Delete', 'trash-2', () => confirmDialog({ title: `Delete ${keyword.keyword}?`, description: 'Its history is deleted with it.', confirmLabel: 'Delete', danger: true, onConfirm: () => {
      deleteKeywords(new Set([keyword.id]));
      closeDrawer();
      refresh();
    } }));
  } else {
    const ids = new Set(shown().filter((keyword) => groupOf(keyword) === open.name).map((keyword) => keyword.id));
    add('Check now', 'refresh-cw', check(ids));
    add('Add keywords', 'plus', () => openAdd({ group: open.name, country: state.country === 'All countries' ? 'India' : state.country }));
    if (open.name !== UNGROUPED) {
      add('Rename', 'pencil', () => openRename(open.name));
      add('Delete', 'trash-2', () => confirmDeleteGroup(open.name, closeDrawer));
    }
  }
  return bar;
}

function step(delta) {
  const ids = shown().map((keyword) => keyword.id);
  const index = ids.indexOf(state.open.id);
  const next = ids[index + delta];
  if (next) openKeyword(next);
}

function draw() {
  host?.remove();
  const open = state.open;
  if (!open) return;
  const keyword = open.type === 'keyword' ? store.keywords.find((candidate) => candidate.id === open.id) : null;
  if (open.type === 'keyword' && !keyword) return closeDrawer();
  host = el('aside', 'fixed inset-y-0 right-0 z-(--z-drawer) w-full max-w-(--container-dialog-md) bg-surface border-l border-border shadow-popover flex flex-col');
  host.setAttribute('aria-label', open.type === 'keyword' ? `Keyword ${keyword.keyword}` : `Group ${open.name}`);
  const head = el('header', 'px-4 py-3 border-b border-border flex items-start gap-2');
  const text = el('div', 'min-w-0 flex-1 flex flex-col');
  text.append(el('h2', 'type-section-title truncate', open.type === 'keyword' ? keyword.keyword : open.name), el('span', 'type-meta', open.type === 'keyword' ? groupOf(keyword) : store.groups.find((group) => group.name === open.name)?.note ?? 'Keywords that belong to no group.'));
  head.append(text);
  if (open.type === 'keyword') head.append(iconButton('chevron-up', 'Previous keyword', () => step(-1)), iconButton('chevron-down', 'Next keyword', () => step(1)));
  head.append(iconButton('x', 'Close', () => {
    closeDrawer();
  }));
  const body = el('div', 'flex-1 min-h-0 overflow-auto px-4 py-4 flex flex-col gap-5');
  body.append(open.type === 'keyword' ? keywordBody(keyword) : groupBody(open.name));
  const foot = el('footer', 'px-4 py-3 border-t border-border');
  foot.append(actions(open));
  host.append(head, body, foot);
  host.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDrawer();
  });
  document.body.append(host);
  host.querySelector('button')?.focus();
}

export const redrawDrawer = () => {
  if (state.open) draw();
};
window.addEventListener('preview-leave', closeDrawer);
