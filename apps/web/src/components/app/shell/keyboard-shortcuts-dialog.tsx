'use client';

import type { ReactElement } from 'react';

import { Dialog, DialogBody, DialogHeader } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';

export interface ShortcutEntry {
  id: string;
  /** What the keys do: "Collapse or expand the sidebar". */
  label: string;
  keys: readonly string[];
}

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One sentence on when single-key shortcuts work. */
  description: string;
  closeLabel: string;
  shortcuts: readonly ShortcutEntry[];
}

/**
 * The shortcuts that exist on this page (11-navigation.md section 7), opened from the Help menu. Every one
 * is also reachable without the keyboard, so none is required (WCAG 2.1.4).
 */
export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  shortcuts,
}: KeyboardShortcutsDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <DialogHeader title={title} description={description} closeLabel={closeLabel} />
      <DialogBody>
        <dl className="flex flex-col divide-y divide-border-subtle">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.id} className="flex items-center justify-between gap-4 py-2">
              <dt className="type-body text-foreground">{shortcut.label}</dt>
              <dd>
                <Kbd keys={shortcut.keys} singleKey="always" />
              </dd>
            </div>
          ))}
        </dl>
      </DialogBody>
    </Dialog>
  );
}
