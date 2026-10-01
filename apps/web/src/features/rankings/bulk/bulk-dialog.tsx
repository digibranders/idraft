'use client';

import { useTranslations } from 'next-intl';
import type { FormEvent, ReactElement, ReactNode, RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';

export interface BulkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Priority for 12 keywords". */
  title: string;
  description?: string | undefined;
  /** Repeats the verb and the count: "Set for 12 keywords". */
  submitLabel: string;
  pending: boolean;
  /** Why the change was not made, shown above the fields. */
  alert: string | null;
  /** Whether a field holds a choice: closing then asks first. */
  dirty: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Where focus goes when the dialog closes, when what opened it went with the change. */
  finalFocus: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * The 400 px dialog of a bulk change to the chosen keywords (16-drawers-dialogs-popovers.md section 4):
 * the count in the title and on the primary button, one or two fields, and the reason when the change was
 * not made. While the change runs the dialog stays, so its answer lands in it.
 */
export function BulkDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  pending,
  alert,
  dirty,
  onSubmit,
  finalFocus,
  children,
}: BulkDialogProps): ReactElement {
  const common = useTranslations('common');
  const discard = useTranslations('account.discard');
  const t = useTranslations('rankings.bulk');
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else if (!pending) onOpenChange(false);
      }}
      size="sm"
      finalFocus={finalFocus}
      dirty={dirty}
      discard={{
        title: discard('title'),
        description: t('discardDescription'),
        keepEditingLabel: discard('keepEditing'),
        discardLabel: discard('discard'),
      }}
    >
      <form noValidate className="contents" onSubmit={onSubmit}>
        <DialogHeader title={title} description={description} closeLabel={common('close')} />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          {children}
        </DialogBody>
        <DialogFooter
          secondary={
            <DialogClose>
              <Button type="button" variant="secondary">
                {common('cancel')}
              </Button>
            </DialogClose>
          }
          primary={
            <Button type="submit" variant="primary" loading={pending}>
              {submitLabel}
            </Button>
          }
        />
      </form>
    </Dialog>
  );
}
