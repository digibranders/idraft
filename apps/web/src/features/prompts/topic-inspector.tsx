'use client';

import { ListOrdered, MessageSquare, Percent } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, type ReactElement, type ReactNode } from 'react';

import {
  countText,
  NO_TOPIC,
  TOPIC_TAB,
  TOPIC_TOP_PROMPTS,
  topicPrompts,
  topicSummaryRow,
  type TopicDescendants,
} from './prompt-model';
import { chosenTab } from './seams/shared';
import { TOPIC_TAB_ENTRIES, topicTabs, type TopicInspectorTab, type TopicTabContext } from './seams/topic-tabs';
import { TopicDrawerProvider, type TopicDrawerExtras } from './topic-drawer/drawer-context';
import { EngineFilteredPrompts } from './topic-drawer/engine-filter';
import { TopicEngineSections } from './topic-drawer/engine-sections';
import { PromptRow } from './topic-drawer/prompt-row';
import { useTopicHeader } from './topic-drawer/use-topic-header';
import { Inspector } from '@/components/app/inspector/inspector';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { InspectorBody, InspectorPanel, InspectorTabs } from '@/components/app/inspector/inspector-tabs';
import { KeyValues, type KeyValue } from '@/components/app/inspector/key-values';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import type { ErrorIdWords } from '@/lib/api/use-error-id';
import type { MetricCell, ProjectEngine, PromptsSummary, PromptSummaryRow } from '@/lib/api/types';
import { EMPTY_VALUE, formatPercent } from '@/lib/format';
import { acrossEngines } from '@/lib/rates/rate-model';

/** What the screen has of the topic's counts: the summary of the window the page is on. */
export interface TopicCounts {
  status: 'loading' | 'failed' | 'ready';
  errorId: ErrorIdWords | null;
  retry: () => void;
  retrying: boolean;
}

export interface TopicInspectorProps {
  /** The term id, or `__none` for the prompts without a topic. */
  topicKey: string;
  summary: PromptsSummary | undefined;
  counts: TopicCounts;
  /** The engines the page shows, in order: the rates are per engine, and the first one orders the prompts. */
  engines: readonly ProjectEngine[];
  descendants: TopicDescendants;
  /** The topic's name in the vocabulary trees, for a topic the summary has no row for. */
  treeName: string | null;
  /** The trees are being read: until they are, the prompts of a topic cannot be told. */
  treePending: boolean;
  /** What the drawer's parts need of the page beyond the summary: the scope of their reads and the screen's actions. */
  extras: TopicDrawerExtras;
  /** The tab the address asks for (`?itab=`), which the drawer resolves against the tabs it shows. */
  tab: string;
  onTabChange: (tab: string) => void;
  onOpenPrompt: (promptId: string) => void;
  onClose: () => void;
}

const METRICS = [
  { key: 'mentioned', label: 'mentioned' },
  { key: 'cited', label: 'cited' },
  { key: 'share_of_voice', label: 'shareOfVoice' },
] as const;
type Metric = (typeof METRICS)[number]['key'];

const cellOf = (engine: PromptSummaryRow['engines'][number] | undefined, metric: Metric): MetricCell | undefined =>
  engine?.[metric];

/** A list of prompts, each opening the prompt inspector, with its mentions on every engine shown. */
function PromptList({
  prompts,
  engines,
  onOpen,
}: {
  prompts: readonly PromptSummaryRow[];
  engines: readonly ProjectEngine[];
  onOpen: (promptId: string) => void;
}): ReactElement {
  const t = useTranslations('prompts.topicDrawer');
  const separator = useTranslations('inspector')('separator');
  return (
    <ul className="flex flex-col">
      {prompts.map((prompt) => (
        <PromptRow
          key={prompt.prompt_id}
          text={prompt.text}
          isBranded={prompt.is_branded}
          onOpen={() => onOpen(prompt.prompt_id)}
          meta={engines.map((engine, index) => (
            <Fragment key={engine.engine.engine_code}>
              {index > 0 ? <span aria-hidden="true">{separator}</span> : null}
              <span className="num">
                {t('engineMentioned', {
                  engine: engine.engine.label,
                  count:
                    countText(
                      cellOf(
                        prompt.engines.find((cells) => cells.engine_code === engine.engine.engine_code),
                        'mentioned',
                      ),
                    ) ?? EMPTY_VALUE,
                })}
              </span>
            </Fragment>
          ))}
        />
      ))}
    </ul>
  );
}

