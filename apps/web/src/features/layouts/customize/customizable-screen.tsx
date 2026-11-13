'use client';

import type { ReactElement, ReactNode } from 'react';

import { CardBoundary } from '../cards/card-boundary';
import { UnavailableCard } from '../cards/unavailable-card';
import { LayoutGrid, type LayoutGridProps } from '../layout-grid';
import { LayoutProvider, type LayoutProviderProps } from '../layout-provider';
import type { LayoutPreset } from '../presets/presets';
import { LayoutSaveBar } from '../save-bar/layout-save-bar';
import { CustomizeButton } from './customize-button';
import { CustomizeController, useCustomize } from './customize-controller';
import { useUndoKeys } from './use-undo-keys';

export interface CustomizableScreenProps extends LayoutProviderProps {
  /** Named in the dialogs of the team default. */
  workspaceName: string;
  /** `end`: the save bar closes the screen. `none`: it is somewhere else (the footer of a drawer). */
  saveBar?: 'end' | 'none';
  /**
   * `column`: a flex column that lays out the page. `contents`: the box takes no part in the layout, for a screen
   * whose children must stay direct children of their parent (the drawer: a docked inspector is sticky in its row).
   */
  box?: 'column' | 'contents';
  /** What the Start from menu offers besides the built-in layout and the team default; see `definePresets`. */
  presets?: readonly LayoutPreset[];
}

const BOX_CLASS = { column: 'flex min-w-0 flex-col gap-3', contents: 'contents' } as const;

/** The box the keys and the focus rules work inside: header, numbers, cards and the save bar. */
function ScreenRoot({
  saveBar,
  box,
  children,
}: {
  saveBar: 'end' | 'none';
  box: NonNullable<CustomizableScreenProps['box']>;
  children: ReactNode;
}): ReactElement {
  const { rootRef } = useCustomize();
  const onKeyDown = useUndoKeys();
  return (
    // `presentation`: the box has no meaning of its own; it only hears the keys of what is inside it
    <div ref={rootRef} role="presentation" data-customize-root="" onKeyDown={onKeyDown} className={BOX_CLASS[box]}>
      {children}
      {saveBar === 'end' ? <LayoutSaveBar /> : null}
    </div>
  );
}

/** What the grid shows for a card this project cannot show, in customize mode. */
const renderUnavailable: NonNullable<LayoutGridProps['renderUnavailable']> = (item, reason) => (
  <UnavailableCard item={item} reason={reason} />
);

/**
 * The cards of a customizable screen: the layout grid with its slots filled. The Add card slot opens the catalog,
 * an unavailable card is a placeholder, every card has its own error boundary, and an empty page offers the
 * Customize button.
 */
export function CustomizableGrid({ label, columns }: Pick<LayoutGridProps, 'label' | 'columns'>): ReactElement {
  const { openCatalog } = useCustomize();
  return (
    <LayoutGrid
      label={label}
      columns={columns}
      onAddCard={openCatalog}
      renderUnavailable={renderUnavailable}
      CardBoundary={CardBoundary}
      emptyAction={<CustomizeButton />}
    />
  );
}

/**
 * One screen that a person can customize (the plan's section 3.1): the layout provider, the customize controller
 * and the root the undo keys listen on. A page puts its whole body inside, header included, because the Customize
 * button and the badge read this screen's state.
 */
export function CustomizableScreen({
  workspaceName,
  saveBar = 'end',
  box = 'column',
  presets,
  children,
  ...provider
}: CustomizableScreenProps): ReactElement {
  return (
    <LayoutProvider {...provider}>
      <CustomizeController workspaceName={workspaceName} {...(presets === undefined ? {} : { presets })}>
        <ScreenRoot saveBar={saveBar} box={box}>
          {children}
        </ScreenRoot>
      </CustomizeController>
    </LayoutProvider>
  );
}
