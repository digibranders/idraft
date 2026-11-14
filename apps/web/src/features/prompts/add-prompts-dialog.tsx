'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { AddResult } from './add/add-result';
import { AskNowCheckbox } from './add/ask-now-checkbox';
import { CheckList } from './add/check-list';
import { DetailsSection } from './add/details-section';
import { MarketFields } from './add/market-fields';
import { PlanBlock, PlanSummary } from './add/plan-block';
import { useAddForm } from './add/use-add-form';
import { BULK_MAX } from './prompt-model';
import type { PromptScope } from './prompt-queries';
import { TopicPicker } from './topic-picker/topic-picker';
import { FormField } from '@/components/app/forms/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip } from '@/components/ui/tooltip';
import type { ProjectEngine, Prompt } from '@/lib/api/types';
import { formatInteger, formatList } from '@/lib/format';

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
 * add. The plan under the fields says what the add takes and costs and why it is off when it is, and holds the box
 * that asks the new prompts right after. The form, the check, the plan, the submit and what follows an add live in
 * `add/`; this is the frame that puts them in order.
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
  const { form, check, outcome, plan } = add;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true);
          else if (!add.pending) add.close();
        }}
        finalFocus={add.finalFocus}
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
              {/* The plan block says that the list could not be checked and that a country is needed: once, there */}
              <CheckList
                rows={check.rows}
                checking={check.checking}
                failed={false}
                needsCountry={false}
                restore={add.restore}
                onShow={add.show}
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
              <PlanBlock
                {...plan.block}
                askSlot={
                  plan.ask === null ? null : (
                    <AskNowCheckbox
                      ask={plan.ask}
                      checked={add.ask.checked}
                      onCheckedChange={add.ask.onCheckedChange}
                      reason={plan.askReason}
                      blockId={plan.id}
                    />
                  )
                }
              />
            </DialogBody>
            <DialogFooter
              start={<PlanSummary text={plan.summary} />}
              primary={
                // Off with its reason, which stays focusable and is read from the plan block; the API has the last word
                <Tooltip content={plan.reason ?? ''} purpose="label" disabled={plan.reason === null}>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={add.pending}
                    disabled={plan.disabled !== null}
                    focusableWhenDisabled
                    aria-describedby={plan.id}
                  >
                    {t('submit', { count: add.sendCount })}
                  </Button>
                </Tooltip>
              }
              secondary={
                <DialogClose>
                  <Button variant="secondary">{common('cancel')}</Button>
                </DialogClose>
              }
            />
          </form>
        ) : (
          <AddResult
            outcome={outcome}
            doneRef={add.doneRef}
            onDone={add.close}
            onShow={add.show}
            onAsk={add.askFromResult}
          />
        )}
      </Dialog>
      {add.followUps}
    </>
  );
}
