'use client';

/**
 * Customize cards in a record drawer (docs/superpowers/plans/2026-11-13-ai-wp-16-layouts-customize.md, T10, spec
 * 5.5). A drawer is not a page: its header holds the More menu that starts the mode, its footer holds the save bar,
 * and closing it (the Close button, Escape, the scrim) must ask first when there are changes. The page writes:
 *
 *   <DrawerCustomizer screen="inspector.keyword" ...>      // around the Inspector, inside its own component
 *     const drawer = useDrawerCustomize();
 *     <Inspector onClose={drawer.guardClose(close)} footer={drawer.saveBar}
 *       header={{ moreActions: [drawer.menuItem, ...], moreButtonRef: drawer.moreButtonRef, ... }}>
 *       <DrawerGrid label="Keyword cards" />
 *     </Inspector>
 */
import { useRef, type ReactElement, type RefObject } from 'react';

import { CustomizableGrid, CustomizableScreen, type CustomizableScreenProps } from '../customize/customizable-screen';
import { useCustomizeMenuItem } from '../customize/customize-button';
import { useCustomize } from '../customize/customize-controller';
import { useLayoutScreen } from '../layout-provider';
import { LayoutSaveBar } from '../save-bar/layout-save-bar';
import type { MenuItemDef } from '@/components/ui/menu';

export type DrawerCustomizerProps = Omit<CustomizableScreenProps, 'saveBar' | 'box'>;

/**
 * A customizable screen whose save bar is in the drawer's footer (`useDrawerCustomize().saveBar`). Its own box takes
 * no part in the layout, so the Inspector stays a direct child of the list's row, which its docked placement needs.
 */
export function DrawerCustomizer(props: DrawerCustomizerProps): ReactElement {
  return <CustomizableScreen {...props} saveBar="none" box="contents" />;
}

export interface DrawerCustomize {
  /**
   * "Customize cards" for the drawer's More menu; null below 768 px, where there is no customize mode. It reads
   * "Customize cards" and leaves the mode when it is on.
   */
  menuItem: MenuItemDef | null;
  /** Goes on the Inspector header's `moreButtonRef`: focus returns to the More button when the mode ends. */
  moreButtonRef: RefObject<HTMLButtonElement | null>;
  /**
   * What the Inspector gets as `onClose`, which serves its Close button, Escape and the scrim: `close` itself while
   * the mode is off, else the discard question first, and `close` only after Discard.
   */
  guardClose(close: () => void): () => void;
  /** The bar of customize mode, in the drawer variant, for the Inspector's `footer`; nothing while the mode is off. */
  saveBar: ReactElement;
}

const SAVE_BAR = <LayoutSaveBar variant="drawer" />;

/** The three parts of a customizable drawer. Inside a `DrawerCustomizer`. */
export function useDrawerCustomize(): DrawerCustomize {
  const { mode } = useLayoutScreen();
  const { requestExit } = useCustomize();
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuItem = useCustomizeMenuItem('customizeCards', moreButtonRef);
  const customizing = mode === 'customize';
  return {
    menuItem,
    moreButtonRef,
    guardClose: (close) =>
      customizing
        ? () => {
            requestExit(close);
          }
        : () => {
            close();
          },
    saveBar: SAVE_BAR,
  };
}

/** The drawer's cards: one column, no width control, with the Add card slot and the catalog of the screen. */
export function DrawerGrid({ label }: { label: string }): ReactElement {
  return <CustomizableGrid label={label} columns="one" />;
}
