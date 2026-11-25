'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactElement } from 'react';

import { TierBadge } from '@/components/app/tier/tier-badge';
import { Button } from '@/components/ui/button';
import { reasonOf } from '@/lib/internal-links/problem-reason';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import { importTiersMutation } from '@/lib/internal-links/mutations';
import { internalLinksKeys } from '@/lib/internal-links/queries';
import { countByTier, parseTierCsv, type CsvTierError, type CsvTierRow } from '@/lib/internal-links/tier-csv';
import type { LinksScope, PageTier, TierImportResult } from '@/lib/internal-links/types';

/** Lines and rows the dialog lists; the count of the rest is said. The API takes up to 20,000 rows. */
const SHOWN = 20;
const ECHO = 40;

/** A tier text from the file as it is echoed back: a pasted cell can be long. */
const boundedEcho = (value: string): string => (value.length > ECHO ? `${value.slice(0, ECHO)}…` : value);

interface Checked {
  rows: CsvTierRow[];
  errors: CsvTierError[];
}

/**
 * Import tiers from CSV (spec 5.2, mock `openImportTiers`). The API has no dry run (gap G6), so Check reads the text
 * on this page with the rules of the API and shows what would change; Apply sends the same text, and the API checks
 * it again, applies all of it or none of it, and answers per line. A refusal or a failure leaves the dialog open
 * with the text and the reason, and sending again is safe: the same rows set the same tiers.
 */
