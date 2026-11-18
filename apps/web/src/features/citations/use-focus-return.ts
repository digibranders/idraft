'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Where focus goes when a drawer closes: the row that opened it (the table's `onOpen` hands it over as `opener`). The
 * inspector moves focus into its title on opening and leaves the return to the page. A drawer no row opened (a shared
 * link) has nowhere to return to, and neither has one whose row is gone.
 */
export function useFocusReturn(open: boolean): (opener: HTMLElement | null) => void {
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const row = opener.current;
      opener.current = null;
      if (row?.isConnected === true) row.focus();
    }
    wasOpen.current = open;
  }, [open]);
  return useCallback((from) => {
    opener.current = from;
  }, []);
}
