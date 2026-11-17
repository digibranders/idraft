'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { PageTier } from '@/lib/internal-links/types';

const NAME_MAX = 60;
const DESCRIPTION_MAX = 200;
/** The API's value for "no tier". */
const UNTIERED = 'none';

/**
 * Add a tier (`tier` is `null`) or rename one: the name is 1 to 60 characters, the description up to 200, and the
 * code stays. `failure` is the sentence of the catalog for why the last save failed, never the server's words.
 */
export function TierFormDialog({
  open,
  tier,
  pending,
  failure,
  onClose,
  onSave,
}: {
  open: boolean;
  tier: PageTier | null;
  pending: boolean;
  failure: string | null;
  onClose: () => void;
  onSave: (name: string, description: string) => void;
}): ReactElement {
  const t = useTranslations('pageTiers');
  const common = useTranslations('common');
  const [name, setName] = useState(tier?.name ?? '');
  const [description, setDescription] = useState(tier?.description ?? '');
  const [tried, setTried] = useState(false);
  const nameBad = name.trim().length < 1 || name.trim().length > NAME_MAX;
  const descriptionBad = description.trim().length > DESCRIPTION_MAX;
  const dirty = name !== (tier?.name ?? '') || description !== (tier?.description ?? '');
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      size="sm"
      dirty={dirty}
      discard={{
        title: t('discardTitle'),
        description: t('discardText'),
        keepEditingLabel: t('keepEditing'),
        discardLabel: t('discard'),
      }}
    >
      <DialogHeader
        title={tier === null ? t('addTitle') : t('renameTitle')}
        description={tier === null ? t('addDescription') : t('renameDescription', { code: tier.code })}
        closeLabel={common('close')}
      />
      <DialogBody>
        {failure === null ? null : <FormAlert message={failure} />}
        <Field invalid={tried && nameBad}>
          <FieldLabel>{t('nameLabel')}</FieldLabel>
          <Input value={name} onValueChange={setName} />
          <FieldDescription>{t('nameHint')}</FieldDescription>
          {tried && nameBad ? <FieldError message={t('nameError')} /> : null}
        </Field>
        <Field invalid={tried && descriptionBad}>
          <FieldLabel>{t('descriptionLabel')}</FieldLabel>
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          <FieldDescription>{t('descriptionHint')}</FieldDescription>
          {tried && descriptionBad ? <FieldError message={t('descriptionError')} /> : null}
        </Field>
      </DialogBody>
      <DialogFooter
        primary={
          <Button
            variant="primary"
            loading={pending}
            onClick={() => {
              setTried(true);
              if (!nameBad && !descriptionBad) onSave(name.trim(), description.trim());
            }}
          >
            {t('save')}
          </Button>
        }
        secondary={
          // Through the dialog's own close, so a form with changes asks first
          <DialogClose>
            <Button type="button" variant="secondary" disabled={pending}>
              {common('cancel')}
            </Button>
          </DialogClose>
        }
      />
    </Dialog>
  );
}

/**
 * Delete a tier. One that pages or rules use must say where they go (another tier or Untiered): the choice starts
 * empty and the button waits for it, so nothing moves by default. The words name the page count, and say that the
 * codes close up. An unused tier only asks to confirm.
 */
export function DeleteTierDialog({
  tier,
  tiers,
  pending,
  failure,
  onClose,
  onDelete,
}: {
  tier: PageTier | null;
  tiers: readonly PageTier[];
  pending: boolean;
  failure: string | null;
  onClose: () => void;
  /** `null` for a tier nothing uses; else a tier id or `none`. */
  onDelete: (moveTo: string | null) => void;
}): ReactElement {
  const t = useTranslations('pageTiers');
  const common = useTranslations('common');
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const inUse = tier !== null && (tier.page_count > 0 || tier.rule_count > 0);
  const later = tier === null ? undefined : tiers.find((candidate) => candidate.position === tier.position + 1);
  const options = [
    ...tiers
      .filter((candidate) => candidate.tier_id !== tier?.tier_id)
      .map((candidate) => ({ value: candidate.tier_id, label: candidate.label })),
    { value: UNTIERED, label: t('untiered') },
  ];
  return (
    <Dialog open={tier !== null} onOpenChange={(next) => (next ? undefined : onClose())} size="sm">
      <DialogHeader title={t('deleteTitle', { code: tier?.code ?? '' })} closeLabel={common('close')} />
      <DialogBody>
        {failure === null ? null : <FormAlert message={failure} />}
        <p className="type-body text-foreground">
          {tier === null
            ? null
            : inUse
              ? t('deleteInUse', { pages: tier.page_count, rules: tier.rule_count, label: tier.label })
              : t('deleteEmpty', { label: tier.label })}
        </p>
        {inUse ? (
          <Select<string>
            aria-label={t('moveTo')}
            value={moveTo}
            onValueChange={setMoveTo}
            placeholder={t('moveToPlaceholder')}
            options={options}
          />
        ) : null}
        {later === undefined || tier === null ? null : (
          <p className="type-meta text-foreground-secondary">{t('closeUp', { from: later.code, to: tier.code })}</p>
        )}
      </DialogBody>
      <DialogFooter
        primary={
          <Button
            variant="destructive-solid"
            disabled={inUse && moveTo === null}
            loading={pending}
            onClick={() => onDelete(inUse ? moveTo : null)}
          >
            {t('deleteConfirm', { code: tier?.code ?? '' })}
          </Button>
        }
        secondary={
          <Button variant="secondary" onClick={onClose}>
            {common('cancel')}
          </Button>
        }
      />
    </Dialog>
  );
}
