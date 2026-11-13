'use client';

import type { ReactElement, ReactNode } from 'react';

import { LayoutProvider, type LayoutProviderProps } from '../layout-provider';
import { CustomizeController, useCustomize } from './customize-controller';
import { useUndoKeys } from './use-undo-keys';

export interface CustomizableScreenProps extends LayoutProviderProps {
  /** Named in the dialogs of the team default. */
  workspaceName: string;
}

/** The box the keys and the focus rules work inside: header, numbers, cards and the save bar. */
function ScreenRoot({ children }: { children: ReactNode }): ReactElement {
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
    </div>
  );
}

/**
 * One screen that a person can customize (the plan's section 3.1): the layout provider, the customize controller
 * and the root the undo keys listen on. A page puts its whole body inside, header included, because the Customize
 * button and the badge read this screen's state.
 */
export function CustomizableScreen({ workspaceName, children, ...provider }: CustomizableScreenProps): ReactElement {
  return (
    <LayoutProvider {...provider}>
      <CustomizeController workspaceName={workspaceName}>
        <ScreenRoot>{children}</ScreenRoot>
      </CustomizeController>
    </LayoutProvider>
  );
}
