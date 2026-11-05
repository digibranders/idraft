'use client';

import { createContext, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A place in the top bar that a page can put its own controls in (11-navigation.md section 4). The top bar
 * is a sibling of the page, not its parent, so the shell provides the slot above both: `TopBarSlotTarget`
 * (inside the bar) registers its element, and `TopBarPortal` (inside the page) draws into it.
 */

interface TopBarSlot {
  element: HTMLElement | null;
  setElement: (element: HTMLElement | null) => void;
}

/** Without a provider there is no slot: a portal draws nothing and a target registers nowhere. */
const NO_SLOT: TopBarSlot = { element: null, setElement: () => undefined };

const TopBarSlotContext = createContext<TopBarSlot>(NO_SLOT);

export function TopBarSlotProvider({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const value = useMemo((): TopBarSlot => ({ element, setElement }), [element]);
  return <TopBarSlotContext.Provider value={value}>{children}</TopBarSlotContext.Provider>;
}

/** The slot's element, in the top bar's right group before the fixed controls. It takes no room while empty. */
export function TopBarSlotTarget(): ReactElement {
  const { setElement } = useContext(TopBarSlotContext);
  return <div ref={setElement} className="flex items-center gap-3 empty:hidden" />;
}

/** Draws `children` in the top bar's slot; nothing when no top bar is above the page. */
export function TopBarPortal({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  const { element } = useContext(TopBarSlotContext);
  return element === null ? null : createPortal(children, element);
}
