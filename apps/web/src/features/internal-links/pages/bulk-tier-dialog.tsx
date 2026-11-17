'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { gridFocus } from '@/components/app/data-table/grid-focus';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { RadioGroup } from '@/components/ui/radio-group';
import type { PageTier } from '@/lib/internal-links/types';

/** The two choices that are not a tier of the workspace. */
const UNTIERED = 'untiered';
const RESET = 'reset';

/** Set tier for the selection: each tier, Untiered (set by hand), or back to the tier the rules give (mock `bulkBar`). */
export function BulkTierDialog({
  open,
  onOpenChange,
  count,
  tiers,
  pending,
  alert,
  onSetTier,
  onReset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  tiers: readonly PageTier[];
  pending: boolean;
  /** Why the last change was not made, shown at the top of the body. */
  alert: string | null;
  /** Each answers whether the change was made; the dialog closes then, and stays open to try again when not. */
  onSetTier: (tier: PageTier | null) => Promise<boolean>;
  onReset: () => Promise<boolean>;
}): ReactElement {
  const t = useTranslations('internalLinks.bulk');
  const common = useTranslations('common');
  const [choice, setChoice] = useState<string | null>(null);
  // The change clears the selection before the dialog is gone: the title keeps the count it was opened for
  const [shown, setShown] = useState(count);
  if (open && count > 0 && count !== shown) setShown(count);
  const close = (): void => {
    setChoice(null);
    onOpenChange(false);
  };
  const apply = async (): Promise<void> => {
    if (choice === null) return;
    const made =
      choice === RESET
        ? await onReset()
        : await onSetTier(choice === UNTIERED ? null : (tiers.find((tier) => tier.tier_id === choice) ?? null));
    if (made) close();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else if (!pending) close();
      }}
      size="sm"
      finalFocus={gridFocus}
    >
      <form
        noValidate
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          void apply();
        }}
      >
        <DialogHeader title={t('setTierTitle', { count: shown })} closeLabel={common('close')} />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          <RadioGroup
            legend={t('tierLegend')}
            value={choice}
            onValueChange={setChoice}
            options={[
              ...tiers.map((tier) => ({
                value: tier.tier_id,
                label: tier.label,
                description: tier.description === '' ? undefined : tier.description,
              })),
              { value: UNTIERED, label: t('untiered') },
              { value: RESET, label: t('resetToRule'), description: t('resetToRuleHint') },
            ]}
          />
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
            <Button type="submit" variant="primary" disabled={choice === null} loading={pending}>
              {t('apply')}
            </Button>
          }
        />
      </form>
    </Dialog>
  );
}
