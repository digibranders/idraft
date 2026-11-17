'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { searchText } from '../url-state';

/**
 * The text of a table's search box (13-filters-search.md section 6) over a search kept in the address. The address
 * holds the search trimmed, and what comes back from it must not replace what is being typed ("seo " would become
 * "seo" and the next word would join it), so the box keeps its own draft. The draft is written to the address
 * once typing pauses for `delay` ms, trimmed; an address that changes from anywhere else (Clear filters, Back) is
 * taken into the draft at once.
 */
export function useSearchDraft(
  address: string | null,
  write: (search: string | null) => void,
  delay: number,
): { draft: string; setDraft: (text: string) => void } {
  const [draft, setDraftState] = useState(address ?? '');
  const timer = useRef<number | null>(null);
  // The address as this box last wrote it or took it, to tell its own writes from other changes
  const known = useRef(address);
  const writeRef = useRef(write);
  useEffect(() => {
    writeRef.current = write;
  });
  const stop = useCallback((): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    if (address === known.current) return;
    known.current = address;
    stop();
    setDraftState(address ?? '');
  }, [address, stop]);
  useEffect(() => stop, [stop]);

  const setDraft = useCallback(
    (text: string): void => {
      setDraftState(text);
      stop();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const next = searchText(text);
        if (next === known.current) return;
        known.current = next;
        writeRef.current(next);
      }, delay);
    },
    [delay, stop],
  );
  return { draft, setDraft };
}
