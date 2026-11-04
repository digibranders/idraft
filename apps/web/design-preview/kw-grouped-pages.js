/* global document, window, setTimeout, clearTimeout */
/**
 * The pages of the project that rank for a keyword, on the hover of the arrow beside its name (a mock: the app gets
 * them from `state.ranking_urls`, docs/19 section 3.6). One keyword can rank with more than one page, on a device or
 * across the two, and the popup lists each page with its rank on the devices the table shows, best first. A page
 * that shares a rank with another is a sub-result of it (a sitelink under the same result).
 */
import { el } from './prompts-parts.js';
import { derived, devicesIn, isRank, state } from './kw-grouped-model.js';

// What a production check found (2026-11-04, Eventus): two pages on the same keyword, on both devices
const PRESET = {
  'best soc service provider': [['/best-soc-as-a-service-providers-2025', 5, 13], ['/managed-soc-service', 16, 19]],
  'top soc service provider': [['/best-soc-as-a-service-providers-2025', 14, 12], ['/managed-soc-service', 18, null]],
};
const MORE = ['/managed-soc-service', '/solutions/security-operations-center', '/blog/what-is-soc-as-a-service', '/pricing', '/solutions/mssp'];

/** The pages that rank for a keyword on the devices chosen, best rank first. */
export function pagesOf(keyword) {
  const info = derived(keyword);
  const devices = devicesIn();
  let pages = [];
  if (PRESET[keyword.keyword]) {
    pages = PRESET[keyword.keyword].map(([path, desktop, mobile]) => ({ path, ranks: { desktop, mobile }, shared: false }));
  } else if (info.url) {
    const path = info.url.replace('https://eventussecurity.com', '');
    const ranks = { desktop: isRank(keyword.ranks.desktop) ? keyword.ranks.desktop : null, mobile: isRank(keyword.ranks.mobile) ? keyword.ranks.mobile : null };
    pages.push({ path, ranks, shared: false });
    if (info.seed % 4 === 0) {
      const gap = 3 + (info.seed % 9);
      pages.push({ path: MORE[info.seed % MORE.length], ranks: { desktop: ranks.desktop === null ? null : Math.min(100, ranks.desktop + gap), mobile: ranks.mobile === null ? null : Math.min(100, ranks.mobile + gap) }, shared: false });
    }
    if (info.seed % 11 === 0) pages.push({ path: `${path}#pricing`.replace(/#.*/, '/pricing'), ranks: { ...ranks }, shared: true });
  }
  const shown = pages.filter((page) => devices.some((device) => page.ranks[device] !== null && page.ranks[device] !== undefined));
  const key = (page) => Math.min(...devices.map((device) => page.ranks[device] ?? 1000));
  return shown.sort((a, b) => key(a) - key(b));
}

let panel = null;
let timer = null;
let anchor = null;

export function closePages() {
  clearTimeout(timer);
  panel?.remove();
  panel = null;
  anchor = null;
}

function row(page, devices, best) {
  const line = el('tr', 'border-t border-border-subtle');
  const name = el('td', 'py-1.5 pr-4 max-w-72');
  const link = el('a', 'block truncate type-body text-link hover:underline', page.path);
  link.href = `https://eventussecurity.com${page.path}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  name.append(link);
  const note = [best ? 'Best rank' : '', page.shared ? 'Sub-result of the page above' : ''].filter(Boolean).join(' · ');
  if (note) name.append(el('span', 'type-label text-foreground-tertiary', note));
  line.append(name);
  devices.forEach((device) => line.append(el('td', 'py-1.5 pl-3 text-right type-table num text-foreground', page.ranks[device] === null || page.ranks[device] === undefined ? '>100' : String(page.ranks[device]))));
  return line;
}

function open(target, keyword) {
  closePages();
  const pages = pagesOf(keyword);
  if (pages.length === 0) return;
  anchor = target;
  const devices = devicesIn();
  panel = el('div', 'fixed z-(--z-dialog) w-max min-w-72 max-w-(--size-popover-max) rounded-lg border border-border bg-surface-elevated shadow-popover p-3 flex flex-col gap-2');
  panel.setAttribute('role', 'tooltip');
  panel.append(el('p', 'type-label text-foreground-tertiary uppercase', pages.length === 1 ? 'Ranking page' : `${pages.length} pages rank for this keyword`));
  const table = el('table', 'border-collapse');
  const head = el('tr', '');
  head.append(el('th', 'pb-1 text-left type-micro text-foreground-tertiary font-normal', 'Page'));
  devices.forEach((device) => head.append(el('th', 'pb-1 pl-3 text-right type-micro text-foreground-tertiary font-normal', device === 'desktop' ? 'Desktop' : 'Mobile')));
  const body = el('tbody', '');
  body.append(head, ...pages.map((page, index) => row(page, devices, index === 0 && pages.length > 1)));
  table.append(body);
  panel.append(table);
  const info = derived(keyword);
  panel.append(el('p', 'type-label text-foreground-tertiary', `At the last check, ${info.updated}${pages.length > 1 ? '. Pages competing for one keyword can hold each other back.' : ''}`));
  panel.addEventListener('mouseenter', () => clearTimeout(timer));
  panel.addEventListener('mouseleave', () => {
    timer = setTimeout(closePages, 150);
  });
  document.body.append(panel);
  const rect = target.getBoundingClientRect();
  panel.style.top = `${rect.bottom + 6}px`;
  panel.style.left = `${Math.max(8, Math.min(rect.left - 8, window.innerWidth - panel.offsetWidth - 8))}px`;
  if (rect.bottom + 6 + panel.offsetHeight > window.innerHeight) panel.style.top = `${Math.max(8, rect.top - panel.offsetHeight - 6)}px`;
}

/** Opens the popup from the arrow on hover and on focus, and closes it on leave, blur and Escape. */
export function bindPages(view, find) {
  const arrow = (event) => event.target.closest?.('[data-pages]');
  const show = (event) => {
    const target = arrow(event);
    if (!target || target === anchor) {
      if (target) clearTimeout(timer);
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => open(target, find(target.dataset.pages)), 120);
  };
  const hide = (event) => {
    if (!arrow(event)) return;
    clearTimeout(timer);
    timer = setTimeout(closePages, 150);
  };
  view.addEventListener('mouseover', show);
  view.addEventListener('focusin', show);
  view.addEventListener('mouseout', hide);
  view.addEventListener('focusout', hide);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePages();
  });
  window.addEventListener('scroll', closePages, true);
  void state;
}
