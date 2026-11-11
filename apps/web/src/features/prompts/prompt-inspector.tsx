'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, ListChecks, MessageSquareText, Play } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, type ReactElement } from 'react';

import { asksIn, countText, fitsEngine, outcomeKey, topicTermsOf, type DateRange } from './prompt-model';
import {
  ARCHIVE_PROMPT,
  isPromptId,
  observationsQuery,
  promptQuery,
  refreshPrompts,
  RUN_NOW,
  UPDATE_PROMPT,
  type PromptScope,
} from './prompt-queries';
import { Inspector } from '@/components/app/inspector/inspector';
import type { InspectorNavigation } from '@/components/app/inspector/inspector-header';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { InspectorBody } from '@/components/app/inspector/inspector-tabs';
import { KeyValues, type KeyValue } from '@/components/app/inspector/key-values';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { MenuItemDef } from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import { projectKey } from '@/lib/api/keys';
import { isApiProblem, retryMinutes, type ApiProblem } from '@/lib/api/problem';
import { useErrorId, type ErrorIdWords } from '@/lib/api/use-error-id';
import type { EngineSummary, ObservationSummary, ProjectEngine, Prompt, PromptSummaryRow } from '@/lib/api/types';
import { EMPTY_VALUE, formatDetailDateTime, formatInteger, formatList, formatTableDateTime } from '@/lib/format';
import { languageName } from '@/lib/format/language';
import { useCountries } from '@/lib/locations/countries';
import { useCan } from '@/lib/permissions';

/** The catalog key of each reason Run now refuses an engine (`422 validation_failed`, one item per engine). */
const REFUSAL_KEYS = {
  engine_not_enabled: 'engineNotEnabled',
  prompt_too_long: 'promptTooLong',
  location_not_enabled: 'locationNotEnabled',
  price_unavailable: 'priceUnavailable',
} as const;
type Refusal = keyof typeof REFUSAL_KEYS;
const isRefusal = (code: string): code is Refusal => code in REFUSAL_KEYS;

/** What the screen has of the prompt's counts: the summary of the window the page is on. */
export interface PromptCounts {
  status: 'loading' | 'failed' | 'ready';
  /** The prompt's row; `undefined` for a prompt the summary leaves out (a branded one, or one with no answer). */
  row: PromptSummaryRow | undefined;
  /** Whether the summary includes the branded prompts (the Branded filter). */
  brandedIncluded: boolean;
  errorId: ErrorIdWords | null;
  retry: () => void;
  retrying: boolean;
}

export interface PromptInspectorProps {
  scope: PromptScope;
  promptId: string;
  /** The project's time zone, for dates. */
  timeZone: string;
  /** The window of the page: the answers listed are its answers. */
  range: DateRange;
  /** The project's enabled engines: the counts per engine and what Run now asks. */
  engines: readonly ProjectEngine[];
  counts: PromptCounts;
  /** "12 of 23"; `null` when the prompt is not in the list on screen. */
  positionText: string | null;
  navigation: InspectorNavigation | null;
  onStep: ((direction: 'next' | 'previous') => void) | undefined;
  onClose: () => void;
  /**
   * Opens the answer in the answer viewer; without it the dates of the answers are plain text. `observedAt` is
   * the time of the answer's row, which the viewer hands the API to find the answer's month.
   */
  onOpenAnswer?: ((observationId: string, observedAt: string) => void) | undefined;
}

/**
 * The inspector of one prompt (spec 2026-11-11 section 4.6; 440 px, as every prompt inspector): its facts,
 * Mentioned and Cited per enabled engine over the window, and its answers (date, engine, status, outcome).
 * Run now (`runs:trigger`) asks it on every enabled engine that takes its length, through the standard queue;
 * Archive (`prompts:write`) stops asking it, keeps its answers and offers Undo. An archived prompt, which the
 * API still serves, shows its facts and answers and offers neither.
 */
