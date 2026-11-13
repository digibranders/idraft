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
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

import { CardCatalogDialog } from '../catalog/card-catalog-dialog';
import { useLayoutScreen } from '../layout-provider';
import { MEDIUM_MEDIA } from '../use-breakpoint';
import { DiscardChangesDialog } from '@/components/ui/alert-dialog';
import { useShortcut } from '@/lib/a11y/use-shortcut';
import { useMediaQuery } from '@/lib/dom/use-media-query';
import type { LayoutDocument } from '@/lib/layouts';

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
   * Which write met a layout that was changed somewhere else, null when none did. The conflict dialog reads it;
   * it clears with the mode.
   */
  conflict: ConflictKind | null;
  setConflict(kind: ConflictKind | null): void;
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
  children: ReactNode;
}

/** Inside a `LayoutProvider`. */
export function CustomizeController({ workspaceName, children }: CustomizeControllerProps): ReactElement {
  const t = useTranslations('layouts.customize.mode');
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
  const [conflict, setConflict] = useState<ConflictKind | null>(null);

  // What the callbacks below read: the state of the last render, so they can stay the same function
  const live = useRef({ customizing, layout, dirty, saving, canCustomize, actions });
  useEffect(() => {
    live.current = { customizing, layout, dirty, saving, canCustomize, actions };
  });

  // The question belongs to the mode: it goes with it
  if (!customizing && discard !== null) setDiscard(null);
  if (!customizing && catalog.open) setCatalog((current) => ({ ...current, open: false }));
  if (!customizing && conflict !== null) setConflict(null);
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
      conflict,
      setConflict,
    }),
    [workspaceName, enter, requestExit, registerEntry, openCatalog, saveError, setSaveError, conflict],
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
        open={customizing && discard !== null}
        title={t('discardTitle')}
        description={t('discardBody')}
        keepEditingLabel={t('keepEditing')}
        discardLabel={t('discard')}
        onKeepEditing={() => {
          setDiscard(null);
        }}
        onDiscard={() => {
          const then = discard?.then;
          setDiscard(null);
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
