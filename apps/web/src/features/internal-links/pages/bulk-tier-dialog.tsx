'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { gridFocus } from '@/components/app/data-table/grid-focus';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
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
  onSetTier,
  onReset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  tiers: readonly PageTier[];
  pending: boolean;
  /** Each answers whether the change was made; the dialog closes then, and stays open to try again when not. */
  onSetTier: (tier: PageTier | null) => Promise<boolean>;
  onReset: () => Promise<boolean>;
}): ReactElement {
  const t = useTranslations('internalLinks.bulk');
  const common = useTranslations('common');
  const [choice, setChoice] = useState<string | null>(null);
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
      <DialogHeader title={t('setTierTitle', { count })} closeLabel={common('close')} />
      <DialogBody>
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
            <Button variant="secondary">{common('cancel')}</Button>
          </DialogClose>
        }
        primary={
          <Button variant="primary" disabled={choice === null} loading={pending} onClick={() => void apply()}>
            {t('apply')}
          </Button>
        }
      />
    </Dialog>
  );
}
