/* global document, window, localStorage, matchMedia, structuredClone */
/**
 * Layout customization in the static preview: a person chooses the cards and headline numbers they see.
 * Spec: docs/superpowers/specs/2026-09-30-layout-customization-design.md.
 *
 * The rules (catalog, sanitizing, resolution, edits, change count) are the tested TypeScript of
 * src/lib/layouts, transpiled to ./vendor/layouts by core-modules.mjs. This file is only the interface:
 * it renders a layout by moving card nodes from a card bank into a grid, and edits a draft in customize mode.
 * In the app this is features/layouts (LayoutProvider, LayoutGrid, CardFrame, CardCatalogDialog) with dnd-kit
 * and the API of spec section 9; here layouts persist in browser storage.
 */
import {
  CARD_TYPES,
  ENGINES,
  LIMITS,
  NUMBER_TYPES,
  SCREENS,
  addCard,
  addNumber,
  canAddCard,
  canAddNumber,
  cardAvailability,
  cardType,
  changeCount,
  defaultLayout,
  hideCard,
  moveCard,
  moveNumber,
  numberType,
  removeNumber,
  resolveLayout,
  sameLayout,
  setCardOption,
  setCardWidth,
  takenIdentityValues,
  trailingSpace,
} from './vendor/layouts/index.js';

const ui = window.PreviewUI;
const charts = window.PreviewCharts;
const { $, $$, icon, toast, openPopup, closePopup, openModal, closeModal, trapFocus, askDiscard, setSelectValue } = ui;

// -------------------------------------------------------------------------------------------------
// Context of the preview: the project has both channels, and the person is an owner

const CAPABILITIES = { channels: ['seo', 'ai'], permissions: ['layouts:manage'], integrations: [] };
const WORKSPACE = 'Digibranders';
const TODAY = Date.UTC(2026, 8, 30);
const NEW_FOR_DAYS = 30;

// -------------------------------------------------------------------------------------------------
// Storage: browser storage stands in for the layouts API. Reads and writes never throw; when storage is
// unavailable the layout lasts for this page only.

const memory = new Map();
const unsynced = new Set(); // keys whose last write did not reach storage: the in-memory copy is the truth
const storageKey = (kind, screen) => `preview-layout:${kind}:${screen}`;

function readStored(kind, screen) {
  const key = storageKey(kind, screen);
  if (unsynced.has(key)) return memory.get(key) ?? null;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    // Unreadable or not JSON: treated as absent, so the next source is used
    return memory.get(key) ?? null;
  }
}

function writeStored(kind, screen, document) {
  const key = storageKey(kind, screen);
  if (document === null) memory.delete(key);
  else memory.set(key, document);
  try {
    if (document === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(document));
    unsynced.delete(key);
  } catch {
    // Storage is blocked or full (private window, site data off): the layout lasts for this page only.
    unsynced.add(key);
  }
}

// -------------------------------------------------------------------------------------------------
// Small helpers

// Ids are plain tokens (letters and digits), the form sanitizing keeps, so they are safe inside selectors
let idCounter = 0;
const newId = () => {
  idCounter += 1;
  return `c${Date.now().toString(36)}${idCounter}`;
};

/** True when focus is on nothing a person can see: the page itself, or a control in a menu that has closed. */
const focusIsGone = (node) => !node || node === document.body || node.offsetParent === null || node.closest('[inert], [role="menu"]') !== null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const announce = (text) => {
  $('#layout-live').textContent = text;
};

const LOGO_BY_ENGINE = { chatgpt_web: 'chatgpt', gemini_web: 'gemini', google_ai_mode: 'google', google_ai_overview: 'google' };
const engineLabel = (code) => ENGINES.find((engine) => engine.code === code)?.label ?? code;

/** EngineLogo (07 section 5): decorative, because the engine name is always beside it. */
function engineLogo(code) {
  const img = el('img', `size-icon shrink-0${LOGO_BY_ENGINE[code] === 'chatgpt' ? ' dark:invert' : ''}`);
  img.src = `./vendor/logos/${LOGO_BY_ENGINE[code]}.svg`;
  img.alt = '';
  img.width = 16;
  img.height = 16;
  return img;
}

const breakpoint = () => (matchMedia('(width >= 80rem)').matches ? 'wide' : matchMedia('(width >= 48rem)').matches ? 'medium' : 'narrow');

/** What a card is called when it is announced or listed: its title, plus the engine for per-engine cards. */
function cardName(item) {
  const type = cardType(item.type);
  return item.options?.engine ? `${type.title}: ${engineLabel(item.options.engine)}` : type.title;
}

// -------------------------------------------------------------------------------------------------
// Fixtures for headline numbers and for cards whose body depends on their options

const NUMBER_DATA = {
  'seo.keywords_tracked': { value: '1,000', context: '986 checked', href: '#/rankings' },
  'seo.visibility_volume': { value: '31.4%', delta: '+1.2 pts', tone: 'pos', context: 'volume-weighted', href: '#/rankings' },
  'seo.visibility_equal': { value: '28.9%', delta: '+0.7 pts', tone: 'neutral', context: 'equal-weight, 986 keywords', href: '#/rankings' },
  'seo.top3_count': { value: '88', delta: '+6', tone: 'pos', context: 'of 986 checked', href: '#/rankings' },
  'seo.top10_count': { value: '301', delta: '+14', tone: 'pos', context: 'of 986 checked', href: '#/rankings' },
  'seo.top20_count': { value: '488', delta: '+9', tone: 'neutral', context: 'of 986 checked', href: '#/rankings' },
  'seo.average_rank': { value: '9.1', delta: '↑0.4', tone: 'neutral', context: '612 ranked', href: '#/rankings' },
  'seo.est_clicks': { value: '18.4K', delta: '+3.1%', tone: 'neutral', context: 'estimate, per month', href: '#/rankings' },
  'seo.aio_citation_rate': { value: '38.2%', delta: '+0.4 pts', tone: 'neutral', context: '157 of 411 checks', href: '#/rankings' },
  'seo.share_of_voice': { value: '18.2%', delta: '+0.6 pts', tone: 'neutral', context: 'among 5 tracked entities', href: '#/competitors' },
  'ai.mention_rate|chatgpt_web': { value: '34%', delta: '+2.1 pts', tone: 'neutral', context: '612 of 1,800 responses', href: '#/prompts' },
  'ai.mention_rate|gemini_web': { value: '29%', delta: '−0.8 pts', tone: 'neutral', context: '376 of 1,296 responses', href: '#/prompts' },
  'ai.mention_rate|google_ai_mode': { value: '41%', delta: '−6.0 pts', tone: 'neg', context: '398 of 980 observations', href: '#/prompts' },
  'ai.mention_rate|google_ai_overview': { value: '16%', delta: '+0.3 pts', tone: 'neutral', context: '66 of 411 observations', href: '#/prompts' },
  'ai.citation_rate|chatgpt_web': { value: '21%', delta: '+3.4 pts', tone: 'pos', context: '378 of 1,800 responses', href: '#/prompts' },
  'ai.citation_rate|gemini_web': { value: '14%', delta: '+0.2 pts', tone: 'neutral', context: '181 of 1,296 responses', href: '#/prompts' },
  'ai.citation_rate|google_ai_mode': { value: '33%', delta: '−1.1 pts', tone: 'neutral', context: '323 of 980 observations', href: '#/prompts' },
  'ai.citation_rate|google_ai_overview': { value: '38%', delta: '+0.4 pts', tone: 'neutral', context: '157 of 411 observations', href: '#/prompts' },
  'ai.recommendation_rate|chatgpt_web': { value: '18%', delta: '+0.9 pts', tone: 'neutral', context: '324 of 1,800 responses', href: '#/prompts' },
  'ai.recommendation_rate|gemini_web': { value: '15%', delta: '−0.4 pts', tone: 'neutral', context: '194 of 1,296 responses', href: '#/prompts' },
  'ai.recommendation_rate|google_ai_mode': { value: 'n/a', context: 'not classified for this engine', href: '#/prompts' },
  'ai.recommendation_rate|google_ai_overview': { value: 'n/a', context: 'not classified for this engine', href: '#/prompts' },
  'ai.share_of_voice|chatgpt_web': { value: '27%', delta: '+1.0 pts', tone: 'neutral', context: '1,204 responses with a tracked entity', href: '#/prompts' },
  'ai.share_of_voice|gemini_web': { value: '24%', delta: '−0.5 pts', tone: 'neutral', context: '842 responses with a tracked entity', href: '#/prompts' },
  'ai.share_of_voice|google_ai_mode': { value: '31%', delta: '−2.2 pts', tone: 'neutral', context: '711 observations with a tracked entity', href: '#/prompts' },
  'ai.share_of_voice|google_ai_overview': { value: '22%', delta: '+0.1 pts', tone: 'neutral', context: '268 observations with a tracked entity', href: '#/prompts' },
};
const numberKey = (number) => (number.engine ? `${number.metric}|${number.engine}` : number.metric);
const numberLabel = (number) => {
  const label = numberType(number.metric).label;
  return number.engine ? `${label} ${engineLabel(number.engine)}` : label;
};
const TONE_CLASS = { pos: 'text-positive-text', neg: 'text-negative-text', neutral: 'text-foreground-secondary' };

