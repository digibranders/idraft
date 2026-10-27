/* global document, window, navigator, URL, Blob, setTimeout */
/**
 * Small controls the Page Performance screens share: badges, popovers, selects, segmented controls, the toast
 * and the two ways data leaves the page (copy and CSV).
 */
import { el } from './prompts-parts.js';

const ui = window.PreviewUI;

export const icon = (name, classes) => ui.icon(name, classes);
export const toast = (options) => ui.toast(options);

// -------------------------------------------------------------------------------------------------
// Tones

const BADGE = 'h-badge inline-flex items-center gap-1 px-2 rounded-sm type-micro whitespace-nowrap';
export const TONES = {
  positive: 'border border-positive-border bg-positive-subtle text-positive-text',
  negative: 'border border-negative-border bg-negative-subtle text-negative-text',
  warning: 'border border-warning-border bg-warning-subtle text-warning-text',
  info: 'border border-info-border bg-info-subtle text-info-text',
  neutral: 'border border-neutral-border bg-neutral-subtle text-neutral-text',
  insufficient: 'bg-insufficient text-foreground-tertiary',
};
export const TEXT_TONES = {
  positive: 'text-positive-text',
  negative: 'text-negative-text',
  warning: 'text-warning-text',
  neutral: 'text-foreground-secondary',
};

export function badge(text, tone = 'neutral', extra = '') {
  return el('span', `${BADGE} ${TONES[tone]} ${extra}`.trim(), text);
}

// -------------------------------------------------------------------------------------------------
// Buttons and fields (class strings follow 09 and 10 of the design system)

export const BUTTON = 'h-control px-3 rounded-md border border-border bg-surface flex items-center gap-2 whitespace-nowrap type-body-strong text-foreground hover:bg-surface-hover';
export const BUTTON_SM = 'h-control-sm px-2 rounded-md border border-border bg-surface flex items-center gap-1.5 whitespace-nowrap type-body-strong text-foreground hover:bg-surface-hover';
export const BUTTON_PRIMARY = 'h-control px-3 rounded-md bg-primary text-primary-foreground type-body-strong flex items-center gap-2 whitespace-nowrap hover:bg-primary-hover';
export const FIELD = 'h-control-sm px-2 rounded-md border border-border bg-surface type-body text-foreground';

