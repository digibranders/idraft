'use client';

import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react';

import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { copyText } from '@/lib/dom/clipboard';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';
import { cn } from '@/lib/utils';

/** How long the check stays in place of the Copy glyph (09-buttons-controls.md section 9.1). */
export const CONFIRMED_MS = 2000;

export interface CopyButtonProps {
  /** What is copied, exactly: the original value, never what the cell shows of it. */
  text: string;
  /** The name and tooltip: what it copies, "Copy keyword seo agency". */
  label: string;
  /** What a screen reader hears after a copy, politely: "Keyword copied". */
  announcement: string;
  /**
   * `overlay` lies over the end of the cell's content, which its wrapper (`relative`, `bg-inherit`) holds, so
   * the content does not give up any width for it. `inline` is a place of its own beside the content.
   */
  placement?: 'overlay' | 'inline' | undefined;
}

/**
 * A small button that copies one value from a table cell (12-tables.md section 6, 09-buttons-controls.md
 * section 9.1). It is out of the grid's tab order and marked for the table, which reaches it with F2. It is
 * drawn only when the row is hovered, when the cell or something in it has focus, and always on a touch
 * screen; hiding is by opacity alone, so it is there for the keyboard and for a screen reader all the time.
 * A copy shows a check for 2 seconds and is announced; a copy the browser refuses is an error toast, the
 * one toast for a direct action, since an icon button has no room for the words. Its clicks stop here, so
 * the row around it does not open.
 */
export function CopyButton({ text, label, announcement, placement = 'overlay' }: CopyButtonProps): ReactElement {
  const t = useTranslations('common.copy');
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);
  const copy = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    void copyText(text).then((done) => {
      if (!done) {
        toast({ type: 'error', title: t('failed') });
        return;
      }
      announce(announcement, { key: 'copy' });
      // The row may have scrolled away while the browser answered
      if (!mounted.current) return;
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), CONFIRMED_MS);
    });
  };
  return (
    <span
      data-copied={copied ? '' : undefined}
      className={cn(
        'flex items-center opacity-0 group-focus-within/cell:opacity-100 group-hover:opacity-100 data-copied:opacity-100 pointer-coarse:opacity-100',
        placement === 'overlay' ? 'absolute inset-y-0 right-0 bg-inherit pl-1' : 'shrink-0',
      )}
    >
      <IconButton
        {...CELL_CONTROL}
        icon={copied ? Check : Copy}
        label={copied ? t('copied') : label}
        size="icon-xs"
        className={cn(copied && 'text-positive-text')}
        onClick={copy}
        onAuxClick={(event) => event.stopPropagation()}
      />
    </span>
  );
}