const MOVERS = [
  { keyword: 'best crm for startups', rank: 3, change: 6 },
  { keyword: 'crm for small business', rank: 4, change: 5 },
  { keyword: 'crm tools for startups', rank: 5, change: -4 },
  { keyword: 'sales pipeline template', rank: 9, change: 4 },
  { keyword: 'startup crm', rank: null, change: -9 },
  { keyword: 'crm with email tracking', rank: 7, change: 3 },
  { keyword: 'free crm for freelancers', rank: 14, change: -3 },
  { keyword: 'lead management software', rank: 11, change: 3 },
  { keyword: 'crm pricing comparison', rank: 18, change: -2 },
  { keyword: 'simple crm', rank: 6, change: 2 },
];

const SHARE_OF_VOICE = {
  seo: { note: 'Search, 986 keywords', rows: [['Northwind (you)', 18.2], ['HubSpot', 24.0], ['Pipedrive', 9.6], ['Zoho', 6.1], ['Attio', 4.4]] },
  chatgpt_web: { note: '1,204 responses', rows: [['Northwind (you)', 27], ['HubSpot', 33], ['Pipedrive', 12], ['Zoho', 8], ['Attio', 6]] },
  gemini_web: { note: '842 responses', rows: [['Northwind (you)', 24], ['HubSpot', 36], ['Pipedrive', 11], ['Zoho', 9], ['Attio', 5]] },
  google_ai_mode: { note: '711 observations', rows: [['Northwind (you)', 31], ['HubSpot', 29], ['Pipedrive', 14], ['Zoho', 7], ['Attio', 6]] },
};

const TREND = {
  chatgpt_web: { value: '34.0%', counts: '612 of 1,800' },
  gemini_web: { value: '29.0%', counts: '376 of 1,296' },
  google_ai_mode: { value: '41.0%', counts: '398 of 980' },
  google_ai_overview: { value: '16.1%', counts: '66 of 411' },
};

/** Shows the first `count` list rows and hides a group heading when none of its rows is shown. */
function showRows(list, count) {
  let shown = 0;
  const rows = [...list.children];
  rows.forEach((row) => {
    if (row.querySelector('a')) {
      row.hidden = shown >= count;
      shown += 1;
    }
  });
  rows.forEach((row, index) => {
    if (row.querySelector('a')) return;
    let next = rows[index + 1];
    let any = false;
    while (next && next.querySelector('a')) {
      any ||= !next.hidden;
      next = next.nextElementSibling;
    }
    row.hidden = !any;
  });
}

/** Card bodies that depend on the card's options. Every other card is static markup in the card bank. */
const CARD_BODIES = {
  'activity.key_changes': (item, node) => showRows($('[data-card-rows]', node), Number(item.options.rows)),
  'cross.opportunities': (item, node) => showRows($('[data-card-rows]', node), Number(item.options.rows)),
  'seo.top_movers': (item, node) => {
    const { direction, rows } = item.options;
    const list = MOVERS.filter((m) => direction === 'all' || (direction === 'improved' ? m.change > 0 : m.change < 0)).slice(0, Number(rows));
    $('[data-card-meta]', node).textContent = direction === 'all' ? 'last 28 days' : `${direction} in the last 28 days`;
    $('[data-card-body]', node).replaceChildren(
      ...list.map((m) => {
        const tr = el('tr', 'h-row border-t border-border-subtle');
        const name = el('th', 'px-4 text-left type-table font-normal text-foreground', m.keyword);
        name.scope = 'row';
        const rank = el('td', 'px-3 text-right type-table num', m.rank === null ? '>20' : String(m.rank));
        const up = m.change > 0;
        const change = el('td', `px-3 pr-4 text-right type-table num ${up ? 'text-positive-text' : 'text-negative-text'}`, `${up ? '↑' : '↓'}${Math.abs(m.change)}`);
        tr.append(name, rank, change);
        return tr;
      }),
    );
  },
  'competitors.share_of_voice': (item, node) => {
    const data = SHARE_OF_VOICE[item.options.channel];
    const meta = $('[data-card-meta]', node);
    meta.replaceChildren(...(item.options.channel === 'seo' ? [] : [engineLogo(item.options.channel)]), data.note);
    const max = Math.max(...data.rows.map(([, share]) => share));
    $('[data-card-body]', node).replaceChildren(
      ...data.rows.map(([name, share], index) => {
        const tr = el('tr', 'h-10');
        const label = el('th', `w-32 pl-4 pr-2 text-left truncate ${index === 0 ? 'type-subsection-title' : 'type-body font-normal text-foreground-secondary'}`, name);
        label.scope = 'row';
        const barCell = el('td', 'pr-2');
        const bar = el('div', `h-6 rounded-2xs ${index === 0 ? 'bg-chart-1' : 'bg-chart-bar-neutral'}`);
        bar.setAttribute('aria-hidden', 'true');
        bar.style.width = `${Math.round((share / max) * 100)}%`;
        barCell.append(bar);
        const value = el('td', 'w-16 pr-4 text-right type-meta num', `${share % 1 === 0 ? share : share.toFixed(1)}%`);
        tr.append(label, barCell, value);
        return tr;
      }),
    );
  },
  'ai.mention_trend': (item, node) => {
    const { engine } = item.options;
    if (node.dataset.engine === engine) return;
    node.dataset.engine = engine;
    const logo = $('[data-trend-logo]', node);
    logo.src = `./vendor/logos/${LOGO_BY_ENGINE[engine]}.svg`;
    logo.classList.toggle('dark:invert', LOGO_BY_ENGINE[engine] === 'chatgpt');
    $('[data-trend-title]', node).textContent = `Mention rate: ${engineLabel(engine)}`;
    $('[data-trend-value]', node).textContent = TREND[engine].value;
    $('[data-trend-counts]', node).textContent = TREND[engine].counts;
    const chartEl = $('[data-trend-chart]', node);
    chartEl.setAttribute('aria-label', `Mention rate on ${engineLabel(engine)} over 28 days, latest ${TREND[engine].value}`);
    node.unmountChart?.();
    node.unmountChart = charts.mountTrend(chartEl, engine);
  },
};

const CARD_ICON = {
  'trend.visibility_mentions': 'chart-line',
  'ai.mention_trend': 'chart-line',
  'inspector.rank_history': 'chart-line',
  'seo.rank_distribution': 'chart-bar',
  'competitors.share_of_voice': 'chart-bar',
  'ai.citation_share_by_domain_type': 'chart-column',
  'inspector.ai_by_engine': 'chart-bar',
  'cross.matrix_summary': 'grid-2x2',
  'inspector.key_numbers': 'layout-grid',
  'activity.key_changes': 'activity',
  'activity.collection_status': 'activity',
  'cross.opportunities': 'list',
  'cross.unclassified': 'list',
  'inspector.url_history': 'route',
};
const cardIcon = (key) => CARD_ICON[key] ?? 'table-2';

