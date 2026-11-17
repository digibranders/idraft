/* global document, window, structuredClone */
/**
 * Customize mode of the AI visibility Overview: the toolbar on every card (drag handle, width, hide, move), the card
 * catalog, presets, the save bar, a person's own layout and the team default. The behavior follows the layout design
 * (docs/superpowers/specs/2026-09-30-layout-customization-design.md) and the project Overview's customize mode
 * (customize.js); the layout rules are in aiov-layout.js. In the app the layouts come from the layouts API and the
 * drag handling from dnd-kit; here browser storage and pointer events stand in for them.
 */
import { CARD_GROUPS, MIN_HEIGHT, WIDTH_CLASS, WIDTH_LABEL, cardDef } from './aiov-registry.js';
import {
  LIMIT,
  PRESETS,
  PRESET_KEYS,
  addCard,
  applyPreset,
  changeCount,
  hiddenCards,
  hideCard,
  moveCard,
  readStored,
  resetTarget,
  resolveLayout,
  sameLayout,
  setWidth,
  writeStored,
} from './aiov-layout.js';
import { cardFrame, el, emptyBody, icon, plural } from './aiov-parts.js';

const ui = window.PreviewUI;

const FRAME_EDIT = ['p-1', 'gap-1', 'rounded-lg', 'outline-1', 'outline-dashed', 'outline-border-strong', 'bg-surface-subtle'];
const FRAME_GRABBED = ['ring-2', 'ring-primary'];
const TOOL = 'size-control-sm shrink-0 rounded-md flex items-center justify-center text-foreground-secondary hover:bg-surface-hover hover:text-foreground';
const BUTTON = 'h-control px-3 rounded-md border border-border bg-surface flex items-center gap-2 whitespace-nowrap type-body-strong text-foreground hover:bg-surface-hover';
const ITEM = 'group w-full min-h-control-sm py-1 px-2 rounded-md flex items-center gap-2 type-body text-foreground text-left outline-none hover:bg-surface-hover focus-visible:bg-surface-hover disabled:text-foreground-disabled disabled:hover:bg-transparent';
const DISCARD_MESSAGE = 'Your layout changes will be lost.';

