'use client';

import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type ReactElement } from 'react';

import { DETAIL, detailQuery } from '../keyword-inspector/inspector-queries';
import { refreshKeywords, type ProjectScope } from '../rankings-queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { quotaFacts } from '@/lib/keywords/quota';

/** A list in the result shows this many keywords, then how many more. */
const SHOWN = 20;

/** What an add did, when it did not simply add everything. */
export interface AddOutcome {
  /** Tracked keywords written: with both devices, two of each keyword. */
  added: number;
  /** Of `added`, the ones that were deleted and came back with their old settings. */
  restored: number;
  both: boolean;
  /** Keywords the project tracks already, with the tracked keyword each one is. */
  skipped: readonly { id: string; keyword: string }[];
  /** Keywords the API refused, with why. */
  rejected: readonly { keyword: string; reason: string }[];
}

type Unarchive = 'pending' | 'done' | { failed: string };

/**
 * The second view of Add keywords, when some keywords were tracked already or refused: how many were
 * added, then each keyword tracked already with "Show it" (and "Unarchive" for an archived one), then each
 * refused keyword with the reason.
 */
export function AddKeywordsResult({
  scope,
  outcome,
  onShowKeyword,
  onDone,
}: {
  scope: ProjectScope;
  outcome: AddOutcome;
  onShowKeyword: (trackedKeywordId: string, archived: boolean) => void;
  onDone: () => void;
}): ReactElement {
  const t = useTranslations('rankings.add.result');
  const add = useTranslations('rankings.add');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const skippedId = useId();
  const rejectedId = useId();
  const shownSkipped = outcome.skipped.slice(0, SHOWN);
  // Whether a keyword tracked already is archived, and on which device, is in its detail
  const details = useQueries({
    queries: shownSkipped.map((item) => detailQuery({ ...scope, trackedKeywordId: item.id })),
  });
  const patch = useMutation(apiMutation('patch', DETAIL));
  const [unarchived, setUnarchived] = useState<ReadonlyMap<string, Unarchive>>(new Map());
  const setState = (id: string, state: Unarchive): void => setUnarchived((current) => new Map(current).set(id, state));
  // The Unarchive button goes once it has worked: its row's "Show it" takes the focus
  const showButtons = useRef(new Map<string, HTMLButtonElement>());

  const unarchive = async (id: string, label: string): Promise<void> => {
    setState(id, 'pending');
    try {
      await patch.mutateAsync({
        params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId, tracked_keyword_id: id } },
        body: { is_active: true },
      });
      setState(id, 'done');
      showButtons.current.get(id)?.focus();
      announce(t('unarchivedAnnouncement', { keyword: label }));
      void refreshKeywords(queryClient, scope);
    } catch (error) {
      setState(id, {
        failed: isApiProblem(error, 'quota_exceeded')
          ? common('quota', { ...quotaFacts(error, 1) })
          : t('unarchiveFailed'),
      });
    }
  };

  return (
    <>
      <DialogHeader
        title={t('title', { added: outcome.added })}
        description={t('summary', { added: outcome.added, both: outcome.both ? 'yes' : 'no' })}
        closeLabel={common('close')}
      />
      <DialogBody>
        {outcome.restored === 0 ? null : <p className="type-body">{add('restored', { count: outcome.restored })}</p>}
        {outcome.skipped.length === 0 ? null : (
          <section aria-labelledby={skippedId} className="flex flex-col gap-2">
            <h3 id={skippedId} className="type-subsection-title">
              {t('skipped')}
            </h3>
            <p className="type-meta">{t('skippedReason', { count: outcome.skipped.length })}</p>
            <ul className="flex flex-col divide-y divide-border-subtle">
              {shownSkipped.map((item, index) => {
                const detail = details[index]?.data?.data ?? null;
                const archived = detail !== null && !detail.is_active;
                const state = unarchived.get(item.id);
                const label =
                  detail === null
                    ? item.keyword
                    : t('keywordDevice', { keyword: item.keyword, device: add(`devices.${detail.device}`) });
                return (
                  <li key={item.id} className="flex flex-col gap-1 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate type-body">{label}</span>
                      {archived && state !== 'done' ? <Badge tone="warning">{t('archived')}</Badge> : null}
                      {state === 'done' ? <Badge tone="positive">{t('unarchived')}</Badge> : null}
                      {archived && state !== 'done' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={t('unarchiveLabel', { keyword: label })}
                          loading={state === 'pending'}
                          onClick={() => void unarchive(item.id, label)}
                        >
                          {t('unarchive')}
                        </Button>
                      ) : null}
                      <Button
                        ref={(button: HTMLButtonElement | null) => {
                          if (button === null) showButtons.current.delete(item.id);
                          else showButtons.current.set(item.id, button);
                        }}
                        variant="ghost"
                        size="sm"
                        aria-label={t('show', { keyword: label })}
                        onClick={() => onShowKeyword(item.id, archived && state !== 'done')}
                      >
                        {t('showLabel')}
                      </Button>
                    </div>
                    {typeof state === 'object' ? (
                      <p role="status" className="type-meta text-negative-text">
                        {state.failed}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {outcome.skipped.length > SHOWN ? (
              <p className="type-meta">{t('more', { count: outcome.skipped.length - SHOWN })}</p>
            ) : null}
          </section>
        )}
        {outcome.rejected.length === 0 ? null : (
          <section aria-labelledby={rejectedId} className="flex flex-col gap-2">
            <h3 id={rejectedId} className="type-subsection-title">
              {t('rejected')}
            </h3>
            <ul className="flex flex-col divide-y divide-border-subtle">
              {outcome.rejected.slice(0, SHOWN).map((item, index) => (
                <li key={`${String(index)}:${item.keyword}`} className="flex flex-col gap-0.5 py-2">
                  <span className="type-body wrap-anywhere">{item.keyword}</span>
                  <span className="type-meta">{item.reason}</span>
                </li>
              ))}
            </ul>
            {outcome.rejected.length > SHOWN ? (
              <p className="type-meta">{t('more', { count: outcome.rejected.length - SHOWN })}</p>
            ) : null}
          </section>
        )}
      </DialogBody>
      <DialogFooter
        primary={
          <Button variant="primary" onClick={onDone}>
            {t('done')}
          </Button>
        }
      />
    </>
  );
}