/**
 * The drawer of one topic (ADR-DS-022 decisions 2, 3, 5, 7 and 8; 440 px, as the prompt drawer it leads to). The header
 * names the category, the prompt count and the scope of the counts, offers Add prompt and Run now and steps through the
 * topics of the Topics tab (`useTopicHeader`). Overview: the three rates averaged over the engines shown (each engine's
 * rate is prompt weighted, and the average says how many engines took part), the engine panel with the weekly trend per
 * engine and against competitors, In search, and the topic's most mentioned prompts. Prompts: every prompt of the topic
 * and of the topics below it, or the ones answered on the engine `?eng=` names; they open the prompt inspector.
 * Competitors and Related come through the seam `seams/topic-tabs.ts`. The sections and tabs read the drawer's
 * context, which this provides.
 *
 * shortcut: no "Top engine" pointer (decision 5; the per-engine rates are all here), and the Prompts tab lists every
 * prompt without paging (a project holds 150 at most on the base plan).
 */
export function TopicInspector({ extras, ...props }: TopicInspectorProps): ReactElement {
  const { topicKey, summary, counts, engines, descendants } = props;
  return (
    <TopicDrawerProvider value={{ topicKey, summary, counts, engines, descendants, extras }}>
      <TopicInspectorBody {...props} />
    </TopicDrawerProvider>
  );
}

