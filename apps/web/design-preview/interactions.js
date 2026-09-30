/* global document, window, echarts, history, location, matchMedia, getComputedStyle, requestAnimationFrame, setTimeout, clearTimeout, ResizeObserver, URL */
/**
 * Interactive behavior for the static design-system preview: menus, popovers, filter editors and chips,
 * tooltips, toasts, the keyword inspector, table sorting and row menus, the Add keywords dialog with its
 * discard confirmation, the command palette, switches and count tabs.
 *
 * Specs: docs/design-system/16-drawers-dialogs-popovers.md (overlays, inspector, palette),
 * 13-filters-search.md (filter editors and chips), 18-notifications-alerts.md (toasts, notification panel),
 * 09-buttons-controls.md (controls), 21-motion.md (durations come from the motion tokens, so reduced motion
 * turns every transition off). In the app these are Base UI primitives; this file only demonstrates behavior.
 */
(() => {
  'use strict';

  const root = document.documentElement;
  const charts = window.PreviewCharts;
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  // ---------------------------------------------------------------------------------------------
  // Motion from tokens (0 ms under reduced motion)

  function duration(name) {
    const raw = getComputedStyle(root).getPropertyValue(`--duration-${name}`).trim();
    return Number.parseFloat(raw) || 0;
  }
  const EASE_IN = 'cubic-bezier(0.2, 0, 0, 1)';
  const EASE_OUT = 'cubic-bezier(0.4, 0, 1, 1)';

  function enter(el, { from = 'translateY(4px)', speed = 'base' } = {}) {
    el.inert = false;
    const ms = duration(speed);
    if (ms > 0) el.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], { duration: ms, easing: EASE_IN });
  }
  // A leaving element is inert, so a click during its fade lands on what is behind it
  function exit(el, done, { to = 'translateY(4px)', speed = 'fast' } = {}) {
    el.inert = true;
    const ms = duration(speed);
    if (ms === 0) return done();
    el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: to }], { duration: ms, easing: EASE_OUT }).onfinish = done;
  }

  // ---------------------------------------------------------------------------------------------
  // Icons for script-created elements (templates filled by icons.mjs)

  function icon(name, classes = 'size-icon') {
    const tpl = document.getElementById(`tpl-icon-${name}`);
    if (!tpl) throw new Error(`Missing icon template tpl-icon-${name}`);
    const svg = tpl.content.firstElementChild.cloneNode(true);
    svg.setAttribute('class', classes);
    svg.setAttribute('aria-hidden', 'true');
    return svg;
  }

  // ---------------------------------------------------------------------------------------------
  // Positioning: side bottom, align start (or end), 4 px offset, flip when there is no room, shift to stay 8 px
  // inside the viewport (16 section 5.1)

  function place(panel, anchor, { align = 'start', offset = 4, point = null } = {}) {
    const vw = root.clientWidth;
    const vh = window.innerHeight;
    const r = point ? { left: point.x, right: point.x, top: point.y, bottom: point.y } : anchor.getBoundingClientRect();
    panel.style.maxWidth = `${vw - 16}px`;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.min(Math.max(8, left), vw - 8 - w);
    let top = r.bottom + offset;
    if (top + h > vh - 8 && r.top - offset - h >= 8) top = r.top - offset - h;
    top = Math.min(Math.max(8, top), Math.max(8, vh - 8 - h));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  // ---------------------------------------------------------------------------------------------
  // Popups: one open at a time (a popover may open one further layer, handled by closing and reopening here)

  let current = null;

  function focusables(scope) {
    return $$('[role^="menuitem"]:not([hidden]), input:not([type="hidden"]), button:not([disabled]), a[href]', scope).filter(
      (el) => el.offsetParent !== null,
    );
  }

  function openPopup(panel, trigger, options = {}) {
    closePopup({ restoreFocus: false });
    if (panel.hasAttribute('data-editor')) syncEditor(panel);
    // A popup opened from a higher layer (the overlay inspector) takes that layer's z-index. Popups follow the
    // inspector in the document, so at the same z-index they paint above it.
    const layer = trigger?.closest('#inspector');
    const layerZ = layer ? Number(getComputedStyle(layer).zIndex) : Number.NaN;
    const dropdownZ = Number(getComputedStyle(root).getPropertyValue('--z-dropdown'));
    panel.style.zIndex = layerZ > dropdownZ ? String(layerZ) : '';
    panel.classList.remove('hidden');
    panel.setAttribute('data-open', '');
    place(panel, options.anchor ?? trigger, options);
    enter(panel);
    trigger?.setAttribute('aria-expanded', 'true');
    current = { panel, trigger, anchor: options.anchor ?? trigger, onClose: options.onClose };
    const first = panel.querySelector('[aria-checked="true"]') ?? focusables(panel)[0];
    (options.focus ?? first)?.focus({ preventScroll: true });
    hideTooltip();
  }

  function closePopup({ restoreFocus = true } = {}) {
    if (!current) return;
    const { panel, trigger, onClose } = current;
    current = null;
    trigger?.setAttribute('aria-expanded', 'false');
    onClose?.();
    exit(panel, () => {
      if (current?.panel === panel) return; // reopened while fading out
      panel.classList.add('hidden');
      panel.removeAttribute('data-open');
    });
    if (restoreFocus && trigger?.isConnected && trigger.offsetParent !== null) trigger.focus({ preventScroll: true });
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-popup]');
    if (trigger) {
      event.preventDefault();
      const panel = document.getElementById(trigger.dataset.popup);
      if (current?.panel === panel) return closePopup();
      const options = { align: trigger.dataset.align };
      if (panel.hasAttribute('data-editor')) {
        options.focus = panel.querySelector('[data-editor-search]') ?? panel.querySelector('input[type="checkbox"]');
      }
      if (trigger.dataset.popup === 'menu-row') {
        setRowMenuTarget(inspectorId);
        setInspectorOnlyItems(true);
      }
      return openPopup(panel, trigger, options);
    }
    // A click on the popup's own anchor (a combobox field, a select trigger) is handled by that control. The event
    // path is used because a popup may re-render the clicked element (calendar days) before this runs.
    const path = event.composedPath();
    if (current && !path.includes(current.panel) && !path.includes(current.anchor)) closePopup({ restoreFocus: false });
  });

  // Keyboard inside menus: arrows, Home and End move; Tab closes a menu (16 section 5.2)
  const GRID_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
  document.addEventListener('keydown', (event) => {
    if (!current) return;
    const { panel } = current;
    // Calendar grids handle their own arrow, Home, End and Page keys (10 section 10.1).
    if (GRID_KEYS.has(event.key) && document.activeElement?.closest('[data-calendar]')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      return closePopup();
    }
    // Arrow keys stay inside a radio group (date presets) when focus is in one
    const items = focusables(document.activeElement?.closest('[role="radiogroup"]') ?? panel);
    const index = items.indexOf(document.activeElement);
    const isMenu = panel.getAttribute('role') === 'menu' || panel.querySelector('[role="menu"]');
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (document.activeElement?.tagName === 'INPUT' && event.key === 'ArrowUp' && index === 0) return;
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      if (document.activeElement?.tagName === 'INPUT') return;
      event.preventDefault();
      (event.key === 'Home' ? items[0] : items[items.length - 1])?.focus();
    } else if (event.key === 'Tab' && isMenu && panel.getAttribute('role') === 'menu') {
      closePopup();
    } else if (event.key === 'Enter' && panel.hasAttribute('data-editor') && !document.activeElement?.matches('button')) {
      // Multi-choice editors apply with the Apply button or Enter; closing any other way discards (13 section 3)
      event.preventDefault();
      applyEditor(panel);
      closePopup();
    }
  }, true);

  window.addEventListener('resize', () => closePopup({ restoreFocus: false }));

  // ---------------------------------------------------------------------------------------------
  // Radio menus: date range, location, compare, device, theme, project

  const radioHandlers = {
    location: (value) => {
      $('[data-location-label]').textContent = value;
      const button = $('#location-button');
      button.setAttribute('aria-label', `Location: ${value}`);
      button.dataset.tip = `Location: ${value}`;
    },
    compare: (value) => $$('[data-compare-label]').forEach((el) => (el.textContent = value)),
    // Overview: "Included" means no branded filter, so the chip goes away; "+ Filter" brings it back
    branded: (value) => {
      $('[data-branded-label]').textContent = `Branded: ${value}`;
      $('[data-branded-chip]').hidden = value === 'Included';
      $('[data-open-menu="menu-branded"]').hidden = value !== 'Included';
    },
    device: (value) => ($('[data-device-label]').textContent = value),
    // The menu closes first so the reveal starts from a clean screen.
    theme: (value) => setTimeout(() => changeTheme(value, themeOrigin()), duration('base')),
    project: (value) => {
      // Sidebar switcher: the name lives in a span; the breadcrumb crumb is the button's own text.
      $$('[data-popup="menu-project"]').forEach((el) => {
        const name = el.querySelector('span.type-subsection-title');
        if (name) name.textContent = value;
        else el.textContent = value;
        if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', `Switch workspace or project: ${value}`);
        if (el.dataset.tip) el.dataset.tip = value;
      });
      toast({ title: `Switched to ${value}`, tone: 'info' });
    },
  };

  document.addEventListener('click', (event) => {
    const option = event.target.closest('[role="menuitemradio"]');
    if (!option || !option.closest('[data-open]')) return;
    const group = option.closest('[data-radio-target], [data-theme-radios]') ?? option.closest('[role="menu"]');
    $$('[role="menuitemradio"]', group).forEach((el) => el.setAttribute('aria-checked', String(el === option)));
    const key = group.dataset.radioTarget ?? (group.hasAttribute('data-theme-radios') ? 'theme' : group.id === 'menu-project' ? 'project' : null);
    const value = option.dataset.value ?? option.textContent.trim();
    if (key) radioHandlers[key](value);
    closePopup();
  });

  // Location search narrows the list
  $('[data-location-search]')?.addEventListener('input', (event) => {
    const q = event.target.value.trim().toLowerCase();
    $$('#pop-location [role="menuitemradio"]').forEach((el) => (el.hidden = q !== '' && !el.textContent.toLowerCase().includes(q)));
  });

  // ---------------------------------------------------------------------------------------------
  // Theme: light, dark, system. The top bar switch flips between light and dark; the account menu also offers
  // System. A change reveals the new theme as a circle growing from the control that asked for it (View
  // Transitions API); without that API, or under reduced motion, the theme swaps at once.

  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  const themeSwitches = $$('[data-theme-toggle]');
  let themeMode = root.classList.contains('dark') ? 'dark' : 'light';

  function syncThemeControls() {
    const dark = root.classList.contains('dark');
    if (themeMode !== 'system') themeMode = dark ? 'dark' : 'light';
    themeSwitches.forEach((el) => el.setAttribute('aria-checked', String(dark)));
    $$('[data-theme-radios] [role="menuitemradio"]').forEach((el) => el.setAttribute('aria-checked', String(el.dataset.value === themeMode)));
    // Settings > Preferences: clicking the segment lets the segmented control restyle itself
    const segment = $(`[data-pref-theme] [data-value="${themeMode}"]`);
    if (segment && segment.getAttribute('aria-checked') !== 'true') segment.click();
  }

  function applyTheme(mode) {
    themeMode = mode;
    root.classList.toggle('dark', mode === 'dark' || (mode === 'system' && systemDark.matches));
    syncThemeControls();
  }

  /** Centre of the first visible element in `candidates`, or null when none is laid out. */
  function originOf(...candidates) {
    for (const el of candidates) {
      const r = el?.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  }

  function changeTheme(mode, origin) {
    const dark = mode === 'dark' || (mode === 'system' && systemDark.matches);
    const reveal = duration('reveal');
    if (dark === root.classList.contains('dark') || !origin || reveal === 0 || typeof document.startViewTransition !== 'function') {
      applyTheme(mode);
      return;
    }
    const radius = Math.hypot(Math.max(origin.x, window.innerWidth - origin.x), Math.max(origin.y, window.innerHeight - origin.y));
    const transition = document.startViewTransition(() => applyTheme(mode));
    transition.ready
      .then(() =>
        root.animate(
          { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${radius}px at ${origin.x}px ${origin.y}px)`] },
          { duration: reveal, easing: EASE_IN, pseudoElement: '::view-transition-new(root)' },
        ),
      )
      .catch(() => applyTheme(mode));
  }

  const accountButton = $('[data-popup="menu-user"]');
  const themeOrigin = () => originOf(...themeSwitches, accountButton);

  themeSwitches.forEach((el) =>
    el.addEventListener('click', () => changeTheme(root.classList.contains('dark') ? 'light' : 'dark', originOf(el))),
  );
  systemDark.addEventListener('change', () => themeMode === 'system' && applyTheme('system'));
  new window.MutationObserver(syncThemeControls).observe(root, { attributes: true, attributeFilter: ['class'] });
  syncThemeControls();

  // ---------------------------------------------------------------------------------------------
  // Filters: state, chips and editors (13 sections 2 and 3)

  const RANK_BUCKETS = [
    ['1 to 3', 1, 3],
    ['4 to 10', 4, 10],
    ['11 to 20', 11, 20],
    ['21 to 50', 21, 50],
    ['51 to 100', 51, 100],
  ];
  const filters = { tag: ['crm'], intent: [], rank: ['1 to 3', '4 to 10', '11 to 20'] };
  const FIELD = {
    tag: { title: 'Tag', editor: 'ed-tag' },
    intent: { title: 'Intent', editor: 'ed-intent' },
    rank: { title: 'Rank', editor: 'ed-rank' },
  };

  function chipLabel(field) {
    const values = filters[field];
    if (field === 'rank') {
      const idx = values.map((v) => RANK_BUCKETS.findIndex((b) => b[0] === v)).sort((a, b) => a - b);
      const contiguous = idx.every((v) => v >= 0) && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
      if (contiguous && idx.length) return `Rank: ${RANK_BUCKETS[idx[0]][1]} to ${RANK_BUCKETS[idx[idx.length - 1]][2]}`;
    }
    if (values.length <= 2) return `${FIELD[field].title}: ${values.join(', ')}`;
    return `${FIELD[field].title}: ${values.length} selected`;
  }

  function renderChips() {
    const host = $('#chips');
    host.replaceChildren();
    let count = 0;
    for (const field of Object.keys(FIELD)) {
      if (!filters[field].length) continue;
      count += 1;
      const label = chipLabel(field);
      const chip = document.createElement('span');
      chip.className = 'flex h-control max-w-60 pl-1 pr-1 rounded-md bg-neutral-subtle items-center gap-0.5 type-body text-foreground';
      const edit = document.createElement('button');
      edit.className = 'h-7 min-w-0 px-2 rounded-sm truncate hover:bg-surface-hover';
      edit.textContent = label;
      edit.dataset.popup = FIELD[field].editor;
      edit.setAttribute('aria-haspopup', 'dialog');
      edit.dataset.tip = `Edit filter ${label}`;
      const remove = document.createElement('button');
      remove.className = 'size-7 shrink-0 rounded-sm flex items-center justify-center text-foreground-tertiary hover:bg-surface-hover hover:text-foreground';
      remove.setAttribute('aria-label', `Remove filter ${label}`);
      remove.dataset.tip = 'Remove filter';
      remove.append(icon('x', 'size-icon-sm'));
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        filters[field] = [];
        renderChips();
        $('#add-filter')?.focus();
      });
      chip.append(edit, remove);
      host.append(chip);
    }
    $$('[data-filter-count]').forEach((el) => {
      el.textContent = String(count);
      el.hidden = count === 0;
    });
    const clear = $('#clear-filters');
    if (clear) clear.hidden = count === 0;
    const active = $('#filter-sheet .type-subsection-title');
    if (active) active.textContent = `Active (${count})`;
  }

  function editorField(panel) {
    return Object.keys(FIELD).find((k) => FIELD[k].editor === panel.id);
  }

  const editorSelection = (panel) => $$('input[type="checkbox"]', panel).filter((b) => b.checked).map((b) => b.dataset.value);

  /** Apply is enabled only when the ticked set differs from the applied filter; Clear only when something is ticked. */
  function updateEditorFooter(panel) {
    const applied = new Set(filters[editorField(panel)]);
    const selected = editorSelection(panel);
    const changed = selected.length !== applied.size || selected.some((v) => !applied.has(v));
    $('[data-apply]', panel).disabled = !changed;
    $('[data-clear]', panel).disabled = selected.length === 0;
  }

  function syncEditor(panel) {
    const field = editorField(panel);
    $$('input[type="checkbox"]', panel).forEach((box) => (box.checked = filters[field].includes(box.dataset.value)));
    const search = $('[data-editor-search]', panel);
    if (search) {
      search.value = '';
      $$('[data-options] label', panel).forEach((row) => (row.hidden = false));
    }
    updateEditorFooter(panel);
  }

  function applyEditor(panel) {
    const field = editorField(panel);
    filters[field] = editorSelection(panel);
    renderChips();
  }

  $$('[data-editor]').forEach((panel) => {
    $('[data-select-all]', panel)?.addEventListener('click', () => {
      $$('[data-options] label:not([hidden]) input', panel).forEach((b) => (b.checked = true));
      updateEditorFooter(panel);
    });
    $('[data-clear]', panel)?.addEventListener('click', () => {
      $$('input[type="checkbox"]', panel).forEach((b) => (b.checked = false));
      updateEditorFooter(panel);
      $('[data-apply]', panel).focus();
    });
    $('[data-options]', panel)?.addEventListener('change', () => updateEditorFooter(panel));
    $('[data-apply]', panel)?.addEventListener('click', () => {
      applyEditor(panel);
      closePopup();
    });
    $('[data-editor-search]', panel)?.addEventListener('input', (event) => {
      const q = event.target.value.trim().toLowerCase();
      $$('[data-options] label', panel).forEach((row) => (row.hidden = q !== '' && !row.textContent.toLowerCase().includes(q)));
    });
  });

  // "+ Filter": choosing a field opens its editor anchored to the "+ Filter" button
  document.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-open-editor]');
    if (!choice) return;
    event.stopPropagation();
    const editor = document.getElementById(choice.dataset.openEditor);
    const anchor = $('#add-filter');
    closePopup({ restoreFocus: false });
    const focus = editor.querySelector('[data-editor-search]') ?? editor.querySelector('input[type="checkbox"]');
    openPopup(editor, anchor, { focus });
  }, true);

  $('#clear-filters')?.addEventListener('click', () => {
    Object.keys(filters).forEach((k) => (filters[k] = []));
    renderChips();
    toast({ title: 'Filters cleared', tone: 'info', action: { label: 'Undo', run: () => location.reload() } });
  });

  renderChips();

  // ---------------------------------------------------------------------------------------------
  // Toasts (18 section 3): 360 px, bottom right, at most 3, newest at the bottom

  function toast({ title, description, tone = 'success', action }) {
    const host = $('#toasts');
    while (host.children.length >= 3) host.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = 'pointer-events-auto w-90 max-w-full min-h-12 px-3 py-2 rounded-lg border border-border bg-surface-elevated shadow-popover flex items-start gap-2';
    el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    el.append(icon(tone === 'success' ? 'circle-check' : 'info', `mt-2 size-icon shrink-0 ${tone === 'success' ? 'text-positive-text' : 'text-info-text'}`));
    const text = document.createElement('div');
    text.className = 'min-w-0 flex-1 py-1.5';
    const t = document.createElement('p');
    t.className = 'type-body-strong truncate';
    t.textContent = title;
    text.append(t);
    if (description) {
      const d = document.createElement('p');
      d.className = 'type-meta text-foreground-secondary line-clamp-2';
      d.textContent = description;
      text.append(d);
    }
    el.append(text);
    if (action) {
      const a = document.createElement('button');
      a.className = 'h-control-sm shrink-0 px-2 rounded-md type-body-strong text-primary-text hover:bg-surface-hover';
      a.textContent = action.label;
      a.addEventListener('click', () => {
        action.run();
        dismiss();
      });
      el.append(a);
    }
    const close = document.createElement('button');
    close.className = 'mt-1.5 size-6 shrink-0 rounded-md flex items-center justify-center text-foreground-tertiary hover:bg-surface-hover hover:text-foreground';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.append(icon('x', 'size-icon-sm'));
    el.append(close);
    const dismiss = () => exit(el, () => el.remove(), { to: 'translateY(8px)', speed: 'fast' });
    close.addEventListener('click', dismiss);
    host.append(el);
    enter(el, { from: 'translateY(8px)' });
    setTimeout(dismiss, action ? 8000 : 5000);
  }

  const TOASTS = {
    export: { title: 'Export started', description: 'keywords.csv downloads when it is ready, usually within a minute.' },
    link: { title: 'Link copied', description: 'The link keeps the current filters and date range.', tone: 'info' },
    check: { title: 'Check queued', description: 'Results arrive in about 2 minutes.', tone: 'info' },
    copy: { title: 'Keyword copied', tone: 'info' },
  };
  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-toast]');
    if (!el) return;
    toast(TOASTS[el.dataset.toast]);
    closePopup({ restoreFocus: false });
  });
  $('[data-toast-check]')?.addEventListener('click', () => toast(TOASTS.check));

  // ---------------------------------------------------------------------------------------------
  // Tooltips (16 section 6.1): 400 ms delay, instant for 300 ms after one closes, Esc closes, no touch

  const tip = $('#tooltip');
  let tipTimer = 0;
  let lastHidden = 0;
  let tipOwner = null;

  function showTooltip(target) {
    if (target.closest('[data-open]') && target.closest('[role="menu"]')) return;
    if (target.hasAttribute('data-tip-when-collapsed')) {
      const label = target.querySelector('span');
      if (label && getComputedStyle(label).position !== 'absolute') return;
    }
    tip.textContent = target.dataset.tip;
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const side = target.dataset.tipSide ?? (target.closest('header, thead, aside') ? 'bottom' : 'top');
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let left = side === 'right' ? r.right + 6 : r.left + r.width / 2 - w / 2;
    let top = side === 'right' ? r.top + r.height / 2 - h / 2 : side === 'bottom' ? r.bottom + 6 : r.top - h - 6;
    if (top < 8) top = r.bottom + 6;
    left = Math.min(Math.max(8, left), root.clientWidth - 8 - w);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tipOwner = target;
    if (Date.now() - lastHidden > 300) enter(tip, { from: 'none' });
  }
  function hideTooltip() {
    clearTimeout(tipTimer);
    if (!tip.hidden) lastHidden = Date.now();
    tip.hidden = true;
    tipOwner = null;
  }
  function scheduleTooltip(event) {
    const target = event.target.closest?.('[data-tip]');
    if (!target || target === tipOwner) return;
    if (event.pointerType === 'touch') return;
    clearTimeout(tipTimer);
    const delay = Date.now() - lastHidden < 300 ? 0 : 400;
    tipTimer = setTimeout(() => showTooltip(target), delay);
  }
  document.addEventListener('pointerover', scheduleTooltip);
  document.addEventListener('focusin', (event) => event.target.matches(':focus-visible') && scheduleTooltip(event));
  document.addEventListener('pointerout', (event) => {
    const target = event.target.closest?.('[data-tip]');
    if (target && !target.contains(event.relatedTarget)) hideTooltip();
  });
  document.addEventListener('focusout', hideTooltip);
  document.addEventListener('keydown', (event) => event.key === 'Escape' && hideTooltip());
  window.addEventListener('scroll', hideTooltip, true);
  $$('#sidebar a[title]').forEach((a) => {
    a.dataset.tip = a.getAttribute('title');
    a.dataset.tipSide = 'right';
    a.setAttribute('data-tip-when-collapsed', '');
    a.removeAttribute('title');
  });

  // ---------------------------------------------------------------------------------------------
  // Switches and count tabs

  document.addEventListener('click', (event) => {
    const sw = event.target.closest('[role="switch"]');
    if (!sw || sw.hasAttribute('data-theme-toggle')) return;
    const on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(on));
    sw.classList.toggle('bg-primary', on);
    sw.classList.toggle('justify-end', on);
    sw.classList.toggle('bg-border-strong', !on);
    sw.classList.toggle('justify-start', !on);
    // Auto-save switch (10 section 13.3): "Show setup checklist" applies at once on Overview
    if (sw.hasAttribute('data-setup-visible')) $('[data-setup]').hidden = !on;
    // Preferences: reduce motion zeroes the duration tokens (21 section 11); single-key shortcuts gate J, K and [
    if (sw.hasAttribute('data-pref-motion')) root.toggleAttribute('data-motion', on);
    if (sw.hasAttribute('data-pref-motion') && on) root.dataset.motion = 'reduced';
    if (sw.hasAttribute('data-pref-keys')) root.dataset.singleKeys = on ? 'on' : 'off';
  });

  const PRESSED = ['border-primary', 'bg-primary', 'text-primary-foreground', 'type-body-strong'];
  const UNPRESSED = ['border-border', 'bg-surface', 'text-foreground', 'type-body', 'hover:bg-surface-hover'];
  function setPressed(button, on) {
    button.setAttribute('aria-pressed', String(on));
    button.classList.remove(...(on ? UNPRESSED : PRESSED));
    button.classList.add(...(on ? PRESSED : UNPRESSED));
    const badge = button.querySelector('span');
    badge.classList.toggle('bg-primary-hover', on);
    badge.classList.toggle('bg-neutral-subtle', !on);
    badge.classList.toggle('text-neutral-text', !on);
  }
  $$('[data-count-tabs]').forEach((bar) => {
    const buttons = $$('button', bar);
    const all = buttons[0];
    buttons.forEach((button) =>
      button.addEventListener('click', () => {
        if (button === all) return buttons.forEach((b) => setPressed(b, b === all));
        setPressed(button, button.getAttribute('aria-pressed') !== 'true');
        const any = buttons.slice(1).some((b) => b.getAttribute('aria-pressed') === 'true');
        setPressed(all, !any);
      }),
    );
  });

  // Show intervals toggles the confidence band; the chart legend toggles series (15 section 2)
  $('#toggle-ci')?.addEventListener('change', (event) => charts.setCiVisible(event.target.checked));
  $$('[data-legend-value]').forEach((value) => {
    const item = value.closest('li');
    const name = item.textContent.replace(value.textContent, '').trim();
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-pressed', 'true');
    item.classList.add('cursor-pointer', 'rounded-sm', 'hover:text-foreground');
    const toggle = () => {
      const visible = charts.toggleSeries(name);
      item.setAttribute('aria-pressed', String(visible));
      item.classList.toggle('opacity-40', !visible);
    };
    item.addEventListener('click', toggle);
    item.addEventListener('keydown', (event) => (event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), toggle()));
  });

  // Notifications: mark all read, unread filter
  $('[data-mark-read]')?.addEventListener('click', () => {
    $$('[data-unread] > span:first-child').forEach((dot) => dot.classList.remove('bg-primary'));
    $$('[data-unread]').forEach((el) => el.removeAttribute('data-unread'));
    const bell = $('[data-popup="pop-notifications"]');
    bell.setAttribute('aria-label', 'Notifications');
    bell.querySelector('span[aria-hidden]')?.remove();
    const unread = $$('#pop-notifications [role="radio"]')[1];
    if (unread) unread.textContent = 'Unread';
  });
  $$('#pop-notifications [role="radio"]').forEach((segment, i) =>
    segment.addEventListener('click', () =>
      $$('#pop-notifications a[class*="flex gap-3"]').forEach((row) => (row.hidden = i === 1 && !row.hasAttribute('data-unread'))),
    ),
  );

  // ---------------------------------------------------------------------------------------------
  // Keyword data for the inspector and palette

  const KEYWORDS = {
    k1: { kw: 'crm for small business', rank: 4, change: '↑3', tone: 'positive-text', best: 3, avg: 5.6, vol: '9,900', url: '/crm/small-business', aio: 'Cited #2', spark: [9, 9, 8, 8, 7, 7, 6, 6, 6, 5, 5, 5, 4, 4, 4] },
    k2: { kw: 'best crm for startups', rank: 3, change: '↑2', tone: 'positive-text', best: 2, avg: 4.8, vol: '8,100', url: '/crm/startups', aio: 'Cited #1', spark: [9, 8, 8, 7, 7, 6, 5, 5, 4, 4, 4, 3, 3, 3, 3] },
    k3: { kw: 'sales pipeline software', rank: 8, change: '0', tone: 'foreground-secondary', best: 7, avg: 7.9, vol: '6,600', url: '/features/pipeline', aio: 'Present', spark: [7, 8, 8, 7, 8, 9, 8, 8, 7, 8, 8, 8, 7, 8, 8] },
    k4: { kw: 'crm tools for startups', rank: 5, change: '↓2', tone: 'negative-text', best: 3, avg: 4.1, vol: '4,400', url: '/blog/crm-tools-for-startups', aio: 'Absent', spark: [3, 3, 4, 3, 4, 4, 3, 4, 4, 5, 4, 5, 5, 4, 5] },
    k5: { kw: 'startup crm', rank: null, change: 'Lost', tone: 'negative-text', best: 12, avg: 16.4, vol: '5,400', url: null, aio: 'Absent', spark: [12, 13, 13, 14, 15, 16, 17, 18, 18, 19, 19, 20, null, null, null] },
    k6: { kw: 'best sales crm', rank: 11, change: 'New', tone: 'positive-text', best: 11, avg: 14.2, vol: '8,100', url: '/crm', aio: 'Present', spark: [null, null, null, null, null, 19, 18, 16, 15, 14, 13, 12, 12, 11, 11] },
  };
  const ORDER = Object.keys(KEYWORDS);
  const ENGINE_NAMES = ['ChatGPT', 'Gemini', 'AI Mode', 'AI Overview'];
  // EngineLogo (07 section 5): a 16 px mark beside the engine's name. Decorative, because the name is always there.
  // Both Google surfaces use the Google mark; the monochrome OpenAI mark is inverted in the dark theme.
  const ENGINE_LOGOS = { ChatGPT: 'chatgpt', Gemini: 'gemini', 'AI Mode': 'google', 'AI Overview': 'google' };
  function engineLogo(name) {
    const img = document.createElement('img');
    img.src = `./vendor/logos/${ENGINE_LOGOS[name]}.svg`;
    img.alt = '';
    img.width = 16;
    img.height = 16;
    img.className = `size-icon shrink-0${ENGINE_LOGOS[name] === 'chatgpt' ? ' dark:invert' : ''}`;
    return img;
  }
  const AI_MENTIONS = {
    k1: [[8, 12], [3, 4], [5, 12], [9, 14]],
    k2: [[10, 12], [3, 4], [7, 12], [12, 14]],
    k3: [[4, 12], [1, 4], [3, 12], [5, 14]],
    k4: [[6, 12], [2, 4], [2, 12], [0, 14]],
    k5: [[1, 12], [0, 4], [0, 12], [0, 0]],
    k6: [[5, 12], [2, 4], [4, 12], [6, 14]],
  };
  const COMPETITORS = [
    ['hubspot.com', 1, '0'],
    ['pipedrive.com', 5, '↑1'],
    ['attio.com', 9, '↓2'],
    ['zoho.com', 12, '↑3'],
    ['folk.app', 17, '0'],
  ];
  const SERP = [
    ['hubspot.com', 'The best CRM software in 2026'],
    ['zoho.com', 'Best CRM for startups'],
    ['northwind.com', 'Northwind: CRM for startups'],
    ['pipedrive.com', 'Pipedrive CRM review'],
    ['attio.com', 'Attio: the CRM for modern teams'],
  ];

  // ---------------------------------------------------------------------------------------------
  // Inspector (16 section 2): a floating card 12 px from the window edges. It docks when the viewport leaves 360 px
  // beside a 720 px main column and the margin, overlays from 768 px, and is a full-screen sheet below 768 px.

  const inspector = $('#inspector');
  const scrim = $('#inspector-scrim');
  let inspectorId = null;
  let inspectorChart = null;
  let lastOpener = null;
  const MODES = {
    docked: ['sticky', 'my-3', 'mr-3', 'shrink-0', 'w-inspector', 'z-(--z-inspector)', 'rounded-xl', 'shadow-inspector'],
    overlay: ['fixed', 'right-3', 'bottom-3', 'w-inspector', 'max-w-full', 'z-(--z-drawer)', 'rounded-xl', 'shadow-inspector'],
    sheet: ['fixed', 'inset-0', 'w-full', 'z-(--z-drawer)', 'border-0'],
  };
  // Heights and offsets that depend on the viewport or the top bar are set inline (no arbitrary utility values).
  // Docked and overlay both start 12 px under the top bar, which always spans the full width.
  const MODE_STYLES = {
    docked: { top: 'calc(var(--size-topbar) + 0.75rem)', height: 'calc(100dvh - var(--size-topbar) - 1.5rem)' },
    overlay: { top: 'calc(var(--size-topbar) + 0.75rem)', height: '' },
    sheet: { top: '', height: '' },
  };
  const INSPECTOR_MARGIN = 12;
  const ALL_MODE_CLASSES = [...new Set(Object.values(MODES).flat())];

  function inspectorMode() {
    const vw = root.clientWidth;
    // The spacer holds the sidebar's layout width (0 below 1024 px, 56 px for the rail, 208 px expanded).
    const sidebarWidth = $('#sidebar-spacer')?.getBoundingClientRect().width ?? 0;
    const available = vw - sidebarWidth - 720 - INSPECTOR_MARGIN;
    if (available >= 360) return { mode: 'docked', width: Math.min(400, available) };
    if (vw >= 768) return { mode: 'overlay' };
    return { mode: 'sheet' };
  }

  function layoutInspector() {
    if (inspector.hidden) return;
    const { mode, width } = inspectorMode();
    inspector.classList.remove(...ALL_MODE_CLASSES);
    inspector.classList.add(...MODES[mode]);
    inspector.style.width = mode === 'docked' && width < 400 ? `${width}px` : '';
    Object.assign(inspector.style, MODE_STYLES[mode]);
    inspector.dataset.mode = mode;
    scrim.hidden = mode !== 'sheet';
    inspector.setAttribute('aria-modal', String(mode === 'sheet'));
    inspectorChart?.resize();
  }

  function badge(text, variant = 'neutral') {
    const el = document.createElement('span');
    el.className =
      variant === 'positive'
        ? 'h-badge inline-flex items-center px-2 rounded-sm bg-positive-subtle text-positive-text type-micro'
        : 'h-badge inline-flex items-center px-2 rounded-sm border border-neutral-border bg-neutral-subtle text-neutral-text type-micro';
    el.textContent = text;
    return el;
  }

  /** One metric card: label, value, then a delta or a short context line. */
  function metricCard(label, value, ...notes) {
    const card = document.createElement('div');
    card.className = 'rounded-lg border border-border bg-surface p-3 min-w-0';
    const dt = document.createElement('dt');
    dt.className = 'type-label truncate';
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.className = 'mt-1 flex flex-col min-w-0';
    const v = document.createElement('span');
    v.className = 'type-metric-sm num truncate';
    v.textContent = value;
    const line = document.createElement('span');
    line.className = 'mt-0.5 flex items-baseline gap-1.5 min-w-0 type-meta num';
    line.append(...notes);
    dd.append(v, line);
    card.append(dt, dd);
    return card;
  }
  function note(text, className = 'truncate') {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    return el;
  }

  /** One engine row: name, share bar on a track, percent, and the counts behind it. */
  function engineRow(name, [mentions, responses]) {
    const row = document.createElement('li');
    row.className = 'h-9 flex items-center gap-3';
    const share = responses === 0 ? null : Math.round((mentions / responses) * 100);
    const label = document.createElement('span');
    label.className = 'w-28 shrink-0 flex items-center gap-2 min-w-0 type-body text-foreground';
    const text = document.createElement('span');
    text.className = 'truncate';
    text.textContent = name;
    label.append(engineLogo(name), text);
    const track = document.createElement('span');
    track.className = 'flex-1 h-2 rounded-full bg-neutral-subtle overflow-hidden';
    track.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('span');
    fill.className = 'block h-full rounded-full bg-primary';
    fill.style.width = `${share ?? 0}%`;
    track.append(fill);
    const value = document.createElement('span');
    value.className = `w-10 shrink-0 text-right type-table num${share === null ? ' text-foreground-tertiary' : ''}`;
    value.textContent = share === null ? 'n/a' : `${share}%`;
    const counts = document.createElement('span');
    counts.className = 'w-14 shrink-0 text-right type-meta num';
    counts.textContent = share === null ? 'no data' : `${mentions} of ${responses}`;
    row.append(label, track, value, counts);
    return row;
  }

  function fillInspector(id) {
    const k = KEYWORDS[id];
    $('#inspector-title').textContent = k.kw;
    const badges = $('[data-inspector-badges]');
    badges.replaceChildren(badge('US · Desktop'), badge('Depth 20'), ...(k.aio.startsWith('Cited') ? [badge(k.aio, 'positive')] : []));
    $('[data-inspector-context]').textContent = `Keyword · ${ORDER.indexOf(id) + 1} of ${ORDER.length} · Updated 12m ago`;
    $('[data-inspector-kv]').replaceChildren(
      metricCard('Rank', k.rank === null ? '>20' : String(k.rank), note(k.change, `shrink-0 type-body-strong text-${k.tone}`), note(`best ${k.best}`)),
      metricCard('Average rank', String(k.avg), note('30 days')),
      metricCard('Volume', k.vol, note('per month')),
    );
    $('[data-inspector-engines]').replaceChildren(...ENGINE_NAMES.map((name, i) => engineRow(name, AI_MENTIONS[id][i])));
    $('[data-inspector-competitors]').replaceChildren(
      ...COMPETITORS.map(([domain, rank, delta]) => {
        const tr = document.createElement('tr');
        tr.className = 'h-row-compact border-t border-border-subtle';
        const tone = delta.startsWith('↑') ? 'text-positive-text' : delta.startsWith('↓') ? 'text-negative-text' : 'text-foreground-secondary';
        tr.innerHTML = `<td class="pl-4 truncate">${domain}</td><td class="text-right num">${rank}</td><td class="pr-4 text-right num ${tone}">${delta}</td>`;
        return tr;
      }),
    );
    $('[data-inspector-serp]').replaceChildren(
      ...SERP.map(([domain, title], i) => {
        const tr = document.createElement('tr');
        const own = domain === 'northwind.com';
        tr.className = `h-row-compact border-t border-border-subtle${own ? ' bg-surface-selected' : ''}`;
        tr.innerHTML = `<td class="pl-4 num">${i + 1}</td><td class="truncate${own ? ' text-primary-text' : ''}">${domain}</td><td class="pr-4 truncate max-w-40${own ? ' text-primary-text' : ''}">${title}</td>`;
        return tr;
      }),
    );
    const aio = $('[data-inspector-aio]');
    aio.replaceChildren(k.aio.startsWith('Cited') ? badge(k.aio, 'positive') : badge(k.aio));
    renderInspectorChart(k);
  }

  // Rank history: one check every two days, ending Sep 29. The 30-day series is the fixture; the 60 days
  // before it and the two competitor lines are generated the same way every time.
  const clampRank = (value) => Math.min(20, Math.max(1, Math.round(value)));
  function rankSeries(spark, points) {
    const extra = points - spark.length;
    const first = spark.find((v) => v !== null);
    const earlier = Array.from({ length: extra }, (_, i) =>
      spark[0] === null ? null : clampRank(first + (extra - i) * 0.12 + Math.sin(i * 1.3) * 0.9),
    );
    return [...earlier, ...spark];
  }
  const competitorSeries = (rank, phase, points) =>
    Array.from({ length: points }, (_, i) => clampRank(rank + Math.sin(i * 0.8 + phase) * (0.6 + phase * 0.4)));
  function rankLabels(points) {
    const end = Date.UTC(2026, 8, 29);
    const format = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return Array.from({ length: points }, (_, i) => format.format(new Date(end - (points - 1 - i) * 2 * 86400000)));
  }

  function renderInspectorChart(k) {
    const el = $('#chart-inspector');
    if (!el || !charts || el.clientWidth === 0) return;
    inspectorChart ??= echarts.init(el, null, { renderer: 'canvas' });
    const axes = charts.axisTheme();
    const points = Number($('#inspector-window').dataset.value) / 2;
    const labels = rankLabels(points);
    const line = (name, token, symbol, data, width) => ({
      name,
      type: 'line',
      data,
      connectNulls: false,
      color: charts.token(token),
      lineStyle: { width, join: 'round' },
      symbol,
      symbolSize: 5,
      showSymbol: false,
      emphasis: { disabled: true },
    });
    inspectorChart.setOption(
      {
        animation: false,
        grid: { ...charts.GRID, right: 48 },
        xAxis: { type: 'category', data: labels, boundaryGap: false, ...axes.x, axisLabel: { ...axes.x.axisLabel, interval: Math.ceil(points / 4) - 1 } },
        yAxis: { type: 'value', inverse: true, min: 1, max: 20, ...axes.y, splitLine: { show: false }, axisLabel: { ...axes.y.axisLabel, customValues: [1, 10, 20] } },
        tooltip: charts.tooltipTheme((list) =>
          list.map((p) => ({ color: p.color, name: p.seriesName, value: p.value === null || p.value === undefined ? 'Not in top 20' : `#${p.value}` })),
        ),
        series: [
          {
            ...line('northwind.com', 'chart-1', 'circle', rankSeries(k.spark, points), 2),
            markLine: {
              silent: true,
              symbol: 'none',
              lineStyle: { color: charts.token('chart-axis'), type: 'dashed', width: 1 },
              label: { color: charts.token('chart-label'), fontFamily: charts.fontFamily(), fontSize: 12, position: 'end', distance: 6 },
              data: [{ yAxis: 3, label: { formatter: 'Top 3' } }, { yAxis: 10, label: { formatter: 'Top 10' } }],
            },
          },
          line('hubspot.com', 'chart-2', 'rect', competitorSeries(2, 0.4, points), 1.5),
          line('pipedrive.com', 'chart-3', 'triangle', competitorSeries(6, 1.7, points), 1.5),
        ],
      },
      true,
    );
    inspectorChart.resize();
  }
  $('#inspector-window')?.addEventListener('change', () => inspectorId && renderInspectorChart(KEYWORDS[inspectorId]));
  $('[data-inspector-goto]')?.addEventListener('click', (event) => selectTab(event.currentTarget.dataset.inspectorGoto));

  function setActiveRow(id) {
    $$('[data-selectable] tbody tr').forEach((row) => {
      if (row.dataset.id === id) row.setAttribute('data-active', 'true');
      else row.removeAttribute('data-active');
      const cell = row.firstElementChild;
      const edge = ['relative', 'before:absolute', 'before:inset-y-0', 'before:left-0', 'before:w-0.5', 'before:bg-primary'];
      cell.classList.toggle('relative', row.dataset.id === id);
      edge.slice(1).forEach((c) => cell.classList.toggle(c, row.dataset.id === id));
    });
    $$('#rank-list [data-open-id]').forEach((a) => {
      const on = a.dataset.openId === id;
      a.classList.toggle('bg-surface-selected', on);
      a.querySelector('.type-body-strong')?.classList.toggle('text-primary-text', on);
    });
    charts?.syncRows();
  }

  function openInspector(id, opener) {
    if (!KEYWORDS[id]) return;
    const wasHidden = inspector.hidden;
    inspectorId = id;
    if (opener) lastOpener = opener;
    inspector.hidden = false;
    layoutInspector();
    fillInspector(id);
    setActiveRow(id);
    selectTab('overview');
    const url = new URL(location.href);
    url.searchParams.set('inspect', `keyword:${id}`);
    history.replaceState(null, '', url);
    if (wasHidden) {
      const mode = inspector.dataset.mode;
      if (mode === 'docked') enter(inspector, { from: 'none', speed: 'slow' });
      else enter(inspector, { from: mode === 'sheet' ? 'translateY(24px)' : 'translateX(24px)', speed: 'slow' });
      requestAnimationFrame(() => $('#inspector-title').focus?.());
      window.dispatchEvent(new window.Event('resize'));
    }
  }

  /**
   * Closes the inspector. Unsaved work in it (a customized card layout) is asked about first, unless forced.
   * `then` runs once it really closes, so a caller's follow-up does not happen when the person keeps editing.
   */
  function closeInspector(force, then) {
    if (inspector.hidden) return;
    const after = typeof then === 'function' ? then : null;
    if (force !== true && blockedByGuard('inspector', () => closeInspector(true, after))) return;
    after?.();
    window.dispatchEvent(new window.Event('inspector-close'));
    const mode = inspector.dataset.mode;
    const done = () => {
      inspector.hidden = true;
      scrim.hidden = true;
      setActiveRow(null);
      const url = new URL(location.href);
      url.searchParams.delete('inspect');
      history.replaceState(null, '', url);
      window.dispatchEvent(new window.Event('resize'));
      if (lastOpener?.isConnected && lastOpener.offsetParent !== null) lastOpener.focus({ preventScroll: true });
    };
    if (mode === 'docked') done();
    else exit(inspector, done, { to: mode === 'sheet' ? 'translateY(24px)' : 'translateX(24px)', speed: 'base' });
  }

  function step(delta) {
    if (!inspectorId) return;
    const rows = $$('[data-selectable] tbody tr').map((r) => r.dataset.id);
    const next = rows[(rows.indexOf(inspectorId) + delta + rows.length) % rows.length];
    openInspector(next);
  }

  /**
   * Leave guards (10 section 13.2). A guard is asked before the page navigates ('route') or the inspector
   * closes ('inspector'). It returns null, or what to say and do: { message, onKeep, onDiscard }.
   */
  const leaveGuards = [];
  function blockedByGuard(kind, proceed) {
    let pending = null;
    for (const guard of leaveGuards) {
      pending = guard(kind);
      if (pending) break;
    }
    if (!pending) return false;
    askDiscard(pending.message, {
      owner: pending.owner,
      onKeep: pending.onKeep,
      onDiscard: () => {
        pending.onDiscard();
        proceed();
      },
    });
    return true;
  }

  function selectTab(name) {
    $$('#inspector [role="tab"]').forEach((tab) => {
      const on = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(on));
      tab.classList.toggle('border-primary', on);
      tab.classList.toggle('border-transparent', !on);
      tab.classList.toggle('type-body-strong', on);
      tab.classList.toggle('type-body', !on);
      tab.classList.toggle('text-primary-text', on);
      tab.classList.toggle('text-foreground-secondary', !on);
      tab.tabIndex = on ? 0 : -1;
    });
    $$('#inspector [role="tabpanel"]').forEach((panel) => (panel.hidden = panel.dataset.panel !== name));
    if (name === 'overview') requestAnimationFrame(() => inspectorChart?.resize());
  }

  $$('#inspector [role="tab"]').forEach((tab, i, all) => {
    tab.addEventListener('click', () => selectTab(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const next = all[(i + (event.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
      next.focus();
      selectTab(next.dataset.tab);
    });
  });
  $('[data-inspector-close]')?.addEventListener('click', closeInspector);
  $('[data-inspector-back]')?.addEventListener('click', closeInspector);
  $('[data-inspector-prev]')?.addEventListener('click', () => step(-1));
  $('[data-inspector-next]')?.addEventListener('click', () => step(1));
  scrim?.addEventListener('click', closeInspector);
  window.addEventListener('resize', layoutInspector);
  if (window.ResizeObserver && $('#chart-inspector')) new ResizeObserver(() => inspectorChart?.resize()).observe($('#chart-inspector'));

  // Rows open the inspector; checkboxes and buttons inside rows keep their own behavior
  $('[data-selectable] tbody')?.addEventListener('click', (event) => {
    if (event.target.closest('input, button, a')) return;
    const row = event.target.closest('tr');
    if (row) openInspector(row.dataset.id, row);
  });
  $$('#rank-list [data-open-id]').forEach((a) =>
    a.addEventListener('click', (event) => {
      event.preventDefault();
      openInspector(a.dataset.openId, a);
    }),
  );

  // Row menus: the More button and right-click (16 section 5.4)
  let rowMenuId = null;
  // "Customize cards" belongs to the drawer's More menu, not to a table row's menu
  function setInspectorOnlyItems(fromInspector) {
    $$('#menu-row [data-inspector-only]').forEach((el) => (el.hidden = !fromInspector));
  }
  function setRowMenuTarget(id) {
    rowMenuId = id;
    const label = $('[data-row-menu-label]');
    if (label && KEYWORDS[id]) label.textContent = KEYWORDS[id].kw;
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-row-menu]');
    if (!button) return;
    event.stopPropagation();
    const row = button.closest('tr');
    setRowMenuTarget(row.dataset.id);
    setInspectorOnlyItems(false);
    openPopup($('#menu-row'), button, { align: 'end' });
  }, true);
  $('[data-selectable] tbody')?.addEventListener('contextmenu', (event) => {
    if (event.shiftKey) return;
    const row = event.target.closest('tr');
    if (!row) return;
    event.preventDefault();
    setRowMenuTarget(row.dataset.id);
    setInspectorOnlyItems(false);
    openPopup($('#menu-row'), row, { point: { x: event.clientX, y: event.clientY } });
  });
  $('[data-row-open]')?.addEventListener('click', () => {
    closePopup({ restoreFocus: false });
    if (rowMenuId) openInspector(rowMenuId);
  });
  // Archive hides the keyword's table row and mobile list row; Undo in the toast brings both back.
  $('[data-row-archive]')?.addEventListener('click', () => {
    closePopup({ restoreFocus: false });
    const id = rowMenuId;
    if (!id) return;
    const rows = [...$$(`tr[data-id="${id}"]`), ...$$(`[data-open-id="${id}"]`).map((a) => a.closest('li') ?? a)];
    const archive = () => {
      rows.forEach((el) => (el.hidden = true));
      toast({
        title: 'Keyword archived',
        description: 'Its history is kept for 90 days.',
        action: { label: 'Undo', run: () => { rows.forEach((el) => (el.hidden = false)); toast({ title: 'Keyword restored' }); } },
      });
    };
    // The keyword open in the inspector is archived only once the inspector has closed: with unsaved card
    // changes the person is asked first, and "Keep editing" archives nothing
    if (inspectorId === id && !inspector.hidden) closeInspector(false, archive);
    else archive();
  });

  // ---------------------------------------------------------------------------------------------
  // Sorting (12 section 7): click toggles ascending and descending; aria-sort on the header cell

  const sortState = { key: 'rank', dir: 'ascending' };
  function sortRows(key) {
    sortState.dir = sortState.key === key && sortState.dir === 'ascending' ? 'descending' : 'ascending';
    sortState.key = key;
    const tbody = $('[data-selectable] tbody');
    const rows = $$('tr', tbody);
    rows.sort((a, b) => {
      const diff = Number(a.dataset[key]) - Number(b.dataset[key]);
      return sortState.dir === 'ascending' ? diff : -diff;
    });
    tbody.append(...rows);
    $$('[data-sort]').forEach((button) => {
      const th = button.closest('th');
      const active = button.dataset.sort === key;
      th.setAttribute('aria-sort', active ? sortState.dir : 'none');
      const old = button.querySelector('svg');
      const name = !active ? 'arrow-up-down' : sortState.dir === 'ascending' ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow';
      old.replaceWith(icon(name, `size-icon-xs${active ? '' : ' text-foreground-muted'}`));
      button.classList.toggle('text-foreground', active);
    });
  }
  $$('[data-sort]').forEach((button) => button.addEventListener('click', () => sortRows(button.dataset.sort)));

  // ---------------------------------------------------------------------------------------------
  // Modal helpers: position at 12vh (minimum 48 px), trap focus, return focus

  // The panel is marked with data-dialog-panel; popups that must stack above it may follow it in the dialog
  const modalPanel = (dialog) => $('[data-dialog-panel]', dialog) ?? dialog.lastElementChild;
  function openModal(dialog) {
    dialog.hidden = false;
    dialog.style.paddingTop = 'max(3rem, 12vh)';
    const panel = modalPanel(dialog);
    panel.style.maxHeight = 'calc(100dvh - max(3rem, 12vh) - 3rem)';
    enter(panel, { from: 'translateY(8px)', speed: 'slow' });
    const scrimEl = dialog.firstElementChild;
    enter(scrimEl, { from: 'none', speed: 'slow' });
  }
  function closeModal(dialog, done) {
    const panel = modalPanel(dialog);
    exit(panel, () => {
      dialog.hidden = true;
      done?.();
    }, { to: 'translateY(8px)', speed: 'base' });
  }
  function trapFocus(dialog, event) {
    if (event.key !== 'Tab') return;
    const items = focusables(dialog);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // Listbox popups shared by the Select and Combobox demos (10 sections 6.2 and 6.3)

  function openListbox(listbox, trigger, anchor, focus) {
    listbox.style.minWidth = `${anchor.getBoundingClientRect().width}px`;
    openPopup(listbox, trigger, { anchor, focus, onClose: () => listbox.dispatchEvent(new window.Event('listbox-close')) });
  }
  function selectOption(listbox, value) {
    $$('[role="option"]', listbox).forEach((o) => o.setAttribute('aria-selected', String(o.dataset.value === value)));
  }
  // Typing a letter in an open listbox jumps to the next option that starts with it (APG select-only combobox)
  $$('[data-listbox]').forEach((listbox) =>
    listbox.addEventListener('keydown', (event) => {
      if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
      const options = $$('[role="option"]:not([hidden])', listbox);
      const from = options.indexOf(document.activeElement);
      const letter = event.key.toLowerCase();
      const match = [...options.slice(from + 1), ...options.slice(0, from + 1)].find((o) => o.dataset.value.toLowerCase().startsWith(letter));
      match?.focus();
    }),
  );

  // Select (10 section 6.2): any trigger with data-select="<listbox id>". Enter, Space or an arrow key opens it
  // with the selected option focused; choosing an option updates the trigger and dispatches "change" on it.
  // One listbox can serve several triggers (the Replicates selects in Settings).
  let selectOwner = null;
  const selectListbox = (trigger) => document.getElementById(trigger.dataset.select);
  function setSelectValue(trigger, value) {
    const option = $$('[role="option"]', selectListbox(trigger)).find((o) => o.dataset.value === String(value));
    if (!option) return;
    trigger.dataset.value = option.dataset.value;
    $('[data-select-value]', trigger).textContent = option.textContent.trim();
  }
  function openSelect(trigger) {
    const listbox = selectListbox(trigger);
    selectOwner = trigger;
    // Lets the owner adjust the shared listbox first (a card's Width select offers only the widths it allows)
    trigger.dispatchEvent(new window.Event('select-open', { bubbles: true }));
    selectOption(listbox, trigger.dataset.value);
    openListbox(listbox, trigger, trigger, $('[aria-selected="true"]', listbox) ?? $('[role="option"]', listbox));
  }
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-select]');
    if (trigger && !trigger.disabled) {
      if (current?.panel === selectListbox(trigger) && selectOwner === trigger) closePopup();
      else openSelect(trigger);
      return;
    }
    const option = event.target.closest('[data-listbox] [role="option"]');
    if (!option || !selectOwner || option.closest('[data-listbox]') !== selectListbox(selectOwner)) return;
    const owner = selectOwner;
    const changed = owner.dataset.value !== option.dataset.value;
    setSelectValue(owner, option.dataset.value);
    closePopup();
    if (changed) owner.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  document.addEventListener('keydown', (event) => {
    const trigger = event.target.closest?.('[data-select]');
    if (!trigger || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    if (current?.panel !== selectListbox(trigger)) openSelect(trigger);
  });

  const languageTrigger = $('#kw-language');
  const setLanguage = (value) => setSelectValue(languageTrigger, value);

  // Location: Combobox. Typing filters; choosing a location sets the default language; text that matches no
  // location reverts to the last valid value when the list closes.
  const LANGUAGE_BY_COUNTRY = { Germany: 'German', France: 'French', Spain: 'Spanish', Netherlands: 'Dutch' };
  const locationInput = $('#kw-location');
  const locationList = $('#lb-location');
  const locationAnchor = $('[data-combobox-anchor]');
  const locationEmpty = $('[data-listbox-empty]', locationList);

  function filterLocations(query) {
    const q = query.trim().toLowerCase();
    let shown = 0;
    $$('[role="group"]', locationList).forEach((group) => {
      let groupShown = 0;
      $$('[role="option"]', group).forEach((option) => {
        option.hidden = q !== '' && !option.dataset.value.toLowerCase().includes(q);
        if (!option.hidden) groupShown += 1;
      });
      group.hidden = groupShown === 0;
      group.previousElementSibling.hidden = groupShown === 0;
      shown += groupShown;
    });
    locationEmpty.hidden = shown > 0;
    locationEmpty.textContent = shown > 0 ? '' : `No locations match “${query.trim()}”`;
  }
  function openLocations() {
    if (current?.panel === locationList) return;
    openListbox(locationList, locationInput, locationAnchor, locationInput);
  }
  function setLocation(value) {
    locationInput.value = value;
    locationInput.dataset.value = value;
    selectOption(locationList, value);
    const country = value.includes(', ') ? value.split(', ').pop() : value;
    setLanguage(LANGUAGE_BY_COUNTRY[country] ?? 'English');
  }
  locationInput?.addEventListener('focus', () => filterLocations(''));
  locationInput?.addEventListener('input', () => {
    filterLocations(locationInput.value);
    openLocations();
  });
  locationInput?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && current?.panel !== locationList) {
      event.preventDefault();
      filterLocations('');
      openLocations();
    } else if (event.key === 'Enter') {
      // Enter chooses the first match instead of submitting the form
      event.preventDefault();
      const first = $('[role="option"]:not([hidden])', locationList);
      if (current?.panel === locationList && first && !first.closest('[hidden]')) {
        setLocation(first.dataset.value);
        closePopup();
      }
    }
  });
  $('[data-combobox-toggle]')?.addEventListener('click', () => {
    if (current?.panel === locationList) return closePopup();
    filterLocations('');
    locationInput.focus();
    openLocations();
  });
  locationList?.addEventListener('click', (event) => {
    const option = event.target.closest('[role="option"]');
    if (!option) return;
    setLocation(option.dataset.value);
    closePopup();
  });
  locationList?.addEventListener('listbox-close', () => {
    if (locationInput.value !== locationInput.dataset.value) locationInput.value = locationInput.dataset.value;
  });

  // Add keywords dialog (16 section 4, 10 section 25.1) with the discard confirmation for a dirty form
  const addDialog = $('#dlg-add');
  const discard = $('#dlg-discard');
  const input = $('#kw-input');
  const submit = $('[data-add-submit]');
  const TRACKED = new Set(Object.values(KEYWORDS).map((k) => k.kw.toLowerCase()));
  const QUOTA = { used: 1000, limit: 2000 };
  const number = new Intl.NumberFormat('en-US');
  let addOpener = null;

  const keywordLines = () => [...new Set(input.value.split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean))];
  const keywordCount = () => keywordLines().length;
  const device = () => $('[data-kw-device] [aria-checked="true"]')?.dataset.value ?? 'desktop';

  function refreshAdd() {
    const lines = keywordLines();
    const tracked = lines.filter((l) => TRACKED.has(l)).length;
    const fresh = lines.length - tracked;
    const perKeyword = device() === 'both' ? 2 : 1;
    const adding = fresh * perKeyword;
    const plural = (n, word) => `${number.format(n)} ${word}${n === 1 ? '' : 's'}`;
    let help = 'One keyword per line.';
    if (lines.length > 0) help = tracked > 0 ? `${plural(lines.length, 'keyword')}, ${number.format(tracked)} already tracked.` : `${plural(lines.length, 'keyword')}.`;
    if (lines.length > 0 && perKeyword === 2) help += ' Both adds two tracked keywords for each keyword.';
    $('[data-kw-help]').textContent = help;
    $('[data-kw-quota]').textContent = `${number.format(QUOTA.used + adding)} of ${number.format(QUOTA.limit)} keywords used`;
    submit.disabled = adding === 0;
    submit.textContent = adding === 0 ? 'Add keywords' : `Add ${plural(adding, 'keyword')}`;
    return adding;
  }
  function openAdd(trigger) {
    addOpener = trigger;
    closePopup({ restoreFocus: false });
    openModal(addDialog);
    input.focus();
  }
  function resetAdd() {
    input.value = '';
    refreshAdd();
  }
  function requestCloseAdd() {
    closePopup({ restoreFocus: false });
    if (keywordCount() > 0) {
      askDiscard('The keywords you pasted will be lost.', {
        onKeep: () => input.focus(),
        onDiscard: () => {
          closeModal(addDialog, () => addOpener?.focus());
          resetAdd();
        },
      });
      return;
    }
    closeModal(addDialog, () => addOpener?.focus());
  }
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-dialog="dlg-add"]');
    if (trigger) openAdd(trigger);
  });
  input?.addEventListener('input', refreshAdd);
  // Cmd or Ctrl plus Enter submits from the keyword list (10 section 5)
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !submit.disabled) {
      event.preventDefault();
      $('form', addDialog).requestSubmit();
    }
  });
  $('[data-kw-device]')?.addEventListener('click', refreshAdd);
  $$('[data-dialog-close]', addDialog).forEach((b) => b.addEventListener('click', requestCloseAdd));
  $('[data-scrim]', addDialog)?.addEventListener('click', () => keywordCount() === 0 && requestCloseAdd());
  addDialog?.addEventListener('keydown', (event) => {
    trapFocus(addDialog, event);
    if (event.key === 'Escape' && discard.hidden) {
      event.preventDefault();
      requestCloseAdd();
    }
  });
  $('form', addDialog)?.addEventListener('submit', (event) => {
    event.preventDefault();
    const n = refreshAdd();
    if (n === 0) return;
    closeModal(addDialog, () => addOpener?.focus());
    resetAdd();
    toast({ title: `${number.format(n)} keyword${n === 1 ? '' : 's'} added`, description: 'First checks finish in about 10 minutes.', action: { label: 'Undo', run: () => toast({ title: 'Keywords removed', tone: 'info' }) } });
  });
  // "Discard unsaved changes?" (10 section 13.2): shared by the Add keywords dialog, the settings forms and
  // layout customization
  let discardRequest = null;
  function askDiscard(message, request) {
    // `request.owner` lets whoever asked withdraw the question (dismissDiscard) when its subject goes away
    discardRequest = request;
    $('[data-discard-desc]', discard).textContent = message;
    openModal(discard);
    $('[data-keep-editing]', discard).focus();
  }
  const keepEditing = () => closeModal(discard, () => discardRequest?.onKeep?.());
  /** Closes the question without running either answer, when it was asked by `owner`. */
  function dismissDiscard(owner) {
    if (!discardRequest || discardRequest.owner !== owner) return;
    discardRequest = null;
    if (!discard.hidden) closeModal(discard);
  }
  $('[data-keep-editing]', discard)?.addEventListener('click', keepEditing);
  $('[data-discard]', discard)?.addEventListener('click', () => {
    discard.hidden = true;
    discardRequest?.onDiscard?.();
  });
  discard?.addEventListener('keydown', (event) => {
    trapFocus(discard, event);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      keepEditing();
    }
  });

  // ---------------------------------------------------------------------------------------------
  // DateRangePicker (10 sections 10.1 and 10.2). Dates are business dates (YYYY-MM-DD) in the project time zone,
  // handled as UTC midnights so the browser's own zone never shifts a day. "Today" is the fixture's date.

  const TODAY = '2026-09-30';
  const DAY_MS = 86400000;
  const MAX_RANGE_DAYS = 400;
  const toTime = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const toIso = (time) => new Date(time).toISOString().slice(0, 10);
  const addDays = (iso, n) => toIso(toTime(iso) + n * DAY_MS);
  const weekday = (iso) => (new Date(toTime(iso)).getUTCDay() + 6) % 7; // Monday 0 to Sunday 6
  const monthStart = (iso) => `${iso.slice(0, 7)}-01`;
  function addMonths(iso, n) {
    const d = new Date(toTime(monthStart(iso)));
    d.setUTCMonth(d.getUTCMonth() + n);
    return toIso(d.getTime());
  }
  function isValidIso(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    return toIso(toTime(value)) === value;
  }
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const shortDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const shortDayYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const longDay = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  /** "Sep 1 to Sep 28, 2026"; the year is repeated only when the range crosses one. */
  function formatDateRange(from, to) {
    const a = new Date(toTime(from));
    const b = new Date(toTime(to));
    const first = from.slice(0, 4) === to.slice(0, 4) ? shortDay.format(a) : shortDayYear.format(a);
    return `${first} to ${shortDayYear.format(b)}`;
  }

  const PRESETS = {
    '7d': { label: 'Last 7 days', range: () => [addDays(TODAY, -6), TODAY] },
    '28d': { label: 'Last 28 days', range: () => [addDays(TODAY, -27), TODAY] },
    '90d': { label: 'Last 90 days', range: () => [addDays(TODAY, -89), TODAY] },
    // The current ISO week plus the 11 before it, Monday to today
    '12w': { label: 'Last 12 weeks', range: () => [addDays(TODAY, -weekday(TODAY) - 77), TODAY] },
  };

  const datePicker = $('#pop-date');
  const dateButton = $('#date-button');
  const calendar = $('[data-calendar]', datePicker);
  const fromInput = $('[data-date-from]', datePicker);
  const toInput = $('[data-date-to]', datePicker);
  const dateNote = $('[data-date-note]', datePicker);
  const dateApply = $('[data-date-apply]', datePicker);
  const customPane = $('[data-date-custom]', datePicker);

  /** Shows or hides the calendar pane and re-places the popover, whose width changes with it. */
  function showCustomPane(show) {
    customPane.hidden = !show;
    if (current?.panel === datePicker) place(datePicker, dateButton);
  }
  const applied = { preset: '28d', from: PRESETS['28d'].range()[0], to: TODAY };
  const draft = { from: null, to: null, hover: null, focus: TODAY, view: addMonths(TODAY, -1) };

  const DAY_BASE = 'size-8 flex items-center justify-center type-body num outline-none focus-visible:focus-ring';
  const DAY_CLASSES = {
    idle: `${DAY_BASE} rounded-md text-foreground hover:bg-surface-hover`,
    today: `${DAY_BASE} rounded-md type-body-strong text-primary-text hover:bg-surface-hover`,
    edge: `${DAY_BASE} rounded-md bg-primary text-primary-foreground`,
    inRange: `${DAY_BASE} rounded-none bg-primary-subtle text-foreground`,
    disabled: `${DAY_BASE} rounded-md text-foreground-disabled cursor-not-allowed`,
  };

  function maxSelectable() {
    // While only a start is chosen, ends more than 400 days after it are unavailable (daily data)
    if (draft.from && !draft.to) {
      const limit = addDays(draft.from, MAX_RANGE_DAYS);
      return limit < TODAY ? limit : TODAY;
    }
    return TODAY;
  }

  function dayState(iso) {
    if (iso > maxSelectable()) return 'disabled';
    const end = draft.to ?? (draft.from && draft.hover && draft.hover > draft.from ? draft.hover : null);
    if (iso === draft.from || iso === draft.to) return 'edge';
    if (draft.from && end && iso > draft.from && iso < end) return 'inRange';
    if (draft.from && end && iso === end) return 'edge';
    return iso === TODAY ? 'today' : 'idle';
  }

  function renderMonth(first) {
    const grid = document.createElement('div');
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', monthName.format(new Date(toTime(first))));
    grid.className = 'w-56';
    const caption = document.createElement('div');
    caption.className = 'h-8 mb-1 flex items-center justify-center type-subsection-title';
    caption.setAttribute('aria-hidden', 'true');
    caption.textContent = monthName.format(new Date(toTime(first)));
    const head = document.createElement('div');
    head.setAttribute('role', 'row');
    head.className = 'grid grid-cols-7';
    ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].forEach((name) => {
      const cell = document.createElement('div');
      cell.setAttribute('role', 'columnheader');
      cell.className = 'size-8 flex items-center justify-center type-meta';
      cell.textContent = name;
      head.append(cell);
    });
    grid.append(caption, head);
    let row = null;
    const next = addMonths(first, 1);
    for (let iso = first, i = 0; iso < next; iso = addDays(iso, 1), i += 1) {
      if (i === 0 || weekday(iso) === 0) {
        row = document.createElement('div');
        row.setAttribute('role', 'row');
        row.className = 'grid grid-cols-7';
        grid.append(row);
        // Outside days are hidden: empty cells before the first day
        for (let pad = 0; i === 0 && pad < weekday(iso); pad += 1) row.append(document.createElement('span'));
      }
      const state = dayState(iso);
      const day = document.createElement('button');
      day.type = 'button';
      day.setAttribute('role', 'gridcell');
      day.dataset.date = iso;
      day.className = DAY_CLASSES[state];
      day.textContent = String(Number(iso.slice(8)));
      day.setAttribute('aria-label', longDay.format(new Date(toTime(iso))));
      day.setAttribute('aria-selected', String(state === 'edge' || state === 'inRange'));
      if (iso === TODAY) day.setAttribute('aria-current', 'date');
      day.disabled = state === 'disabled';
      day.tabIndex = iso === draft.focus ? 0 : -1;
      row.append(day);
    }
    return grid;
  }

  function renderCalendar() {
    calendar.replaceChildren(renderMonth(draft.view), renderMonth(addMonths(draft.view, 1)));
    $('[data-cal-next]', datePicker).disabled = addMonths(draft.view, 1) >= monthStart(TODAY);
    fromInput.value = draft.from ?? '';
    toInput.value = draft.to ?? '';
    const limitShown = draft.from && !draft.to && addDays(draft.from, MAX_RANGE_DAYS) < TODAY;
    if (!fromInput.hasAttribute('aria-invalid') && !toInput.hasAttribute('aria-invalid')) {
      dateNote.hidden = !limitShown;
      dateNote.className = 'type-meta';
      dateNote.textContent = limitShown ? `Ranges longer than ${MAX_RANGE_DAYS} days are not available for daily data` : '';
    }
    const changed = draft.from !== applied.from || draft.to !== applied.to;
    dateApply.disabled = !(draft.from && draft.to && changed);
  }

  function markPreset(key) {
    $$('[data-preset]', datePicker).forEach((el) => el.setAttribute('aria-checked', String(el.dataset.preset === key)));
  }

  /** Moves the visible months so `iso` is shown, keeping the right month no later than the current month. */
  function reveal(iso) {
    const month = monthStart(iso);
    if (month < draft.view) draft.view = month;
    else if (month > addMonths(draft.view, 1)) draft.view = addMonths(month, -1);
  }

  function applyRange(preset, from, to) {
    Object.assign(applied, { preset, from, to });
    const label = preset === 'custom' ? formatDateRange(from, to) : PRESETS[preset].label;
    $('[data-date-label]').textContent = label;
    dateButton.setAttribute('aria-label', `Date range: ${label}`);
    dateButton.dataset.tip = `${formatDateRange(from, to)} (America/New_York)`;
  }

  function syncDatePicker() {
    Object.assign(draft, { from: applied.from, to: applied.to, hover: null, focus: applied.to });
    draft.view = addMonths(applied.to, -1);
    [fromInput, toInput].forEach((el) => el.removeAttribute('aria-invalid'));
    markPreset(applied.preset);
    customPane.hidden = applied.preset !== 'custom';
    renderCalendar();
  }

  function focusDay(iso) {
    draft.focus = iso;
    reveal(iso);
    renderCalendar();
    $(`[data-date="${iso}"]`, calendar)?.focus();
  }

  dateButton?.addEventListener('click', (event) => {
    // Opens as a dialog-like popover; the generic handler places it once the draft is rendered
    if (current?.panel === datePicker) return;
    event.stopPropagation();
    event.preventDefault();
    syncDatePicker();
    openPopup(datePicker, dateButton, { focus: $('[aria-checked="true"]', datePicker) });
  }, true);

  $$('[data-preset]', datePicker).forEach((button) =>
    button.addEventListener('click', () => {
      const key = button.dataset.preset;
      if (key === 'custom') {
        markPreset('custom');
        showCustomPane(true);
        focusDay(draft.from ?? addDays(TODAY, -13));
        return;
      }
      const [from, to] = PRESETS[key].range();
      applyRange(key, from, to);
      closePopup();
    }),
  );

  calendar?.addEventListener('click', (event) => {
    const day = event.target.closest('[data-date]');
    if (!day || day.disabled) return;
    const iso = day.dataset.date;
    if (!draft.from || draft.to || iso < draft.from) Object.assign(draft, { from: iso, to: null });
    else draft.to = iso;
    draft.focus = iso;
    draft.hover = null;
    markPreset('custom');
    renderCalendar();
    $(`[data-date="${iso}"]`, calendar)?.focus();
  });
  // The hover preview restyles the existing cells: re-rendering under the pointer would split a click in two
  function paintDays() {
    $$('[data-date]', calendar).forEach((day) => {
      const state = dayState(day.dataset.date);
      day.className = DAY_CLASSES[state];
      day.setAttribute('aria-selected', String(state === 'edge' || state === 'inRange'));
    });
  }
  calendar?.addEventListener('mouseover', (event) => {
    const day = event.target.closest('[data-date]');
    if (!draft.from || draft.to || !day || day.disabled || day.dataset.date === draft.hover) return;
    draft.hover = day.dataset.date;
    paintDays();
  });
  calendar?.addEventListener('mouseleave', () => {
    if (!draft.hover) return;
    draft.hover = null;
    paintDays();
  });
  calendar?.addEventListener('keydown', (event) => {
    const iso = event.target.dataset?.date;
    if (!iso) return;
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let target = null;
    if (event.key in steps) target = addDays(iso, steps[event.key]);
    else if (event.key === 'Home') target = addDays(iso, -weekday(iso));
    else if (event.key === 'End') target = addDays(iso, 6 - weekday(iso));
    else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const months = (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1);
      const moved = addMonths(iso, months);
      const lastDay = addDays(addMonths(moved, 1), -1);
      target = `${moved.slice(0, 8)}${iso.slice(8)}`;
      if (!isValidIso(target) || target > lastDay) target = lastDay;
    }
    if (!target) return;
    event.preventDefault();
    focusDay(target > maxSelectable() ? maxSelectable() : target);
  });

  $('[data-cal-prev]', datePicker)?.addEventListener('click', () => {
    draft.view = addMonths(draft.view, -1);
    renderCalendar();
  });
  $('[data-cal-next]', datePicker)?.addEventListener('click', () => {
    draft.view = addMonths(draft.view, 1);
    renderCalendar();
  });

  // Typed dates are validated on blur (and Enter): YYYY-MM-DD, not in the future, From on or before To
  function commitTyped(inputEl, key) {
    const value = inputEl.value.trim();
    let error = '';
    if (value === '') error = '';
    else if (!isValidIso(value)) error = 'Use the format YYYY-MM-DD, for example 2026-09-01';
    else if (value > TODAY) error = `Choose a date on or before ${TODAY}`;
    else if (key === 'from' && draft.to && value > draft.to) error = 'From must be on or before To';
    else if (key === 'to' && draft.from && value < draft.from) error = 'To must be on or after From';
    inputEl.toggleAttribute('aria-invalid', error !== '');
    if (error) {
      dateNote.hidden = false;
      dateNote.className = 'type-meta text-negative-text';
      dateNote.textContent = error;
      return;
    }
    [fromInput, toInput].forEach((el) => el.removeAttribute('aria-invalid'));
    if (value === '' || value === draft[key]) return renderCalendar();
    draft[key] = value;
    markPreset('custom');
    reveal(value);
    renderCalendar();
  }
  fromInput?.addEventListener('blur', () => commitTyped(fromInput, 'from'));
  toInput?.addEventListener('blur', () => commitTyped(toInput, 'to'));
  [fromInput, toInput].forEach((el) =>
    el?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      commitTyped(el, el === fromInput ? 'from' : 'to');
    }),
  );

  dateApply?.addEventListener('click', () => {
    applyRange('custom', draft.from, draft.to);
    closePopup();
  });
  $('[data-date-cancel]', datePicker)?.addEventListener('click', () => closePopup());
  applyRange(applied.preset, applied.from, applied.to);

  // ---------------------------------------------------------------------------------------------
  // Command palette (16 section 7)

  const palette = $('#palette');
  const paletteInput = $('[data-palette-input]');
  const list = $('#palette-list');
  let paletteOpener = null;
  let highlighted = 0;
  const ENTRIES = [
    ...ORDER.map((id) => ({ group: 'Keywords', label: KEYWORDS[id].kw, context: 'Keyword · US desktop', icon: 'tag', run: () => openInspector(id) })),
    ...['Rankings', 'Keywords', 'Prompts', 'Citations', 'Competitors'].map((page) => ({
      group: 'Pages',
      label: page,
      context: ['Rankings', 'Keywords'].includes(page) ? 'SEO' : page === 'Competitors' ? 'Project' : 'AI Visibility',
      icon: 'file-text',
      run: () => toast({ title: `Opens ${page}`, description: 'Navigation is not part of this preview.', tone: 'info' }),
    })),
    { group: 'Actions', label: 'Add keywords', context: '', icon: 'plus', run: () => openAdd(paletteOpener) },
    { group: 'Actions', label: 'Export CSV', context: '', icon: 'download', run: () => toast(TOASTS.export) },
    { group: 'Actions', label: 'Switch theme', context: '', icon: 'sun-moon', run: () => setTimeout(() => changeTheme(root.classList.contains('dark') ? 'light' : 'dark', themeOrigin()), duration('base')) },
  ];

  function highlight(label, q) {
    const frag = document.createDocumentFragment();
    const i = q ? label.toLowerCase().indexOf(q) : -1;
    if (i < 0) {
      frag.append(label);
      return frag;
    }
    const strong = document.createElement('span');
    strong.className = 'type-body-strong';
    strong.textContent = label.slice(i, i + q.length);
    frag.append(label.slice(0, i), strong, label.slice(i + q.length));
    return frag;
  }

  function renderPalette() {
    const q = paletteInput.value.trim().toLowerCase();
    const results = q ? ENTRIES.filter((e) => e.label.toLowerCase().includes(q)) : [{ ...ENTRIES[1], group: 'Recent' }, ...ENTRIES];
    list.replaceChildren();
    if (!results.length) {
      const empty = document.createElement('p');
      empty.className = 'px-3 py-6 text-center type-body text-foreground-secondary';
      empty.textContent = `No results for "${paletteInput.value.trim()}"`;
      list.append(empty);
      return;
    }
    highlighted = Math.min(highlighted, results.length - 1);
    let group = null;
    results.forEach((entry, i) => {
      if (entry.group !== group) {
        group = entry.group;
        const heading = document.createElement('div');
        heading.setAttribute('role', 'presentation');
        heading.className = 'h-7 px-3 flex items-center type-meta';
        heading.textContent = group;
        list.append(heading);
      }
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.id = `palette-option-${i}`;
      option.setAttribute('aria-selected', String(i === highlighted));
      option.className = `h-control-sm px-3 rounded-md flex items-center gap-2 type-body cursor-pointer ${i === highlighted ? 'bg-surface-hover' : ''}`;
      option.append(icon(entry.icon, 'size-icon shrink-0 text-foreground-tertiary'));
      const text = document.createElement('span');
      text.className = 'truncate';
      text.append(highlight(entry.label, q));
      option.append(text);
      if (entry.context) {
        const ctx = document.createElement('span');
        ctx.className = 'ml-auto pl-4 shrink-0 type-meta';
        ctx.textContent = entry.context;
        option.append(ctx);
      }
      option.addEventListener('pointermove', () => {
        if (highlighted !== i) {
          highlighted = i;
          renderPalette();
        }
      });
      option.addEventListener('click', () => runEntry(entry));
      list.append(option);
    });
    paletteInput.setAttribute('aria-activedescendant', `palette-option-${highlighted}`);
    $(`#palette-option-${highlighted}`)?.scrollIntoView({ block: 'nearest' });
    palette.__results = results;
  }

  function runEntry(entry) {
    closePalette(false);
    entry.run();
  }
  function openPalette(opener) {
    paletteOpener = opener ?? document.activeElement;
    closePopup({ restoreFocus: false });
    paletteInput.value = '';
    highlighted = 0;
    renderPalette();
    openModal(palette);
    paletteInput.focus();
  }
  function closePalette(restore = true) {
    closeModal(palette, () => restore && paletteOpener?.focus?.());
  }
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-command]');
    if (trigger) openPalette(trigger);
  });
  $('[data-scrim]', palette)?.addEventListener('click', () => closePalette());
  paletteInput?.addEventListener('input', () => {
    highlighted = 0;
    renderPalette();
  });
  palette?.addEventListener('keydown', (event) => {
    const results = palette.__results ?? [];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      highlighted = (highlighted + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % Math.max(results.length, 1);
      renderPalette();
    } else if (event.key === 'Enter' && results[highlighted]) {
      event.preventDefault();
      runEntry(results[highlighted]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
    } else if (event.key === 'Tab') {
      event.preventDefault();
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Overview (24 section 9.2): setup checklist, branded filter, series menu and the chart's table alternative

  const setupToggle = $('[data-setup-toggle]');
  setupToggle?.addEventListener('click', () => {
    const steps = $('#setup-steps');
    steps.hidden = !steps.hidden;
    setupToggle.setAttribute('aria-expanded', String(!steps.hidden));
    setupToggle.textContent = steps.hidden ? 'Show steps' : 'Hide steps';
  });

  // Removing the default chip is the same as choosing "Included"
  $('[data-branded-remove]')?.addEventListener('click', () => {
    $$('#menu-branded [role="menuitemradio"]').forEach((el) => el.setAttribute('aria-checked', String(el.dataset.value === 'Included')));
    radioHandlers.branded('Included');
    $('[data-popup="menu-ov-filter"]').focus();
  });
  $('[data-open-menu="menu-branded"]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const anchorButton = $('[data-popup="menu-ov-filter"]');
    closePopup({ restoreFocus: false });
    openPopup($('#menu-branded'), anchorButton);
  });

  // Series menu: checkbox items stay open; the last visible series cannot be hidden
  $('#menu-ov-series')?.addEventListener('click', (event) => {
    const item = event.target.closest('[role="menuitemcheckbox"]');
    if (!item) return;
    const show = item.getAttribute('aria-checked') !== 'true';
    if (charts.setMultipleVisible(item.dataset.series, show)) item.setAttribute('aria-checked', String(show));
    else toast({ title: 'Keep at least one series', tone: 'info' });
  });

  // Every chart has a table alternative (15 section 2)
  const tableToggle = $('[data-ov-table-toggle]');
  tableToggle?.addEventListener('click', () => {
    const asTable = tableToggle.getAttribute('aria-pressed') !== 'true';
    tableToggle.setAttribute('aria-pressed', String(asTable));
    $('[data-ov-table]').hidden = !asTable;
    $('[data-ov-charts]').hidden = asTable;
    $('[data-popup="menu-ov-series"]').disabled = asTable;
  });

  // ---------------------------------------------------------------------------------------------
  // Settings (24 section 6): sections, the dirty form with its SaveBar and cost notice, and project deletion

  const SETTINGS_LABELS = Object.fromEntries($$('[data-settings-link]').map((a) => [a.dataset.settingsLink, a.textContent.trim()]));
  const BUILT_SECTIONS = new Set(['profile', 'security', 'preferences', 'general', 'engines']);
  const NAV_ON = ['type-body-strong', 'text-primary-text', 'bg-surface-selected'];
  const NAV_OFF = ['type-body', 'text-foreground-secondary', 'hover:bg-surface-hover'];
  function setNavState(link, on) {
    link.classList.remove(...(on ? NAV_OFF : NAV_ON));
    link.classList.add(...(on ? NAV_ON : NAV_OFF));
    if (on) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  function showSettingsSection(key) {
    const shown = BUILT_SECTIONS.has(key) ? key : 'placeholder';
    $$('[data-settings-section]').forEach((section) => (section.hidden = section.dataset.settingsSection !== shown));
    $('[data-placeholder-title]').textContent = SETTINGS_LABELS[key];
    $$('[data-settings-link]').forEach((link) => setNavState(link, link.dataset.settingsLink === key));
    setSelectValue($('#settings-section'), key);
  }
  // The sticky navigation scrolls inside itself on short windows (72 px top offset plus a 16 px bottom margin)
  $('[data-settings-nav]').style.maxHeight = 'calc(100dvh - 5.5rem)';
  $('#settings-section')?.addEventListener('change', (event) => {
    location.hash = `#/settings/${event.target.dataset.value}`;
  });

  // Form state. One replicate of one engine costs this much per month for the project's 250 prompts (price book).
  const REPLICATE_MONTHLY_USD = 21.05;
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const signedUsd = (amount) => `${amount < 0 ? '−' : '+'}${usd.format(Math.abs(amount))}`;
  const engineRows = $$('[data-engine]');
  const nameInput = $('#set-name');
  const accountNameInput = $('#acct-name');
  const initials = (name) => {
    const words = name.trim().split(/\s+/).filter(Boolean);
    return ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
  };
  const timezoneSelect = $('#set-tz');
  const saveBar = $('[data-save-bar]');

  function readSettings() {
    return {
      accountName: accountNameInput.value.trim(),
      name: nameInput.value.trim(),
      timezone: timezoneSelect.dataset.value,
      engines: Object.fromEntries(
        engineRows.map((row) => [row.dataset.engine, { on: $('[data-engine-enabled]', row).checked, reps: Number($('[data-engine-replicates]', row).dataset.value) }]),
      ),
    };
  }
  let savedSettings = readSettings();

  function writeSettings(state) {
    accountNameInput.value = state.accountName;
    $('[data-avatar-preview]').textContent = initials(state.accountName);
    nameInput.value = state.name;
    setSelectValue(timezoneSelect, state.timezone);
    engineRows.forEach((row) => {
      $('[data-engine-enabled]', row).checked = state.engines[row.dataset.engine].on;
      setSelectValue($('[data-engine-replicates]', row), state.engines[row.dataset.engine].reps);
    });
  }

  /** Counts changed fields and describes the cost effect of the engine changes. */
  function settingsDiff() {
    const now = readSettings();
    let changes = Number(now.accountName !== savedSettings.accountName) + Number(now.name !== savedSettings.name) + Number(now.timezone !== savedSettings.timezone);
    let delta = 0;
    const notes = [];
    engineRows.forEach((row) => {
      const before = savedSettings.engines[row.dataset.engine];
      const after = now.engines[row.dataset.engine];
      const name = row.dataset.name;
      changes += Number(before.on !== after.on) + Number(before.reps !== after.reps);
      delta += ((after.on ? after.reps : 0) - (before.on ? before.reps : 0)) * REPLICATE_MONTHLY_USD;
      if (before.on && !after.on) notes.push(`${name} is no longer observed.`);
      else if (!before.on && after.on) notes.push(`${name} is observed again.`);
      else if (after.on && before.reps !== after.reps) {
        const diff = Math.abs(after.reps - before.reps);
        notes.push(`${name} replicates ${before.reps} → ${after.reps} ${after.reps > before.reps ? 'adds' : 'removes'} ${diff} observation${diff === 1 ? '' : 's'} per prompt per week.`);
      }
    });
    return { changes, delta: Math.round(delta * 100) / 100, notes };
  }

  function refreshSettings() {
    const { changes, delta, notes } = settingsDiff();
    engineRows.forEach((row) => ($('[data-engine-replicates]', row).disabled = !$('[data-engine-enabled]', row).checked));
    const banner = $('[data-cost-banner]');
    banner.hidden = notes.length === 0;
    $('[data-cost-delta]').textContent = signedUsd(delta);
    $('[data-cost-detail]').textContent = notes.join(' ');
    saveBar.hidden = changes === 0;
    $('[data-save-summary]').textContent = `${changes} unsaved change${changes === 1 ? '' : 's'}`;
    $('[data-save-estimate]').textContent = notes.length > 0 ? `${signedUsd(delta)} per month, estimate` : '';
    return changes;
  }
  const settingsDirty = () => settingsDiff().changes > 0;
  function discardSettings() {
    writeSettings(savedSettings);
    refreshSettings();
  }

  nameInput?.addEventListener('input', refreshSettings);
  accountNameInput?.addEventListener('input', () => {
    $('[data-avatar-preview]').textContent = initials(accountNameInput.value);
    refreshSettings();
  });
  $('[data-view="settings"]')?.addEventListener('change', refreshSettings);
  $('[data-save-discard]')?.addEventListener('click', discardSettings);
  $('[data-save-submit]')?.addEventListener('click', () => {
    savedSettings = readSettings();
    refreshSettings();
    // The saved name reaches the account button and its menu
    if (savedSettings.accountName) {
      accountButton.textContent = initials(savedSettings.accountName);
      accountButton.setAttribute('aria-label', `Account menu for ${savedSettings.accountName}`);
      $('#menu-user .type-body-strong').textContent = savedSettings.accountName;
    }
    // Saved: the bar leaves and a polite status announces it; no toast (SaveBar, 25 section 4.26)
    $('[data-save-status]').textContent = 'Changes saved';
  });

  // Small dialogs opened by data-dialog-open: scrim, Escape and Cancel close; focus returns to the opener
  function wireDialog(dialog, { onOpen, onClose } = {}) {
    let opener = null;
    const close = () => {
      closeModal(dialog, () => opener?.focus());
      onClose?.();
    };
    $$(`[data-dialog-open="${dialog.id}"]`).forEach((button) =>
      button.addEventListener('click', () => {
        opener = button;
        openModal(dialog);
        onOpen?.();
      }),
    );
    $$('[data-dialog-cancel]', dialog).forEach((button) => button.addEventListener('click', close));
    $('[data-scrim]', dialog)?.addEventListener('click', close);
    dialog.addEventListener('keydown', (event) => {
      trapFocus(dialog, event);
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });
    return close;
  }

  // Security: sessions (19 section 2, auth/sessions)
  const sessionsBody = $('[data-sessions]');
  const otherSessions = () => $$('tr[data-session]', sessionsBody).filter((row) => row.dataset.session !== 'current');
  function revokeSessions(rows) {
    rows.forEach((row) => row.remove());
    $('[data-sessions-revoke-others]').disabled = otherSessions().length === 0;
  }
  sessionsBody?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-session-revoke]');
    if (!button) return;
    const device = button.closest('tr').querySelector('th .type-body').textContent;
    revokeSessions([button.closest('tr')]);
    toast({ title: `${device} signed out` });
    $('[data-sessions-revoke-others]').focus();
  });
  $('[data-sessions-revoke-others]')?.addEventListener('click', () => {
    const rows = otherSessions();
    revokeSessions(rows);
    toast({ title: `${rows.length} session${rows.length === 1 ? '' : 's'} signed out` });
  });

  // Security: change password. The button enables when the current password is filled, the new one has at
  // least 12 characters and the confirmation matches; the mismatch message waits until the field was left once.
  const passwordDialog = $('#dlg-password');
  const pwFields = { current: $('#pw-current'), next: $('#pw-new'), confirm: $('#pw-confirm') };
  const pwSubmit = $('[data-pw-submit]');
  let confirmTouched = false;
  function refreshPassword() {
    const mismatch = pwFields.confirm.value !== '' && pwFields.confirm.value !== pwFields.next.value;
    const showError = mismatch && confirmTouched;
    $('[data-pw-error]').hidden = !showError;
    pwFields.confirm.toggleAttribute('aria-invalid', showError);
    pwSubmit.disabled = !(pwFields.current.value !== '' && pwFields.next.value.length >= 12 && pwFields.confirm.value === pwFields.next.value);
  }
  function resetPassword() {
    Object.values(pwFields).forEach((field) => (field.value = ''));
    confirmTouched = false;
    refreshPassword();
  }
  const closePassword = wireDialog(passwordDialog, { onOpen: () => pwFields.current.focus(), onClose: resetPassword });
  Object.values(pwFields).forEach((field) => field.addEventListener('input', refreshPassword));
  pwFields.confirm.addEventListener('blur', () => {
    confirmTouched = true;
    refreshPassword();
  });
  $('form', passwordDialog).addEventListener('submit', (event) => {
    event.preventDefault();
    if (pwSubmit.disabled) return;
    closePassword();
    revokeSessions(otherSessions());
    toast({ title: 'Password changed', description: 'Your other sessions were signed out.' });
  });

  // Security: recovery codes are shown once
  const recoveryDialog = $('#dlg-recovery');
  wireDialog(recoveryDialog, { onOpen: () => $('[data-recovery-copy]').focus() });
  $('[data-recovery-copy]')?.addEventListener('click', async () => {
    const codes = $$('[data-recovery-codes] li').map((li) => li.textContent).join('\n');
    try {
      await window.navigator.clipboard.writeText(codes);
      toast({ title: 'Recovery codes copied', tone: 'info' });
    } catch {
      toast({ title: 'Could not copy', description: 'Select the codes and copy them by hand.', tone: 'info' });
    }
  });

  // Preferences apply at once (10 section 13.3). Theme reveals from the segment that was chosen.
  $('[data-pref-theme]')?.addEventListener('click', (event) => {
    const segment = event.target.closest('[role="radio"]');
    if (segment && segment.dataset.value !== themeMode) changeTheme(segment.dataset.value, originOf(segment));
  });
  $('[data-pref-density]')?.addEventListener('click', (event) => {
    const segment = event.target.closest('[role="radio"]');
    if (!segment) return;
    const compact = segment.dataset.value === 'compact';
    $$('[data-selectable] tbody tr').forEach((row) => {
      row.classList.toggle('h-row', !compact);
      row.classList.toggle('h-row-compact', compact);
    });
  });
  const LOCALE_EXAMPLES = { 'en-US': '1,234.5 · Sep 30, 2026', 'en-GB': '1,234.5 · 30 Sep 2026' };
  $('#pref-locale')?.addEventListener('change', (event) => {
    $('[data-locale-example]').textContent = LOCALE_EXAMPLES[event.target.dataset.value];
  });

  // Delete project: confirmed by typing the slug (16 section 4.5)
  const deleteDialog = $('#dlg-delete');
  const slugInput = $('#delete-slug');
  const deleteSubmit = $('[data-delete-submit]');
  let deleteOpener = null;
  function closeDelete() {
    closeModal(deleteDialog, () => deleteOpener?.focus());
    slugInput.value = '';
    deleteSubmit.disabled = true;
  }
  $('[data-dialog-open="dlg-delete"]')?.addEventListener('click', (event) => {
    deleteOpener = event.currentTarget;
    openModal(deleteDialog);
    slugInput.focus();
  });
  slugInput?.addEventListener('input', () => (deleteSubmit.disabled = slugInput.value !== 'northwind-crm'));
  $('[data-delete-cancel]')?.addEventListener('click', closeDelete);
  $('[data-scrim]', deleteDialog)?.addEventListener('click', closeDelete);
  deleteDialog?.addEventListener('keydown', (event) => {
    trapFocus(deleteDialog, event);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDelete();
    }
  });
  $('form', deleteDialog)?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (deleteSubmit.disabled) return;
    closeDelete();
    toast({ title: 'Nothing was deleted', description: 'Deleting a project is turned off in this preview.', tone: 'info' });
  });

  // ---------------------------------------------------------------------------------------------
  // Views: #/overview, #/rankings, #/settings/<section>. Rankings is shown when there is no route, so links that
  // carry ?inspect= keep working. Destinations that are not built say so instead of navigating.

  const VIEWS = { overview: 'Overview', rankings: 'Rankings', settings: 'Settings' };
  let route = { view: 'rankings', section: null };

  function parseRoute(hash) {
    const [, view, section] = /^#\/([a-z-]+)(?:\/([a-z-]+))?$/.exec(hash) ?? [];
    if (!(view in VIEWS)) return null;
    if (view !== 'settings') return { view, section: null };
    return { view, section: section in SETTINGS_LABELS ? section : 'engines' };
  }
  const routeHash = (r) => (r.view === 'settings' ? `#/settings/${r.section}` : `#/${r.view}`);

  function showRoute(next) {
    const viewChanged = next.view !== route.view;
    route = next;
    closePopup({ restoreFocus: false });
    // Route guards have already asked about unsaved work, so the inspector closes without asking again
    if (viewChanged && !inspector.hidden) closeInspector(true);
    if ($('#sidebar').hasAttribute('data-open')) $('#nav-close').click();
    $$('[data-view]').forEach((view) => (view.hidden = view.dataset.view !== next.view));
    $$('#sidebar [data-nav]').forEach((link) => setNavState(link, link.dataset.nav === next.view));
    const settings = next.view === 'settings';
    if (settings) showSettingsSection(next.section);
    const label = settings ? SETTINGS_LABELS[next.section] : VIEWS[next.view];
    $('[data-crumb-current]').textContent = label;
    $('[data-crumb-parent]').hidden = !settings;
    // Date range and location are hidden where they do not apply (11 section 4)
    $$('[data-scope-control]').forEach((el) => (el.hidden = settings));
    document.title = `${settings ? `${label}, Settings` : label} · Design System Preview`;
    if (viewChanged) window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', () => {
    const next = parseRoute(location.hash);
    if (!next || routeHash(next) === routeHash(route)) return;
    // Leaving unsaved work asks first (10 section 13.2). The address is put back while the question is open,
    // so "Keep editing" leaves everything as it was, including after Back and Forward.
    const stay = routeHash(route);
    const proceed = () => {
      history.replaceState(null, '', routeHash(next));
      showRoute(next);
    };
    if (blockedByGuard('route', proceed)) {
      history.replaceState(null, '', stay);
      return;
    }
    showRoute(next);
  });

  leaveGuards.push((kind) =>
    kind === 'route' && route.view === 'settings' && settingsDirty()
      ? {
          message: 'Your unsaved settings changes will be lost.',
          onKeep: () => (BUILT_SECTIONS.has(route.section) ? $(`[data-settings-section="${route.section}"] input, [data-settings-section="${route.section}"] button`)?.focus() : undefined),
          onDiscard: discardSettings,
        }
      : null,
  );

  function previewNote(name) {
    toast({ title: `${name} is not in this preview`, description: 'Overview, Rankings and Settings are built so far.', tone: 'info' });
  }
  document.addEventListener('click', (event) => {
    const missing = event.target.closest('[data-nav-missing], [data-preview-note]');
    if (!missing) return;
    event.preventDefault();
    previewNote(missing.dataset.navMissing ?? missing.dataset.previewNote);
  });

  refreshSettings();
  const initialRoute = parseRoute(location.hash);
  if (initialRoute) showRoute(initialRoute);

  // ---------------------------------------------------------------------------------------------
  // Global keyboard: Cmd or Ctrl+K opens the palette; J and K step records; Esc closes the inspector

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      return palette.hidden ? openPalette() : closePalette();
    }
    const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    const modalOpen = !palette.hidden || $$('[aria-modal="true"]').some((dialog) => !dialog.hidden);
    if (typing || modalOpen || current) return;
    if (!inspector.hidden) {
      // While the drawer's cards are being customized, Escape leaves customize mode first (customize.js)
      if (event.key === 'Escape' && $('#inspector [data-layout-save-bar]:not([hidden])')) return;
      if (event.key === 'Escape') closeInspector();
      else if (root.dataset.singleKeys === 'off') return;
      else if (event.key === 'j') step(1);
      else if (event.key === 'k') step(-1);
    }
  });

  // Restore an inspector from the URL (?inspect=keyword:k2), as a shared link would
  const fromUrl = new URL(location.href).searchParams.get('inspect');
  if (fromUrl?.startsWith('keyword:')) openInspector(fromUrl.slice(8));

  /** Helpers shared with customize.js (layout customization), which is a separate ES module. */
  window.PreviewUI = {
    $,
    $$,
    icon,
    toast,
    openPopup,
    closePopup,
    popupOpen: () => current !== null,
    openModal,
    closeModal,
    trapFocus,
    askDiscard,
    setSelectValue,
    addLeaveGuard: (guard) => leaveGuards.push(guard),
    dismissDiscard,
    selectInspectorTab: selectTab,
    refreshInspectorChart: () => inspectorId && renderInspectorChart(KEYWORDS[inspectorId]),
  };
})();
