'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, Download, PanelRight, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

import { buildPromptExport, exportFileName } from './export-rows';
import type { PromptAction } from './prompt-action';
import type { PromptRow } from './prompt-columns';
import type { DateRange } from './prompt-model';
import { ARCHIVE_PROMPT, refreshPrompts, RUN_NOW, UPDATE_PROMPT, type PromptScope } from './prompt-queries';
import {
  CAP_NOTE_ABOVE,
  classifyRunError,
  MANUAL_RUN_CAP,
  planRuns,
  runInTurn,
  tallyRuns,
  type RefusedWhy,
  type RunResult,
  type RunTally,
  type Stop,
} from './run-model';
import { gridTabStop } from '@/components/app/data-table/grid-focus';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { toast, type ToastOptions } from '@/components/ui/toast';
import { projectKey } from '@/lib/api/keys';
import { isApiProblem } from '@/lib/api/problem';
import type { ProjectEngine } from '@/lib/api/types';
import { csvBlob, downloadBlob } from '@/lib/csv/csv-write';
import { copyText } from '@/lib/dom/clipboard';
import { useCountries } from '@/lib/locations/countries';
import { useCan } from '@/lib/permissions';

/** Above this many prompts, archiving asks first (12-tables.md section 14), as Rankings does for keywords. */
const CONFIRM_ARCHIVE_ABOVE = 100;

const REFUSED_KEYS = {
  pending: 'runRefusedPending',
  engines: 'runRefusedEngines',
  gone: 'runRefusedGone',
  failed: 'runRefusedFailed',
} as const satisfies Record<RefusedWhy, string>;

/** What a confirm waits on: the prompts, and how many the caller named that the list does not hold (said in the toast). */
type Asking = { kind: 'run' | 'archive'; ids: readonly string[]; skipped: number } | null;

export interface PromptActionsOptions {
  scope: PromptScope;
  /** The prompts on screen by id: what an action reads the text, the engines and the counts of. */
  rowsById: ReadonlyMap<string, PromptRow>;
  /** The enabled engines: Run now asks each prompt on those that take it. */
  engines: readonly ProjectEngine[];
  /** The engines shown, whose counts the export has. */
  shown: readonly ProjectEngine[];
  /** The window of the counts in the export, and in its name. */
  range: DateRange;
  /**
   * After an action changed some prompts: the ones it changed, which the screen takes out of the choice. A prompt the
   * action did not reach (not tried after a limit, refused) stays chosen, and so does every other prompt of the choice.
   */
  onDone: (ids: readonly string[]) => void;
}

export interface PromptActions {
  /** The bulk bar's actions on the prompts of `ids`, for the permissions the person has. */
  bar: (ids: readonly string[]) => PromptAction[];
  /** The row menu of one prompt: `open` shows it in the inspector. */
  forPrompt: (promptId: string, open: () => void) => PromptAction[];
  /** Run now on the prompts of `ids` (a topic's): asks first for more than one. The caller checks `runs:trigger`. */
  run: (ids: readonly string[]) => void;
  /** Writes the prompts of `ids` as CSV. */
  exportPrompts: (ids: readonly string[]) => void;
  /** Why Run now and Archive wait: one of them is running. `null` when none is. */
  busyReason: string | null;
  /** The dialogs the actions open; the screen renders them once. */
  dialogs: ReactNode;
}

/**
 * The actions on prompts of Topics & Prompts (parity spec G26, G46, G47, G124), the bulk bar's for now. Run now asks
 * each prompt on the engines that take it, one after the other, and stops at the first refusal every prompt would
 * get (the project's 20 manual runs a day, the month's answers, a paused provider); one summary says what started
 * and why the rest did not. Archive stops asking the prompts and offers one Undo for all of them. Export writes the
 * prompts as the Prompts table shows them.
 *
 * shortcut: Run now and Archive loop over the prompts, one request each (the API has neither `bulk-run` nor
 * `bulk-archive` yet, B7); the backend's bulk routes replace the loops and the 20 a day cap text.
 */
