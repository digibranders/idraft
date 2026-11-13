'use client';

import { createContext, use, useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

import type { ExportBlock } from './export-model';

/**
 * The export registry of the AI visibility Overview (WP-33 plan section 5, item 8): a card with a Table view tells
 * the page what its table holds with `useExportBlock(id, getBlock)`, and the Export menu reads every card's block
 * when its item runs. Nothing is read while the page renders: `getBlock` is called only by `useExportBlocks()`'s
 * reader, so a card that builds its rows at that moment costs nothing on every render.
 */

/** A card's way to build its table now, or `null` while it is still loading. */
export type GetExportBlock = () => ExportBlock | null;

/** What the menu item gets: the blocks that are ready, and how many cards were still loading and are left out. */
export interface ExportRead {
  blocks: ExportBlock[];
  /** The words ("{n} blocks were still loading and are not included") are the menu's; this is the count. */
  loading: number;
}

interface Entry {
  id: string;
  /** Reads the card's latest `getBlock`, so the entry never has to be replaced when a card renders again. */
  get: GetExportBlock;
}

interface Registry {
  /** Returns the function that takes this entry out again. */
  register: (entry: Entry) => () => void;
  read: () => ExportRead;
}

function createRegistry(): Registry {
  const entries = new Map<string, Entry>();
  return {
    register: (entry) => {
      // One card per id: the newer wins, and the older one leaving must not take the newer one with it
      entries.set(entry.id, entry);
      return () => {
        if (entries.get(entry.id) === entry) entries.delete(entry.id);
      };
    },
    read: () => {
      const blocks: ExportBlock[] = [];
      let loading = 0;
      // Cards mount when their code arrives, so the order of mounting is no order: the ids give a stable one
      for (const entry of [...entries.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
        const block = entry.get();
        if (block === null) loading += 1;
        else blocks.push(block);
      }
      return { blocks, loading };
    },
  };
}

/** What a reader outside any provider sees: no card has told the page of a table. */
const readNothing = (): ExportRead => ({ blocks: [], loading: 0 });

const ExportContext = createContext<Registry | null>(null);

/** Holds the cards' blocks for the Export menu; sits inside `OverviewProvider`. */
export function ExportProvider({ children }: { children: ReactNode }): ReactElement {
  const [registry] = useState(createRegistry);
  return <ExportContext.Provider value={registry}>{children}</ExportContext.Provider>;
}

/**
 * Registers a card's table while the card is mounted. `getBlock` may change on every render: the latest is the one
 * read, and the card is registered once. Outside an `ExportProvider` it does nothing, so a card renders alone
 * (in a test, or in a preview) without one.
 */
export function useExportBlock(id: string, getBlock: GetExportBlock): void {
  const registry = use(ExportContext);
  const latest = useRef(getBlock);
  useEffect(() => {
    latest.current = getBlock;
  });
  useEffect(() => registry?.register({ id, get: () => latest.current() }), [registry, id]);
}

/**
 * The reader of the blocks, for the Export menu: call it from the menu item, not while rendering. Its identity
 * is stable. Outside an `ExportProvider` it reads nothing.
 */
export function useExportBlocks(): () => ExportRead {
  const registry = use(ExportContext);
  return useCallback(() => registry?.read() ?? readNothing(), [registry]);
}
