'use client';

import { ListChecks, ListOrdered, MessageSquare, Percent } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, type ReactElement, type ReactNode } from 'react';

import {
  acrossEngines,
  countText,
  NO_TOPIC,
  TOPIC_TABS,
  TOPIC_TOP_PROMPTS,
  topicPrompts,
  topicSummaryRow,
  type TopicDescendants,
  type TopicTab,
} from './prompt-model';
import { Inspector } from '@/components/app/inspector/inspector';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { InspectorBody, InspectorPanel, InspectorTabs } from '@/components/app/inspector/inspector-tabs';
import { KeyValues, type KeyValue } from '@/components/app/inspector/key-values';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ErrorIdWords } from '@/lib/api/use-error-id';
import type { MetricCell, ProjectEngine, PromptsSummary, PromptSummaryRow } from '@/lib/api/types';
import { EMPTY_VALUE, formatPercent } from '@/lib/format';

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
  tab: TopicTab;
  onTabChange: (tab: TopicTab) => void;
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

/** One rate of one engine, prompt weighted, with the count behind it; why there is none when there is none. */
function Rate({ cell, metric }: { cell: MetricCell | undefined; metric: Metric }): ReactElement {
  const t = useTranslations('prompts.topicDrawer');
  const columns = useTranslations('prompts.columns');
  if (cell === undefined || cell.value === null) {
    const reason =
      cell === undefined || cell.n_observations === 0
        ? columns('noAnswers')
        : t(metric === 'share_of_voice' ? 'noBrandNamed' : 'noneValid');
    return (
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="num text-foreground-tertiary">{EMPTY_VALUE}</span>
        <span className="type-meta text-foreground-tertiary">{reason}</span>
      </span>
    );
  }
  // A topic's share of voice is answers that name a tracked brand with a sum of shares over them: not a count
  const basis = metric === 'share_of_voice' ? t('answerCount', { count: cell.denominator }) : countText(cell);
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="num type-body-strong">{formatPercent(cell.value, { decimals: 0 })}</span>
      {basis === null ? null : <span className="num type-meta text-foreground-tertiary">{basis}</span>}
    </span>
  );
}

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
  const words = useTranslations('prompts');
  const separator = useTranslations('inspector')('separator');
  return (
    <ul className="flex flex-col">
      {prompts.map((prompt) => (
        <li
          key={prompt.prompt_id}
          className="flex flex-col gap-0.5 border-t border-border-subtle py-2 first:border-t-0 first:pt-0 last:pb-0"
        >
          <span className="flex items-start gap-2">
            <Button
              variant="link"
              className="max-w-full min-w-0 shrink justify-start"
              onClick={() => onOpen(prompt.prompt_id)}
            >
              <span className="line-clamp-2 text-left whitespace-normal">{prompt.text}</span>
            </Button>
            {prompt.is_branded ? <Badge>{words('branded')}</Badge> : null}
          </span>
          <p className="flex flex-wrap items-center gap-x-1.5 type-meta text-foreground-tertiary">
            {engines.map((engine, index) => (
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
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * The drawer of one topic (ADR-DS-022 decisions 2, 3, 5, 7 and 8; 440 px, as the prompt drawer it leads to), from
 * the summary of the window and nothing else. Overview: the three rates averaged over the engines shown (each
 * engine's rate is prompt weighted, and the average says how many engines took part), the rates of each engine
 * with the answers behind them, and the topic's most mentioned prompts. Prompts: every prompt of the topic and of
 * the topics below it, which open the prompt inspector.
 *
 * shortcut: no Competitors tab (the summary carries the tracked entity set, not a value per entity and topic; add it
 * when the API does), no Related tab and no trend against competitors (keyword links and history are slice 2 and 3),
 * no "Top engine" pointer (decision 5; the per-engine rates are all here), no J and K between topics, and the Prompts
 * tab lists every prompt without paging (a project holds 150 at most on the base plan).
 */
export function TopicInspector({
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
}: TopicInspectorProps): ReactElement {
  const t = useTranslations('prompts.topicDrawer');
  const words = useTranslations('prompts');
  const common = useTranslations('common');
  const inspectorWords = useTranslations('inspector');
  const row = topicSummaryRow(summary, topicKey);
  const name = topicKey === NO_TOPIC ? words('columns.noTopic') : (row?.name ?? treeName ?? '');
  const prompts = topicPrompts(summary, topicKey, descendants, engines[0]?.engine.engine_code);
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
    body = (
      <InspectorTabs<TopicTab>
        label={t('tabsLabel')}
        value={tab}
        onValueChange={onTabChange}
        items={TOPIC_TABS.map((value) => ({ value, label: t(value === 'overview' ? 'tabOverview' : 'tabPrompts') }))}
      >
        <InspectorPanel<TopicTab> value="overview">
          <InspectorSection title={t('rates')} icon={Percent} status={sectionStatus()} error={failed}>
            <KeyValues items={headline} />
          </InspectorSection>
          <InspectorSection title={t('byEngine')} icon={ListChecks} status={sectionStatus()} error={failed}>
            <div className="flex flex-col gap-4">
              {engines.map((engine) => (
                <div key={engine.engine.engine_code} className="flex flex-col gap-2">
                  <h4 className="type-body-strong">{engine.engine.label}</h4>
                  <KeyValues
                    items={METRICS.map(({ key, label }) => ({
                      id: key,
                      label: t(label),
                      value: <Rate cell={cellOf(enginesOf(engine), key)} metric={key} />,
                    }))}
                  />
                </div>
              ))}
              <p className="type-meta text-foreground-tertiary">{words('topics.weighted')}</p>
            </div>
          </InspectorSection>
          <InspectorSection
            title={t('topPrompts')}
            icon={ListOrdered}
            status={promptsStatus}
            error={failed}
            empty={noPrompts}
            action={
              prompts !== null && prompts.length > TOPIC_TOP_PROMPTS ? (
                <Button variant="link" size="sm" onClick={() => onTabChange('prompts')}>
                  {words('topics.showAll', { count: prompts.length })}
                </Button>
              ) : undefined
            }
          >
            {prompts === null ? null : (
              <PromptList prompts={prompts.slice(0, TOPIC_TOP_PROMPTS)} engines={engines} onOpen={onOpenPrompt} />
            )}
          </InspectorSection>
        </InspectorPanel>
        <InspectorPanel<TopicTab> value="prompts">
          <InspectorSection
            title={t('prompts')}
            icon={MessageSquare}
            status={promptsStatus}
            error={failed}
            empty={noPrompts}
          >
            {prompts === null ? null : <PromptList prompts={prompts} engines={engines} onOpen={onOpenPrompt} />}
          </InspectorSection>
        </InspectorPanel>
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
        // The context line's second part: how many prompts the topic holds, as "12 of 986" is for a list
        positionText: row === undefined ? null : t('promptCount', { count: row.prompt_count }),
      }}
    >
      {body}
    </Inspector>
  );
}
