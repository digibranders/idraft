'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { gridFocus } from '@/components/app/data-table/grid-focus';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { Select } from '@/components/ui/select';
import { TextLink } from '@/components/ui/text-link';

export interface TagChoice {
  termId: string;
  name: string;
}

/** How the read of the tag vocabularies stands: the dialog says so before it says there are none. */
export interface TagVocabularyState {
  pending: boolean;
  error: boolean;
  retry: () => void;
}

type Mode = 'add' | 'remove';

/** Add or remove one term of the project's or the workspace's `tag` vocabularies for the selection (spec 5.3). */
export function BulkTagDialog({
  mode,
  onClose,
  count,
  tags,
  vocabularies,
  taxonomyHref,
  pending,
  alert,
  onApply,
}: {
  /** `null` while the dialog is closed. */
  mode: Mode | null;
  onClose: () => void;
  count: number;
  tags: readonly TagChoice[];
  vocabularies: TagVocabularyState;
  taxonomyHref: Route;
  pending: boolean;
  /** Why the last change was not made, shown at the top of the body. */
  alert: string | null;
  /** Answers whether the change was made; the dialog closes then, and stays open to try again when not. */
  onApply: (tag: TagChoice, add: boolean) => Promise<boolean>;
}): ReactElement {
  const t = useTranslations('internalLinks.bulk');
  const common = useTranslations('common');
  const [termId, setTermId] = useState<string | null>(null);
  // The change clears the selection and closes the dialog: the title keeps the words it was opened with while it leaves
  const [shown, setShown] = useState<{ mode: Mode; count: number }>({ mode: 'add', count });
  if (mode !== null && count > 0 && (shown.mode !== mode || shown.count !== count)) setShown({ mode, count });
  const tag = tags.find((candidate) => candidate.termId === termId) ?? null;
  const close = (): void => {
    setTermId(null);
    onClose();
  };
  const apply = async (): Promise<void> => {
    if (tag !== null && mode !== null && (await onApply(tag, mode === 'add'))) close();
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
      <form
        noValidate
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          void apply();
        }}
      >
        <DialogHeader
          title={t(shown.mode === 'remove' ? 'removeTagTitle' : 'addTagTitle', { count: shown.count })}
          closeLabel={common('close')}
        />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          {vocabularies.pending ? (
            <p className="type-body text-foreground-secondary">{t('tagsLoading')}</p>
          ) : vocabularies.error ? (
            <InlineError
              title={t('tagsFailed')}
              reason={t('tagsFailedReason')}
              errorId={null}
              onRetry={vocabularies.retry}
              retrying={false}
              retryLabel={common('retry')}
            />
          ) : tags.length === 0 ? (
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
              <Button type="button" variant="secondary">
                {common('cancel')}
              </Button>
            </DialogClose>
          }
          primary={
            <Button type="submit" variant="primary" disabled={tag === null} loading={pending}>
              {t('apply')}
            </Button>
          }
        />
      </form>
    </Dialog>
  );
}
