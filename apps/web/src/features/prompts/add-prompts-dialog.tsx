'use client';

import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { AddResult } from './add/add-result';
import { CheckList } from './add/check-list';
import { DetailsSection } from './add/details-section';
import { MarketFields } from './add/market-fields';
import { useAddForm } from './add/use-add-form';
import { BULK_MAX } from './prompt-model';
import type { PromptScope } from './prompt-queries';
import { TopicPicker } from './topic-picker/topic-picker';
import { FormField } from '@/components/app/forms/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { Icon } from '@/components/ui/icon';
import { Textarea } from '@/components/ui/textarea';
import type { ProjectEngine, Prompt } from '@/lib/api/types';
import { formatInteger, formatList } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The findings named under the field before the rest are counted. */
const SHOWN_FINDINGS = 5;

const FINDING_ICON = { error: CircleAlert, warning: TriangleAlert, note: Info } as const;
const FINDING_CLASS = {
  error: cn('text-negative-text'),
  warning: cn('text-warning-text'),
  note: cn('text-foreground-secondary'),
} as const;

export interface AddPromptsDialogProps {
  scope: PromptScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project's enabled engines: their countries and their length limits apply. */
  engines: readonly ProjectEngine[];
  /** The project's loaded active prompts, which decide what is tracked while the lint cannot say. */
  existing: readonly Prompt[];
  /**
   * What the form starts on: the project's language and country, and a topic when the dialog opens from one
   * (a new topic means a new dialog: give it a `key`, as the form is made once).
   */
  defaults: { languageCode: string | null; countryIso: string | null; termId?: string | null };
}

/**
 * Add prompts (prompt-dialogs 4): one field for one prompt or a pasted list, one per line, with the market, the
 * topics and the details they share. Each line is checked before anything is saved (`useAddCheck`): the lint says
 * what the project tracks, a repeat and a tracked prompt are left out, and a line the API would refuse blocks the
 * add. The form, the check and the submit live in `add/`; this is the frame that puts them in order.
 */
export function AddPromptsDialog({
  scope,
  open,
  onOpenChange,
  engines,
  existing,
  defaults,
}: AddPromptsDialogProps): ReactElement {
  const t = useTranslations('prompts.add');
  const common = useTranslations('common');
  const discard = useTranslations('account.discard');
  const locale = useLocale();
  const add = useAddForm({ scope, open, onOpenChange, engines, existing, defaults });
  const { form, check, findings, quota, outcome } = add;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else if (!add.pending) add.close();
      }}
      size="md"
      dirty={outcome === null && form.formState.isDirty}
      discard={{
        title: discard('title'),
        description: t('discardDescription'),
        keepEditingLabel: discard('keepEditing'),
        discardLabel: discard('discard'),
      }}
    >
      {outcome === null ? (
        <form noValidate className="contents" onSubmit={add.submit}>
          <DialogHeader
            title={t('title')}
            description={
              engines.length === 0
                ? t('descriptionNoEngine')
                : t('descriptionEngines', {
                    engines: formatList(
                      engines.map((engine) => engine.engine.label),
                      locale,
                    ),
                  })
            }
            closeLabel={common('close')}
          />
          <DialogBody>
            {add.alert === null ? null : <FormAlert message={add.alert} />}
            <FormField
              control={form.control}
              name="text"
              label={t('prompts')}
              description={t('promptsHint', { max: formatInteger(BULK_MAX) })}
              render={(field) => (
                <Textarea
                  {...field.controlProps}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                  spellCheck={false}
                  submitOnModEnter
                  counter={check.counter}
                  counterOver={check.counts.lines - check.counts.repeats > BULK_MAX}
                />
              )}
            />
            {findings.length === 0 ? null : (
              <ul aria-label={t('findingsLabel')} className="flex flex-col gap-1">
                {findings.slice(0, SHOWN_FINDINGS).map((finding) => (
                  <li
                    key={`${String(finding.line)} ${finding.text}`}
                    className={cn('flex items-start gap-1.5 type-meta', FINDING_CLASS[finding.tone])}
                  >
                    <Icon icon={FINDING_ICON[finding.tone]} size="sm" className="mt-0.5" />
                    {finding.text}
                  </li>
                ))}
                {findings.length > SHOWN_FINDINGS ? (
                  <li className="type-meta">{t('moreFindings', { count: findings.length - SHOWN_FINDINGS })}</li>
                ) : null}
              </ul>
            )}
            <CheckList
              rows={check.rows}
              checking={check.checking}
              failed={check.failed}
              needsCountry={check.needsCountry}
              restore={null}
              onShow={null}
            />
            <MarketFields
              control={form.control}
              engines={engines}
              countries={add.countries.countries}
              countriesFailed={add.countries.isError}
              onRetry={add.countries.retry}
            />
            <FormField
              control={form.control}
              name="topics"
              label={t('topics')}
              optional
              render={(field) => (
                <TopicPicker
                  scope={scope}
                  inputRef={field.ref}
                  onBlur={field.onBlur}
                  aria-required={field.required}
                  value={field.value}
                  onValueChange={(chosen) => field.onChange([...chosen])}
                />
              )}
            />
            <DetailsSection control={form.control} />
            {quota === null ? null : (
              <p className={cn('type-meta', quota.over && 'text-negative-text')}>{quota.text}</p>
            )}
          </DialogBody>
          <DialogFooter
            primary={
              <Button type="submit" variant="primary" loading={add.pending}>
                {t('submit', { count: add.sendCount })}
              </Button>
            }
            secondary={
              <DialogClose>
                <Button variant="secondary">{common('cancel')}</Button>
              </DialogClose>
            }
          />
        </form>
      ) : (
        <AddResult outcome={outcome} doneRef={add.doneRef} onDone={add.close} />
      )}
    </Dialog>
  );
}
