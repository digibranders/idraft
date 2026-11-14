'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { askProblemText, askProblemTitle, skipText, type AskTextContext } from './ask-problem';
import { useNextScheduled } from './add-queries';
import { clearJustAdded } from './just-added-store';
import { bulkArchive, bulkRun, refreshPrompts, type PromptScope } from '../prompt-queries';
import {
  BULK_RUN_MAX,
  chunkIds,
  MANUAL_RUN_CAP,
  runProblemOf,
  skipCounts,
  summarizeRuns,
  type ChunkAnswer,
  type RunProblem,
} from '../run-model';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { toast } from '@/components/ui/toast';
import { projectKey } from '@/lib/api/keys';
import type { ProjectEngine } from '@/lib/api/types';
import { formatCurrency, formatDetailDateTime } from '@/lib/format';

/** Above this many prompts, asking or archiving confirms with the count (20-accessibility criterion 3.3.4). */
export const CONFIRM_ABOVE = 100;

/** What asking the new prompts takes, as the plan said it before the add: for the confirm's sentence. */
export interface AskEstimate {
  /** The answers and their cost in words, as the plan block writes it; `null` when the add made other prompts than it counted. */
  cost: { answers: number; text: string } | null;
  /** The day's manual runs used and the limit; `null` while they are not known. */
  used: number | null;
  limit: number | null;
}

export interface AddedPrompts {
  /** The prompts the add created: what Undo archives, and all it touches. */
  created: readonly string[];
  /** The archived prompts the add brought back: Undo leaves them alone. */
  restored: number;
  /** The result view is up in the dialog, so a question to answer must wait for it to close. */
  resultView: boolean;
  /** The person ticked "Ask them now as well". */
  ask: boolean;
  /** What asking takes, for the confirm's sentence; `null` when the plan did not count these prompts. */
  estimate: AskEstimate | null;
}

export interface AfterAdd {
  /** The add went through: its toast with Undo, and the ask the form asked for. */
  added: (done: AddedPrompts) => void;
  /** Ask the prompts, after the confirm: the result view's "Ask them now". */
  confirmAsk: (ids: readonly string[], estimate: AskEstimate | null) => void;
  /** The confirms; the dialog renders them once, outside its own overlay. */
  dialogs: ReactNode;
}

type Confirm =
  | { kind: 'ask'; ids: readonly string[]; estimate: AskEstimate | null }
  | { kind: 'archive'; ids: readonly string[] }
  | null;

export interface UseAfterAddInput {
  scope: PromptScope;
  /** The dialog is open: the schedules are read only then. */
  open: boolean;
  /** The project's enabled engines, which asking uses. */
  engines: readonly ProjectEngine[];
}

/**
 * What follows an add (prompt-dialogs 4.6): the toast that tells what was added, when the first answers come and
 * that Undo archives them (an archive, never a delete); asking the new prompts now, in runs of 150, one manual run
 * each, stopping at the first refusal; and the confirms that more than 100 prompts to ask or archive need.
 */
