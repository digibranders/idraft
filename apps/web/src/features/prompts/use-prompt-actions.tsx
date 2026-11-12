'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Download, Play } from 'lucide-react';
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

type Asking = { kind: 'run' | 'archive'; ids: readonly string[] } | null;

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
  /** After an action that changed the prompts the choice held: the screen drops the choice. */
  onDone: () => void;
}

export interface PromptActions {
  /** The bulk bar's actions on the prompts of `ids`, for the permissions the person has. */
  bar: (ids: readonly string[]) => PromptAction[];
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
  // One run or archive at a time: a second press while the loop goes on is ignored
  const busy = useRef(false);
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
  const finish = (): void => {
    changed.current = true;
    void refreshPrompts(queryClient, scope);
    onDone();
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
  const summaryOf = (tally: RunTally): ToastOptions => {
    if (tally.started === tally.total) {
      return {
        type: 'success',
        title: tally.total === 1 ? t('inspector.runQueued') : t('bulk.runsQueued', { count: tally.started }),
        description: t('inspector.runQueuedHint'),
      };
    }
    const reasons = [
      ...(tally.stop === null ? [] : [stopText(tally.stop)]),
      ...(tally.blocked === 0 ? [] : [t('bulk.runBlocked', { count: tally.blocked })]),
      ...(Object.keys(REFUSED_KEYS) as RefusedWhy[]).flatMap((why) =>
        tally.refused[why] === 0 ? [] : [t(`bulk.${REFUSED_KEYS[why]}`, { count: tally.refused[why] })],
      ),
    ].join(' ');
    return tally.started === 0
      ? { type: 'error', title: t('inspector.runFailedTitle'), description: reasons }
      : {
          type: 'info',
          title: t('bulk.runPartialTitle', { started: tally.started, total: tally.total }),
          description: reasons,
        };
  };
  const runPrompts = async (ids: readonly string[]): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
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
            return { kind: 'started' };
          } catch (error) {
            return classifyRunError(error);
          }
        },
        () => !mounted.current,
      );
      const tally = tallyRuns(ids.length, plan.blocked.length, outcome);
      toast(summaryOf(tally));
      if (tally.started > 0) {
        // The runs are in Runs at once, planned; the prompts' lists and answers are read again too
        void queryClient.invalidateQueries({ queryKey: [...projectKey(scope.workspaceId, scope.projectId), 'runs'] });
        finish();
      }
    } finally {
      busy.current = false;
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
  const archivePrompts = async (ids: readonly string[]): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    const archived: string[] = [];
    try {
      for (const id of ids) {
        try {
          await archive.mutateAsync({ params: { path: path(id) } });
          archived.push(id);
        } catch {
          // Counted below: the others go on
        }
      }
    } finally {
      busy.current = false;
    }
    if (archived.length === 0) {
      toast({ type: 'error', title: t('inspector.archiveFailed') });
      return;
    }
    finish();
    toast({
      type: 'success',
      title:
        archived.length === ids.length
          ? t('bulk.archived', { count: archived.length })
          : t('bulk.archivePartialTitle', { done: archived.length, total: ids.length }),
      ...(archived.length === ids.length
        ? {}
        : { description: t('bulk.archiveSome', { count: ids.length - archived.length }) }),
      // The toast does not wait for the lists to be read again: Undo is there while the rows go
      action: { label: t('inspector.undo'), onAction: () => void restorePrompts(archived) },
    });
  };

  const exportPrompts = (ids: readonly string[]): void => {
    const chosen = new Set(ids);
    // In the order of the list, as the table shows them
    const rows = [...rowsById.values()].filter((row) => chosen.has(row.prompt.prompt_id));
    try {
      const table = buildPromptExport(rows, shown, {
        prompt: t('columns.prompt'),
        topic: t('columns.topic'),
        country: t('columns.country'),
        branded: t('branded'),
        yes: t('bulk.yes'),
        no: t('bulk.no'),
        mentionRate: t('columns.mentionRate'),
        citationRate: t('columns.citationRate'),
        mentioned: (engine) => t('columns.mentioned', { engine }),
        cited: (engine) => t('columns.cited', { engine }),
      });
      downloadBlob(csvBlob(table), exportFileName(range));
      toast({ type: 'success', title: t('bulk.exported', { count: rows.length }) });
    } catch {
      toast({ type: 'error', title: t('bulk.exportFailed') });
    }
  };

  /** More than one prompt asks first; one runs at once, as the inspector's Run now does. */
  const startRun = (ids: readonly string[]): void => {
    changed.current = false;
    if (ids.length > 1) setAsking({ kind: 'run', ids });
    else void runPrompts(ids);
  };
  /** Above 100 prompts asks first; fewer run at once with Undo, as Rankings archives keywords. */
  const startArchive = (ids: readonly string[]): void => {
    changed.current = false;
    if (ids.length > CONFIRM_ARCHIVE_ABOVE) setAsking({ kind: 'archive', ids });
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
              disabledReason: plan.runnable.length === 0 ? t('bulk.runNothing') : null,
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
              run: () => startArchive(ids),
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
        await (asking.kind === 'archive' ? archivePrompts(asking.ids) : runPrompts(asking.ids));
      }}
    />
  );

  return { bar, dialogs };
}
