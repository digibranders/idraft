'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, Download, PanelRight, Play } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

import { buildPromptExport, exportFileName } from './export-rows';
import type { PromptAction } from './prompt-action';
import type { PromptRow } from './prompt-columns';
import type { DateRange } from './prompt-model';
import { bulkArchive, bulkRun, refreshPrompts, RUN_NOW, type PromptScope } from './prompt-queries';
import {
  BULK_RUN_MAX,
  chunkIds,
  MANUAL_RUN_CAP,
  planRuns,
  runProblemOf,
  skipCounts,
  summarizeRuns,
  type ChunkAnswer,
  type EngineRefusal,
  type RunProblem,
  type SkipCounts,
} from './run-model';
import { gridTabStop } from '@/components/app/data-table/grid-focus';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { toast } from '@/components/ui/toast';
import { projectKey } from '@/lib/api/keys';
import type { ProjectEngine } from '@/lib/api/types';
import { csvBlob, downloadBlob } from '@/lib/csv/csv-write';
import { copyText } from '@/lib/dom/clipboard';
import { formatCurrency, formatList } from '@/lib/format';
import { useCountries } from '@/lib/locations/countries';
import { useCan } from '@/lib/permissions';

/** Above this many prompts, archiving asks first (12-tables.md section 14), as Rankings does for keywords. */
const CONFIRM_ARCHIVE_ABOVE = 100;