// -------------------------------------------------------------------------------------------------
// Shared dialogs: confirmation and the card catalog

function wireModal(dialog, onRequestClose) {
  $('[data-scrim]', dialog)?.addEventListener('click', onRequestClose);
  $$('[data-dialog-cancel], [data-confirm-cancel]', dialog).forEach((button) => button.addEventListener('click', onRequestClose));
  dialog.addEventListener('keydown', (event) => {
    trapFocus(dialog, event);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onRequestClose();
    }
  });
}

const confirmDialog = $('#dlg-confirm');
let confirmRequest = null;
function settleConfirm(result) {
  const request = confirmRequest;
  confirmRequest = null;
  closeModal(confirmDialog, () => request?.opener?.focus());
  request?.resolve(result);
}
wireModal(confirmDialog, () => settleConfirm(false));
$('[data-confirm-ok]', confirmDialog).addEventListener('click', () => settleConfirm(true));

/** Asks before an action that affects other people. Resolves to true when confirmed, false when dismissed. */
function confirmAction({ title, body, confirmLabel, customizer, opener }) {
  return new Promise((resolve) => {
    // `opener` is where focus returns. The menu item that asked has closed with its menu, so callers name it.
    confirmRequest = { resolve, customizer, opener: opener ?? document.activeElement };
    $('#dlg-confirm-title').textContent = title;
    $('#dlg-confirm-desc').textContent = body;
    $('[data-confirm-ok]', confirmDialog).textContent = confirmLabel;
    openModal(confirmDialog);
    $('[data-confirm-ok]', confirmDialog).focus();
  });
}
// Other pages of the preview confirm large bulk actions with the same dialog (prompts.js)
ui.confirmAction = confirmAction;

const catalogDialog = $('#dlg-catalog');
const catalogList = $('[data-catalog-list]', catalogDialog);
const catalogSearch = $('[data-catalog-search]', catalogDialog);
let catalogRequest = null;
function closeCatalog(restoreFocus = true) {
  const request = catalogRequest;
  catalogRequest = null;
  closeModal(catalogDialog, () => restoreFocus && request?.opener?.focus());
}
wireModal(catalogDialog, () => closeCatalog());
catalogSearch.addEventListener('input', () => renderCatalog());

const GROUPS = [
  ['seo', 'SEO'],
  ['ai', 'AI'],
  ['cross', 'Cross-channel'],
  ['activity', 'Activity'],
];
const isNew = (type) => (TODAY - Date.parse(`${type.addedOn}T00:00:00Z`)) / 86400000 < NEW_FOR_DAYS;

function catalogEntry(type, customizer) {
  const availability = cardAvailability(type, CAPABILITIES);
  const draft = customizer.state.draft;
  const placed = (draft.cards ?? []).filter((card) => card.type === type.key).length;
  const row = el('div', 'py-2 flex items-start gap-3 border-t border-border-subtle');
  const tile = el('span', 'size-10 shrink-0 rounded-md bg-neutral-subtle text-foreground-secondary flex items-center justify-center');
  tile.setAttribute('aria-hidden', 'true');
  tile.append(icon(cardIcon(type.key), 'size-icon-md'));
  const text = el('div', 'min-w-0 flex-1');
  const title = el('p', 'flex flex-wrap items-center gap-x-2 type-body-strong text-foreground', type.title);
  if (isNew(type)) title.append(el('span', 'h-badge inline-flex items-center px-2 rounded-sm bg-primary-subtle text-primary-text type-micro', 'New'));
  text.append(title, el('p', 'type-meta', type.description));
  if (availability.state === 'unavailable') text.append(el('p', 'type-meta text-warning-text', availability.reason));

  const button = el('button', 'h-control-sm shrink-0 px-3 rounded-md border border-border bg-surface type-body-strong text-foreground whitespace-nowrap hover:bg-surface-hover disabled:border-transparent disabled:bg-surface-disabled disabled:text-foreground-disabled disabled:cursor-not-allowed');
  button.type = 'button';
  if (availability.state === 'unavailable') {
    button.textContent = 'Unavailable';
    button.disabled = true;
  } else if (placed >= type.maxInstances) {
    button.textContent = 'Added';
    button.disabled = true;
  } else if (!canAddCard(draft, type.key, customizer.screen)) {
    // The only remaining reason is the limit of cards per page
    button.textContent = 'Page is full';
    button.disabled = true;
  } else {
    button.textContent = placed > 0 ? 'Add another' : 'Add';
    button.setAttribute('aria-label', `${button.textContent} ${type.title}`);
    button.addEventListener('click', () => {
      const request = catalogRequest;
      closeCatalog(false);
      request.customizer.add(type.key, request.index);
    });
  }
  row.append(tile, text, button);
  return row;
}

function renderCatalog() {
  const { customizer } = catalogRequest;
  const query = catalogSearch.value.trim().toLowerCase();
  const sections = [];
  for (const [group, label] of GROUPS) {
    const types = CARD_TYPES.filter(
      (type) =>
        type.group === group &&
        type.status === 'active' &&
        type.screens.includes(customizer.screen) &&
        cardAvailability(type, CAPABILITIES).state !== 'hidden' &&
        (query === '' || `${type.title} ${type.description}`.toLowerCase().includes(query)),
    );
    if (types.length === 0) continue;
    const section = el('section', 'flex flex-col');
    section.append(el('h3', 'pb-1 type-label', label), ...types.map((type) => catalogEntry(type, customizer)));
    sections.push(section);
  }
  if (sections.length === 0) sections.push(el('p', 'py-6 text-center type-meta', `No cards match “${catalogSearch.value.trim()}”`));
  catalogList.replaceChildren(...sections);
}

/** Closes the catalog and the confirmation when the customizer they belong to leaves customize mode. */
function dismissDialogsOf(customizer) {
  if (catalogRequest?.customizer === customizer) closeCatalog(false);
  if (confirmRequest?.customizer === customizer) settleConfirm(false);
}

function openCatalog(customizer, index) {
  catalogRequest = { customizer, index, opener: document.activeElement };
  catalogSearch.value = '';
  renderCatalog();
  openModal(catalogDialog);
  catalogSearch.focus();
}

// -------------------------------------------------------------------------------------------------
// One customizer per screen

const WIDTH_CLASSES = {
  third: ['md:col-span-6', 'xl:col-span-4'],
  half: ['md:col-span-6'],
  two_thirds: ['md:col-span-12', 'xl:col-span-8'],
  full: ['md:col-span-12'],
};
const ALL_WIDTH_CLASSES = [...new Set(Object.values(WIDTH_CLASSES).flat())];
const FRAME_EDIT = ['p-1', 'gap-1', 'rounded-lg', 'outline-1', 'outline-dashed', 'outline-border-strong', 'bg-surface-subtle'];
const FRAME_GRABBED = ['ring-2', 'ring-primary'];
const TOOL = 'size-control-sm shrink-0 rounded-md flex items-center justify-center text-foreground-secondary hover:bg-surface-hover hover:text-foreground';
const NUMBER_COLUMNS = ['', '@5xl:grid-cols-1', '@5xl:grid-cols-2', '@5xl:grid-cols-3', '@5xl:grid-cols-4', '@5xl:grid-cols-5', '@5xl:grid-cols-6'];
const NUMBER_COLUMNS_MID = ['', '@xl:grid-cols-1', '@xl:grid-cols-2', '@xl:grid-cols-3'];

const DISCARD_MESSAGE = 'Your layout changes will be lost.';

const customizers = new Map();
let active = null;
let menuTarget = null; // { customizer, zone, id }: what the shared Move menu, Options popover and number catalog act on
// Where focus goes when customize mode is left: the control that started it
const ENTRY_FOCUS = { overview: '[data-customize="overview"]', 'inspector.keyword': '#inspector [data-popup="menu-row"]' };

