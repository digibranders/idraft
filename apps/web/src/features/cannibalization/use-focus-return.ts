'use client';

import { useCallback, useEffect, useRef } from 'react';

/** The button of the table row whose id is `id` (a `BoardTable` row carries `data-id`), if the table shows it. */
function rowButton(id: string | null): HTMLElement | null {
  if (id === null) return null;
  const row = [...document.querySelectorAll<HTMLElement>('tr[data-id]')].find((entry) => entry.dataset.id === id);
  return row?.querySelector<HTMLElement>('button') ?? null;
}

/**
 * Where focus goes when a drawer closes. `openId` is the keyword the drawer is open on (`null` when closed). Opened
 * from a row, focus returns to that row's button; after J or K stepped to another keyword, to the row of the keyword
 * the drawer closes on; opened from a popover (no opener), to that keyword's row. The inspector moves focus into its
 * title on opening and leaves the return to the page. A shared link has nowhere to return to, and neither has a row
 * that is gone.
 */
export function useFocusReturn(openId: string | null): (opener: HTMLElement | null) => void {
  const opener = useRef<HTMLElement | null>(null);
  const openedOn = useRef<string | null>(openId);
  const lastId = useRef<string | null>(openId);
  const wasOpen = useRef(openId !== null);
  const open = openId !== null;
  useEffect(() => {
    if (open) {
      if (!wasOpen.current) openedOn.current = openId;
      lastId.current = openId;
    } else if (wasOpen.current) {
      const from = opener.current?.isConnected === true ? opener.current : null;
      const stepped = lastId.current !== openedOn.current;
      const target = stepped ? (rowButton(lastId.current) ?? from) : (from ?? rowButton(lastId.current));
      opener.current = null;
      lastId.current = null;
      target?.focus();
    }
    wasOpen.current = open;
  }, [open, openId]);
  return useCallback((from) => {
    opener.current = from;
  }, []);
}
