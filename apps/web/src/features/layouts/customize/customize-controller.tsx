'use client';

/**
 * The mode of a customizable screen (docs/superpowers/plans/2026-11-13-ai-wp-16-layouts-customize.md, section 3.2):
 * who may enter it, how it is left, where focus goes, and the question asked before changes are lost. The
 * provider holds the draft; this holds what a person does around it. Other parts of the customize UI (the
 * catalogs, the save bar, the dialogs of the team default) read `useCustomize()`.
 */
import { useTranslations } from 'next-intl';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

import { CardCatalogDialog } from '../catalog/card-catalog-dialog';
import { useLayoutScreen } from '../layout-provider';
import type { LayoutPreset } from '../presets/presets';
import { MEDIUM_MEDIA } from '../use-breakpoint';
import { useLayoutLeaveGuard } from './use-layout-leave-guard';
import { DiscardChangesDialog } from '@/components/ui/alert-dialog';
import { dismissToast, toast } from '@/components/ui/toast';
import { useShortcut } from '@/lib/a11y/use-shortcut';
import { useMediaQuery } from '@/lib/dom/use-media-query';
import { cardName, type LayoutDocument } from '@/lib/layouts';

export interface CustomizeContextValue {
  /** For the dialogs of the team default: "Set this as the default for everyone in {workspace}?". */
  workspaceName: string;
  /** The element that wraps the screen; a drag handle is looked for inside it. */
  rootRef: RefObject<HTMLDivElement | null>;
  /**
   * Starts customize mode. Another screen's mode ends first, and asks when it has changes. Focus returns to
   * `returnFocus` (the control that started the mode) when the mode ends, else to the Customize button.
   */
  enter(returnFocus?: HTMLElement | null): void;
  /** Leaves customize mode and then runs `then`; with changes it asks first, and `then` waits for the answer. */
  requestExit(then?: () => void): void;
  /** The ref of a Customize button: where focus goes back to. Returns what React calls when the button goes. */
  registerEntry(node: HTMLElement | null): () => void;
  /**
   * Opens the card catalog; a card chosen there goes to `index` of the document's cards. Only in customize mode,
   * and the catalog closes with the mode. Focus returns to what held it when the catalog was opened.
   */
  openCatalog(index: number): void;
  /**
   * A save failed and the draft has not changed since: the save bar says so. It clears on the next edit, on the
   * next save and when the mode ends.
   */
  saveError: boolean;
  setSaveError(failed: boolean): void;
  /**
   * Which write met a layout that was changed somewhere else, null while its question is not on screen. The
   * conflict dialog is open exactly while this is set.
   */
  conflict: ConflictKind | null;
  /**
   * The conflict that has not been answered yet. It stays set when the dialog is dismissed, because the API has
   * already re-read the layout: a plain save would now send the fresh ETag and overwrite the other version
   * without asking. No save is sent while it is set; asking again is `setConflict(conflictPending)`.
   */
  conflictPending: ConflictKind | null;
  /** A write met a conflict: opens the question and holds every save until it is answered. */
  setConflict(kind: ConflictKind): void;
  /** The dialog closes without an answer (Escape): the conflict stays pending, so Save asks again. */
  dismissConflict(): void;
  /** The question was answered (Keep mine, Load the other version): clears both. The mode ending does too. */
  resolveConflict(): void;
  /**
   * Hides a card and raises a toast "{card} hidden" with Undo (D-06). The toast goes with the next change to the
   * draft (any edit, Undo, Redo) and with the mode, so its Undo can only ever bring this card back; focus then
   * goes to the card's handle.
   */
  hideWithUndo(id: string): void;
  /** The presets the page gave the Start from menu (T9); none for a page that has none. */
  presets: readonly LayoutPreset[];
}

/** The personal layout or the team default: what "Keep mine" writes again. */
export type ConflictKind = 'personal' | 'team';

const CustomizeContext = createContext<CustomizeContextValue | null>(null);

