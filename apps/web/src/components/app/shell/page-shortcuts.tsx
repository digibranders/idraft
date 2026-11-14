'use client';

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import type { ShortcutEntry } from './keyboard-shortcuts-dialog';

/**
 * The seam between a page and the keyboard shortcuts dialog (20-accessibility.md section 14, rule 3): the shell
 * holds the provider above both the top bar and the page, the page calls `usePageShortcuts` with the keys it
 * listens to (through `useShortcut`), and the dialog reads `usePageShortcutEntries` next to the shell's own keys.
 */

/** Returns the function that takes the owner's entries out again. */
type Register = (owner: string, entries: readonly ShortcutEntry[]) => () => void;

const NONE: readonly ShortcutEntry[] = [];
/** Two contexts, so a page that registers does not render again each time any page does. */
const RegisterContext = createContext<Register | null>(null);
const EntriesContext = createContext<readonly ShortcutEntry[]>(NONE);

export function PageShortcutsProvider({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  const [byOwner, setByOwner] = useState<ReadonlyMap<string, readonly ShortcutEntry[]>>(new Map());
  const register = useCallback<Register>((owner, entries) => {
    setByOwner((previous) => new Map(previous).set(owner, entries));
    return () => {
      setByOwner((previous) => {
        const next = new Map(previous);
        next.delete(owner);
        return next;
      });
    };
  }, []);
  const entries = useMemo(() => [...byOwner.values()].flat(), [byOwner]);
  return (
    <RegisterContext.Provider value={register}>
      <EntriesContext.Provider value={entries}>{children}</EntriesContext.Provider>
    </RegisterContext.Provider>
  );
}

/**
 * Lists a page's shortcuts in the dialog while it is mounted. `entries` must keep its identity between renders
 * (build it with `useMemo`): a new array is a new registration. Outside a provider it does nothing.
 */
export function usePageShortcuts(entries: readonly ShortcutEntry[]): void {
  const register = use(RegisterContext);
  const owner = useId();
  useEffect(() => register?.(owner, entries), [register, owner, entries]);
}

/** What the pages under the shell have registered, in the order they did; empty outside a provider. */
export const usePageShortcutEntries = (): readonly ShortcutEntry[] => use(EntriesContext);
