'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { gridFocus } from '@/components/app/data-table/grid-focus';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { TextLink } from '@/components/ui/text-link';

export interface TagChoice {
  termId: string;
  name: string;
}

/** Add or remove one term of the project's or the workspace's `tag` vocabularies for the selection (spec 5.3). */
export function BulkTagDialog({
  mode,
  onClose,
  count,
  tags,
  taxonomyHref,
  pending,
  onApply,
}: {
  /** `null` while the dialog is closed. */
  mode: 'add' | 'remove' | null;
  onClose: () => void;
  count: number;
  tags: readonly TagChoice[];
  taxonomyHref: Route;
  pending: boolean;
  /** Answers whether the change was made; the dialog closes then, and stays open to try again when not. */
  onApply: (tag: TagChoice, add: boolean) => Promise<boolean>;
}): ReactElement {
  const t = useTranslations('internalLinks.bulk');
  const common = useTranslations('common');
  const [termId, setTermId] = useState<string | null>(null);
  const tag = tags.find((candidate) => candidate.termId === termId) ?? null;
  const close = (): void => {
    setTermId(null);
    onClose();
  };
  const apply = async (): Promise<void> => {
    if (tag !== null && (await onApply(tag, mode !== 'remove'))) close();
  };
  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(next) => {
        if (!next && !pending) close();
      }}
      size="sm"
      finalFocus={gridFocus}
    >
      <DialogHeader
        title={t(mode === 'remove' ? 'removeTagTitle' : 'addTagTitle', { count })}
        closeLabel={common('close')}
      />
      <DialogBody>
        {tags.length === 0 ? (
          <p className="type-body text-foreground-secondary">
            {t('noTags')}{' '}
            <TextLink variant="inline" render={<Link href={taxonomyHref} />}>
              {t('noTagsLink')}
            </TextLink>
          </p>
        ) : (
          <Field>
            <FieldLabel>{t('tag')}</FieldLabel>
            <Select
              value={termId}
              onValueChange={setTermId}
              placeholder={t('tagPlaceholder')}
              options={tags.map((candidate) => ({ value: candidate.termId, label: candidate.name }))}
            />
          </Field>
        )}
      </DialogBody>
      <DialogFooter
        secondary={
          <DialogClose>
            <Button variant="secondary">{common('cancel')}</Button>
          </DialogClose>
        }
        primary={
          <Button variant="primary" disabled={tag === null} loading={pending} onClick={() => void apply()}>
            {t('apply')}
          </Button>
        }
      />
    </Dialog>
  );
}