/** What another screen needs of the one that is customizing now: only one screen is in the mode at a time. */
interface ActiveScreen {
  isDirty(): boolean;
  requestExit(then?: () => void): void;
  exit(): void;
}
let active: ActiveScreen | null = null;

/** The toast of the last hide: what Undo on it may undo, and the document the hide left behind. */
interface HideToast {
  toastId: string;
  /** Known after the render that shows the hide; null until then. */
  after: LayoutDocument | null;
  /** Ends the offer after `HIDE_TOAST_MS`. */
  timer: ReturnType<typeof setTimeout>;
}

/** How long Undo stays on the toast: it sits over the save bar, and the save bar's own Undo outlasts it. */
const HIDE_TOAST_MS = 8000;

/** Focus that is on nothing, or on a dialog that is about to go. */
function focusIsLost(): boolean {
  const focused = document.activeElement;
  return (
    focused === null ||
    focused === document.body ||
    focused.closest('[role="alertdialog"], [aria-modal="true"]') !== null
  );
}

/** The first card handle, else the first number handle, else the Add card slot. */
function firstTarget(root: HTMLElement | null): HTMLElement | null {
  if (root === null) return null;
  return (
    root.querySelector<HTMLElement>('[data-layout-card] [data-part="handle"]') ??
    root.querySelector<HTMLElement>('[data-layout-number] [data-part="handle"]') ??
    root.querySelector<HTMLElement>('[data-add-card-slot]')
  );
}

export interface CustomizeControllerProps {
  workspaceName: string;
  presets?: readonly LayoutPreset[];
  children: ReactNode;
}

/** One list for every screen that gives no presets, so the context value does not change with each render. */
const NO_PRESETS: readonly LayoutPreset[] = [];