export function createCustomizer({ grid, onChange }) {
  const state = { mode: 'view', saved: null, draft: null, source: 'default' };

  const load = () => {
    const resolved = resolveLayout();
    state.saved = resolved.document;
    state.source = resolved.source;
  };
  load();

  const customizing = () => state.mode === 'customize';
  const current = () => (customizing() ? state.draft : state.saved);
  const changes = () => (customizing() ? changeCount(state.saved, state.draft) : 0);
  const dirty = () => customizing() && changes() > 0;
  const teamExists = () => readStored('team') !== null;

  // --- announcements and menus -------------------------------------------------------------------

  const live = el('p', 'sr-only');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  const announce = (text) => {
    live.textContent = '';
    window.setTimeout(() => (live.textContent = text), 30);
  };

  const menu = el('div', 'hidden fixed z-(--z-dropdown) min-w-56 max-w-84 max-h-96 overflow-y-auto rounded-lg border border-border bg-surface-elevated shadow-popover p-1');
  menu.setAttribute('role', 'menu');
  document.body.append(menu);

  /** Opens the shared menu from `trigger`. Entries: `{ heading }` or `{ label, hint, disabled, selected, onPick }`. */
  function showMenu(trigger, entries, { label, role = 'menuitem', align = 'start' } = {}) {
    menu.setAttribute('aria-label', label ?? 'Menu');
    menu.replaceChildren(
      // An item that cannot be chosen is left out: the popup would put focus on it and the keys would skip past
      ...entries.filter((entry) => !entry.disabled).map((entry) => {
        if (entry.heading) {
          const heading = el('div', 'h-7 px-2 flex items-center type-meta', entry.heading);
          heading.setAttribute('role', 'presentation');
          return heading;
        }
        const item = el('button', ITEM);
        item.type = 'button';
        item.setAttribute('role', role);
        if (role !== 'menuitem') item.setAttribute('aria-checked', String(Boolean(entry.selected)));
        const check = el('span', 'size-icon-sm shrink-0 text-primary-text invisible group-aria-checked:visible');
        check.setAttribute('aria-hidden', 'true');
        check.append(icon('check', 'size-icon-sm'));
        const text = el('span', 'min-w-0 flex flex-col');
        text.append(el('span', '', entry.label));
        if (entry.hint) text.append(el('span', 'type-meta whitespace-normal', entry.hint));
        item.append(...(role === 'menuitem' ? [] : [check]), text);
        item.addEventListener('click', () => {
          ui.closePopup();
          entry.onPick?.();
        });
        return item;
      }),
    );
    ui.openPopup(menu, trigger, { align });
  }

  /** A confirmation for something other people will see. Resolves to true when confirmed. */
  function confirmAction({ title, body, confirmLabel }) {
    return new Promise((resolve) => {
      const dialog = document.getElementById('dlg-confirm').cloneNode(true);
      dialog.removeAttribute('id');
      const titleNode = dialog.querySelector('h2');
      const bodyNode = dialog.querySelector('p');
      titleNode.removeAttribute('id');
      bodyNode.removeAttribute('id');
      titleNode.textContent = title;
      bodyNode.textContent = body;
      dialog.querySelector('[data-confirm-ok]').textContent = confirmLabel;
      const labelId = `aiov-confirm-${Date.now()}`;
      titleNode.id = labelId;
      bodyNode.id = `${labelId}-body`;
      dialog.setAttribute('aria-labelledby', labelId);
      dialog.setAttribute('aria-describedby', `${labelId}-body`);
      document.body.append(dialog);
      const opener = document.activeElement;
      let settled = false;
      const settle = (answer) => {
        if (settled) return;
        settled = true;
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          dialog.remove();
          opener?.focus?.();
          resolve(answer);
        };
        ui.closeModal(dialog, finish);
        // The answer must not wait on the fade: it never ends in a tab that is not showing
        window.setTimeout(finish, 450);
      };
      dialog.querySelector('[data-confirm-ok]').addEventListener('click', () => settle(true));
      dialog.querySelectorAll('[data-confirm-cancel], [data-scrim]').forEach((node) => node.addEventListener('click', () => settle(false)));
      dialog.addEventListener('keydown', (event) => {
        ui.trapFocus(dialog, event);
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          settle(false);
        }
      });
      ui.openModal(dialog);
      dialog.querySelector('[data-confirm-cancel]').focus();
    });
  }

  // --- the controls in the page header ------------------------------------------------------------

  const toggle = el('button', `${BUTTON} hidden md:flex aria-pressed:border-primary-border aria-pressed:bg-primary-subtle aria-pressed:text-primary-text`);
  toggle.type = 'button';
  toggle.setAttribute('aria-pressed', 'false');
  toggle.append(icon('sliders-horizontal', 'size-icon'), 'Customize');

  const presetsButton = el('button', BUTTON);
  presetsButton.hidden = true;
  presetsButton.type = 'button';
  presetsButton.setAttribute('aria-haspopup', 'menu');
  presetsButton.append('Start from', icon('chevron-down', 'size-icon-sm text-foreground-tertiary'));

  const badge = el('span', 'h-badge inline-flex items-center px-2 rounded-sm type-micro whitespace-nowrap bg-primary-subtle text-primary-text', 'Customizing');
  badge.hidden = true;

  // --- the save bar ---------------------------------------------------------------------------------

  const bar = el('div', 'sticky bottom-0 z-(--z-sticky) min-h-save-bar shrink-0 bg-surface border-t border-border -mx-3 md:-mx-4 lg:-mx-5 px-3 md:px-4 lg:px-5 py-2 flex flex-wrap items-center gap-x-3 gap-y-2');
  bar.hidden = true;
  bar.setAttribute('aria-label', 'Layout');
  const changesText = el('span', 'type-body-strong text-foreground whitespace-nowrap');
  const scopeText = el('span', 'hidden lg:block min-w-0 type-meta truncate');
  const actions = el('span', 'ml-auto flex items-center gap-2');
  const resetButton = el('button', 'h-control px-3 rounded-md flex items-center gap-2 whitespace-nowrap type-body-strong text-foreground-secondary hover:bg-surface-hover hover:text-foreground disabled:text-foreground-disabled disabled:hover:bg-transparent', 'Reset');
  resetButton.type = 'button';
  const cancelButton = el('button', BUTTON, 'Cancel');
  cancelButton.type = 'button';
  const saveGroup = el('span', 'flex');
  const saveButton = el('button', 'h-control px-3 rounded-l-md bg-primary text-primary-foreground type-body-strong whitespace-nowrap hover:bg-primary-hover disabled:bg-surface-disabled disabled:text-foreground-disabled', 'Save layout');
  saveButton.type = 'button';
  const saveMore = el('button', 'h-control w-8 rounded-r-md border-l border-primary-hover bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary-hover disabled:bg-surface-disabled');
  saveMore.type = 'button';
  saveMore.setAttribute('aria-haspopup', 'menu');
  saveMore.setAttribute('aria-label', 'More save options');
  saveMore.dataset.tip = 'More save options';
  saveMore.append(icon('chevron-down', 'size-icon-sm'));
  saveGroup.append(saveButton, saveMore);
  actions.append(resetButton, cancelButton, saveGroup);
  bar.append(changesText, scopeText, actions);

  function updateBar() {
    const count = changes();
    changesText.textContent = count === 0 ? 'No changes' : plural(count, 'change');
    const full = state.draft?.cards.length ?? 0;
    scopeText.textContent = `${full} of ${LIMIT} cards · ${teamExists() ? 'Reset goes back to the team default' : 'Reset goes back to the built in Default'}`;
    saveButton.disabled = count === 0;
    resetButton.disabled = !state.draft || sameLayout(state.draft, resetTarget());
  }

  // --- changing the draft ---------------------------------------------------------------------------

  function edit(next, message) {
    if (!next || sameLayout(next, state.draft)) return;
    state.draft = next;
    if (message) announce(message);
    onChange();
  }

  const nameOf = (id) => cardDef(id)?.title ?? id;
  const positionText = (id) => `${nameOf(id)}, position ${state.draft.cards.findIndex((item) => item.id === id) + 1} of ${state.draft.cards.length}`;

  function move(id, to, focus = true) {
    const next = moveCard(state.draft, id, to);
    // At the start or the end there is nowhere to go: nothing changes and nothing is announced
    if (sameLayout(next, state.draft)) return;
    edit(next, '');
    announce(`Moved ${positionText(id)}`);
    if (focus) refocus(id, '[data-drag-handle]');
  }

  function refocus(id, selector) {
    window.requestAnimationFrame(() => grid.querySelector(`[data-card-id="${id}"] ${selector}`)?.focus({ preventScroll: false }));
  }

  // --- the toolbar and frame of one card ------------------------------------------------------------

  function toolbar(item, def) {
    const row = el('div', 'h-9 px-1 flex items-center gap-1');
    row.dataset.cardToolbar = '';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `${def.title} card`);

    const handle = el('button', `${TOOL} cursor-grab touch-none`);
    handle.type = 'button';
    handle.dataset.dragHandle = '';
    handle.dataset.tip = 'Drag to reorder, or use the arrow keys';
    handle.setAttribute('aria-label', `Reorder ${def.title}. Arrow keys move it`);
    handle.append(icon('grip-vertical', 'size-icon'));
    handle.addEventListener('keydown', (event) => {
      const keys = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 };
      if (event.key in keys) move(item.id, state.draft.cards.findIndex((card) => card.id === item.id) + keys[event.key]);
      else if (event.key === 'Home') move(item.id, 0);
      else if (event.key === 'End') move(item.id, state.draft.cards.length - 1);
      else return;
      event.preventDefault();
    });
    wireDrag(handle, item);

    const tools = el('span', 'ml-auto flex items-center gap-1');
    if (def.widths.length > 1) {
      const width = el('button', 'h-control-sm px-2 rounded-md border border-border bg-surface flex items-center gap-1.5 whitespace-nowrap type-body text-foreground hover:bg-surface-hover');
      width.type = 'button';
      width.setAttribute('aria-haspopup', 'menu');
      width.setAttribute('aria-label', `Width of ${def.title}: ${WIDTH_LABEL[item.width]}`);
      width.append(WIDTH_LABEL[item.width], icon('chevron-down', 'size-icon-sm text-foreground-tertiary'));
      width.addEventListener('click', () =>
        showMenu(
          width,
          def.widths.map((value) => ({ label: WIDTH_LABEL[value], selected: value === item.width, onPick: () => edit(setWidth(state.draft, item.id, value), `${def.title} is now ${WIDTH_LABEL[value].toLowerCase()}`) })),
          { label: `Width of ${def.title}`, role: 'menuitemradio', align: 'end' },
        ),
      );
      tools.append(width);
    }
    const hide = el('button', TOOL);
    hide.type = 'button';
    hide.dataset.tip = 'Hide card. Add it back from the catalog';
    hide.setAttribute('aria-label', `Hide ${def.title}`);
    hide.append(icon('eye-off', 'size-icon'));
    hide.addEventListener('click', () => {
      const index = state.draft.cards.findIndex((card) => card.id === item.id);
      edit(hideCard(state.draft, item.id), `${def.title} hidden. ${plural(state.draft.cards.length - 1, 'card')} left`);
      const next = state.draft.cards[Math.min(index, state.draft.cards.length - 1)];
      if (next) refocus(next.id, '[data-drag-handle]');
      else window.requestAnimationFrame(() => grid.querySelector('button')?.focus());
    });
    const more = el('button', TOOL);
    more.type = 'button';
    more.dataset.tip = 'Move';
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-label', `Move ${def.title}`);
    more.append(icon('ellipsis-vertical', 'size-icon'));
    more.addEventListener('click', () => {
      const index = state.draft.cards.findIndex((card) => card.id === item.id);
      const last = state.draft.cards.length - 1;
      showMenu(
        more,
        [
          { label: 'Move earlier', disabled: index === 0, onPick: () => move(item.id, index - 1, false) },
          { label: 'Move later', disabled: index === last, onPick: () => move(item.id, index + 1, false) },
          { label: 'Move to the start', disabled: index === 0, onPick: () => move(item.id, 0, false) },
          { label: 'Move to the end', disabled: index === last, onPick: () => move(item.id, last, false) },
        ],
        { label: `Move ${def.title}`, align: 'end' },
      );
    });
    tools.append(hide, more);
    row.append(handle, tools);
    return row;
  }

  /** Dragging: the card follows the pointer through the grid; the new order is read from the grid when it is dropped. */
  function wireDrag(handle, item) {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const frame = handle.closest('[data-card-id]');
      event.preventDefault();
      frame.classList.add(...FRAME_GRABBED);
      // Moving the frame in the grid re-inserts the handle, which makes the browser drop a pointer capture. So the
      // move and the drop are heard on the window, which does not depend on the handle staying where it is.
      const onMove = (moveEvent) => {
        const under = document
          .elementsFromPoint(moveEvent.clientX, moveEvent.clientY)
          .map((node) => node.closest?.('[data-card-id]'))
          .find((candidate) => candidate && candidate !== frame);
        if (!under) return;
        const a = frame.getBoundingClientRect();
        const b = under.getBoundingClientRect();
        const sameRow = Math.abs(a.top - b.top) < 24;
        const before = sameRow ? moveEvent.clientX < b.left + b.width / 2 : moveEvent.clientY < b.top + b.height / 2;
        grid.insertBefore(frame, before ? under : under.nextSibling);
      };
      const onEnd = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        frame.classList.remove(...FRAME_GRABBED);
        const order = [...grid.children].map((node) => node.dataset.cardId).filter(Boolean);
        const byId = new Map(state.draft.cards.map((card) => [card.id, card]));
        const next = { ...state.draft, cards: order.map((id) => byId.get(id)).filter(Boolean) };
        if (next.cards.length === state.draft.cards.length) edit(next, `Moved ${nameOf(item.id)}`);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    });
  }

  /**
   * The frame of one card: its width in the grid, its smallest height and, while customizing, its toolbar. `node` is
   * null when the card cannot be drawn for the scope; then a placeholder with the reason takes its place.
   */
  function frameFor(item, node, { unavailableText }) {
    const def = cardDef(item.type);
    // A card that has nothing for this scope stays in its place with the reason, so the page keeps its shape
    const body = node ?? cardFrame({ key: item.type, title: def.title, body: emptyBody('Not available for this scope', unavailableText) });
    const frame = el('div', `min-w-0 flex flex-col ${WIDTH_CLASS[item.width]}`);
    frame.dataset.cardId = item.id;
    body.classList.add('flex-1');
    if (customizing()) {
      frame.classList.add(...FRAME_EDIT);
      frame.prepend(toolbar(item, def));
      body.inert = true;
    } else if (MIN_HEIGHT[item.type]) frame.classList.add(...MIN_HEIGHT[item.type].split(' '));
    frame.append(body);
    return frame;
  }

  /** The "Add card" slot at the end of the grid. */
  function addSlot() {
    const full = state.draft.cards.length >= LIMIT;
    const slot = el('button', `${WIDTH_CLASS.half} min-h-30 rounded-lg border border-dashed border-border-strong flex flex-col items-center justify-center gap-1 type-body-strong text-primary-text hover:bg-surface-hover disabled:text-foreground-tertiary disabled:hover:bg-transparent`);
    slot.type = 'button';
    slot.disabled = full;
    const label = el('span', 'flex items-center gap-1.5');
    label.append(icon('plus', 'size-icon'), 'Add card');
    slot.append(label, el('span', 'type-meta', full ? `All ${LIMIT} cards are in use` : 'Opens the card catalog'));
    slot.addEventListener('click', () => openCatalog(slot));
    return slot;
  }

  function openCatalog(trigger) {
    const hidden = hiddenCards(state.draft);
    const entries = [];
    CARD_GROUPS.forEach((group) => {
      const inGroup = hidden.filter((def) => def.group === group);
      if (inGroup.length === 0) return;
      entries.push({ heading: group });
      inGroup.forEach((def) =>
        entries.push({
          label: def.title,
          hint: def.description,
          onPick: () => {
            edit(addCard(state.draft, def.key), `${def.title} added`);
            ui.toast({ title: `${def.title} added`, description: 'It is at the end of the page. Drag it where you want it.' });
            refocus(def.key, '[data-drag-handle]');
          },
        }),
      );
    });
    if (entries.length === 0) entries.push({ heading: 'Every card is already on the page' });
    showMenu(trigger, [{ heading: `Card catalog · ${state.draft.cards.length} of ${LIMIT} cards` }, ...entries], { label: 'Card catalog' });
  }

  // --- entering, leaving and saving ----------------------------------------------------------------

  function sync() {
    const on = customizing();
    toggle.setAttribute('aria-pressed', String(on));
    presetsButton.hidden = !on;
    badge.hidden = !on;
    bar.hidden = !on;
    if (on) updateBar();
  }

  function enter() {
    if (customizing()) return;
    load();
    state.mode = 'customize';
    state.draft = structuredClone(state.saved);
    sync();
    announce('Customize mode. Drag cards or use the arrow keys on a handle to reorder them.');
    onChange();
  }

  function exit() {
    // The controls that held focus are about to be hidden: focus goes back to where the person started
    const held = document.activeElement === document.body || grid.contains(document.activeElement) || bar.contains(document.activeElement) || menu.contains(document.activeElement);
    state.mode = 'view';
    state.draft = null;
    sync();
    onChange();
    if (held && toggle.offsetParent !== null) toggle.focus();
  }

  /** Leaving with unsaved changes asks first (10 section 13.2). Resolves when the person has chosen. */
  function requestExit() {
    if (!dirty()) return exit();
    ui.askDiscard(DISCARD_MESSAGE, { owner: 'aiov-layout', onKeep: () => toggle.focus?.(), onDiscard: exit });
  }

  function saveLayout() {
    if (changes() === 0) return;
    const draft = state.draft;
    writeStored('personal', sameLayout(draft, resetTarget()) ? null : draft);
    ui.toast({ title: 'Layout saved', description: 'This is your layout on this page.' });
    load();
    exit();
  }

  async function saveTeam() {
    // The layout asked about is the one shown now; the question may stay open while something else changes the page
    const draft = structuredClone(state.draft);
    const ok = await confirmAction({ title: 'Save as the team default?', body: 'Everyone in the workspace who has not saved a layout of their own will see this one.', confirmLabel: 'Save as team default' });
    if (!ok || !customizing()) return;
    writeStored('team', draft);
    writeStored('personal', null);
    ui.toast({ title: 'Team default saved', description: 'It is now the layout for everyone without their own.' });
    load();
    exit();
  }

  async function removeTeam() {
    const ok = await confirmAction({ title: 'Remove the team default?', body: 'People without a layout of their own go back to the built in Default.', confirmLabel: 'Remove team default' });
    if (!ok) return;
    writeStored('team', null);
    ui.toast({ title: 'Team default removed', description: 'The built in Default applies again.' });
    // What is saved may have been the team default: read it again. With edits in hand they stay and are counted
    // against the new base; with none, the mode simply ends on the layout that now applies.
    if (!customizing()) return;
    if (dirty()) {
      load();
      updateBar();
    } else {
      load();
      exit();
    }
  }

  toggle.addEventListener('click', () => (customizing() ? requestExit() : enter()));
  cancelButton.addEventListener('click', requestExit);
  saveButton.addEventListener('click', saveLayout);
  resetButton.addEventListener('click', () => edit(structuredClone(resetTarget()), 'Layout reset'));
  saveMore.addEventListener('click', () =>
    showMenu(
      saveMore,
      [
        { label: 'Save as team default', hint: 'For everyone without a layout of their own', disabled: false, onPick: saveTeam },
        { label: 'Remove team default', hint: 'Back to the built in Default for them', disabled: !teamExists(), onPick: removeTeam },
      ],
      { label: 'Save options', align: 'end' },
    ),
  );
  presetsButton.addEventListener('click', () =>
    showMenu(
      presetsButton,
      [{ heading: 'Replaces the cards on this page. Nothing is saved until you save.' }, ...PRESET_KEYS.map((key) => ({ label: PRESETS[key].label, hint: PRESETS[key].description, onPick: () => edit(applyPreset(key), `${PRESETS[key].label} layout applied`) }))],
      { label: 'Start from a preset' },
    ),
  );

  // Escape leaves customize mode when nothing else is open; a route change with unsaved edits asks first
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !customizing() || ui.popupOpen() || ui.currentRoute().view !== 'ai') return;
    if (document.querySelector('[aria-modal="true"]:not([hidden])')) return;
    if (event.target.closest?.('input, textarea')) return;
    requestExit();
  });
  ui.addLeaveGuard((kind) => (kind === 'route' && dirty() ? { owner: 'aiov-layout', message: DISCARD_MESSAGE, onKeep: () => toggle.focus?.(), onDiscard: exit } : null));
  // Leaving the page, or narrowing the window below the width that has the Customize button, ends a clean session of
  // customizing (a dirty one is asked about by the leave guard above, and stays while the window is narrowed)
  window.addEventListener('preview-leave', (event) => {
    if (event.detail?.from === 'ai' && customizing() && !dirty()) exit();
  });
  window.matchMedia('(max-width: 767px)').addEventListener('change', (event) => {
    if (event.matches && customizing() && !dirty()) exit();
  });
  window.addEventListener('beforeunload', (event) => {
    if (dirty()) event.preventDefault();
  });

  return { toggle, presetsButton, badge, bar, live, current, customizing, frameFor, addSlot, load, sync, updateBar, exit };
}
