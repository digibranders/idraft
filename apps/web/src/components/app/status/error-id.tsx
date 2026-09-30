'use client';

import { Copy } from 'lucide-react';
import type { ReactElement } from 'react';

import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/components/ui/toast';

export interface ErrorIdProps {
  id: string;
  /** "Error ID {id}", already filled in. */
  label: string;
  /** "Copy error ID". */
  copyLabel: string;
  /** "Error ID copied". */
  copiedLabel: string;
}

/**
 * The id support looks an error up by (17-empty-loading-error-states.md section 5.2): the request id of an
 * API problem, or the digest of a server error, in `type-mono`, with a button that copies it.
 */
export function ErrorId({ id, label, copyLabel, copiedLabel }: ErrorIdProps): ReactElement {
  const copy = (): void => {
    void navigator.clipboard
      .writeText(id)
      .then(() => toast({ type: 'success', title: copiedLabel }))
      // A browser that refuses the clipboard leaves the id on screen to select
      .catch(() => undefined);
  };
  return (
    <span className="flex items-center gap-1 type-meta">
      <span className="type-mono select-all">{label}</span>
      <IconButton icon={Copy} label={copyLabel} size="icon-xs" onClick={copy} />
    </span>
  );
}
