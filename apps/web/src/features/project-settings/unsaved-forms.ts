'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * The forms of General that keep changes of their own: the project's details, and the keyword defaults. A page
 * has one guard against leaving with unsaved changes, and one question for all of them, so each form tells the
 * page whether it is dirty and how it is put back, and the page asks once.
 */
export type UnsavedFormKey = 'details' | 'defaults';

const KEYS: readonly UnsavedFormKey[] = ['details', 'defaults'];

/** What one form hands the page. */
export interface UnsavedFormBinding {
  /** Says whether the form has changes that are not saved. */
  setDirty: (dirty: boolean) => void;
  /** Hands over what puts the form back to its saved values; the page calls it when the changes are discarded. */
  setDiscard: (discard: () => void) => void;
}

export interface UnsavedForms {
  /** Whether any of the forms has unsaved changes. */
  dirty: boolean;
  /** Puts every form back to its saved values. */
  discardAll: () => void;
  bindings: Readonly<Record<UnsavedFormKey, UnsavedFormBinding>>;
}

const keepAsIs = (): void => undefined;

/** Where the page keeps what puts each form back; plain data behind two functions, as the guard's registry is. */
function createDiscards(): {
  set: (key: UnsavedFormKey, discard: () => void) => void;
  run: () => void;
} {
  const held: Record<UnsavedFormKey, () => void> = { details: keepAsIs, defaults: keepAsIs };
  return {
    set: (key, discard) => {
      held[key] = discard;
    },
    run: () => {
      for (const key of KEYS) held[key]();
    },
  };
}

/** The page's side: which forms are dirty, and a way to discard what they hold. */
export function useUnsavedForms(): UnsavedForms {
  const [dirty, setDirty] = useState<Readonly<Record<UnsavedFormKey, boolean>>>({ details: false, defaults: false });
  const [discards] = useState(createDiscards);
  const bindings = useMemo((): Record<UnsavedFormKey, UnsavedFormBinding> => {
    const bind = (key: UnsavedFormKey): UnsavedFormBinding => ({
      setDirty: (value) => setDirty((current) => (current[key] === value ? current : { ...current, [key]: value })),
      setDiscard: (discard) => discards.set(key, discard),
    });
    return { details: bind('details'), defaults: bind('defaults') };
  }, [discards]);
  return { dirty: KEYS.some((key) => dirty[key]), discardAll: discards.run, bindings };
}

/** A form's side: reports whether it is dirty, and how it is put back, to the page that asks. */
export function useReportUnsaved(binding: UnsavedFormBinding, dirty: boolean, discard: () => void): void {
  useEffect(() => {
    binding.setDiscard(discard);
  });
  useEffect(() => {
    binding.setDirty(dirty);
    // A form that goes away holds nothing the page could lose
    return () => binding.setDirty(false);
  }, [binding, dirty]);
}