/** Inside a `LayoutProvider`. */
export function CustomizeController({
  workspaceName,
  presets = NO_PRESETS,
  children,
}: CustomizeControllerProps): ReactElement {
  const t = useTranslations('layouts.customize.mode');
  const tCard = useTranslations('layouts.customize.card');
  const { mode, document: layout, dirty, saving, canCustomize, actions } = useLayoutScreen();
  const customizing = mode === 'customize';
  const wide = useMediaQuery(MEDIUM_MEDIA);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const entryRef = useRef<HTMLElement | null>(null);
  const returnRef = useRef<HTMLElement | null>(null);
  const [discard, setDiscard] = useState<{ then: (() => void) | undefined } | null>(null);
  // The index stays when the catalog closes, so the closing dialog still has the place it was opened for
  const [catalog, setCatalog] = useState({ open: false, index: 0 });
  // The draft a failed save was sent with: the failure holds only while the draft is that one
  const [failedDraft, setFailedDraft] = useState<LayoutDocument | null>(null);
  const [conflictState, setConflictState] = useState<{ open: ConflictKind | null; pending: ConflictKind | null }>({
    open: null,
    pending: null,
  });

  // What the callbacks below read: the state of the last render, so they can stay the same function
  const live = useRef({ customizing, layout, dirty, saving, canCustomize, actions });
  useEffect(() => {
    live.current = { customizing, layout, dirty, saving, canCustomize, actions };
  });

  // The question belongs to the mode: it goes with it
  if (!customizing && discard !== null) setDiscard(null);
  if (!customizing && catalog.open) setCatalog((current) => ({ ...current, open: false }));
  if (!customizing && conflictState.pending !== null) setConflictState({ open: null, pending: null });
  if (failedDraft !== null && (!customizing || failedDraft !== layout)) setFailedDraft(null);

  const requestExit = useCallback((then?: () => void): void => {
    const { dirty: changed, saving: writing, actions: current } = live.current;
    // A save is under way: leaving now would drop the draft the write is putting
    if (writing) return;
    if (!changed) {
      current.exit();
      then?.();
      return;
    }
    // The dialog gives focus back to what held it when it opened, so "Keep editing" lands on the first handle
    firstTarget(rootRef.current)?.focus({ preventScroll: true });
    setDiscard({ then });
  }, []);

  const exitNow = useCallback((): void => {
    live.current.actions.exit();
  }, []);
  // A link, a guarded push, Back, Forward and a reload ask through the same dialog as Cancel and Escape
  const leaveGuard = useLayoutLeaveGuard({ customizing, dirty, saving, exit: exitNow });
  // The dialog gives focus back to what held it when it opened, so "Keep editing" lands on the first handle
  useLayoutEffect(() => {
    if (leaveGuard.asking) firstTarget(rootRef.current)?.focus({ preventScroll: true });
  }, [leaveGuard.asking]);

  const self = useMemo<ActiveScreen>(
    () => ({
      isDirty: () => live.current.dirty,
      requestExit,
      exit: () => {
        live.current.actions.exit();
      },
    }),
    [requestExit],
  );
  useEffect(() => {
    if (!customizing) return undefined;
    active = self;
    return () => {
      if (active === self) active = null;
    };
  }, [customizing, self]);

  // Started with focus on nothing (from a menu that has closed): the first handle is where the work is
  const focusFirstOnEnter = useRef(false);
  useEffect(() => {
    if (!customizing || !focusFirstOnEnter.current) return;
    focusFirstOnEnter.current = false;
    if (focusIsLost()) firstTarget(rootRef.current)?.focus({ preventScroll: true });
  }, [customizing]);

  // Focus that sat on a control the mode took away, or in a dialog it closed, goes back to where the mode began
  const wasCustomizing = useRef(false);
  useEffect(() => {
    if (customizing) {
      wasCustomizing.current = true;
      return;
    }
    if (!wasCustomizing.current) return;
    wasCustomizing.current = false;
    const target = returnRef.current;
    if (target?.isConnected === true && focusIsLost()) target.focus({ preventScroll: true });
  }, [customizing]);

  const enter = useCallback(
    (returnFocus?: HTMLElement | null): void => {
      const begin = (): void => {
        returnRef.current = returnFocus ?? entryRef.current;
        focusFirstOnEnter.current = true;
        live.current.actions.enter();
      };
      if (!live.current.canCustomize || live.current.customizing || live.current.saving) return;
      const other = active;
      if (other === null || other === self) {
        begin();
      } else if (other.isDirty()) {
        other.requestExit(begin);
      } else {
        other.exit();
        begin();
      }
    },
    [self],
  );

  const registerEntry = useCallback((node: HTMLElement | null): (() => void) => {
    entryRef.current = node;
    // Two buttons may exist (the header's and the empty page's): one going away must not forget the other
    return () => {
      if (entryRef.current === node) entryRef.current = null;
    };
  }, []);

  const openCatalog = useCallback((index: number): void => {
    if (live.current.customizing) setCatalog({ open: true, index });
  }, []);

  const setSaveError = useCallback((failed: boolean): void => {
    setFailedDraft(failed ? live.current.layout : null);
  }, []);
  const setConflict = useCallback((kind: ConflictKind): void => {
    setConflictState({ open: kind, pending: kind });
  }, []);
  const dismissConflict = useCallback((): void => {
    setConflictState((current) => ({ ...current, open: null }));
  }, []);
  const resolveConflict = useCallback((): void => {
    setConflictState({ open: null, pending: null });
  }, []);

  // The toast of the last hide. Undo on it is only right while the draft is the one the hide made
  const hideToast = useRef<HideToast | null>(null);
  const refocusCard = useRef<string | null>(null);
  const closeHideToast = useCallback((): void => {
    const open = hideToast.current;
    hideToast.current = null;
    if (open === null) return;
    clearTimeout(open.timer);
    dismissToast(open.toastId);
  }, []);
  const hideWithUndo = useCallback(
    (id: string): void => {
      const { layout: before, actions: current } = live.current;
      const card = before.cards?.find((candidate) => candidate.id === id);
      if (card === undefined || !current.hideCard(id)) return;
      closeHideToast();
      const toastId = toast({
        type: 'info',
        title: tCard('hiddenToast', { card: cardName(card) }),
        action: {
          label: tCard('undo'),
          onAction: () => {
            const open = hideToast.current;
            if (open?.toastId !== toastId) return;
            // The toast closes itself after this action
            clearTimeout(open.timer);
            hideToast.current = null;
            if (open.after !== live.current.layout) return;
            if (live.current.actions.undo()) refocusCard.current = id;
          },
        },
      });
      // The toast has an action, so the toast region never closes it, and it would stay over the save bar
      const timer = setTimeout(() => {
        if (hideToast.current?.toastId === toastId) closeHideToast();
      }, HIDE_TOAST_MS);
      hideToast.current = { toastId, after: null, timer };
    },
    [closeHideToast, tCard],
  );
  useEffect(() => {
    const open = hideToast.current;
    if (open === null) return;
    if (!customizing) closeHideToast();
    // The first render after the hide shows what it left; any later change to the draft ends the offer
    else if (open.after === null) open.after = layout;
    else if (open.after !== layout) closeHideToast();
  }, [layout, customizing, closeHideToast]);
  useEffect(() => closeHideToast, [closeHideToast]);
  // Undo from the toast has no focus request of its own: the card is back after this render
  useEffect(() => {
    const id = refocusCard.current;
    if (id === null) return;
    refocusCard.current = null;
    const frame = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-layout-card]') ?? [])].find(
      (candidate) => candidate.dataset.layoutCard === id,
    );
    frame?.querySelector<HTMLElement>('[data-part="handle"]')?.focus({ preventScroll: true });
  }, [layout]);

  // Escape leaves the mode. A card in the hand, a menu and a dialog keep the key for themselves
  useShortcut(
    'Escape',
    () => {
      requestExit();
    },
    { kind: 'dismiss', enabled: customizing },
  );

  // Customize mode needs 768 px. A window narrowed below it leaves the mode, unless there are changes: those
  // stay, with their controls, until the person saves or cancels
  useEffect(() => {
    if (!wide && live.current.customizing && !live.current.dirty) live.current.actions.exit();
  }, [wide]);

  const saveError = failedDraft !== null;
  const value = useMemo<CustomizeContextValue>(
    () => ({
      workspaceName,
      rootRef,
      enter,
      requestExit,
      registerEntry,
      openCatalog,
      saveError,
      setSaveError,
      conflict: conflictState.open,
      conflictPending: conflictState.pending,
      setConflict,
      dismissConflict,
      resolveConflict,
      hideWithUndo,
      presets,
    }),
    [
      workspaceName,
      presets,
      enter,
      requestExit,
      registerEntry,
      openCatalog,
      saveError,
      setSaveError,
      conflictState,
      setConflict,
      dismissConflict,
      resolveConflict,
      hideWithUndo,
    ],
  );

  return (
    <CustomizeContext value={value}>
      {children}
      <CardCatalogDialog
        open={customizing && catalog.open}
        index={catalog.index}
        onOpenChange={(open) => {
          setCatalog((current) => ({ ...current, open }));
        }}
      />
      <DiscardChangesDialog
        open={customizing && (discard !== null || leaveGuard.asking)}
        title={t('discardTitle')}
        description={t('discardBody')}
        keepEditingLabel={t('keepEditing')}
        discardLabel={t('discard')}
        onKeepEditing={() => {
          setDiscard(null);
          leaveGuard.stay();
        }}
        onDiscard={() => {
          if (discard === null) {
            leaveGuard.leave();
            return;
          }
          const then = discard.then;
          setDiscard(null);
          leaveGuard.stay();
          live.current.actions.exit();
          then?.();
        }}
      />
    </CustomizeContext>
  );
}

/** The customize controller of the nearest customizable screen; throws outside one. */
export function useCustomize(): CustomizeContextValue {
  const value = use(CustomizeContext);
  if (value === null) throw new Error('useCustomize is used outside a CustomizableScreen');
  return value;
}

/** Like `useCustomize`, for parts that also work on a bare `LayoutProvider` (a grid with no controller): null there. */
export function useOptionalCustomize(): CustomizeContextValue | null {
  return use(CustomizeContext);
}