/** The catalog key of each reason an engine is refused, the inspector's sentences. */
const REFUSAL_KEYS = {
  engine_not_enabled: 'engineNotEnabled',
  prompt_too_long: 'promptTooLong',
  location_not_enabled: 'locationNotEnabled',
  price_unavailable: 'priceUnavailable',
} as const satisfies Record<EngineRefusal, string>;

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
   * action did not reach (not asked after a refusal, left out by the API) stays chosen, and so does every other
   * prompt of the choice.
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
 * The actions on prompts of Topics & Prompts (parity spec G26, G46, G47, G124), the bulk bar's for now. Run now of
 * one prompt is the prompt's own route; of many it is one request for up to 150 prompts, which the API makes one
 * manual run (more prompts are split into runs of 150, each one of the day's 20). One toast says what started, and
 * in words what the API left out and why. Archive is one request for all the prompts and offers one Undo. Export
 * writes the prompts as the Prompts table shows them.
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
  const locale = useLocale();
  const queryClient = useQueryClient();
  const canTrigger = useCan('runs:trigger');
  const canWrite = useCan('prompts:write');
  const { countries } = useCountries();
  const runNow = useMutation(RUN_NOW);
  const [asking, setAsking] = useState<Asking>(null);
  // The day's manual runs, as the last run of this project said: not known before the first one
  const [manualRuns, setManualRuns] = useState<{ projectId: string; used: number; limit: number } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // One run or archive at a time: a second press while the request goes on is ignored, and the actions say why they wait
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
  /** The runs are in Runs at once, planned; the prompts' lists and answers are read again too. */
  const queued = (done: readonly string[]): void => {
    void queryClient.invalidateQueries({ queryKey: [...projectKey(scope.workspaceId, scope.projectId), 'runs'] });
    finish(done);
  };

  const engineName = (code: string): string =>
    engines.find((engine) => engine.engine.engine_code === code)?.engine.label ?? code;
  /** The pairs left out, in words: "3 prompt and engine pairs were left out: 2 too long and 1 with no location". */
  const skipText = (skips: SkipCounts): string => {
    const total = skips.tooLong + skips.noLocation + skips.pending;
    if (total === 0) return '';
    const reasons = [
      ...(skips.tooLong === 0 ? [] : [t('bulk.runSkipTooLong', { count: skips.tooLong })]),
      ...(skips.noLocation === 0 ? [] : [t('bulk.runSkipNoLocation', { count: skips.noLocation })]),
      ...(skips.pending === 0 ? [] : [t('bulk.runSkipPending', { count: skips.pending })]),
    ];
    return t('bulk.runSkipped', { count: total, reasons: formatList(reasons, locale) });
  };
  /** A refusal of Run now in words, one prompt's or many. */
  const problemText = (problem: RunProblem): string => {
    switch (problem.kind) {
      case 'provider_paused':
        return t('inspector.runPaused', { minutes: problem.minutes });
      case 'rate_limited':
        return t('inspector.runRateLimited', { minutes: problem.minutes });
      case 'manual_run_limit':
        return t('inspector.runLimit', { limit: problem.limit ?? MANUAL_RUN_CAP });
      case 'quota_exceeded':
        return problem.limit !== null && problem.used !== null && problem.requested !== null
          ? t('inspector.runQuota', { limit: problem.limit, used: problem.used, requested: problem.requested })
          : t('bulk.runStopQuota');
      case 'prompt_unknown':
        return t('bulk.runUnknown');
      case 'engines_refused':
        return (Object.keys(problem.refused) as EngineRefusal[])
          .map((reason) => {
            const named = problem.refused[reason] ?? [];
            // A reason without an engine named is every engine asked
            const names = (named.length === 0 ? engines.map((engine) => engine.engine.engine_code) : named).map(
              engineName,
            );
            return t(`inspector.runRefused.${REFUSAL_KEYS[reason]}`, {
              engines: formatList(names, locale),
              count: names.length,
            });
          })
          .join(' ');
      case 'nothing_to_run':
        return [t('bulk.runNothingToRun'), skipText(problem.skips)].filter((part) => part !== '').join(' ');
      case 'check_pending':
        return problem.engines.length > 0
          ? t('inspector.runPending', { engines: formatList(problem.engines.map(engineName), locale) })
          : t('bulk.runNothingPending');
      case 'forbidden':
        return t('inspector.runForbidden');
      case 'gone':
        return t('inspector.runGone');
      case 'failed':
        return t('inspector.runFailed');
    }
  };
  /** The title of a refusal: that nothing was started when the prompts were asked together and none could be. */
  const problemTitle = (problem: RunProblem): string =>
    problem.kind === 'nothing_to_run' || (problem.kind === 'check_pending' && problem.engines.length === 0)
      ? t('bulk.runNothingStarted')
      : t('inspector.runFailedTitle');

  // The prompts the caller named that the list does not hold are said, not dropped in silence
  const notLoadedText = (skipped: number): string[] => (skipped === 0 ? [] : [t('bulk.notLoaded', { count: skipped })]);

  /** One prompt: its own route, on the engines that take it. */
  const runOnePrompt = async (promptId: string, skipped: number): Promise<void> => {
    if (!begin()) return;
    try {
      const row = rowsById.get(promptId);
      const [entry] = planRuns(
        row === undefined ? [] : [row.prompt],
        engines,
        countries.length > 0 ? countries : null,
      ).runnable;
      if (entry === undefined) {
        toast({
          type: 'error',
          title: t('inspector.runFailedTitle'),
          description: [t('inspector.runNoEngine'), ...notLoadedText(skipped)].join(' '),
        });
        return;
      }
      try {
        await runNow.mutateAsync({ params: { path: path(promptId) }, body: { engine_codes: entry.engineCodes } });
      } catch (error) {
        const problem = runProblemOf(error);
        toast({ type: 'error', title: problemTitle(problem), description: problemText(problem) });
        return;
      }
      toast({
        type: 'success',
        title: t('inspector.runQueued'),
        description: [t('inspector.runQueuedHint'), ...notLoadedText(skipped)].join(' '),
      });
      queued([promptId]);
    } finally {
      end();
    }
  };

  /** Many prompts: one request for each 150, one manual run each, stopping at the first refusal. */
  const runPrompts = async (ids: readonly string[], skipped: number): Promise<void> => {
    if (ids.length === 1 && ids[0] !== undefined) return runOnePrompt(ids[0], skipped);
    if (!begin()) return;
    const answers: ChunkAnswer[] = [];
    let problem: RunProblem | null = null;
    let notTried = 0;
    try {
      const runs = chunkIds(ids);
      for (const [at, chunk] of runs.entries()) {
        // The page was left in the middle of the runs: the prompts after the one that went are not asked
        if (!mounted.current) {
          notTried = ids.length - answers.reduce((sum, answer) => sum + answer.ids.length, 0);
          break;
        }
        try {
          const { meta } = await bulkRun(scope, chunk);
          answers.push({ ids: chunk, meta });
        } catch (error) {
          problem = runProblemOf(error);
          notTried = runs.slice(at).reduce((sum, left) => sum + left.length, 0);
          break;
        }
      }
    } finally {
      end();
    }
    if (problem?.kind === 'prompt_unknown') void refreshPrompts(queryClient, scope);
    if (answers.length === 0) {
      if (problem !== null) {
        toast({ type: 'error', title: problemTitle(problem), description: problemText(problem) });
      }
      return;
    }
    const summary = summarizeRuns(
      answers,
      engines.map((engine) => engine.engine.engine_code),
    );
    const day = summary.manualRuns;
    if (day !== null) setManualRuns({ projectId: scope.projectId, used: day.used, limit: day.limit });
    // A page that was left has nobody to tell that some prompts were not asked
    if (mounted.current || notTried === 0) {
      const stopped = [
        ...(problem === null ? [] : [problemText(problem)]),
        ...(notTried === 0 ? [] : [t('bulk.notTried', { count: notTried })]),
      ];
      const left = skipText(skipCounts(answers.flatMap((answer) => answer.meta.skipped)));
      toast({
        type: stopped.length === 0 ? 'success' : 'info',
        // The title is one line of the toast and the description two: the cost and what was left out come first, and the
        // hint of when the answers come only when there is room, since the toast is written out in full for assistive technology
        title: t('bulk.runStarted', { prompts: summary.prompts, engines: summary.engines }),
        description: [
          ...(summary.cost === null ? [] : [t('bulk.runCost', { cost: formatCurrency(summary.cost) })]),
          left === '' ? t('inspector.runQueuedHint') : left,
          ...stopped,
          ...notLoadedText(skipped),
        ].join(' '),
      });
    }
    // Only the prompts asked on an engine leave the choice: the others stay chosen to be tried again
    queued(summary.startedIds);
  };

  /** Brings the prompts back (Undo): all or none against the workspace's prompt limit. */
  const restorePrompts = async (ids: readonly string[]): Promise<void> => {
    try {
      const { data } = await bulkArchive(scope, ids, false);
      void refreshPrompts(queryClient, scope);
      toast(
        data.updated === ids.length
          ? { type: 'success', title: t('bulk.restored', { count: data.updated }) }
          : {
              type: 'info',
              title: t('bulk.restorePartialTitle', { done: data.updated, total: ids.length }),
            },
      );
    } catch (error) {
      void refreshPrompts(queryClient, scope);
      const problem = runProblemOf(error);
      toast({
        type: 'error',
        title: t('bulk.restoreFailedTitle'),
        description:
          problem.kind === 'quota_exceeded' &&
          problem.limit !== null &&
          problem.used !== null &&
          problem.requested !== null
            ? t('bulk.restoreQuota', { limit: problem.limit, used: problem.used, requested: problem.requested })
            : t('bulk.tryAgain'),
      });
    }
  };
  /** Why an archive was refused, in words. */
  const archiveProblemText = (problem: RunProblem): string =>
    problem.kind === 'forbidden'
      ? t('bulk.archiveForbidden')
      : problem.kind === 'rate_limited'
        ? t('inspector.runRateLimited', { minutes: problem.minutes })
        : t('bulk.tryAgain');
  const archivePrompts = async (ids: readonly string[]): Promise<void> => {
    if (!begin()) return;
    let result: { matched: number; updated: number } | null = null;
    let failure: RunProblem = { kind: 'failed' };
    try {
      result = (await bulkArchive(scope, ids, true)).data;
    } catch (error) {
      failure = runProblemOf(error);
    } finally {
      end();
    }
    if (result === null) {
      toast({ type: 'error', title: t('bulk.archiveFailedTitle'), description: archiveProblemText(failure) });
      return;
    }
    const { matched, updated } = result;
    if (updated === 0) {
      // Every prompt was gone or archived already: the lists are read again, and nothing leaves the choice
      void refreshPrompts(queryClient, scope);
      toast({
        type: 'error',
        title: t('bulk.archiveFailedTitle'),
        description: t('bulk.archiveLeft', { count: ids.length }),
      });
      return;
    }
    // The prompts the request named leave the choice: the lists no longer hold the ones it did not change
    finish(ids);
    toast({
      type: 'success',
      title:
        updated === ids.length
          ? t('bulk.archived', { count: updated })
          : t('bulk.archivePartialTitle', { done: updated, total: ids.length }),
      ...(updated === ids.length ? {} : { description: t('bulk.archiveLeft', { count: ids.length - updated }) }),
      // Which prompts were changed is not told when some were archived already: Undo would bring those back too, so it
      // is there only when every prompt the request found was changed. The toast does not wait for the lists to be read
      ...(updated === matched
        ? { action: { label: t('inspector.undo'), onAction: () => void restorePrompts(ids) } }
        : {}),
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
  // Each 150 prompts is a manual run of the day's 20; how many were used is known once a run of this project was made
  const runs = Math.ceil(count / BULK_RUN_MAX);
  const day = manualRuns?.projectId === scope.projectId ? manualRuns : null;
  const runDescription = [
    runs <= 1 ? t('bulk.runConfirmOne', { count }) : t('bulk.runConfirmMany', { count, runs, size: BULK_RUN_MAX }),
    day === null
      ? t('bulk.runConfirmCounts', { runs, limit: MANUAL_RUN_CAP })
      : t('bulk.runConfirmUsed', { used: day.used, limit: day.limit }),
  ].join(' ');
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
      description={asking?.kind === 'archive' ? t('bulk.archiveConfirmDescription') : runDescription}
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
