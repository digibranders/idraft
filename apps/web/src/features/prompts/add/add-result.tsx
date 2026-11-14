'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode, Ref } from 'react';

import { Button } from '@/components/ui/button';
import { DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { Truncate } from '@/components/ui/truncate';
import { copyText } from '@/lib/dom/clipboard';

/** A line of the pasted list, as the person saw it, and the project's prompt it is when it is one. */
export interface OutcomeLine {
  line: number;
  text: string;
  promptId: string | null;
}

export interface Outcome {
  /** The language of the lines, for `lang`. */
  language: string;
  /** The prompts the add created. */
  created: readonly string[];
  /** The project tracks these already: the check found them, or the API skipped them (someone added them meanwhile). */
  tracked: OutcomeLine[];
  /** Archived and left archived, because Restore was off. */
  archived: OutcomeLine[];
  /** The API refused these. */
  rejected: (OutcomeLine & { reason: string })[];
  /** How many archived prompts the add brought back. */
  restored: number;
  /** The archived prompts that could not be brought back, and why: the created prompts stay. */
  restoreFailed: { lines: OutcomeLine[]; reason: string } | null;
}

/** The lines that were not added, one each in the order they were typed: what "Copy the lines not added" copies. */
export function notAddedText(outcome: Outcome): string {
  return [...outcome.tracked, ...outcome.archived, ...outcome.rejected, ...(outcome.restoreFailed?.lines ?? [])]
    .sort((a, b) => a.line - b.line)
    .map((entry) => entry.text)
    .join('\n');
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="type-subsection-title">{title}</h3>
      {children}
    </section>
  );
}

function Lines({
  lines,
  language,
  onShow,
}: {
  lines: readonly OutcomeLine[];
  language: string;
  onShow: (promptId: string) => void;
}): ReactElement {
  const t = useTranslations('prompts.add.check');
  return (
    <ul className="flex flex-col divide-y divide-border-subtle">
      {lines.map((entry) => (
        <li key={entry.line} className="flex min-w-0 items-baseline gap-2 py-1.5">
          <span className="shrink-0 num type-label text-foreground-secondary">{t('line', { line: entry.line })}</span>
          <Truncate text={entry.text} lang={language} className="min-w-0 flex-1 type-body" />
          {entry.promptId === null ? null : (
            <Button
              variant="link"
              size="sm"
              aria-label={t('showItLabel', { line: entry.line })}
              onClick={() => onShow(entry.promptId ?? '')}
            >
              {t('showIt')}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * What an add that skipped or refused a line, or could not bring an archived one back, says in place of the form
 * (prompt-dialogs 4.6): how many were added, and each line that was not, with its reason and a way to its prompt. The
 * focus goes to Done when it appears.
 */
export function AddResult({
  outcome,
  doneRef,
  onDone,
  onShow,
  onAsk,
}: {
  outcome: Outcome;
  doneRef: Ref<HTMLButtonElement>;
  onDone: () => void;
  /** Shows the project's prompt of a line. */
  onShow: (promptId: string) => void;
  /** Asks the created prompts now; `null` when the person cannot, or the add asked already. */
  onAsk: (() => void) | null;
}): ReactElement {
  const t = useTranslations('prompts.add');
  const common = useTranslations('common');
  const copy = notAddedText(outcome);
  return (
    <>
      <DialogHeader title={t('resultTitle')} closeLabel={common('close')} />
      <DialogBody>
        <p className="type-body">{t('resultCreated', { count: outcome.created.length })}</p>
        {outcome.restored === 0 ? null : (
          <p className="type-body">{t('resultRestored', { count: outcome.restored })}</p>
        )}
        {outcome.restoreFailed === null ? null : (
          <Section title={t('restoreFailedTitle', { count: outcome.restoreFailed.lines.length })}>
            <p className="type-meta text-foreground-secondary">{outcome.restoreFailed.reason}</p>
            <Lines lines={outcome.restoreFailed.lines} language={outcome.language} onShow={onShow} />
          </Section>
        )}
        {outcome.tracked.length === 0 ? null : (
          <Section title={t('resultTracked', { count: outcome.tracked.length })}>
            <Lines lines={outcome.tracked} language={outcome.language} onShow={onShow} />
          </Section>
        )}
        {outcome.archived.length === 0 ? null : (
          <Section title={t('resultArchived', { count: outcome.archived.length })}>
            <Lines lines={outcome.archived} language={outcome.language} onShow={onShow} />
          </Section>
        )}
        {outcome.rejected.length === 0 ? null : (
          <Section title={t('rejectedTitle', { count: outcome.rejected.length })}>
            <ul className="flex flex-col divide-y divide-border-subtle">
              {outcome.rejected.map((entry) => (
                <li key={entry.line} className="flex flex-col py-1.5">
                  <p className="type-meta">{t('rejectedLine', { line: entry.line, reason: entry.reason })}</p>
                  <Truncate text={entry.text} lang={outcome.language} className="type-body" />
                </li>
              ))}
            </ul>
          </Section>
        )}
      </DialogBody>
      <DialogFooter
        secondary={
          <>
            {copy === '' ? null : (
              <Button
                variant="secondary"
                onClick={() => {
                  void copyText(copy).then((copied) =>
                    toast(
                      copied
                        ? { type: 'success', title: t('copied') }
                        : { type: 'error', title: common('copy.failed') },
                    ),
                  );
                }}
              >
                {t('copyLines')}
              </Button>
            )}
            {onAsk === null ? null : (
              <Button variant="secondary" onClick={onAsk}>
                {t('askNow')}
              </Button>
            )}
          </>
        }
        primary={
          <Button ref={doneRef} variant="primary" onClick={onDone}>
            {t('done')}
          </Button>
        }
      />
    </>
  );
}