export function ImportDialog({
  open,
  onOpenChange,
  scope,
  tiers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: LinksScope;
  tiers: readonly PageTier[];
}): ReactElement {
  const t = useTranslations('internalLinks.csv');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const apply = useMutation(importTiersMutation);
  const picker = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [checked, setChecked] = useState<Checked | null>(null);
  const [refused, setRefused] = useState<TierImportResult['errors'] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const tierOf = (tierId: string | null): PageTier | null => tiers.find((tier) => tier.tier_id === tierId) ?? null;
  const errorText = (error: CsvTierError): string => {
    switch (error.code) {
      case 'unknown_tier':
        return t('unknownTier', { line: error.line, value: boundedEcho(error.value) });
      case 'missing_column':
        return t('missingColumn', { line: error.line });
      case 'missing_header':
        return t('missingHeader', { line: error.line });
      case 'invalid_url':
        return t('invalidUrl', { line: error.line });
      case 'too_many_rows':
        return t('tooManyRows', { line: error.line });
      case 'too_large':
        return t('tooLarge');
      case 'body_too_large':
        return t('bodyTooLarge');
    }
  };
  const ready = checked !== null && checked.rows.length > 0 && checked.errors.length === 0;
  const counts = checked === null ? [] : [...countByTier(checked.rows)];
  // Only the lines that are shown are turned into text: a text of 20,000 bad lines costs 20 messages, not 20,000
  const lines = checked === null ? [] : checked.errors.slice(0, SHOWN).map(errorText);
  const refusedLines =
    refused === null
      ? []
      : refused.slice(0, SHOWN).map((error) => t('serverLine', { line: error.line, message: error.message }));

  const check = (): void => {
    const result = parseTierCsv(text, tiers, { strict: true });
    setChecked(result);
    // The result is spoken once, here: the alert that shows the lines is not a live region
    if (result.errors.length > 0) {
      announce(`${t('errorsTitle', { count: result.errors.length })}. ${t('errorsText')}`, {
        key: 'internal-links-import',
      });
    } else if (result.rows.length === 0) announce(t('nothing'), { key: 'internal-links-import' });
    else announce(t('readyTitle', { count: result.rows.length }), { key: 'internal-links-import' });
  };

  const reset = (): void => {
    setText('');
    setChecked(null);
    setRefused(null);
    setFailure(null);
  };
  const close = (next: boolean): void => {
    // The import finishes first, so its answer is not lost
    if (!next && apply.isPending) return;
    if (!next) reset();
    onOpenChange(next);
  };
  const edit = (next: string): void => {
    setText(next);
    setChecked(null);
    setRefused(null);
    setFailure(null);
  };

  // A file is read as text into the same box, so Check and Apply work on it as on pasted text
  const load = async (file: File): Promise<void> => {
    try {
      edit(await file.text());
    } catch {
      setFailure(t('readFailed'));
    }
  };

  const submit = (): void => {
    if (!ready || apply.isPending) return;
    setRefused(null);
    setFailure(null);
    apply.mutate(
      { params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } }, body: { csv: text } },
      {
        onSuccess: (answer) => {
          const result = answer.data;
          for (const queryKey of internalLinksKeys(scope)) void queryClient.invalidateQueries({ queryKey });
          if (!result.applied) {
            setRefused(result.errors);
            return;
          }
          // `accepted` counts the rows that wait for a crawl too: those are stored, and apply when a crawl finds them
          const tagged = Math.max(result.accepted - result.pending.length, 0);
          toast({
            type: 'success',
            title: t('imported'),
            description: [
              ...(tagged > 0 ? [t('importedText', { count: tagged })] : []),
              ...(result.pending.length > 0 ? [t('pending', { count: result.pending.length })] : []),
            ].join(' '),
          });
          reset();
          onOpenChange(false);
        },
        onError: (error) => {
          // A 413 and the other 4xx answers are refusals before anything is written; a lost connection or a 5xx may
          // have come after the API committed, and the text says so
          const status = isApiProblem(error) ? error.status : null;
          const lead =
            status === 413
              ? t('tooBigForServer')
              : status !== null && status >= 400 && status < 500
                ? t('refusedNothing')
                : t('failed');
          setFailure([lead, status === 413 ? '' : reasonOf(error)].filter((part) => part !== '').join(' '));
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="md"
      dirty={text !== ''}
      discard={{
        title: t('discardTitle'),
        description: t('discardText'),
        keepEditingLabel: t('keepEditing'),
        discardLabel: t('discard'),
      }}
    >
      <DialogHeader title={t('title')} description={t('description')} closeLabel={common('close')} />
      <DialogBody>
        {failure === null ? null : <FormAlert message={failure} />}
        {refused === null ? null : (
          <div className="flex flex-col gap-2">
            <FormAlert message={t('serverErrors')} />
            <ul className="flex flex-col gap-1 pl-4 type-body text-foreground">
              {refusedLines.map((line, index) => (
                <li key={`${String(refused[index]?.line)}-${String(index)}`} className="list-disc">
                  {line}
                </li>
              ))}
            </ul>
            {refused.length > SHOWN ? (
              <p className="type-meta text-foreground-secondary">
                {t('errorsMore', { count: refused.length - SHOWN })}
              </p>
            ) : null}
          </div>
        )}
        <Field>
          <FieldLabel>{t('field')}</FieldLabel>
          <Textarea
            value={text}
            placeholder={t('placeholder')}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => edit(event.target.value)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const dropped = event.dataTransfer.files[0];
              if (dropped !== undefined) void load(dropped);
            }}
          />
          <FieldDescription>
            {t('hint')} {t('dropHint')}
          </FieldDescription>
        </Field>
        <input
          ref={picker}
          type="file"
          hidden
          accept=".csv,text/csv"
          onChange={(event) => {
            const chosen = event.target.files?.item(0);
            // The same file chosen again still fires a change
            event.target.value = '';
            if (chosen !== null && chosen !== undefined) void load(chosen);
          }}
        />
        <div className="mt-2 flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => picker.current?.click()}>
            {t('chooseFile')}
          </Button>
          <Button variant="secondary" size="sm" onClick={check}>
            {t('check')}
          </Button>
        </div>
        {checked === null ? null : checked.rows.length === 0 && checked.errors.length === 0 ? (
          <p className="mt-3 type-body text-foreground-secondary">{t('nothing')}</p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {checked.errors.length === 0 ? null : (
              <div className="flex flex-col gap-2">
                <FormAlert
                  live={false}
                  message={`${t('errorsTitle', { count: checked.errors.length })}. ${t('errorsText')}`}
                />
                <ul className="flex flex-col gap-1 pl-4 type-body text-foreground">
                  {lines.map((line, index) => (
                    <li key={`${String(checked.errors[index]?.line)}-${String(index)}`} className="list-disc">
                      {line}
                    </li>
                  ))}
                </ul>
                {checked.errors.length > SHOWN ? (
                  <p className="type-meta text-foreground-secondary">
                    {t('errorsMore', { count: checked.errors.length - SHOWN })}
                  </p>
                ) : null}
              </div>
            )}
            {checked.rows.length === 0 ? null : (
              <section className="flex flex-col gap-2">
                <h3 className="type-body-strong">{t('readyTitle', { count: checked.rows.length })}</h3>
                <ul className="flex flex-wrap items-center gap-2">
                  {counts.map(([tierId, count]) => (
                    <li
                      key={tierId ?? 'none'}
                      className="flex items-center gap-1.5 num type-meta text-foreground-secondary"
                    >
                      <TierBadge tier={tierOf(tierId)} withName />
                      <span>{t('tierCount', { count })}</span>
                    </li>
                  ))}
                </ul>
                <p className="type-meta text-foreground-secondary">{t('readyText')}</p>
                <p className="type-meta text-foreground-secondary">{t('previewNote')}</p>
                <table className="w-full border-collapse">
                  <caption className="sr-only">{t('rowsCaption')}</caption>
                  <thead>
                    <tr>
                      {[t('line'), t('url'), t('tier')].map((header) => (
                        <th
                          key={header}
                          scope="col"
                          className="h-row-header border-b border-border bg-surface-subtle px-3 text-left type-table-header text-foreground-tertiary"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {checked.rows.slice(0, SHOWN).map((row) => (
                      <tr key={row.line} className="h-row-compact border-b border-border-subtle">
                        <td className="px-3 num type-table">{row.line}</td>
                        <td className="max-w-72 truncate px-3 type-table" title={row.url}>
                          {row.url}
                        </td>
                        <td className="px-3">
                          <TierBadge tier={tierOf(row.tierId)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {checked.rows.length > SHOWN ? (
                  <p className="type-meta text-foreground-secondary">
                    {t('rowsShown', { shown: SHOWN, count: checked.rows.length })}
                  </p>
                ) : null}
              </section>
            )}
          </div>
        )}
      </DialogBody>
      <DialogFooter
        primary={
          <Button variant="primary" disabled={!ready} loading={apply.isPending} onClick={submit}>
            {ready ? t('apply', { count: checked.rows.length }) : t('applyNone')}
          </Button>
        }
        secondary={
          <DialogClose>
            <Button type="button" variant="secondary" disabled={apply.isPending}>
              {common('cancel')}
            </Button>
          </DialogClose>
        }
      />
    </Dialog>
  );
}