export function PromptInspector({
  scope,
  promptId,
  timeZone,
  range,
  engines,
  counts,
  positionText,
  navigation,
  onStep,
  onClose,
  onOpenAnswer,
}: PromptInspectorProps): ReactElement {
  const t = useTranslations('prompts.inspector');
  const words = useTranslations('prompts');
  const common = useTranslations('common');
  const inspectorWords = useTranslations('inspector');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const canTrigger = useCan('runs:trigger');
  const canWrite = useCan('prompts:write');
  const { countries, isError: countriesFailed } = useCountries();
  const detail = useQuery(promptQuery(scope, promptId));
  // An id that is no prompt's (a hand-typed address, or one the API refuses) is a prompt that is not there
  const notFound = isApiProblem(detail.error, 'not_found') || isApiProblem(detail.error, 'validation_failed');
  const answers = useQuery({
    ...observationsQuery(scope, promptId, range),
    enabled: isPromptId(promptId) && !notFound,
  });
  const runNow = useMutation(RUN_NOW);
  const archive = useMutation(ARCHIVE_PROMPT);
  const restore = useMutation(UPDATE_PROMPT);
  const { reset: resetRun } = runNow;
  // The inspector stays while it steps to another prompt: what the last one's Run now was doing is not this one's
  useEffect(() => resetRun(), [promptId, resetRun]);
  const errorId = useErrorId(detail.error);
  const answersErrorId = useErrorId(answers.error);
  const prompt = detail.data?.data ?? null;
  const path = { workspace_id: scope.workspaceId, project_id: scope.projectId, prompt_id: promptId };
  const engineLabel = new Map<string, string>(
    engines.map((engine) => [engine.engine.engine_code, engine.engine.label]),
  );
  const labelOf = (code: string): string => engineLabel.get(code) ?? code;
  // The engines Run now asks: those that take the prompt's length and have a location in its country. The API
  // refuses the whole run when one of the engines asked gets nothing to ask, so the others are not sent with it.
  // The countries are waited for (without them the locations cannot be told); when they fail the API decides.
  const locationsKnown = countries.length > 0 || countriesFailed;
  const runnable =
    prompt === null || !locationsKnown
      ? []
      : engines.filter(
          (engine) =>
            fitsEngine(prompt.current_version.text, engine) &&
            (countriesFailed || asksIn(engine, countries, prompt.country_iso)),
        );
  const mayRun = canTrigger && prompt?.is_active === true;

  /**
   * The refusal of Run now in words: one sentence per reason, naming the engines refused for it. The API names the
   * engine before the colon of its message ("gemini_web: ..."), except for a missing price, which is the run's: a
   * reason without a known engine in front of it is every engine asked.
   */
  const refusedText = (error: ApiProblem): string => {
    const byReason = new Map<Refusal, Set<string>>();
    for (const item of error.errors) {
      if (!item.path.startsWith('engine_codes') || !isRefusal(item.code)) continue;
      const named = engineLabel.get(item.message.split(':')[0] ?? '');
      const names = byReason.get(item.code) ?? new Set<string>();
      for (const name of named === undefined ? runnable.map((e) => e.engine.label) : [named]) names.add(name);
      byReason.set(item.code, names);
    }
    const sentences = [...byReason].map(([reason, names]) =>
      t(`runRefused.${REFUSAL_KEYS[reason]}`, { engines: formatList([...names], locale), count: names.size }),
    );
    return sentences.length === 0 ? t('runInvalid') : sentences.join(' ');
  };
  const runProblem = (error: unknown): string => {
    if (!isApiProblem(error)) return t('runFailed');
    const limit = error.number('limit');
    const used = error.number('used');
    const requested = error.number('requested');
    if (error.code === 'check_pending') {
      const pending = error.body.engine_codes;
      const names = Array.isArray(pending)
        ? pending.filter((code): code is string => typeof code === 'string').map(labelOf)
        : [];
      return t('runPending', {
        engines: formatList(names.length === 0 ? runnable.map((e) => e.engine.label) : names, locale),
      });
    }
    if (error.code === 'manual_run_limit' && limit !== null) return t('runLimit', { limit });
    if (error.code === 'quota_exceeded' && limit !== null && used !== null && requested !== null) {
      return t('runQuota', { limit, used, requested });
    }
    if (error.code === 'provider_paused') return t('runPaused', { minutes: retryMinutes(error) });
    if (error.code === 'rate_limited') return t('runRateLimited', { minutes: retryMinutes(error) });
    if (error.code === 'validation_failed') return refusedText(error);
    if (error.status === 404) return t('runGone');
    if (error.status === 403) return t('runForbidden');
    return t('runFailed');
  };
  const run = async (): Promise<void> => {
    try {
      await runNow.mutateAsync({
        params: { path },
        body: { engine_codes: runnable.map((engine) => engine.engine.engine_code) },
      });
    } catch (error) {
      toast({ type: 'error', title: t('runFailedTitle'), description: runProblem(error) });
      return;
    }
    toast({ type: 'success', title: t('runQueued'), description: t('runQueuedHint') });
    // The run is in Runs at once, planned; the prompt's lists and its answers are read again too
    void queryClient.invalidateQueries({ queryKey: [...projectKey(scope.workspaceId, scope.projectId), 'runs'] });
    void refreshPrompts(queryClient, scope);
  };
  const bringBack = (): void => {
    restore.mutateAsync({ params: { path }, body: { is_active: true } }).then(
      () => {
        toast({ type: 'success', title: t('restored') });
        void refreshPrompts(queryClient, scope);
      },
      (error: unknown) => {
        const used = isApiProblem(error, 'quota_exceeded') ? error.number('used') : null;
        const limit = isApiProblem(error, 'quota_exceeded') ? error.number('limit') : null;
        toast({
          type: 'error',
          title: t('restoreFailed'),
          ...(used !== null && limit !== null ? { description: t('restoreQuota', { used, limit }) } : {}),
        });
      },
    );
  };
  const doArchive = async (): Promise<void> => {
    try {
      await archive.mutateAsync({ params: { path } });
    } catch {
      toast({ type: 'error', title: t('archiveFailed') });
      return;
    }
    onClose();
    // The toast does not wait for the lists to be read again: Undo is there while the row goes
    toast({
      type: 'success',
      title: t('archived'),
      description: t('archivedHint'),
      action: { label: t('undo'), onAction: bringBack },
    });
    void refreshPrompts(queryClient, scope);
  };

  const cellText = (cell: EngineSummary['mentioned']): string => countText(cell) ?? EMPTY_VALUE;
  const engineValue = (cells: EngineSummary | undefined): string =>
    cells === undefined || (cells.mentioned.n_observations === 0 && cells.cited.n_observations === 0)
      ? t('engineNoAnswers')
      : t('engineCounts', { mentioned: cellText(cells.mentioned), cited: cellText(cells.cited) });
  const countryName = (iso: string | null): string =>
    iso === null ? EMPTY_VALUE : (countries.find((country) => country.country_iso === iso)?.name ?? iso);
  const outcomeLabel = (row: ObservationSummary): string => t(`outcomes.${outcomeKey(row.status, row.facts)}`);
  const answerColumns: PlainColumn<ObservationSummary>[] = [
    {
      id: 'date',
      header: t('columns.date'),
      cell: (row) => {
        const date = formatTableDateTime(row.observed_at, timeZone);
        return onOpenAnswer === undefined ? (
          <span className="num">{date}</span>
        ) : (
          <Button
            variant="link"
            aria-label={t('openAnswer', { engine: labelOf(row.engine_code), date })}
            onClick={() => onOpenAnswer(row.observation_id, row.observed_at)}
          >
            <span className="num">{date}</span>
          </Button>
        );
      },
    },
    { id: 'engine', header: t('columns.engine'), cell: (row) => labelOf(row.engine_code) },
    { id: 'status', header: t('columns.status'), cell: (row) => t(`statuses.${row.status}`) },
    { id: 'outcome', header: t('columns.outcome'), wrap: true, cell: outcomeLabel },
  ];
  const answerRows = answers.data?.data ?? [];
  const answersFailed = answers.isError && answers.data === undefined;
  // Why the summary has no row: an archived prompt is not asked, a branded one is left out unless included
  const countsReason =
    prompt?.is_active === false
      ? t('noCountsArchived')
      : prompt?.is_branded === true && !counts.brandedIncluded
        ? t('noCountsBranded')
        : t('noCountsReason');
  const archiveAction: MenuItemDef = { id: 'archive', label: t('archive'), onSelect: () => void doArchive() };
  const factsOf = (candidate: Prompt): KeyValue[] => {
    const topics = topicTermsOf(candidate).map((term) => term.name);
    return [
      {
        id: 'topic',
        label: t('topic'),
        value: topics.length === 0 ? words('columns.noTopic') : formatList(topics, locale),
      },
      { id: 'language', label: t('language'), value: languageName(candidate.language_code, locale) },
      { id: 'country', label: t('country'), value: countryName(candidate.country_iso) },
      {
        id: 'importance',
        label: t('importance'),
        value: <span className="num">{formatInteger(candidate.importance)}</span>,
      },
      { id: 'added', label: t('added'), value: formatDetailDateTime(candidate.created_at, timeZone) },
      { id: 'addedBy', label: t('addedBy'), value: candidate.created_by?.name ?? t('system') },
    ];
  };

  return (
    <Inspector
      type="prompt"
      backLabel={t('back')}
      onClose={onClose}
      onStep={onStep}
      header={{
        title: prompt?.current_version.text ?? '',
        typeLabel: t('type'),
        typeNoun: t('noun'),
        positionText,
        navigation,
        badges:
          prompt === null ? null : (
            <span className="inline-flex items-center gap-1.5">
              {prompt.is_branded ? <Badge>{words('branded')}</Badge> : null}
              {prompt.is_active ? null : <Badge tone="warning">{t('archivedBadge')}</Badge>}
            </span>
          ),
        frequentAction:
          mayRun && runnable.length > 0 ? (
            <Button variant="secondary" size="sm" icon={Play} loading={runNow.isPending} onClick={() => void run()}>
              {t('runNow')}
            </Button>
          ) : null,
        moreActions: canWrite && prompt?.is_active === true ? [archiveAction] : [],
      }}
    >
      <InspectorBody>
        {detail.isError && prompt === null ? (
          notFound ? (
            <EmptyState
              variant="inline"
              title={t('loadFailed')}
              reason={inspectorWords('notFound', { type: t('noun') })}
              headingLevel={3}
            />
          ) : (
            <InlineError
              title={t('loadFailed')}
              reason={t('loadFailedReason')}
              errorId={errorId}
              onRetry={() => void detail.refetch()}
              retrying={detail.isFetching}
              retryLabel={common('retry')}
            />
          )
        ) : (
          <>
            {canTrigger &&
            prompt?.is_active === true &&
            locationsKnown &&
            engines.length > 0 &&
            runnable.length === 0 ? (
              <p className="type-meta">{t('runNoEngine')}</p>
            ) : null}
            <InspectorSection title={t('facts')} icon={ClipboardList} status={prompt === null ? 'loading' : 'ready'}>
              {prompt === null ? null : <KeyValues items={factsOf(prompt)} />}
            </InspectorSection>
            <InspectorSection
              title={t('byEngine')}
              icon={ListChecks}
              status={
                counts.status === 'loading'
                  ? 'loading'
                  : counts.status === 'failed'
                    ? 'error'
                    : counts.row === undefined
                      ? 'empty'
                      : 'ready'
              }
              error={
                <InlineError
                  title={t('countsFailed')}
                  reason={t('loadFailedReason')}
                  errorId={counts.errorId}
                  onRetry={counts.retry}
                  retrying={counts.retrying}
                  retryLabel={common('retry')}
                />
              }
              empty={<EmptyState variant="inline" title={t('noCounts')} reason={countsReason} headingLevel={3} />}
            >
              {counts.row === undefined ? null : (
                <KeyValues
                  items={engines.map((engine) => ({
                    id: engine.engine.engine_code,
                    label: engine.engine.label,
                    value: engineValue(
                      counts.row?.engines.find((cell) => cell.engine_code === engine.engine.engine_code),
                    ),
                  }))}
                />
              )}
            </InspectorSection>
            <InspectorSection
              title={t('answers')}
              icon={MessageSquareText}
              status={
                answersFailed ? 'error' : answers.isPending ? 'loading' : answerRows.length === 0 ? 'empty' : 'ready'
              }
              error={
                <InlineError
                  title={t('answersFailed')}
                  reason={t('loadFailedReason')}
                  errorId={answersErrorId}
                  onRetry={() => void answers.refetch()}
                  retrying={answers.isFetching}
                  retryLabel={common('retry')}
                />
              }
              empty={
                <EmptyState
                  variant="inline"
                  title={t('answersEmpty')}
                  reason={t('answersEmptyReason')}
                  headingLevel={3}
                />
              }
            >
              {answers.data?.page.has_more === true ? (
                <p className="mb-2 type-meta">{t('answersTruncated', { count: answerRows.length })}</p>
              ) : null}
              <PlainTable<ObservationSummary>
                caption={t('answersCaption')}
                columns={answerColumns}
                rows={answerRows}
                rowKey={(row) => row.observation_id}
                status="ready"
                errorState={null}
                emptyText={t('answersEmpty')}
              />
            </InspectorSection>
          </>
        )}
      </InspectorBody>
    </Inspector>
  );
}
