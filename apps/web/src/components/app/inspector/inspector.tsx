'use client';

import {
  use,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { InspectorHeader, type InspectorHeaderProps } from './inspector-header';
import { InspectorBoxContext, InspectorOverlaySetterContext, useViewportWidth } from './inspector-layout';
import { InspectorResizeHandle } from './inspector-resize-handle';
import type { MenuItemDef } from '@/components/ui/menu';
import { Sheet } from '@/components/ui/sheet';
import { useShortcut } from '@/lib/a11y/use-shortcut';
import {
  fitInspectorWidth,
  INSPECTOR_EDGE,
  INSPECTOR_WIDTH,
  inspectorPlacement,
  type InspectorType,
} from '@/lib/inspector/placement';
import {
  InspectorWidthUserContext,
  readInspectorWidth,
  subscribeInspectorWidth,
  writeInspectorWidth,
} from '@/lib/inspector/width-store';
import { cn } from '@/lib/utils';

export interface InspectorProps {
  type: InspectorType;
  /** Everything the header shows except what the inspector itself adds (the title's id and Close). */
  header: Omit<InspectorHeaderProps, 'titleId' | 'titleRef' | 'onClose' | 'backLabel' | 'moreActions'> & {
    moreActions?: readonly MenuItemDef[] | undefined;
  };
  /** The sheet's back button below 900 px: "Back to Rankings". */
  backLabel: string;
  onClose: () => void;
  /** J, K, and ArrowDown and ArrowUp from inside the card, the same as Previous and Next; left out with them. */
  onStep?: ((direction: 'next' | 'previous') => void) | undefined;
  /**
   * Leaves out the More actions button even when the drawer passes actions. The button is left out anyway when the
   * drawer has none. Default `false`.
   */
  hideMoreActions?: boolean | undefined;
  /** An `InspectorFooter` while a section is in edit mode. */
  footer?: ReactNode;
  /** `InspectorTabs` with their panels, or an `InspectorBody`. */
  children: ReactNode;
}

/** Popups that own the keyboard while open. */
const OPEN_POPUPS =
  ':is([role="listbox"], [role="menu"], [role="dialog"])[data-open], [role="combobox"][aria-expanded="true"]';
/** Layers that close before the inspector does, one per Escape (16 section 2.8, rule 5). */
const OPEN_LAYERS = `[data-slot="tooltip"]:not([data-ending-style]), ${OPEN_POPUPS}`;
/** Controls that use the arrow keys themselves: there ArrowUp and ArrowDown do not step. */
const ARROW_OWNERS =
  'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="listbox"], [role="menu"], [role="menubar"], [role="tablist"], [role="radiogroup"], [role="slider"], [role="spinbutton"], [role="separator"], [role="grid"], [role="treegrid"], [role="tree"], [aria-haspopup]';
/** A focused scroll area keeps its arrows, so a keyboard can scroll it. */
const SCROLL_AREAS = '[role="region"], [role="tabpanel"]';

const FRAME = cn('relative flex flex-col rounded-xl border border-border bg-background shadow-inspector');

/**
 * The detail panel of one record (16-drawers-dialogs-popovers.md section 2, 25 section 18.1): a card under the
 * top bar that lays over the page from 900 px and never resizes it, and is a full-width sheet below that. The
 * card is a non-modal `aside`: the page stays usable, Escape closes it from inside, and J, K, ArrowUp and ArrowDown
 * step through the list. Its width is one saved choice per person, 640 px by default. It must sit in an
 * `InspectorLayout`.
 */
export function Inspector({
  type,
  header,
  backLabel,
  onClose,
  onStep,
  hideMoreActions = false,
  footer,
  children,
}: InspectorProps): ReactElement {
  const titleId = useId();
  const asideId = useId();
  const aside = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const userId = use(InspectorWidthUserContext);
  const box = use(InspectorBoxContext);
  const viewportWidth = useViewportWidth();
  const stored = useSyncExternalStore(
    subscribeInspectorWidth,
    () => readInspectorWidth(userId),
    () => null,
  );
  const [preview, setPreview] = useState<number | null>(null);
  const { mode, width, maxWidth } = inspectorPlacement({
    viewportWidth,
    frameWidth: box?.width ?? viewportWidth,
    preferred: stored ?? INSPECTOR_WIDTH.default,
  });
  // While a drag runs the card is drawn at the preview width; the width is saved once, on release
  const drawn = preview === null ? width : fitInspectorWidth(preview, maxWidth);
  const setWidth = (next: number | null): void => writeInspectorWidth(userId, next);

  // The card covers the right side of the page: a bar of the list's actions keeps clear of where it begins
  const setOverlay = use(InspectorOverlaySetterContext);
  const overlayLeft = mode === 'overlay' && box === null ? viewportWidth - INSPECTOR_EDGE - drawn : null;
  useEffect(() => {
    setOverlay(overlayLeft);
    return () => setOverlay(null);
  }, [overlayLeft, setOverlay]);

  // Opening moves focus to the title, so the next Tab reaches the header's actions (16 section 2.8). The
  // sheet does the same through its own initial focus. Only on opening: a resize that turns the sheet into
  // a card keeps focus where it is.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (mode !== 'sheet') title.current?.focus({ preventScroll: true });
  }, [mode]);

  // Escape closes from inside the card only (16 section 2.8, rule 3), so the list's search keeps its own
  // Escape. Popups portal out of the card and close themselves; a tooltip showing goes first, one layer
  // per press (rule 5). A held key closes once.
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const element = aside.current;
    if (element === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.repeat || event.isComposing) return;
      // An open popup takes this Escape: a tooltip still showing, or a list or menu (one whose focus stays
      // in its combobox field too)
      if (document.querySelector(OPEN_LAYERS) !== null) return;
      event.preventDefault();
      latestClose.current();
    };
    element.addEventListener('keydown', onKeyDown);
    return () => element.removeEventListener('keydown', onKeyDown);
  }, [mode]);

  // A step made from inside the card may remove the control that had focus: the title takes it then, so the
  // next key still reaches the card
  const steppedInside = useRef(false);
  useEffect(() => {
    if (!steppedInside.current) return;
    steppedInside.current = false;
    if (document.activeElement === document.body) title.current?.focus({ preventScroll: true });
  }, [header.title, header.positionText]);
  // J and K work from the list or the inspector, not from elsewhere on the page (16 section 2.10)
  const stepFromHere = (direction: 'next' | 'previous'): void => {
    const active = document.activeElement;
    const inside = active !== null && aside.current?.contains(active) === true;
    const inGrid = active !== null && active.closest('[role="grid"], [role="treegrid"]') !== null;
    if (!inside && !inGrid) return;
    steppedInside.current = inside;
    onStep?.(direction);
  };
  useShortcut('j', () => stepFromHere('next'), { kind: 'single-key', enabled: onStep !== undefined });
  useShortcut('k', () => stepFromHere('previous'), { kind: 'single-key', enabled: onStep !== undefined });
  // ArrowDown and ArrowUp step from inside the card, wherever no control uses them itself. They are not
  // character keys and act only while the card has focus, so the single-key preference does not cover them
  // (20-accessibility.md section 14)
  const onArrowKey = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (onStep === undefined || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    if (event.defaultPrevented || event.repeat || event.nativeEvent.isComposing) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    // A menu or dialog opened from the card is outside it in the page, and its keys still arrive here
    if (!(target instanceof HTMLElement) || !event.currentTarget.contains(target)) return;
    if (target.closest(ARROW_OWNERS) !== null || target.matches(SCROLL_AREAS)) return;
    if (document.querySelector(OPEN_POPUPS) !== null) return;
    event.preventDefault();
    steppedInside.current = true;
    onStep(event.key === 'ArrowDown' ? 'next' : 'previous');
  };

  const content = (
    <>
      <InspectorHeader
        {...header}
        titleId={titleId}
        titleRef={title}
        moreActions={hideMoreActions ? [] : (header.moreActions ?? [])}
        onClose={onClose}
        backLabel={mode === 'sheet' ? backLabel : null}
      />
      {children}
      {footer}
    </>
  );

  if (mode === 'sheet') {
    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        aria-labelledby={titleId}
        initialFocus={title}
      >
        {content}
      </Sheet>
    );
  }
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The arrow keys step the record this landmark shows, as its Previous and Next buttons do
    <aside
      ref={aside}
      id={asideId}
      aria-labelledby={titleId}
      data-inspector={type}
      style={{ width: drawn }}
      onKeyDown={onArrowKey}
      className={cn(
        FRAME,
        // Over the page, which stays usable and keeps its layout: no scrim. In a boxed preview, inside the box
        box === null
          ? 'fixed top-inspector-top right-3 bottom-3 z-(--z-drawer)'
          : 'absolute top-3 right-3 bottom-3 z-(--z-drawer)',
      )}
    >
      {/* The content clips to the rounded card; the resize handle reaches over its left edge */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl">{content}</div>
      <InspectorResizeHandle
        width={drawn}
        max={maxWidth}
        controlsId={asideId}
        onResize={setWidth}
        onReset={() => setWidth(null)}
        onPreview={setPreview}
      />
    </aside>
  );
}