function createCustomizer(screen) {
  const definition = SCREENS[screen];
  const cardsZone = $(`[data-zone="cards"][data-screen="${screen}"]`);
  const numbersZone = $(`[data-zone="numbers"][data-screen="${screen}"]`);
  const bank = $(`[data-card-bank="${screen}"]`);
  const saveBar = $(`[data-layout-save-bar="${screen}"]`);
  const orientation = definition.zones.widths ? 'grid' : 'column';
  const frames = new Map(); // card id -> frame element
  const state = { mode: 'view', saved: null, baseline: null, draft: null, grabbed: null, keyboardMove: false };

  const team = () => readStored('team', screen);
  const resetTarget = () => defaultLayout(team(), screen).document;
  const documentNow = () => (state.mode === 'customize' ? state.draft : state.saved.document);
  const customizing = () => state.mode === 'customize';

  // --- card nodes -------------------------------------------------------------------------------

  /** The card's own markup: a single node for most types, a clone of the template for reusable types. */
  function cardNode(item, frame) {
    const existing = frame.querySelector(':scope > [data-card]');
    if (existing) return existing;
    const template = $(`template[data-card-template="${item.type}"]`, bank);
    if (template) {
      const node = template.content.firstElementChild.cloneNode(true);
      $('[data-trend-chart]', node).id = `chart-trend-${item.id}`;
      return node;
    }
    return $(`[data-card="${item.type}"]`);
  }

  /** The drag handle shared by cards and numbers. Its name is set by the caller; how to use it is described once. */
  function dragHandle(iconSize) {
    const handle = el('button', `${TOOL} cursor-grab touch-none`);
    handle.type = 'button';
    handle.dataset.dragHandle = '';
    handle.dataset.tip = 'Drag to reorder';
    handle.setAttribute('aria-describedby', 'layout-drag-help');
    handle.setAttribute('aria-pressed', 'false');
    handle.append(icon('grip-vertical', iconSize));
    return handle;
  }

  /** Names a card's controls. Run again when an option changes the card's name (a trend card's engine). */
  function labelToolbar(bar, item) {
    const name = cardName(item);
    bar.setAttribute('aria-label', `${name} card`);
    $('[data-drag-handle]', bar).setAttribute('aria-label', `Reorder ${name}`);
    $('[data-card-width]', bar)?.setAttribute('aria-label', `Width of ${name}`);
    $('[data-card-options]', bar)?.setAttribute('aria-label', `Options for ${name}`);
    $('[data-card-hide]', bar).setAttribute('aria-label', `Hide ${name}`);
    $('[data-card-more]', bar).setAttribute('aria-label', `Move ${name}`);
  }

  function toolbar(item) {
    const type = cardType(item.type);
    const bar = el('div', 'h-9 px-1 flex items-center gap-1');
    bar.dataset.cardToolbar = '';
    bar.setAttribute('role', 'group');

    const handle = dragHandle('size-icon');

    const tools = el('span', 'ml-auto flex items-center gap-1');
    if (definition.zones.widths && type.widths.length > 1) {
      const width = el('button', 'h-control-sm px-2 rounded-md border border-border bg-surface flex items-center gap-1.5 whitespace-nowrap type-body text-foreground hover:bg-surface-hover');
      width.type = 'button';
      width.setAttribute('role', 'combobox');
      width.setAttribute('aria-haspopup', 'listbox');
      width.setAttribute('aria-expanded', 'false');
      width.setAttribute('aria-controls', 'lb-card-width');
      width.dataset.select = 'lb-card-width';
      width.dataset.cardWidth = '';
      const value = el('span');
      value.dataset.selectValue = '';
      width.append(value, icon('chevron-down', 'size-icon-sm text-foreground-tertiary'));
      tools.append(width);
    }
    if (Object.keys(type.options).length > 0) {
      const options = el('button', TOOL);
      options.type = 'button';
      options.dataset.cardOptions = '';
      options.dataset.tip = 'Card options';
      options.setAttribute('aria-haspopup', 'dialog');
      options.append(icon('settings-2', 'size-icon'));
      tools.append(options);
    }
    const hide = el('button', TOOL);
    hide.type = 'button';
    hide.dataset.cardHide = '';
    hide.dataset.tip = 'Hide card. Add it back from the catalog';
    hide.append(icon('eye-off', 'size-icon'));
    const more = el('button', TOOL);
    more.type = 'button';
    more.dataset.cardMore = '';
    more.dataset.tip = 'Move';
    more.setAttribute('aria-haspopup', 'menu');
    more.append(icon('ellipsis-vertical', 'size-icon'));
    tools.append(hide, more);
    bar.append(handle, tools);
    return bar;
  }

  /** Builds or updates the frame of one card: its place in the grid and, in customize mode, its toolbar. */
  function frameFor(item) {
    let frame = frames.get(item.id);
    if (!frame) {
      frame = el('div', 'min-w-0 flex flex-col');
      frame.dataset.cardId = item.id;
      frames.set(item.id, frame);
    }
    const node = cardNode(item, frame);
    if (node.parentElement !== frame) frame.append(node);
    node.classList.add('flex-1');
    CARD_BODIES[item.type]?.(item, node);

    frame.classList.remove(...ALL_WIDTH_CLASSES);
    if (item.width) frame.classList.add(...WIDTH_CLASSES[item.width]);

    let bar = frame.querySelector(':scope > [data-card-toolbar]');
    if (customizing()) {
      if (!bar) {
        bar = toolbar(item);
        frame.prepend(bar);
      }
      labelToolbar(bar, item);
      const width = $('[data-card-width]', bar);
      if (width) {
        width.dataset.value = item.width;
        setSelectValue(width, item.width);
      }
      frame.classList.add(...FRAME_EDIT);
      node.inert = true;
    } else {
      bar?.remove();
      frame.classList.remove(...FRAME_EDIT, ...FRAME_GRABBED);
      node.inert = false;
    }
    return frame;
  }

  /** Puts a card's node back in the bank (or disposes a reusable card's instance) and forgets its frame. */
  function release(id) {
    const frame = frames.get(id);
    const node = frame?.querySelector(':scope > [data-card]');
    if (node) {
      node.inert = false;
      node.classList.remove('flex-1');
      if (node.unmountChart) {
        node.unmountChart();
        node.remove();
      } else bank.append(node);
    }
    frame?.remove();
    frames.delete(id);
  }

  function addSlot() {
    const slot = el('button', 'min-h-30 rounded-lg border border-dashed border-border-strong flex flex-col items-center justify-center gap-1 type-body-strong text-primary-text hover:bg-surface-hover');
    slot.type = 'button';
    slot.dataset.addSlot = '';
    const label = el('span', 'flex items-center gap-1.5');
    label.append(icon('plus', 'size-icon'), 'Add card');
    slot.append(label, el('span', 'type-meta', 'Opens the card catalog'));
    if (orientation === 'grid') slot.classList.add(...(trailingSpace(state.draft.cards ?? [], 'wide') === 4 ? WIDTH_CLASSES.third : WIDTH_CLASSES.half));
    else slot.classList.replace('min-h-30', 'min-h-16');
    slot.addEventListener('click', () => openCatalog(api));
    return slot;
  }

  function renderCards() {
    if (!cardsZone) return;
    // Normal view shows what is available. Customize mode also shows unavailable cards, so they can be moved or
    // hidden. A card the person has no permission for is never shown (spec section 8).
    const items = (documentNow().cards ?? []).filter((item) => {
      const { state: availability } = cardAvailability(cardType(item.type), CAPABILITIES);
      return customizing() ? availability !== 'hidden' : availability === 'available';
    });
    const wanted = new Set(items.map((item) => item.id));
    [...frames.keys()].filter((id) => !wanted.has(id)).forEach(release);
    const children = items.map(frameFor);
    $$(':scope > [data-add-slot], :scope > [data-empty]', cardsZone).forEach((node) => node.remove());
    // Only re-append when the order changed, so focus and chart canvases are left alone otherwise
    const current = [...cardsZone.children].filter((child) => child.dataset.cardId);
    if (current.length !== children.length || current.some((child, index) => child !== children[index])) cardsZone.append(...children);
    if (customizing()) {
      if (items.length === 0) {
        const empty = el('p', 'type-meta', 'This page has no cards. Add one from the catalog.');
        empty.dataset.empty = '';
        if (orientation === 'grid') empty.classList.add('md:col-span-12');
        cardsZone.append(empty);
      }
      if (items.length < LIMITS.cards) cardsZone.append(addSlot());
    }
    charts.refresh();
    ui.refreshInspectorChart();
  }

  // --- headline numbers ---------------------------------------------------------------------------

  function numberCell(number, previous) {
    const data = NUMBER_DATA[numberKey(number)];
    const type = numberType(number.metric);
    const cell = el('div', 'group relative min-w-0 px-4 @5xl:px-5 py-3 border-r border-b border-border-subtle');
    cell.dataset.numberId = number.id;
    // The channel group divider: a stronger line wherever SEO and AI numbers meet (23 section 2)
    if (previous && numberType(previous.metric).channel !== type.channel) cell.classList.add('@5xl:-ml-px', '@5xl:border-l', '@5xl:border-l-border');

    const dt = el('dt', 'flex items-center gap-1.5 min-w-0 type-meta');
    if (number.engine) dt.append(engineLogo(number.engine));
    // In customize mode the number is not a link: its cell is being arranged, not read
    if (customizing() || !data.href) dt.append(el('span', 'truncate', numberLabel(number)));
    else {
      const link = el('a', 'truncate outline-none after:absolute after:inset-0', numberLabel(number));
      link.href = data.href;
      dt.append(link);
      cell.classList.add('hover:bg-surface-hover', 'has-focus-visible:focus-ring-inset');
    }
    const dd = el('dd', 'flex flex-wrap items-baseline gap-x-2 min-w-0');
    dd.append(el('span', `type-metric num shrink-0${data.value === 'n/a' ? ' text-foreground-tertiary' : ''}`, data.value));
    if (data.delta) dd.append(el('span', `type-body-strong num shrink-0 whitespace-nowrap ${TONE_CLASS[data.tone]}`, data.delta));
    dd.append(el('span', 'type-meta truncate min-w-0 basis-full', data.context));
    const pair = el('dl');
    pair.append(dt, dd);

    if (customizing()) {
      // The same controls as a card, in the same order: reorder, then Remove and the Move menu on the right
      const name = numberLabel(number);
      const bar = el('div', '-mx-2 -mt-1 mb-1 flex items-center');
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', `${name} number`);
      const handle = dragHandle('size-icon');
      handle.setAttribute('aria-label', `Reorder ${name}`);
      const remove = el('button', `${TOOL} ml-auto`);
      remove.type = 'button';
      remove.dataset.numberRemove = '';
      remove.dataset.tip = 'Remove';
      remove.setAttribute('aria-label', `Remove ${name}`);
      remove.append(icon('x', 'size-icon'));
      const more = el('button', TOOL);
      more.type = 'button';
      more.dataset.numberMore = '';
      more.dataset.tip = 'Move';
      more.setAttribute('aria-label', `Move ${name}`);
      more.setAttribute('aria-haspopup', 'menu');
      more.append(icon('ellipsis-vertical', 'size-icon'));
      bar.append(handle, remove, more);
      cell.append(bar);
    }
    cell.append(pair);
    return cell;
  }

  function renderNumbers() {
    if (!numbersZone) return;
    const numbers = documentNow().numbers ?? [];
    const cells = numbers.map((number, index) => numberCell(number, numbers[index - 1]));
    if (customizing() && numbers.length < LIMITS.numbers) {
      const slot = el('button', 'min-h-19 px-4 py-3 border-r border-b border-border-subtle flex items-center justify-center gap-1.5 whitespace-nowrap type-body-strong text-primary-text hover:bg-surface-hover');
      slot.type = 'button';
      slot.dataset.addNumber = '';
      slot.setAttribute('aria-haspopup', 'dialog');
      slot.append(icon('plus', 'size-icon'), 'Add number');
      cells.push(slot);
    }
    const count = cells.length;
    numbersZone.classList.remove(...NUMBER_COLUMNS.filter(Boolean), ...NUMBER_COLUMNS_MID.filter(Boolean), 'grid-cols-1', 'grid-cols-2');
    numbersZone.classList.add(count === 1 ? 'grid-cols-1' : 'grid-cols-2', NUMBER_COLUMNS_MID[Math.min(count, 3)] || '@xl:grid-cols-3', NUMBER_COLUMNS[count] || '@5xl:grid-cols-6');
    numbersZone.replaceChildren(...cells);
    // With no numbers the strip is not shown (spec section 5.3); in customize mode the "Add number" slot keeps it
    numbersZone.closest('section').hidden = count === 0;
  }

  // --- save bar ------------------------------------------------------------------------------------

  function renderSaveBar() {
    if (!saveBar) return;
    saveBar.hidden = !customizing();
    if (!customizing()) return;
    const changes = changeCount(state.baseline, state.draft);
    $('[data-layout-changes]', saveBar).textContent = changes === 0 ? 'No changes' : `${changes} change${changes === 1 ? '' : 's'}`;
    const scope = $('[data-layout-scope]', saveBar);
    if (scope) {
      const differs = state.saved.source === 'personal' && team() !== null;
      scope.textContent = differs ? 'Your layout differs from the team default. It applies to your view, in every project' : 'Applies to your view, in every project';
    }
    $('[data-layout-save]', saveBar).disabled = changes === 0;
    $('[data-layout-reset]', saveBar).disabled = sameLayout(state.draft, resetTarget());
  }

  function render() {
    renderNumbers();
    renderCards();
    renderSaveBar();
    markGrabbed();
  }

  // --- edits ---------------------------------------------------------------------------------------

  /** Applies an edit to the draft. `focus` names what should hold focus afterwards. Returns whether it changed. */
  function commit(next, { message, focus } = {}) {
    if (next === state.draft) return false;
    // Anything but a keyboard move ends a keyboard pick-up: the item is where the person just put it
    if (!state.keyboardMove) state.grabbed = null;
    state.draft = next;
    render();
    if (message) announce(message);
    if (focus) restoreFocus(focus);
    return true;
  }

  /**
   * Moves focus to a control of one item: { zone, id, part }. When the item is gone (it was the last one and
   * was removed), focus goes to the zone's "Add" slot, so it never falls back to the top of the page.
   */
  function restoreFocus({ zone, id, part = 'handle' }) {
    const options = { preventScroll: true };
    if (zone === 'cards') {
      const selector = { handle: '[data-drag-handle]', more: '[data-card-more]', options: '[data-card-options]' }[part];
      (frames.get(id)?.querySelector(selector) ?? $('[data-add-slot]', cardsZone))?.focus(options);
    } else {
      const selector = { handle: '[data-drag-handle]', more: '[data-number-more]' }[part];
      const cell = id ? $(`[data-number-id="${id}"]`, numbersZone) : null;
      (cell?.querySelector(selector) ?? $('[data-add-number]', numbersZone))?.focus(options);
    }
  }

  /** Focus for "Keep editing" and for entering the mode from a menu: the first thing that can be arranged. */
  function focusDraft() {
    if (!customizing()) return;
    if (cardsZone) restoreFocus({ zone: 'cards', id: state.draft.cards?.[0]?.id });
    else restoreFocus({ zone: 'numbers', id: state.draft.numbers?.[0]?.id });
  }

  const itemsOf = (zone) => (zone === 'cards' ? (state.draft.cards ?? []) : (state.draft.numbers ?? []));
  const nameOf = (zone, id) => {
    const item = itemsOf(zone).find((candidate) => candidate.id === id);
    return zone === 'cards' ? cardName(item) : numberLabel(item);
  };
  function moveItem(zone, id, toIndex, part = 'handle') {
    const name = nameOf(zone, id);
    const move = zone === 'cards' ? moveCard : moveNumber;
    const next = move(state.draft, id, toIndex);
    const position = itemsOf(zone).length;
    const changed = commit(next, { focus: { zone, id, part } });
    if (changed) announce(`${name}, position ${itemsOf(zone).findIndex((item) => item.id === id) + 1} of ${position}`);
    return changed;
  }

  function hide(id) {
    const cards = state.draft.cards ?? [];
    const index = cards.findIndex((card) => card.id === id);
    const name = cardName(cards[index]);
    const neighbor = cards[index + 1] ?? cards[index - 1];
    commit(hideCard(state.draft, id), { message: `${name} hidden. Add it back from the catalog`, focus: { zone: 'cards', id: neighbor?.id } });
  }

  function add(typeKey, index) {
    const id = newId();
    if (!commit(addCard(state.draft, typeKey, id, index))) return;
    const item = state.draft.cards.find((card) => card.id === id);
    announce(`${cardName(item)} added, position ${state.draft.cards.indexOf(item) + 1} of ${state.draft.cards.length}`);
    const frame = frames.get(id);
    frame.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    restoreFocus({ zone: 'cards', id });
  }

  // --- dragging: pointer and keyboard (spec section 5.2). Menus are the single-pointer alternative. -----

  let indicator = null;
  function showIndicator(zoneEl, target, after, vertical) {
    indicator ??= el('div', 'absolute z-(--z-sticky) rounded-full bg-primary pointer-events-none');
    if (indicator.parentElement !== zoneEl) zoneEl.append(indicator);
    const zoneRect = zoneEl.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    // Half the zone's own gap puts the line midway between two items; number cells have no gap
    const style = window.getComputedStyle(zoneEl);
    const half = (Number.parseFloat(vertical ? style.columnGap : style.rowGap) || 0) / 2;
    if (vertical) {
      Object.assign(indicator.style, { width: '2px', height: `${rect.height}px`, top: `${rect.top - zoneRect.top}px`, left: `${(after ? rect.right + half : rect.left - half) - zoneRect.left - 1}px` });
    } else {
      Object.assign(indicator.style, { height: '2px', width: `${rect.width}px`, left: `${rect.left - zoneRect.left}px`, top: `${(after ? rect.bottom + half : rect.top - half) - zoneRect.top - 1}px` });
    }
  }

  function wireDrag(zoneEl, zone, itemSelector, idOf, vertical) {
    let drag = null;
    const cancel = () => {
      if (!drag) return;
      drag.item.classList.remove('opacity-50');
      indicator?.remove();
      drag = null;
    };
    zoneEl.addEventListener('pointerdown', (event) => {
      const handle = event.target.closest('[data-drag-handle]');
      if (!handle || !customizing() || event.button !== 0) return;
      const item = handle.closest(itemSelector);
      drag = { handle, item, id: idOf(item), startX: event.clientX, startY: event.clientY, moving: false, drop: null };
      handle.setPointerCapture(event.pointerId);
    });
    zoneEl.addEventListener('pointermove', (event) => {
      if (!drag) return;
      if (!drag.moving && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
      if (!drag.moving) {
        drag.moving = true;
        drag.item.classList.add('opacity-50');
        closePopup({ restoreFocus: false });
      }
      // Still over the item being dragged: releasing here leaves it where it was
      const own = drag.item.getBoundingClientRect();
      if (event.clientX >= own.left && event.clientX <= own.right && event.clientY >= own.top && event.clientY <= own.bottom) {
        drag.drop = null;
        indicator?.remove();
        return;
      }
      const others = $$(`:scope > ${itemSelector}`, zoneEl).filter((candidate) => candidate !== drag.item);
      if (others.length === 0) return;
      // The nearest other item, then before or after it by which half the pointer is in
      let target = others[0];
      let best = Infinity;
      for (const candidate of others) {
        const r = candidate.getBoundingClientRect();
        const dx = Math.max(r.left - event.clientX, 0, event.clientX - r.right);
        const dy = Math.max(r.top - event.clientY, 0, event.clientY - r.bottom);
        const distance = Math.hypot(dx, dy);
        if (distance < best) {
          best = distance;
          target = candidate;
        }
      }
      const rect = target.getBoundingClientRect();
      const after = vertical ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2;
      drag.drop = others.indexOf(target) + (after ? 1 : 0);
      showIndicator(zoneEl, target, after, vertical);
    });
    const finish = (event) => {
      if (!drag) return;
      const { id, drop, moving } = drag;
      if (drag.handle.hasPointerCapture(event.pointerId)) drag.handle.releasePointerCapture(event.pointerId);
      cancel();
      if (moving && drop !== null) moveItem(zone, id, drop);
    };
    zoneEl.addEventListener('pointerup', finish);
    zoneEl.addEventListener('pointercancel', cancel);

    zoneEl.addEventListener('keydown', (event) => {
      const handle = event.target.closest?.('[data-drag-handle]');
      if (!handle || !customizing()) return;
      const id = idOf(handle.closest(itemSelector));
      const index = itemsOf(zone).findIndex((item) => item.id === id);
      const grabbed = state.grabbed?.id === id;
      // Focus is put back on the moved item's handle during a keyboard move; that must not count as leaving it
      const keyboardMove = (toIndex) => {
        state.keyboardMove = true;
        try {
          return moveItem(zone, id, toIndex);
        } finally {
          state.keyboardMove = false;
        }
      };
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (grabbed) drop();
        else {
          state.grabbed = { id, zone, from: index };
          announce(`${nameOf(zone, id)} picked up. Use the arrow keys to move, Space to drop, Escape to put it back`);
          markGrabbed();
        }
      } else if (grabbed && ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const earlier = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
        // At either end there is nowhere to go, and that is said too: every key press gets an answer
        if (!keyboardMove(index + (earlier ? -1 : 1))) announce(`${nameOf(zone, id)} is already ${earlier ? 'first' : 'last'}`);
      } else if (grabbed && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        const { from } = state.grabbed;
        const moved = keyboardMove(from);
        state.grabbed = null;
        markGrabbed();
        if (!moved) announce(`${nameOf(zone, id)} put back`);
      }
    });
    // Tabbing or clicking away drops the item where it is, and says so
    zoneEl.addEventListener('focusout', (event) => {
      if (state.keyboardMove || state.grabbed?.zone !== zone || !event.target.closest?.('[data-drag-handle]')) return;
      drop();
    });
  }

  /** Ends a keyboard pick-up where the item now is. */
  function drop() {
    if (!state.grabbed) return;
    const { id, zone } = state.grabbed;
    state.grabbed = null;
    markGrabbed();
    const index = itemsOf(zone).findIndex((item) => item.id === id);
    if (index !== -1) announce(`${nameOf(zone, id)} dropped at position ${index + 1} of ${itemsOf(zone).length}`);
  }

  function markGrabbed() {
    $$('[data-drag-handle]', cardsZone ?? document).forEach((handle) => handle.setAttribute('aria-pressed', 'false'));
    if (numbersZone) $$('[data-drag-handle]', numbersZone).forEach((handle) => handle.setAttribute('aria-pressed', 'false'));
    frames.forEach((frame) => frame.classList.remove(...FRAME_GRABBED));
    if (!state.grabbed) return;
    const { id, zone } = state.grabbed;
    if (zone === 'cards') {
      frames.get(id)?.classList.add(...FRAME_GRABBED);
      frames.get(id)?.querySelector('[data-drag-handle]')?.setAttribute('aria-pressed', 'true');
    } else $(`[data-number-id="${id}"] [data-drag-handle]`, numbersZone)?.setAttribute('aria-pressed', 'true');
  }

  /** The Move menu is the single-pointer and keyboard alternative to dragging (WCAG 2.5.7), for cards and numbers. */
  function openMoveMenu(zone, id, anchor) {
    menuTarget = { customizer: api, zone, id };
    const items = itemsOf(zone);
    const index = items.findIndex((item) => item.id === id);
    const menu = $('#menu-card');
    menu.setAttribute('aria-label', `Move ${nameOf(zone, id)}`);
    $$('[data-card-move]', menu).forEach((entry) => {
      const earlier = entry.dataset.cardMove === 'earlier' || entry.dataset.cardMove === 'start';
      const disabled = earlier ? index === 0 : index === items.length - 1;
      if (disabled) entry.setAttribute('aria-disabled', 'true');
      else entry.removeAttribute('aria-disabled');
      entry.classList.toggle('text-foreground-disabled', disabled);
    });
    openPopup(menu, anchor, { align: 'end' });
  }

  if (cardsZone) {
    wireDrag(cardsZone, 'cards', '[data-card-id]', (frame) => frame.dataset.cardId, orientation === 'grid');
    cardsZone.addEventListener('click', (event) => {
      if (!customizing()) return;
      const frame = event.target.closest('[data-card-id]');
      if (!frame) return;
      const id = frame.dataset.cardId;
      if (event.target.closest('[data-card-hide]')) hide(id);
      else if (event.target.closest('[data-card-more]')) {
        event.stopPropagation();
        openMoveMenu('cards', id, event.target.closest('[data-card-more]'));
      } else if (event.target.closest('[data-card-options]')) {
        menuTarget = { customizer: api, zone: 'cards', id };
        event.stopPropagation();
        openOptions(event.target.closest('[data-card-options]'));
      }
    });
    // Width: the shared listbox offers only the widths this card type allows
    cardsZone.addEventListener('select-open', (event) => {
      const id = event.target.closest('[data-card-id]').dataset.cardId;
      const allowed = cardType(state.draft.cards.find((card) => card.id === id).type).widths;
      $$('#lb-card-width [role="option"]').forEach((option) => (option.hidden = !allowed.includes(option.dataset.value)));
    });
    cardsZone.addEventListener('change', (event) => {
      const trigger = event.target.closest('[data-card-width]');
      if (!trigger) return;
      const id = trigger.closest('[data-card-id]').dataset.cardId;
      const name = nameOf('cards', id);
      commit(setCardWidth(state.draft, id, trigger.dataset.value), { message: `${name} width: ${$('[data-select-value]', trigger).textContent}` });
      frames.get(id)?.querySelector('[data-card-width]')?.focus({ preventScroll: true });
    });
  }

  if (numbersZone) {
    wireDrag(numbersZone, 'numbers', '[data-number-id]', (cell) => cell.dataset.numberId, true);
    numbersZone.addEventListener('click', (event) => {
      if (!customizing()) return;
      const remove = event.target.closest('[data-number-remove]');
      if (remove) {
        const numbers = state.draft.numbers;
        const id = remove.closest('[data-number-id]').dataset.numberId;
        const index = numbers.findIndex((number) => number.id === id);
        const name = numberLabel(numbers[index]);
        commit(removeNumber(state.draft, id), { message: `${name} removed`, focus: { zone: 'numbers', id: (numbers[index + 1] ?? numbers[index - 1])?.id } });
      } else if (event.target.closest('[data-number-more]')) {
        const more = event.target.closest('[data-number-more]');
        event.stopPropagation();
        openMoveMenu('numbers', more.closest('[data-number-id]').dataset.numberId, more);
      } else if (event.target.closest('[data-add-number]')) {
        menuTarget = { customizer: api, zone: 'numbers', id: null };
        event.stopPropagation();
        openNumberCatalog(event.target.closest('[data-add-number]'));
      }
    });
  }

  // --- options popover and number catalog ------------------------------------------------------------

  function radioRow(label, checked, onChoose) {
    const row = el('button', 'group w-full h-control-sm px-2 rounded-md flex items-center gap-2 type-body text-foreground text-left outline-none hover:bg-surface-hover focus-visible:bg-surface-hover');
    row.type = 'button';
    row.setAttribute('role', 'radio');
    row.setAttribute('aria-checked', String(checked));
    const mark = el('span', 'size-icon-sm shrink-0 text-primary-text invisible group-aria-checked:visible');
    mark.setAttribute('aria-hidden', 'true');
    mark.append(icon('check', 'size-icon-sm'));
    row.append(mark, el('span', 'truncate', label));
    row.addEventListener('click', onChoose);
    return row;
  }

  function renderOptions() {
    const item = state.draft.cards.find((card) => card.id === menuTarget.id);
    const type = cardType(item.type);
    const groups = Object.entries(type.options).map(([key, option]) => {
      const group = el('div', 'flex flex-col');
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', option.label);
      group.append(el('p', 'px-2 pb-1 type-label', option.label));
      // A reusable card cannot take a value another instance already uses (one trend card per engine).
      // setCardOption refuses it too; here it is shown as unavailable.
      const taken = key === Object.keys(type.options)[0] ? takenIdentityValues(state.draft, type, item.id) : new Set();
      option.values.forEach((candidate) => {
        const row = radioRow(candidate.label, item.options[key] === candidate.value, () => {
          commit(setCardOption(state.draft, item.id, key, candidate.value), { message: `${type.title}: ${option.label} ${candidate.label}` });
          renderOptions();
          // The popover was rebuilt: put focus back on the option that was chosen
          $(`[role="radiogroup"][aria-label="${option.label}"] [aria-checked="true"]`, $('#pop-card-options'))?.focus();
        });
        if (taken.has(candidate.value)) {
          row.disabled = true;
          row.classList.add('text-foreground-disabled');
        }
        group.append(row);
      });
      return group;
    });
    $('[data-card-options]', $('#pop-card-options')).replaceChildren(el('p', 'px-2 type-subsection-title', type.title), ...groups);
  }
  function openOptions(anchor) {
    renderOptions();
    openPopup($('#pop-card-options'), anchor, { align: 'end' });
  }

  function openNumberCatalog(anchor) {
    const panel = $('[data-number-catalog]', $('#pop-add-number'));
    const chip = 'h-control-sm px-2 rounded-md border border-border bg-surface flex items-center gap-1.5 type-body text-foreground whitespace-nowrap hover:bg-surface-hover disabled:border-transparent disabled:bg-surface-disabled disabled:text-foreground-disabled disabled:cursor-not-allowed';
    const choose = (metric, engine) => () => {
      const id = newId();
      closePopup({ restoreFocus: false });
      commit(addNumber(state.draft, engine ? { id, metric, engine } : { id, metric }), { message: `${numberLabel({ metric, engine })} added`, focus: { zone: 'numbers', id } });
    };
    const available = NUMBER_TYPES.filter((type) => type.screens.includes(screen));
    const seo = el('div', 'flex flex-col gap-1.5');
    const seoChips = el('div', 'flex flex-wrap gap-1.5');
    available.filter((type) => !type.perEngine).forEach((type) => {
      const button = el('button', chip, type.label);
      button.type = 'button';
      button.disabled = !canAddNumber(state.draft, type.metric);
      button.addEventListener('click', choose(type.metric));
      seoChips.append(button);
    });
    seo.append(el('p', 'type-label', 'SEO'), seoChips);
    const ai = el('div', 'flex flex-col gap-2');
    ai.append(el('p', 'type-label', 'AI, one engine each'));
    available.filter((type) => type.perEngine).forEach((type) => {
      const row = el('div', 'flex flex-col gap-1.5');
      const chips = el('div', 'flex flex-wrap gap-1.5');
      ENGINES.forEach((engine) => {
        const button = el('button', chip);
        button.type = 'button';
        button.setAttribute('aria-label', `${type.label} ${engine.label}`);
        button.append(engineLogo(engine.code), engine.label);
        button.disabled = !canAddNumber(state.draft, type.metric, engine.code);
        button.addEventListener('click', choose(type.metric, engine.code));
        chips.append(button);
      });
      row.append(el('p', 'type-body text-foreground', type.label), chips);
      ai.append(row);
    });
    const left = LIMITS.numbers - (state.draft.numbers ?? []).length;
    panel.replaceChildren(el('p', 'type-subsection-title', 'Add a headline number'), el('p', 'type-meta', `${left} of ${LIMITS.numbers} places left.`), seo, ai);
    openPopup($('#pop-add-number'), anchor, { align: 'end' });
  }

  // --- mode -------------------------------------------------------------------------------------------

  function setChrome() {
    $$(`[data-customize="${screen}"]`).forEach((button) => button.hasAttribute('aria-pressed') && button.setAttribute('aria-pressed', String(customizing())));
    const badge = $(`[data-customizing-badge="${screen}"]`);
    if (badge) badge.hidden = !customizing();
  }

  function load() {
    state.saved = resolveLayout({ personal: readStored('personal', screen), team: team() }, screen);
    render();
  }

  function enter() {
    if (customizing()) return;
    if (active && active !== api) active.exit();
    active = api;
    state.mode = 'customize';
    state.baseline = structuredClone(state.saved.document);
    state.draft = structuredClone(state.saved.document);
    state.grabbed = null;
    // The drawer's cards are on its Overview tab, which may not be the one showing
    if (screen === 'inspector.keyword') ui.selectInspectorTab('overview');
    setChrome();
    render();
    announce(`Customizing ${definition.title}. Drag cards to reorder, or use each card's Move menu`);
    // Started from a menu, which has closed: focus would otherwise be left on nothing
    if (focusIsGone(document.activeElement)) focusDraft();
  }

  const owns = (node) => [cardsZone, numbersZone, saveBar].some((area) => area?.contains(node));

  function exit() {
    if (!customizing()) return;
    // Focus that is on a control about to disappear goes back to where the mode was started
    const focused = document.activeElement;
    const refocus = focusIsGone(focused) || owns(focused) || focused.closest('[aria-modal="true"]') !== null;
    closePopup({ restoreFocus: false });
    state.mode = 'view';
    state.draft = null;
    state.baseline = null;
    state.grabbed = null;
    if (active === api) active = null;
    // A dialog opened from this mode must not outlive it and act on a draft that is gone
    dismissDialogsOf(api);
    ui.dismissDiscard(api);
    setChrome();
    render();
    const entry = $(ENTRY_FOCUS[screen]);
    if (refocus && entry && entry.offsetParent !== null) entry.focus({ preventScroll: true });
  }

  const dirty = () => customizing() && changeCount(state.baseline, state.draft) > 0;

  /** Leaves customize mode, asking first when there are unsaved changes. `then` runs once the mode is left. */
  function requestExit(then) {
    if (!dirty()) {
      exit();
      then?.();
      return;
    }
    askDiscard(DISCARD_MESSAGE, {
      owner: api,
      onKeep: focusDraft,
      onDiscard: () => {
        exit();
        then?.();
      },
    });
  }

  /** What the router and the inspector are told when they ask whether unsaved layout changes block leaving. */
  const leaveGuard = () => (dirty() ? { message: DISCARD_MESSAGE, owner: api, onKeep: focusDraft, onDiscard: exit } : null);

  function save() {
    // A layout equal to the default is not stored, so the person keeps following the team default
    writeStored('personal', screen, sameLayout(state.draft, resetTarget()) ? null : state.draft);
    exit();
    load();
    announce('Layout saved');
  }

  const teamMenuTrigger = () => (saveBar ? $('[data-popup="menu-layout-save"]', saveBar) : null);

  async function saveTeamDefault() {
    // The draft is copied before the question: the mode can end while the dialog is open
    const layout = structuredClone(state.draft);
    const ok = await confirmAction({
      title: `Set this as the default for everyone in ${WORKSPACE}?`,
      body: 'People who have customized this page keep their own layout. Everyone else sees this one.',
      confirmLabel: 'Set team default',
      customizer: api,
      opener: teamMenuTrigger(),
    });
    if (!ok || !customizing()) return;
    writeStored('team', screen, layout);
    writeStored('personal', screen, null);
    exit();
    load();
    toast({ title: 'Team default set', description: `${definition.title} now opens with this layout for ${WORKSPACE}.` });
  }

  async function removeTeamDefault() {
    const ok = await confirmAction({
      title: 'Remove the team default?',
      body: `People in ${WORKSPACE} who have not customized this page go back to the built-in layout.`,
      confirmLabel: 'Remove team default',
      customizer: api,
      opener: teamMenuTrigger(),
    });
    if (!ok || !customizing()) return;
    writeStored('team', screen, null);
    // Unsaved changes are kept: removing the default is about everyone else, not about this draft. What the
    // draft is compared with, and what Cancel returns to, is now the layout without the team default.
    if (dirty()) {
      state.saved = resolveLayout({ personal: readStored('personal', screen), team: team() }, screen);
      state.baseline = structuredClone(state.saved.document);
      renderSaveBar();
      toast({ title: 'Team default removed', description: 'Your unsaved changes are still here.', tone: 'info' });
      return;
    }
    exit();
    load();
    toast({ title: 'Team default removed', tone: 'info' });
  }

  if (saveBar) {
    $('[data-layout-save]', saveBar).addEventListener('click', save);
    $('[data-layout-cancel]', saveBar).addEventListener('click', () => requestExit());
    $('[data-layout-reset]', saveBar).addEventListener('click', () => commit(structuredClone(resetTarget()), { message: 'Layout reset to the default. Save to keep it' }));
  }

  const api = { screen, state, add, moveItem, hide, enter, exit, requestExit, leaveGuard, load, dirty, customizing, saveTeamDefault, removeTeamDefault, hasTeamDefault: () => team() !== null };
  return api;
}

