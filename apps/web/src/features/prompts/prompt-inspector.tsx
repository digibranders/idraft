'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Play } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, type ReactElement } from 'react';

import { InspectorCompetitors } from './inspector-competitors';
import { InspectorHistory } from './inspector-history';
import { InspectorLatest } from './inspector-latest';
import type { PromptAnswers, PromptCounts } from './inspector-reads';
import { InspectorStats } from './inspector-stats';
import { InspectorStrip } from './inspector-strip';
import { asksIn, fitsEngine, PROMPT_TABS, topicTermsOf, type DateRange, type PromptTab } from './prompt-model';
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
import { InspectorBody, InspectorPanel, InspectorTabs } from '@/components/app/inspector/inspector-tabs';
import { KeyValues, type KeyValue } from '@/components/app/inspector/key-values';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { MenuItemDef } from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { projectKey } from '@/lib/api/keys';
import { isApiProblem, retryMinutes, type ApiProblem } from '@/lib/api/problem';
import { useErrorId } from '@/lib/api/use-error-id';
import type { ProjectEngine, Prompt } from '@/lib/api/types';
import { EMPTY_VALUE, formatDetailDateTime, formatInteger, formatList } from '@/lib/format';
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

export type { PromptCounts } from './inspector-reads';

/** The key of the label of each tab. */
const TAB_LABEL = {
  latest: 'tabLatest',
  history: 'tabHistory',
  competitors: 'tabCompetitors',
  stats: 'tabStats',
} as const satisfies Record<PromptTab, string>;

export interface PromptInspectorProps {
  scope: PromptScope;
  promptId: string;
  /** The project's time zone, for dates. */
  timeZone: string;
  /** The window of the page: the answers listed are its answers. */
  range: DateRange;
  /** The project's enabled engines: the counts per engine and what Run now asks. */
  engines: readonly ProjectEngine[];
  /** Every engine of the project, on or off: an engine turned off keeps its answers, which are named by its label. */
  allEngines: readonly ProjectEngine[];
  counts: PromptCounts;
  /** "12 of 23"; `null` when the prompt is not in the list on screen. */
  positionText: string | null;
  navigation: InspectorNavigation | null;
  onStep: ((direction: 'next' | 'previous') => void) | undefined;
  /**
   * The topic the prompt was opened from (ADR-DS-022 decision 8): its name is a badge that reopens the topic's
   * drawer. Left out for a prompt that was not opened from a topic.
   */
  topic?: { name: string; onOpen: () => void } | null | undefined;
  /** The tab shown (`?itab=`), and the choice of another. */
  tab: PromptTab;
  onTabChange: (tab: PromptTab) => void;
  onClose: () => void;
  /**
   * Opens the answer in the answer viewer; without it the dates of the answers are plain text. `observedAt` is
   * the time of the answer's row, which the viewer hands the API to find the answer's month.
   */
  onOpenAnswer?: ((observationId: string, observedAt: string) => void) | undefined;
}

/**
 * The inspector of one prompt (spec 2026-11-11 section 4.6; 440 px, as every prompt inspector). Above its tabs
 * the strip says the Mention rate of each enabled engine and the Citation rate; the tabs are Latest (the newest
 * valid answer of each engine, and the prompt's facts), History (the weekly rate with its interval, the latest
 * answers, events), Competitors and Stats (parity spec G90 to G100). Run now (`runs:trigger`) asks the prompt on
 * every enabled engine that takes its length, through the standard queue; Archive (`prompts:write`) stops asking
 * it, keeps its answers and offers Undo. An archived prompt, which the API still serves, shows its tabs and offers
 * neither.
 */
