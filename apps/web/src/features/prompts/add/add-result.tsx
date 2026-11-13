'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement, Ref } from 'react';

import { Button } from '@/components/ui/button';
import { DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';

export interface Outcome {
  created: number;
  skipped: number;
  rejected: { line: number; reason: string }[];
}

/**
 * What an add that skipped or refused a line says in place of the form: how many were added and tracked already,
 * and each refused line with its reason. The focus goes to Done when it appears.
 */
export function AddResult({
  outcome,
  doneRef,
  onDone,
}: {
  outcome: Outcome;
  doneRef: Ref<HTMLButtonElement>;
  onDone: () => void;
}): ReactElement {
  const t = useTranslations('prompts.add');
  const common = useTranslations('common');
  return (
    <>
      <DialogHeader title={t('resultTitle')} closeLabel={common('close')} />
      <DialogBody>
        <p className="type-body">{t('resultCreated', { count: outcome.created })}</p>
        {outcome.skipped === 0 ? null : <p className="type-body">{t('resultSkipped', { count: outcome.skipped })}</p>}
        {outcome.rejected.length === 0 ? null : (
          <>
            <p className="type-body-strong">{t('rejectedTitle', { count: outcome.rejected.length })}</p>
            <ul className="flex flex-col gap-1">
              {outcome.rejected.map((entry) => (
                <li key={entry.line} className="type-meta">
                  {t('rejectedLine', { line: entry.line, reason: entry.reason })}
                </li>
              ))}
            </ul>
          </>
        )}
      </DialogBody>
      <DialogFooter
        primary={
          <Button ref={doneRef} variant="primary" onClick={onDone}>
            {t('done')}
          </Button>
        }
      />
    </>
  );
}