// -------------------------------------------------------------------------------------------------
// Wiring shared by both screens

for (const screen of Object.keys(SCREENS)) {
  const customizer = createCustomizer(screen);
  customizers.set(screen, customizer);
  customizer.load();
}

// Entry points: the Customize button on the page and "Customize cards" in the drawer's More menu
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-customize]');
  if (!button) return;
  const customizer = customizers.get(button.dataset.customize);
  closePopup({ restoreFocus: false });
  if (customizer.customizing()) customizer.requestExit();
  else if (active?.dirty()) active.requestExit(() => customizer.enter());
  else customizer.enter();
});

// The shared Move menu
$('#menu-card').addEventListener('click', (event) => {
  const entry = event.target.closest('[data-card-move]');
  if (!entry || entry.getAttribute('aria-disabled') === 'true' || !menuTarget?.customizer.customizing()) return;
  const { customizer, zone, id } = menuTarget;
  const items = customizer.state.draft[zone] ?? [];
  const index = items.findIndex((item) => item.id === id);
  const target = { earlier: index - 1, later: index + 1, start: 0, end: items.length - 1 }[entry.dataset.cardMove];
  closePopup({ restoreFocus: false });
  customizer.moveItem(zone, id, target, 'more');
});

// Team default actions live in a menu on the Save button (owners and admins only)
document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-popup="menu-layout-save"]');
  if (trigger && active) $('[data-layout-team="remove"]').hidden = !active.hasTeamDefault();
}, true);
$('#menu-layout-save').addEventListener('click', (event) => {
  const entry = event.target.closest('[data-layout-team]');
  if (!entry || !active) return;
  closePopup({ restoreFocus: false });
  if (entry.dataset.layoutTeam === 'save') active.saveTeamDefault();
  else active.removeTeamDefault();
});

