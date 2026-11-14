'use client';

import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react';

/**
 * The open state of the Add competitor dialog, which the route's slot reads. A feature may not import another, so
 * the dialog of the entities feature is composed by the route (`add-competitor-slot.tsx`); the route page is a Server
 * Component and cannot hand a client function down, so the screen provides this control and the slot reads it.
 */

export interface AddCompetitorControl {
  open: boolean;
  /** Closes the dialog; the screen reads the tracked set again, as it may have changed. */
  close: () => void;
}

const CLOSED: AddCompetitorControl = { open: false, close: () => undefined };

const AddCompetitorControlContext = createContext<AddCompetitorControl>(CLOSED);

export function AddCompetitorControlProvider({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}): ReactElement {
  const value = useMemo((): AddCompetitorControl => ({ open, close: onClose }), [open, onClose]);
  return <AddCompetitorControlContext.Provider value={value}>{children}</AddCompetitorControlContext.Provider>;
}

/** The control of the dialog; closed, with a close that does nothing, outside a provider. */
export const useAddCompetitorControl = (): AddCompetitorControl => useContext(AddCompetitorControlContext);