export function usePromptActions({
  scope,
  rowsById,
  engines,
  shown,
  range,
  onDone,
}: PromptActionsOptions): PromptActions {
  const t = useTranslations('prompts');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const canTrigger = useCan('runs:trigger');
  const canWrite = useCan('prompts:write');
  const { countries } = useCountries();
  const runNow = useMutation(RUN_NOW);
  const archive = useMutation(ARCHIVE_PROMPT);
  const restore = useMutation(UPDATE_PROMPT);
  const [asking, setAsking] = useState<Asking>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // One run or archive at a time: a second press while the loop goes on is ignored, and the actions say why they wait
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const begin = (): boolean => {
    if (busy.current) return false;
    busy.current = true;
    setWorking(true);
    return true;
  };
  const end = (): void => {
    busy.current = false;
    if (mounted.current) setWorking(false);
  };
  const busyReason = working ? t('bulk.busy') : null;
  // A dialog that changed something closes onto a bar that went with the choice: focus goes to the grid's cell
  const changed = useRef(false);
  const gridFocus = useMemo(
    (): RefObject<HTMLElement | null> => ({
      get current(): HTMLElement | null {
        return changed.current ? gridTabStop() : null;
      },
    }),
    [],
  );
  const path = (promptId: string) => ({
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    prompt_id: promptId,
  });
  const rowsOf = (ids: readonly string[]): PromptRow[] => ids.flatMap((id) => rowsById.get(id) ?? []);
  const finish = (done: readonly string[]): void => {
    changed.current = true;
    void refreshPrompts(queryClient, scope);
    onDone(done);
  };

  const stopText = (stop: Stop): string => {
    switch (stop.reason) {
      case 'manual_run_limit':
        return t('bulk.runStopLimit', { limit: stop.limit ?? MANUAL_RUN_CAP });
      case 'quota_exceeded':
        return stop.limit !== null && stop.used !== null && stop.requested !== null
          ? t('inspector.runQuota', { limit: stop.limit, used: stop.used, requested: stop.requested })
          : t('bulk.runStopQuota');
      case 'provider_paused':
        return t('inspector.runPaused', { minutes: stop.retryMinutes ?? 1 });
      case 'rate_limited':
        return t('inspector.runRateLimited', { minutes: stop.retryMinutes ?? 1 });
      case 'forbidden':
        return t('inspector.runForbidden');
    }
  };
  /** One toast for the whole run: what started, and in words why the rest did not. */
  const summaryOf = (tally: RunTally, skipped: number): ToastOptions => {
    // The prompts the caller named that the list does not hold are said, not dropped in silence
    const notLoaded = skipped === 0 ? [] : [t('bulk.notLoaded', { count: skipped })];
    if (tally.started === tally.total) {
      return {
        type: 'success',
        title: tally.total === 1 ? t('inspector.runQueued') : t('bulk.runsQueued', { count: tally.started }),
        description: [t('inspector.runQueuedHint'), ...notLoaded].join(' '),
      };
    }
    const reasons = [
      ...(tally.stop === null ? [] : [stopText(tally.stop)]),
      ...(tally.blocked === 0 ? [] : [t('bulk.runBlocked', { count: tally.blocked })]),
      ...(Object.keys(REFUSED_KEYS) as RefusedWhy[]).flatMap((why) =>
        tally.refused[why] === 0 ? [] : [t(`bulk.${REFUSED_KEYS[why]}`, { count: tally.refused[why] })],
      ),
      ...(tally.notTried === 0 ? [] : [t('bulk.notTried', { count: tally.notTried })]),
      ...notLoaded,
    ].join(' ');
    return tally.started === 0
      ? { type: 'error', title: t('inspector.runFailedTitle'), description: reasons }
      : {
          type: 'info',
          title: t('bulk.runPartialTitle', { started: tally.started, total: tally.total }),
          description: reasons,
        };
  };
  const runPrompts = async (ids: readonly string[], skipped: number): Promise<void> => {
    if (!begin()) return;
    const started: string[] = [];
    try {
      const plan = planRuns(
        rowsOf(ids).map((row) => row.prompt),
        engines,
        countries.length > 0 ? countries : null,
      );
      const engineCodes = new Map(plan.runnable.map((entry) => [entry.promptId, entry.engineCodes]));
      const outcome = await runInTurn(
        plan.runnable.map((entry) => entry.promptId),
        async (promptId): Promise<RunResult> => {
          try {
            await runNow.mutateAsync({
              params: { path: path(promptId) },
              body: { engine_codes: engineCodes.get(promptId) ?? [] },
            });
            started.push(promptId);
            return { kind: 'started' };
          } catch (error) {
            return classifyRunError(error);
          }
        },
        () => !mounted.current,
      );
      const tally = tallyRuns(ids.length, plan.blocked.length, outcome);
      // A page that was left in the middle of the run has nobody to tell that some prompts were not tried
      if (mounted.current || tally.notTried === 0) toast(summaryOf(tally, skipped));
      if (tally.started > 0) {
        // The runs are in Runs at once, planned; the prompts' lists and answers are read again too
        void queryClient.invalidateQueries({ queryKey: [...projectKey(scope.workspaceId, scope.projectId), 'runs'] });
        // Only the prompts that started leave the choice: the others stay chosen to be tried again
        finish(started);
      }
    } finally {
      end();
    }
  };

  const restorePrompts = async (ids: readonly string[]): Promise<void> => {
    let done = 0;
    let quota: { used: number; limit: number } | null = null;
    for (const id of ids) {
      try {
        await restore.mutateAsync({ params: { path: path(id) }, body: { is_active: true } });
        done += 1;
      } catch (error) {
        // The workspace is at its prompt limit: the rest would meet it too
        if (isApiProblem(error, 'quota_exceeded')) {
          quota = { used: error.number('used') ?? 0, limit: error.number('limit') ?? 0 };
          break;
        }
      }
    }
    void refreshPrompts(queryClient, scope);
    if (done === ids.length) {
      toast({ type: 'success', title: t('bulk.restored', { count: done }) });
      return;
    }
    toast({
      type: 'error',
      title: done === 0 ? t('inspector.restoreFailed') : t('bulk.restorePartialTitle', { done, total: ids.length }),
      description:
        quota === null ? t('bulk.restoreSome', { count: ids.length - done }) : t('inspector.restoreQuota', quota),
    });
  };
  /** Why the archive stopped, in words: the refusals every other prompt would get too. */
  const archiveStopText = (stop: Stop): string =>
    stop.reason === 'forbidden' ? t('bulk.archiveForbidden') : stopText(stop);
  const archivePrompts = async (ids: readonly string[]): Promise<void> => {
    if (!begin()) return;
    const archived: string[] = [];
    // The prompts refused for their own sake, and what ended the loop with the prompts it did not ask
    let failed = 0;
    let stop: Stop | null = null;
    let notTried = 0;
    try {
      for (const [at, id] of ids.entries()) {
        if (!mounted.current) {
          notTried = ids.length - at;
          break;
        }
        try {
          await archive.mutateAsync({ params: { path: path(id) } });
          archived.push(id);
        } catch (error) {
          const result = classifyRunError(error);
          // Too many requests or no permission: the prompts after this one would meet it too
          if (result.kind === 'stop') {
            stop = result.stop;
            notTried = ids.length - at - 1;
            break;
          }
          failed += 1;
        }
      }
    } finally {
      end();
    }
    const why = [
      ...(stop === null ? [] : [archiveStopText(stop)]),
      ...(notTried === 0 ? [] : [t('bulk.notTried', { count: notTried })]),
      ...(failed === 0 ? [] : [t('bulk.archiveSome', { count: failed })]),
    ].join(' ');
    if (archived.length === 0) {
      toast({ type: 'error', title: t('inspector.archiveFailed'), ...(why === '' ? {} : { description: why }) });
      return;
    }
    // Only the prompts that were archived leave the choice
    finish(archived);
    toast({
      type: 'success',
      title:
        archived.length === ids.length
          ? t('bulk.archived', { count: archived.length })
          : t('bulk.archivePartialTitle', { done: archived.length, total: ids.length }),
      ...(why === '' ? {} : { description: why }),
      // The toast does not wait for the lists to be read again: Undo is there while the rows go
      action: { label: t('inspector.undo'), onAction: () => void restorePrompts(archived) },
    });
  };

  const exportPrompts = (ids: readonly string[]): void => {
    const chosen = new Set(ids);
    // In the order of the list, as the table shows them
    const rows = [...rowsById.values()].filter((row) => chosen.has(row.prompt.prompt_id));
    // The prompts the caller named that the list does not hold are not in the file, and the toast says how many
    const notLoaded = ids.length > rows.length ? t('bulk.notLoaded', { count: ids.length - rows.length }) : undefined;
    // No file of a header alone
    if (rows.length === 0) {
      toast({
        type: 'error',
        title: t('bulk.exportNone'),
        ...(notLoaded === undefined ? {} : { description: notLoaded }),
      });
      return;
    }
    try {
      const table = buildPromptExport(rows, shown, {
        prompt: t('columns.prompt'),
        topic: t('columns.topic'),
        country: t('columns.country'),
        branded: t('branded'),
        yes: t('bulk.yes'),
        no: t('bulk.no'),
        mentionRate: t('bulk.exportMentionRate'),
        mentionAnswers: t('bulk.exportMentionAnswers'),
        citationRate: t('bulk.exportCitationRate'),
        citationAnswers: t('bulk.exportCitationAnswers'),
        mentioned: (engine) => t('columns.mentioned', { engine }),
        cited: (engine) => t('columns.cited', { engine }),
        answers: (engine) => t('bulk.exportAnswers', { engine }),
      });
      downloadBlob(csvBlob(table), exportFileName(range));
      toast({
        type: 'success',
        title: t('bulk.exported', { count: rows.length }),
        ...(notLoaded === undefined ? {} : { description: notLoaded }),
      });
    } catch {
      toast({ type: 'error', title: t('bulk.exportFailed') });
    }
  };

  /** More than one prompt asks first; one runs at once, as the inspector's Run now does. */
  const startRun = (named: readonly string[]): void => {
    // Only the prompts the list holds are run and counted; the others are said in the toast
    const ids = named.filter((id) => rowsById.has(id));
    const skipped = named.length - ids.length;
    if (named.length === 0) return;
    if (ids.length === 0) {
      toast({
        type: 'error',
        title: t('inspector.runFailedTitle'),
        description: t('bulk.notLoaded', { count: skipped }),
      });
      return;
    }
    changed.current = false;
    if (ids.length > 1) setAsking({ kind: 'run', ids, skipped });
    else void runPrompts(ids, skipped);
  };
  /** Above 100 prompts asks first; fewer run at once with Undo, as Rankings archives keywords. */
  const startArchive = (ids: readonly string[]): void => {
    changed.current = false;
    if (ids.length > CONFIRM_ARCHIVE_ABOVE) setAsking({ kind: 'archive', ids, skipped: 0 });
    else void archivePrompts(ids);
  };

  const bar = (ids: readonly string[]): PromptAction[] => {
    const plan = planRuns(
      rowsOf(ids).map((row) => row.prompt),
      engines,
      countries.length > 0 ? countries : null,
    );
    return [
      ...(canTrigger
        ? [
            {
              id: 'run-now',
              label: t('bulk.run'),
              icon: Play,
              group: 'object' as const,
              disabledReason: busyReason ?? (plan.runnable.length === 0 ? t('bulk.runNothing') : null),
              run: () => startRun(ids),
            },
          ]
        : []),
      {
        id: 'export',
        label: t('bulk.export'),
        icon: Download,
        group: 'object' as const,
        run: () => exportPrompts(ids),
      },
      ...(canWrite
        ? [
            {
              id: 'archive',
              label: t('bulk.archive'),
              icon: Archive,
              // Last in the bar, but neutral: it loses nothing, and its toast has Undo
              group: 'destructive' as const,
              tone: 'default' as const,
              disabledReason: busyReason,
              run: () => startArchive(ids),
            },
          ]
        : []),
    ];
  };

  const copyPrompt = (text: string): void => {
    void copyText(text).then((copied) =>
      toast(copied ? { type: 'success', title: t('rowMenu.copied') } : { type: 'error', title: common('copy.failed') }),
    );
  };
  /** The menu of a prompt's row, wherever it is listed: Open, Run now, Copy prompt and Archive, by permission. */
  const forPrompt = (promptId: string, open: () => void): PromptAction[] => {
    const row = rowsById.get(promptId);
    if (row === undefined) return [];
    const runnable = planRuns([row.prompt], engines, countries.length > 0 ? countries : null).runnable.length > 0;
    return [
      { id: 'open', label: t('rowMenu.open'), icon: PanelRight, group: 'open', run: open },
      ...(canTrigger
        ? [
            {
              id: 'run-now',
              label: t('bulk.run'),
              icon: Play,
              group: 'object' as const,
              disabledReason: busyReason ?? (runnable ? null : t('inspector.runNoEngine')),
              run: () => startRun([promptId]),
            },
          ]
        : []),
      {
        id: 'copy',
        label: t('rowMenu.copyPrompt'),
        icon: Copy,
        group: 'copy',
        run: () => copyPrompt(row.prompt.current_version.text),
      },
      ...(canWrite
        ? [
            {
              id: 'archive',
              label: t('bulk.archive'),
              icon: Archive,
              // Last, but neutral: it loses nothing, and its toast has Undo
              group: 'destructive' as const,
              tone: 'default' as const,
              disabledReason: busyReason,
              run: () => startArchive([promptId]),
            },
          ]
        : []),
    ];
  };

  const count = asking?.ids.length ?? 0;
  const dialogs = (
    <ConfirmDialog
      open={asking !== null}
      onOpenChange={(open) => {
        if (!open) setAsking(null);
      }}
      finalFocus={gridFocus}
      tone="neutral"
      title={
        asking?.kind === 'archive' ? t('bulk.archiveConfirmTitle', { count }) : t('bulk.runConfirmTitle', { count })
      }
      description={
        asking?.kind === 'archive'
          ? t('bulk.archiveConfirmDescription')
          : count > CAP_NOTE_ABOVE
            ? `${t('bulk.runConfirmDescription')} ${t('bulk.runConfirmCap', { limit: MANUAL_RUN_CAP })}`
            : t('bulk.runConfirmDescription')
      }
      confirmLabel={
        asking?.kind === 'archive' ? t('bulk.archiveConfirmLabel', { count }) : t('bulk.runConfirmLabel', { count })
      }
      cancelLabel={common('cancel')}
      onConfirm={async () => {
        if (asking === null) return;
        await (asking.kind === 'archive' ? archivePrompts(asking.ids) : runPrompts(asking.ids, asking.skipped));
      }}
    />
  );

  return { bar, forPrompt, run: startRun, exportPrompts, busyReason, dialogs };
}
