'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { useCompetitors, type AddedCompetitor } from './use-competitors';
import type { ProjectEntry } from './competitor-model';
import type { PromptScope } from '../prompt-queries';
import { toast } from '@/components/ui/toast';

/** A brand a person added from the list, kept until the summary has been read again. */
export interface AddedBrand {
  /** 2 to 6, or `null` while the competitor is being made and past the fifth competitor (the neutral color). */
  colorIndex: number | null;
  /** The row has just flipped, so focus goes to it. */
  fresh: boolean;
}

const keyOf = (name: string): string => name.trim().toLowerCase();

export interface AddedBrands {
  /** The brands added from this list, by lowercase name. */
  added: ReadonlyMap<string, AddedBrand>;
  /** The project's entities, for the colors of the competitors it follows. */
  entries: readonly ProjectEntry[];
  open: boolean;
  /** Opens or closes the list. Closing reads the summary again when a competitor was added or taken off. */
  setOpen: (open: boolean) => void;
  /** The row flips at once; a toast offers Undo once the competitor exists, and an error takes the row back. */
  add: (name: string) => void;
  find: (name: string) => AddedBrand | undefined;
}

/**
 * The state behind "Add as competitor" of one Brands list. The summary is read again when the list closes, or at once on
 * Undo with the list already closed, never under the open list: a brand that is a tracked entity now has no answers
 * counted for it until the matcher has run again, and it would vanish from the list or read as a measured zero.
 */
export function useAddedBrands(project: PromptScope): AddedBrands {
  const t = useTranslations('prompts.lists.brands');
  const [open, setOpenState] = useState(false);
  const [added, setAdded] = useState<ReadonlyMap<string, AddedBrand>>(new Map());
  const openRef = useRef(false);
  const changed = useRef(false);
  const competitors = useCompetitors(project, open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const drop = (name: string): void =>
    setAdded((current) => {
      const next = new Map(current);
      next.delete(keyOf(name));
      return next;
    });

  const setOpen = (next: boolean): void => {
    setOpenState(next);
    if (next) return;
    setAdded((current) => new Map([...current].map(([name, entry]) => [name, { ...entry, fresh: false }])));
    if (changed.current) {
      changed.current = false;
      competitors.refresh();
    }
  };

  const undo = (name: string, result: AddedCompetitor): void => {
    competitors.remove(result.entityId).then(
      () => {
        drop(name);
        // Still open: its row flips back now and the tables follow when it closes
        if (openRef.current) changed.current = true;
        else competitors.refresh();
      },
      () => toast({ type: 'error', title: t('undoFailedTitle', { name }), description: t('tryAgain') }),
    );
  };

  const add = (name: string): void => {
    const flip = (colorIndex: number | null): void =>
      setAdded((current) => new Map(current).set(keyOf(name), { colorIndex, fresh: true }));
    flip(null);
    changed.current = true;
    competitors.add(name).then(
      (result) => {
        flip(result.colorIndex);
        toast({
          type: 'success',
          title: t('addedTitle', { name }),
          description: t('addedBody'),
          action: { label: t('undo'), onAction: () => undo(name, result) },
        });
      },
      () => {
        drop(name);
        toast({ type: 'error', title: t('addFailedTitle', { name }), description: t('tryAgain') });
      },
    );
  };

  return { added, entries: competitors.entries, open, setOpen, add, find: (name) => added.get(keyOf(name)) };
}
