/* global document, window, history, location, matchMedia, getComputedStyle, requestAnimationFrame, setTimeout, clearTimeout, URL */
/**
 * Interactive behavior for the static design-system preview: menus, popovers, tooltips, toasts, the inspector shell
 * (each page registers its record types through PreviewUI), the discard confirmation, the command palette, switches
 * and the date range picker. Rankings is built by kw*.js and has its own filters, table, inspector and dialogs.
 *
 * Specs: docs/design-system/16-drawers-dialogs-popovers.md (overlays, inspector, palette),
 * 18-notifications-alerts.md (toasts, notification panel),
 * 09-buttons-controls.md (controls), 21-motion.md (durations come from the motion tokens, so reduced motion
 * turns every transition off). In the app these are Base UI primitives; this file only demonstrates behavior.
 */
(() => {
  'use strict';

  const root = document.documentElement;
  const charts = window.PreviewCharts;
  // A missing element (or a missing scope element) gives null or an empty list, so optional parts of a page are skipped
  const $ = (selector, scope = document) => scope?.querySelector(selector) ?? null;
  const $$ = (selector, scope = document) => (scope ? [...scope.querySelectorAll(selector)] : []);

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
      return openPopup(panel, trigger, { align: trigger.dataset.align });
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
    device: (value) => {
      const label = $('[data-device-label]');
      if (label) label.textContent = value;
    },
    // The menu closes first so the reveal starts from a clean screen.
    theme: (value) => setTimeout(() => changeTheme(value, themeOrigin()), duration('base')),
    project: (value) => {
      // Sidebar switcher: the name lives in a span; the breadcrumb crumb is the button's own text.
      $$('[data-popup="menu-project"]').forEach((el) => {
        // The name has its own marker: the initial beside it uses the same type style
        const name = el.querySelector('[data-project-name]');
        if (name) name.textContent = value;
        else el.textContent = value;
        if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', `Switch workspace or project: ${value}`);
        if (el.dataset.tip) el.dataset.tip = value;
      });
      $('[data-project-initial]').textContent = value.charAt(0).toUpperCase();
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
  // Switches

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
  // ---------------------------------------------------------------------------------------------
  // Inspector (16 section 2): a floating card 12 px from the window edges. It docks when the viewport leaves 360 px
  // beside a 720 px main column and the margin, overlays from 768 px, and is a full-screen sheet below 768 px.

  const inspector = $('#inspector');
  const scrim = $('#inspector-scrim');
  let inspectorId = null;
  let inspectorType = null;
  let lastOpener = null;
  /**
   * What the inspector can show. A type names its records, fills the panel, and knows the order of the records
   * on screen for stepping. Parts of the panel that belong to one type carry data-inspector-type. Each page adds
   * its types through PreviewUI.registerInspectorType (prompts-inspector.js adds "prompt", prompts-topic-inspector.js "topic").
   */
  const INSPECTOR_TYPES = {};
  const inspectorDef = () => INSPECTOR_TYPES[inspectorType];
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
    if (available >= 360) return { mode: 'docked', width: Math.min(inspectorDef().width, available) };
    if (vw >= 768) return { mode: 'overlay' };
    return { mode: 'sheet' };
  }

  function layoutInspector() {
    if (inspector.hidden) return;
    const { mode, width } = inspectorMode();
    inspector.classList.remove(...ALL_MODE_CLASSES);
    inspector.classList.add(...MODES[mode]);
    // The width class is the 400 px default; a narrower dock or a wider type (the prompt inspector is 440 px,
    // 16 section 2.6) is set inline. Overlays are capped by the viewport through max-w-full.
    const natural = inspectorDef().width;
    inspector.style.width = mode === 'docked' && width !== 400 ? `${width}px` : mode === 'overlay' && natural !== 400 ? `${natural}px` : '';
    Object.assign(inspector.style, MODE_STYLES[mode]);
    inspector.dataset.mode = mode;
    scrim.hidden = mode !== 'sheet';
    inspector.setAttribute('aria-modal', String(mode === 'sheet'));
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

  function setActiveRow(id) {
    $$('[data-selectable] tbody tr').forEach((row) => {
      if (row.dataset.id === id) row.setAttribute('data-active', 'true');
      else row.removeAttribute('data-active');
      const cell = row.firstElementChild;
      const edge = ['relative', 'before:absolute', 'before:inset-y-0', 'before:left-0', 'before:w-0.5', 'before:bg-primary'];
      cell.classList.toggle('relative', row.dataset.id === id);
      edge.slice(1).forEach((c) => cell.classList.toggle(c, row.dataset.id === id));
    });
    charts?.syncRows();
  }

  function openInspector(id, opener, type) {
    const def = INSPECTOR_TYPES[type];
    if (!def?.has(id)) return;
    const wasHidden = inspector.hidden;
    const typeChanged = type !== inspectorType;
    inspectorId = id;
    inspectorType = type;
    if (opener) lastOpener = opener;
    inspector.hidden = false;
    $$('[data-inspector-type]', inspector).forEach((part) => (part.hidden = part.dataset.inspectorType !== type));
    $('[data-inspector-back]').setAttribute('aria-label', `Back to ${def.back}`);
    $('[data-inspector-prev]').setAttribute('aria-label', `Previous ${def.noun}`);
    $('[data-inspector-prev]').dataset.tip = `Previous ${def.noun} (K)`;
    $('[data-inspector-next]').setAttribute('aria-label', `Next ${def.noun}`);
    $('[data-inspector-next]').dataset.tip = `Next ${def.noun} (J)`;
    layoutInspector();
    def.fill(id);
    setActiveRow(id);
    // Stepping to another record of the same type keeps the tab the person is reading
    if (wasHidden || typeChanged) selectTab(def.defaultTab);
    const url = new URL(location.href);
    url.searchParams.set('inspect', `${type}:${id}`);
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
    const ids = inspectorDef().order();
    if (ids.length === 0) return;
    const at = ids.indexOf(inspectorId);
    // A record that is no longer in the list (filtered away) steps to the first or the last one
    const next = at === -1 ? ids[delta > 0 ? 0 : ids.length - 1] : ids[(at + delta + ids.length) % ids.length];
    openInspector(next, undefined, inspectorType);
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
    inspector.dispatchEvent(new window.CustomEvent('inspector-tab', { detail: { tab: name } }));
  }

  // Arrow keys move inside the tab list the tab belongs to: each record type has its own
  $$('#inspector [role="tab"]').forEach((tab) => {
    tab.addEventListener('click', () => selectTab(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const all = $$('[role="tab"]', tab.closest('[role="tablist"]'));
      const next = all[(all.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
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

  // "Discard unsaved changes?" (10 section 13.2): shared by the settings forms and layout customization
  const discard = $('#dlg-discard');
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
    ...['Keywords', 'Prompts', 'Citations', 'Competitors'].map((page) => ({
      group: 'Pages',
      label: page,
      context: ['Keywords'].includes(page) ? 'SEO' : page === 'Competitors' ? 'Project' : 'AI Visibility',
      icon: 'file-text',
      run: () => toast({ title: `Opens ${page}`, description: 'Navigation is not part of this preview.', tone: 'info' }),
    })),
    { group: 'Actions', label: 'Add keywords', context: '', icon: 'plus', run: () => {
      location.hash = '#/keywords';
      window.dispatchEvent(new window.CustomEvent('kw-add'));
    } },
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
  slugInput?.addEventListener('input', () => (deleteSubmit.disabled = slugInput.value !== 'fynix-digital'));
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
  // Views: #/overview, #/keywords, #/settings/<section>. Keywords is shown when there is no route, so links that
  // carry ?inspect= keep working. The old #/rankings address still opens it. Destinations that are not built say so
  // instead of navigating.

  const VIEWS = { overview: 'Overview', keywords: 'Keywords', pages: 'Pages', prompts: 'Topics & Prompts', settings: 'Settings' };
  // Pages with tabs keep the tab in the route: #/prompts (Topics), #/prompts/explorer, #/prompts/panels, #/prompts/versions
  const PAGE_TABS = { pages: ['performance', 'landing'], prompts: ['topics', 'explorer', 'panels', 'versions'] };
  let route = { view: 'keywords', section: null };

  function parseRoute(hash) {
    const [, address, section] = /^#\/([a-z-]+)(?:\/([a-z-]+))?$/.exec(hash) ?? [];
    const view = address === 'rankings' ? 'keywords' : address;
    if (!(view in VIEWS)) return null;
    if (view in PAGE_TABS) return { view, section: PAGE_TABS[view].includes(section) ? section : PAGE_TABS[view][0] };
    if (view !== 'settings') return { view, section: null };
    return { view, section: section in SETTINGS_LABELS ? section : 'engines' };
  }
  function routeHash(r) {
    if (r.view === 'settings') return `#/settings/${r.section}`;
    // The first tab of a page is the page itself
    return r.view in PAGE_TABS && r.section !== PAGE_TABS[r.view][0] ? `#/${r.view}/${r.section}` : `#/${r.view}`;
  }

  function showRoute(next) {
    const viewChanged = next.view !== route.view;
    const leaving = route.view;
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
    $$('[data-scope-control]').forEach((el) => (el.hidden = settings || next.view === 'pages'));
    document.title = `${settings ? `${label}, Settings` : label} · Design System Preview`;
    if (viewChanged) window.scrollTo(0, 0);
    // Pages built in their own script (prompts.js) show their tab from this
    // A page lets go of its address first (preview-leave), so the page that opens next never reads its query
    if (viewChanged) window.dispatchEvent(new window.CustomEvent('preview-leave', { detail: { from: leaving } }));
    window.dispatchEvent(new window.CustomEvent('preview-route', { detail: next }));
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
    toast({ title: `${name} is not in this preview`, description: 'Overview, Keywords, Topics & Prompts and Settings are built so far.', tone: 'info' });
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
    wireDialog,
    engineLogo,
    badge,
    registerInspectorType: (name, definition) => {
      INSPECTOR_TYPES[name] = definition;
    },
    openInspector,
    closeInspector,
    inspectorState: () => ({ open: !inspector.hidden, type: inspectorType, id: inspectorId, mode: inspector.dataset.mode }),
    /** Re-marks the row of the open record after a table has rendered its rows again. */
    syncActiveRow: () => setActiveRow(inspector.hidden ? null : inspectorId),
    currentRoute: () => route,
    dismissDiscard,
    selectInspectorTab: selectTab,
  };
})();