export function button(label, { iconName, className = BUTTON, onClick, title } = {}) {
  const node = el('button', className);
  node.type = 'button';
  if (iconName) node.append(icon(iconName, 'size-icon text-foreground-tertiary'));
  if (label) node.append(el('span', '', label));
  if (title) node.setAttribute('aria-label', title);
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

export function iconButton(iconName, label, onClick, className = 'size-control-sm') {
  const node = el('button', `${className} rounded-md border border-border bg-surface flex items-center justify-center text-foreground-secondary hover:bg-surface-hover disabled:text-foreground-disabled disabled:hover:bg-surface`);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.dataset.tip = label;
  node.append(icon(iconName, 'size-icon'));
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

/** A native select with the design system's field look. `options` are `[value, label]` pairs. */
export function selectField(options, value, onChange, label, className = '') {
  const select = el('select', `${FIELD} pr-6 ${className}`.trim());
  select.setAttribute('aria-label', label);
  options.forEach(([optionValue, text]) => {
    const option = el('option', '', text);
    option.value = optionValue;
    select.append(option);
  });
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

/** Segmented control (09 section 6): one choice of a few, as radio buttons in a group. */
export function segmented(options, value, onChange, label) {
  const group = el('div', 'inline-flex h-control-sm p-0.5 rounded-md border border-border bg-surface-subtle gap-0.5');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  const buttons = options.map(([optionValue, text, disabled]) => {
    const node = el('button', 'px-3 rounded-sm type-body text-foreground-secondary hover:text-foreground disabled:text-foreground-disabled aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:type-body-strong aria-pressed:border aria-pressed:border-border', text);
    node.type = 'button';
    node.disabled = Boolean(disabled);
    node.addEventListener('click', () => onChange(optionValue));
    return [optionValue, node];
  });
  const sync = (current) => buttons.forEach(([optionValue, node]) => node.setAttribute('aria-pressed', String(optionValue === current)));
  buttons.forEach(([, node]) => group.append(node));
  sync(value);
  group.sync = sync;
  return group;
}

// -------------------------------------------------------------------------------------------------
// Popover: a panel under its trigger, closed by Escape (focus returns to the trigger) or a click outside

let current = null;

function closeCurrent(restoreFocus = true) {
  if (!current) return;
  const { panel, trigger, off } = current;
  current = null;
  off();
  panel.remove();
  trigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger.focus();
}

export function closePopovers() {
  closeCurrent(false);
}
export const popoverOpen = () => current !== null;

/**
 * @param {HTMLElement} trigger
 * @param {(panel: HTMLElement, api: {close: () => void}) => void} build fills the panel each time it opens
 */
export function popover(trigger, build, { label } = {}) {
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (current?.trigger === trigger) {
      closeCurrent();
      return;
    }
    closeCurrent(false);
    const panel = el('div', 'fixed z-(--z-dropdown) min-w-(--size-popover-min) max-w-(--size-popover-max) max-h-(--size-popover-max-h) overflow-auto rounded-lg border border-border bg-surface-elevated shadow-popover p-2 flex flex-col gap-1');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', label ?? trigger.getAttribute('aria-label') ?? 'Options');
    build(panel, { close: () => closeCurrent() });
    document.body.append(panel);
    const rect = trigger.getBoundingClientRect();
    panel.style.top = `${rect.bottom + 4}px`;
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8))}px`;
    const onDown = (down) => {
      if (!panel.contains(down.target) && !trigger.contains(down.target)) closeCurrent(false);
    };
    const onKey = (key) => {
      if (key.key === 'Escape') {
        key.stopPropagation();
        closeCurrent();
      }
    };
    const onMove = () => closeCurrent(false);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onMove);
    const off = () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onMove);
    };
    current = { panel, trigger, off };
    trigger.setAttribute('aria-expanded', 'true');
    panel.querySelector('input, button, select, [tabindex]')?.focus();
  });
}

/** A labelled checkbox row for popovers and lists. */
export function checkRow(text, checked, onChange, { hint, disabled = false } = {}) {
  const row = el('label', 'min-h-8 px-2 py-1 rounded-md flex items-center gap-2 type-body text-foreground hover:bg-surface-hover cursor-pointer');
  const box = el('input', 'size-4 rounded-sm accent-primary shrink-0');
  box.type = 'checkbox';
  box.checked = checked;
  box.disabled = disabled;
  box.addEventListener('change', () => onChange(box.checked));
  row.append(box, el('span', 'min-w-0 truncate', text));
  if (hint) row.append(el('span', 'ml-auto pl-2 type-meta shrink-0', hint));
  return row;
}

// -------------------------------------------------------------------------------------------------
// Data out

export async function copyText(text, message = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: message, tone: 'success' });
  } catch {
    toast({ title: 'Could not copy', description: 'The browser blocked clipboard access.', tone: 'info' });
  }
}

const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
export function downloadCsv(filename, rows) {
  const blob = new Blob([`${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast({ title: 'Export ready', description: filename, tone: 'success' });
}

/** Skeleton rows that match the shape of a table row (17 section 3). */
export function skeletonRows(count, columns) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i += 1) {
    const row = el('tr', 'h-row border-t border-border-subtle');
    for (let c = 0; c < columns; c += 1) {
      const cell = el('td', 'px-3');
      cell.append(el('span', `block h-3 rounded-sm bg-surface-hover animate-skeleton-pulse ${c === 0 ? 'w-32' : 'w-12'}`));
      row.append(cell);
    }
    frag.append(row);
  }
  return frag;
}