// Escape leaves customize mode when nothing else is open to close first
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !active || event.defaultPrevented || ui.popupOpen()) return;
  if ($$('[aria-modal="true"]').some((dialog) => !dialog.hidden) || active.state.grabbed) return;
  event.preventDefault();
  active.requestExit();
});

// Leaving with unsaved changes asks first, however the person leaves: a link, Back and Forward, or closing
// the drawer by its button, its scrim or Escape. The router and the inspector ask these guards (interactions.js).
ui.addLeaveGuard((kind) => (kind === 'inspector' ? customizers.get('inspector.keyword').leaveGuard() : (active?.leaveGuard() ?? null)));
// Without unsaved changes the mode is left quietly. A dirty draft is never dropped here: the guards above
// have either kept the person on the page or already discarded it.
window.addEventListener('hashchange', () => {
  if (active && !active.dirty()) active.exit();
});
window.addEventListener('inspector-close', () => customizers.get('inspector.keyword').exit());

// Customize mode needs 768 px (spec section 5.1). A window narrowed below that leaves the mode, unless
// there are unsaved changes: those stay, with the save bar, until the person saves or cancels.
let lastBreakpoint = breakpoint();
window.addEventListener('resize', () => {
  if (breakpoint() === lastBreakpoint) return;
  lastBreakpoint = breakpoint();
  if (lastBreakpoint === 'narrow' && active && !active.dirty()) active.exit();
});
