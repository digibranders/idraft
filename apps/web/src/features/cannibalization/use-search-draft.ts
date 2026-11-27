'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the address waits for the next key before it takes the search (250 ms, as the Citations page). */
export const SEARCH_DELAY_MS = 250;

/**
 * The text of a search input and when it reaches the address. The input keeps what is typed, spaces included (the
 * address holds the trimmed text, so it cannot be the input's value: "crm " would come back as "crm" and the next word
 * could not be started). The trimmed text is written once typing pauses, and only when it differs from the address. An
 * address that changes by itself (Back, an old link) replaces the input's text and drops a write that was waiting.
 */
export function useSearchDraft(
  settled: string,
  commit: (search: string) => void,
): readonly [draft: string, setDraft: (search: string) => void] {
  const [draft, setDraftState] = useState(settled);
  // What the address holds because of this input; a different `settled` is somebody else's write
  const written = useRef(settled);
  const timer = useRef<number | undefined>(undefined);
  const latestCommit = useRef(commit);
  useEffect(() => {
    latestCommit.current = commit;
  }, [commit]);
  useEffect(() => {
    if (settled === written.current) return;
    written.current = settled;
    window.clearTimeout(timer.current);
    setDraftState(settled);
  }, [settled]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const setDraft = useCallback((search: string): void => {
    setDraftState(search);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const next = search.trim();
      if (next === written.current) return;
      written.current = next;
      latestCommit.current(next);
    }, SEARCH_DELAY_MS);
  }, []);
  return [draft, setDraft];
}
