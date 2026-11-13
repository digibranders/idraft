'use client';

import type { ReactElement, ReactNode } from 'react';

import { LayoutGrid, type LayoutGridProps } from '../layout-grid';
import { LayoutProvider, type LayoutProviderProps } from '../layout-provider';
import { LayoutSaveBar } from '../save-bar/layout-save-bar';
import { CustomizeButton } from './customize-button';
import { CustomizeController, useCustomize } from './customize-controller';
import { useUndoKeys } from './use-undo-keys';

export interface CustomizableScreenProps extends LayoutProviderProps {
  /** Named in the dialogs of the team default. */
  workspaceName: string;
  /** `end`: the save bar closes the screen. `none`: it is somewhere else (the footer of a drawer). */
  saveBar?: 'end' | 'none';
}

/** The box the keys and the focus rules work inside: header, numbers, cards and the save bar. */
function ScreenRoot({ saveBar, children }: { saveBar: 'end' | 'none'; children: ReactNode }): ReactElement {
  const { rootRef } = useCustomize();
  const onKeyDown = useUndoKeys();
  return (
    // `presentation`: the box has no meaning of its own; it only hears the keys of what is inside it
    <div
      ref={rootRef}
      role="presentation"
      data-customize-root=""
      onKeyDown={onKeyDown}
      className="flex min-w-0 flex-col gap-3"
    >
      {children}
      {saveBar === 'end' ? <LayoutSaveBar /> : null}
    </div>
  );
}

/**
 * The cards of a customizable screen: the layout grid with its Add card slot wired to the catalog and the
 * Customize button on an empty page. Later parts of the customize UI (placeholders, the card boundary) fill the
 * grid's other slots here.
 */
export function CustomizableGrid({ label, columns }: Pick<LayoutGridProps, 'label' | 'columns'>): ReactElement {
  const { openCatalog } = useCustomize();
  return <LayoutGrid label={label} columns={columns} onAddCard={openCatalog} emptyAction={<CustomizeButton />} />;
}

/**
 * One screen that a person can customize (the plan's section 3.1): the layout provider, the customize controller
 * and the root the undo keys listen on. A page puts its whole body inside, header included, because the Customize
 * button and the badge read this screen's state.
 */
export function CustomizableScreen({
  workspaceName,
  saveBar = 'end',
  children,
  ...provider
}: CustomizableScreenProps): ReactElement {
  return (
    <LayoutProvider {...provider}>
      <CustomizeController workspaceName={workspaceName}>
        <ScreenRoot saveBar={saveBar}>{children}</ScreenRoot>
      </CustomizeController>
    </LayoutProvider>
  );
}