export function useAfterAdd({ scope, open, engines }: UseAfterAddInput): AfterAdd {
  const t = useTranslations('prompts.add');
  const plan = useTranslations('prompts.add.plan');
  const prompts = useTranslations('prompts');
  const common = useTranslations('common');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const next = useNextScheduled(scope, { enabled: open });
  const [confirm, setConfirm] = useState<Confirm>(null);
  const text: AskTextContext = { t: prompts, engines, locale };

  const firstAnswers = (): string | null => {
    if (engines.length === 0 || next.status !== 'ready') return null;
    return next.nextRunAt === null || next.timeZone === null
      ? plan('paused')
      : plan('nextRun', { when: formatDetailDateTime(next.nextRunAt, next.timeZone, locale) });
  };

  /** Brings the added prompts' archive about: exactly the ids the add created. */
  const archiveCreated = async (ids: readonly string[]): Promise<void> => {
    try {
      const { data } = await bulkArchive(scope, ids, true);
      void refreshPrompts(queryClient, scope);
      if (data.updated === 0) {
        toast({
          type: 'error',
          title: t('undoFailed'),
          description: prompts('bulk.archiveLeft', { count: ids.length }),
        });
        return;
      }
      clearJustAdded();
      toast({ type: 'success', title: t('undone', { count: data.updated }), description: t('undoneHint') });
    } catch (error) {
      const problem = runProblemOf(error);
      toast({
        type: 'error',
        title: t('undoFailed'),
        description:
          problem.kind === 'forbidden'
            ? prompts('bulk.archiveForbidden')
            : problem.kind === 'rate_limited'
              ? prompts('inspector.runRateLimited', { minutes: problem.minutes })
              : prompts('bulk.tryAgain'),
      });
    }
  };
  const undo = (ids: readonly string[]): void => {
    if (ids.length > CONFIRM_ABOVE) setConfirm({ kind: 'archive', ids });
    else void archiveCreated(ids);
  };

  /** One request for each 150 prompts, one manual run each, stopping at the first refusal; one toast says what went. */
  const runAsk = async (ids: readonly string[]): Promise<void> => {
    const asked = engines.map((engine) => engine.engine.engine_code);
    const answers: ChunkAnswer[] = [];
    let problem: RunProblem | null = null;
    let notTried = 0;
    const runs = chunkIds(ids, BULK_RUN_MAX);
    for (const [at, chunk] of runs.entries()) {
      try {
        const { meta } = await bulkRun(scope, chunk, asked.length === 0 ? undefined : asked);
        answers.push({ ids: chunk, meta });
      } catch (error) {
        problem = runProblemOf(error);
        notTried = runs.slice(at).reduce((sum, left) => sum + left.length, 0);
        break;
      }
    }
    if (problem?.kind === 'prompt_unknown') void refreshPrompts(queryClient, scope);
    if (answers.length === 0) {
      if (problem !== null) {
        toast({ type: 'error', title: askProblemTitle(problem, prompts), description: askProblemText(problem, text) });
      }
      return;
    }
    const summary = summarizeRuns(answers, asked);
    const stopped = [
      ...(problem === null ? [] : [askProblemText(problem, text, true)]),
      ...(notTried === 0 ? [] : [prompts('bulk.notTried', { count: notTried })]),
    ];
    const left = skipText(skipCounts(answers.flatMap((answer) => answer.meta.skipped)), text);
    toast({
      type: stopped.length === 0 ? 'success' : 'info',
      title: prompts('bulk.runStarted', { prompts: summary.prompts, engines: summary.engines }),
      description: [
        ...(summary.cost === null ? [] : [prompts('bulk.runCost', { cost: formatCurrency(summary.cost, { locale }) })]),
        left === '' ? prompts('inspector.runQueuedHint') : left,
        ...stopped,
      ].join(' '),
    });
    void queryClient.invalidateQueries({ queryKey: [...projectKey(scope.workspaceId, scope.projectId), 'runs'] });
    void refreshPrompts(queryClient, scope);
  };

  const added = ({ created, restored, resultView, ask, estimate }: AddedPrompts): void => {
    if (created.length === 0 && restored === 0) return;
    const description =
      created.length === 0 ? undefined : [firstAnswers(), t('undoHint')].filter((part) => part !== null).join(' ');
    toast({
      type: 'success',
      title:
        created.length === 0
          ? t('restored', { count: restored })
          : restored === 0
            ? t('added', { count: created.length })
            : t('addedRestored', { added: created.length, restored }),
      description,
      // Undo archives what was created and nothing else: not what was skipped, not what was brought back
      action: created.length === 0 ? undefined : { label: t('undo'), onAction: () => undo(created) },
    });
    if (!ask || created.length === 0) return;
    if (created.length <= CONFIRM_ABOVE) void runAsk(created);
    // Many prompts ask first, and a question cannot open over the result view: its button asks then
    else if (!resultView) setConfirm({ kind: 'ask', ids: created, estimate });
  };

  const count = confirm?.ids.length ?? 0;
  const runs = Math.ceil(count / BULK_RUN_MAX);
  const askDescription = (estimate: AskEstimate | null): string =>
    [
      runs <= 1
        ? prompts('bulk.runConfirmOne', { count })
        : prompts('bulk.runConfirmMany', { count, runs, size: BULK_RUN_MAX }),
      estimate === null || estimate.used === null || estimate.limit === null
        ? prompts('bulk.runConfirmCounts', { runs, limit: MANUAL_RUN_CAP })
        : prompts('bulk.runConfirmUsed', { used: estimate.used, limit: estimate.limit }),
      estimate?.cost === undefined || estimate.cost === null
        ? ''
        : t('askConfirmCost', { answers: estimate.cost.answers, cost: estimate.cost.text }),
    ]
      .filter((part) => part !== '')
      .join(' ');

  const dialogs = (
    <ConfirmDialog
      open={confirm !== null}
      onOpenChange={(next) => {
        if (!next) setConfirm(null);
      }}
      tone="neutral"
      title={
        confirm?.kind === 'archive' ? prompts('bulk.archiveConfirmTitle', { count }) : t('askConfirmTitle', { count })
      }
      description={
        confirm?.kind === 'archive'
          ? prompts('bulk.archiveConfirmDescription')
          : askDescription(confirm?.kind === 'ask' ? confirm.estimate : null)
      }
      confirmLabel={
        confirm?.kind === 'archive' ? prompts('bulk.archiveConfirmLabel', { count }) : t('askConfirmLabel', { count })
      }
      cancelLabel={common('cancel')}
      onConfirm={async () => {
        if (confirm === null) return;
        await (confirm.kind === 'archive' ? archiveCreated(confirm.ids) : runAsk(confirm.ids));
      }}
    />
  );

  return {
    added,
    confirmAsk: (ids, estimate) => {
      if (ids.length > 0) setConfirm({ kind: 'ask', ids, estimate });
    },
    dialogs,
  };
}