/** The drawer inside its context: the header reads the context, so it cannot be drawn by the component that gives it. */
function TopicInspectorBody({
  topicKey,
  summary,
  counts,
  engines,
  descendants,
  treeName,
  treePending,
  tab,
  onTabChange,
  onOpenPrompt,
  onClose,
}: Omit<TopicInspectorProps, 'extras'>): ReactElement {
  const t = useTranslations('prompts.topicDrawer');
  const root = useTranslations();
  const words = useTranslations('prompts');
  const common = useTranslations('common');
  const inspectorWords = useTranslations('inspector');
  const row = topicSummaryRow(summary, topicKey);
  const name = topicKey === NO_TOPIC ? words('columns.noTopic') : (row?.name ?? treeName ?? '');
  const prompts = topicPrompts(summary, topicKey, descendants, engines[0]?.engine.engine_code);
  const header = useTopicHeader({ topicKey, row, prompts });
  const missing = counts.status === 'ready' && row === undefined;
  const sectionStatus = (ready: InspectorSectionStatus = 'ready'): InspectorSectionStatus =>
    counts.status === 'loading' ? 'loading' : counts.status === 'failed' ? 'error' : ready;
  const failed = (
    <InlineError
      title={words('summaryLoadFailed')}
      reason={words('loadFailedReason')}
      errorId={counts.errorId}
      onRetry={counts.retry}
      retrying={counts.retrying}
      retryLabel={common('retry')}
    />
  );
  // Until the trees are read a topic may hold prompts the page cannot tell yet, and then it is not empty
  const promptsStatus = sectionStatus(
    prompts === null ? (treePending ? 'loading' : 'empty') : prompts.length === 0 ? 'empty' : 'ready',
  );
  const noPrompts = (
    <EmptyState
      variant="inline"
      title={prompts === null ? t('unknownTitle') : t('emptyTitle')}
      reason={prompts === null ? t('unknownReason') : t('emptyReason')}
      headingLevel={3}
    />
  );
  const enginesOf = (engine: ProjectEngine): PromptSummaryRow['engines'][number] | undefined =>
    row?.engines.find((cells) => cells.engine_code === engine.engine.engine_code);
  const headline: KeyValue[] = METRICS.map(({ key, label }) => {
    const average = acrossEngines(
      engines.flatMap((engine) => {
        const cell = cellOf(enginesOf(engine), key);
        return cell === undefined ? [] : [cell];
      }),
    );
    return {
      id: key,
      label: t(label),
      value:
        average === null ? (
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="num text-foreground-tertiary">{EMPTY_VALUE}</span>
            <span className="type-meta text-foreground-tertiary">{t('noRate')}</span>
          </span>
        ) : (
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="num type-body-strong">{formatPercent(average.value, { decimals: 0 })}</span>
            <span className="num type-meta text-foreground-tertiary">
              {t('acrossEngines', { count: average.engines })}
            </span>
          </span>
        ),
    };
  });

  let body: ReactNode;
  if (missing) {
    body = (
      <InspectorBody>
        <EmptyState
          variant="inline"
          title={t('loadFailed')}
          reason={inspectorWords('notFound', { type: t('noun') })}
          headingLevel={3}
        />
      </InspectorBody>
    );
  } else {
    const overview = (
      <>
        <InspectorSection title={t('rates')} icon={Percent} status={sectionStatus()} error={failed}>
          <KeyValues items={headline} />
        </InspectorSection>
        <TopicEngineSections />
        <InspectorSection
          title={t('topPrompts')}
          icon={ListOrdered}
          status={promptsStatus}
          error={failed}
          empty={noPrompts}
          action={
            prompts !== null && prompts.length > TOPIC_TOP_PROMPTS ? (
              <Button variant="link" size="sm" onClick={() => onTabChange(TOPIC_TAB.prompts)}>
                {words('topics.showAll', { count: prompts.length })}
              </Button>
            ) : undefined
          }
        >
          {prompts === null ? null : (
            <PromptList prompts={prompts.slice(0, TOPIC_TOP_PROMPTS)} engines={engines} onOpen={onOpenPrompt} />
          )}
        </InspectorSection>
      </>
    );
    const promptsPanel = (
      <InspectorSection
        title={t('prompts')}
        icon={MessageSquare}
        status={promptsStatus}
        error={failed}
        empty={noPrompts}
      >
        {prompts === null ? null : (
          <EngineFilteredPrompts
            prompts={prompts}
            onOpen={onOpenPrompt}
            renderList={(list) => <PromptList prompts={list} engines={engines} onOpen={onOpenPrompt} />}
          />
        )}
      </InspectorSection>
    );
    const context: TopicTabContext = { topicKey, summary, counts, engines, descendants, onOpenPrompt };
    const builtInTabs: TopicInspectorTab[] = [
      { id: 'overview', label: (translate) => translate('prompts.topicDrawer.tabOverview'), render: () => overview },
      { id: 'prompts', label: (translate) => translate('prompts.topicDrawer.tabPrompts'), render: () => promptsPanel },
    ];
    const tabs = topicTabs(builtInTabs, TOPIC_TAB_ENTRIES, context);
    body = (
      <InspectorTabs<string>
        label={t('tabsLabel')}
        value={chosenTab(tabs, tab)}
        onValueChange={onTabChange}
        items={tabs.map((entry) => ({ value: entry.id, label: entry.label(root) }))}
      >
        {tabs.map((entry) => (
          <InspectorPanel<string> key={entry.id} value={entry.id}>
            {entry.render(context)}
          </InspectorPanel>
        ))}
      </InspectorTabs>
    );
  }

  return (
    <Inspector
      type="topic"
      backLabel={t('back')}
      onClose={onClose}
      header={{
        title: name,
        typeLabel: t('type'),
        typeNoun: t('noun'),
        badges: header.badges,
        frequentAction: header.frequentAction,
        navigation: header.navigation,
        positionText: header.positionText,
        freshness: header.freshness,
      }}
      onStep={header.onStep}
    >
      {body}
    </Inspector>
  );
}