export function PromptInspector({
  scope,
  promptId,
  timeZone,
  range,
  engines,
  allEngines,
  counts,
  positionText,
  navigation,
  onStep,
  topic,
  tab,
  onTabChange,
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
  // The window's answers are read for the tabs that list or count them, History and Competitors, and for no other
  const answers = useQuery({
    ...observationsQuery(scope, promptId, range),
    enabled: isPromptId(promptId) && !notFound && (tab === 'history' || tab === 'competitors'),
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
    allEngines.map((engine) => [engine.engine.engine_code, engine.engine.label]),
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

  const countryName = (iso: string | null): string =>
    iso === null ? EMPTY_VALUE : (countries.find((country) => country.country_iso === iso)?.name ?? iso);
  // One read of the prompt's answers serves three tabs: Latest picks from it, History lists it, Competitors counts it
  const promptAnswers: PromptAnswers = {
    status: answers.isError && answers.data === undefined ? 'error' : answers.isPending ? 'loading' : 'ready',
    rows: answers.data?.data ?? [],
    hasMore: answers.data?.page.has_more === true,
    errorId: answersErrorId,
    retry: () => void answers.refetch(),
    retrying: answers.isFetching,
  };
  // Why the summary has no row: an archived prompt is not asked, a branded one is left out unless included
  const countsReason =
    prompt?.is_active === false
      ? t('noCountsArchived')
      : prompt?.is_branded === true && !counts.brandedIncluded
        ? t('noCountsBranded')
        : t('noCountsReason');
  const firstTopic = prompt === null ? undefined : topicTermsOf(prompt)[0];
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
          prompt === null && topic == null ? null : (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {topic == null ? (
                firstTopic === undefined ? null : firstTopic.path === firstTopic.name ? (
                  <Badge>{firstTopic.name}</Badge>
                ) : (
                  // Where the topic sits in its tree is the tooltip; the badge takes the keyboard so it reaches it. It
                  // is no button: a prompt that was not opened from a topic has no way back to one (decision 8)
                  <Tooltip content={firstTopic.path}>
                    <Badge tabIndex={0}>{firstTopic.name}</Badge>
                  </Tooltip>
                )
              ) : (
                // There is no interactive badge: the badge is the button's label
                <Button
                  variant="link"
                  size="sm"
                  aria-label={words('topics.openTopic', { name: topic.name })}
                  onClick={topic.onOpen}
                >
                  <Badge>{topic.name}</Badge>
                </Button>
              )}
              {prompt?.is_branded === true ? <Badge>{words('branded')}</Badge> : null}
              {prompt === null || prompt.is_active ? null : <Badge tone="warning">{t('archivedBadge')}</Badge>}
              {prompt?.country_iso == null ? null : <Badge variant="outline">{countryName(prompt.country_iso)}</Badge>}
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
      {detail.isError && prompt === null ? (
        <InspectorBody>
          {notFound ? (
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
          )}
        </InspectorBody>
      ) : (
        <>
          {/* The strip stays above the tabs, whichever is shown */}
          <div className="flex shrink-0 flex-col gap-3 border-t border-border px-4 pt-3 pb-2">
            {canTrigger &&
            prompt?.is_active === true &&
            locationsKnown &&
            engines.length > 0 &&
            runnable.length === 0 ? (
              <p className="type-meta">{t('runNoEngine')}</p>
            ) : null}
            <InspectorStrip engines={engines} counts={counts} noCountsReason={countsReason} />
          </div>
          <InspectorTabs<PromptTab>
            label={t('tabsLabel')}
            value={tab}
            onValueChange={onTabChange}
            items={PROMPT_TABS.map((value) => ({ value, label: t(TAB_LABEL[value]) }))}
          >
            <InspectorPanel<PromptTab> value="latest">
              <InspectorLatest
                scope={scope}
                promptId={promptId}
                exists={isPromptId(promptId) && !notFound}
                range={range}
                timeZone={timeZone}
                engines={engines}
                onOpenAnswer={onOpenAnswer}
              >
                <InspectorSection
                  title={t('facts')}
                  icon={ClipboardList}
                  status={prompt === null ? 'loading' : 'ready'}
                >
                  {prompt === null ? null : <KeyValues items={factsOf(prompt)} />}
                </InspectorSection>
              </InspectorLatest>
            </InspectorPanel>
            <InspectorPanel<PromptTab> value="history">
              <InspectorHistory
                counts={counts}
                engines={engines}
                range={range}
                timeZone={timeZone}
                createdAt={prompt?.created_at ?? null}
                answers={promptAnswers}
                labelOf={labelOf}
                noCountsReason={countsReason}
                onOpenAnswer={onOpenAnswer}
              />
            </InspectorPanel>
            <InspectorPanel<PromptTab> value="competitors">
              <InspectorCompetitors scope={scope} counts={counts} engines={engines} answers={promptAnswers} />
            </InspectorPanel>
            <InspectorPanel<PromptTab> value="stats">
              <InspectorStats engines={engines} counts={counts} noCountsReason={countsReason} />
            </InspectorPanel>
          </InspectorTabs>
        </>
      )}
    </Inspector>
  );
}
