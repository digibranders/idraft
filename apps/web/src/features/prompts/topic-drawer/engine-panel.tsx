'use client';

import { ListChecks } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTimeZone, useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { ComparisonLine } from './comparison-line';
import { useDrawerMetric, useTopicDrawer } from './drawer-context';
import { TopicEnginePanel, type EnginePanelRow } from '@/components/app/chart/topic-engine-panel';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { useCompare } from '@/features/prompts/compare';
import { CELL_OF_METRIC, topicSummaryRow } from '@/features/prompts/prompt-model';
import { useRateWords } from '@/features/prompts/rate-view';
import { drillHref } from '@/features/prompts/topics-by-engine/drill';
import { useDrill } from '@/features/prompts/topics-by-engine/use-drill';
import { engineChange, engineValue } from '@/features/prompts/topics-by-engine/engine-values';
import { MetricSelect } from '@/features/prompts/topics-by-engine/metric-select';
import { isStale } from '@/features/prompts/topics-by-engine/series-model';
import { formatMetricDelta, formatPercent, formatTableDate, type MetricDeltaInput } from '@/lib/format';

/**
 * The By engine section of the topic drawer's Overview (WB-TPE-09, 10 and 12, WB-TI-10 and 11): one row for each engine
 * shown, in order, with the chosen metric as a bar and a percent, the answers and prompts behind it and the change since the
 * compared window (only when the cells carry one); then the sentence that compares the engines and the note that a topic's
 * rate is prompt weighted. Each row opens the topic's prompts on that engine. The metric is the page's `?metric=`.
 */
export function EnginePanel(): ReactElement {
  const { topicKey, summary, counts, engines } = useTopicDrawer();
  const t = useTranslations('prompts.topicDrawer');
  const panel = useTranslations('prompts.topicDrawer.panel');
  const prompts = useTranslations('prompts');
  const common = useTranslations('common');
  const inspector = useTranslations('inspector');
  const words = useRateWords();
  const timeZone = useTimeZone() ?? 'UTC';
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const { metric, setMetric } = useDrawerMetric();
  const drill = useDrill();
  const { compare } = useCompare();
  const key = CELL_OF_METRIC[metric];
  const row = topicSummaryRow(summary, topicKey);
  const metricLabel = prompts(`metric.${metric}`);
  // A row already held stays while the next window is read (the page keeps the previous summary)
  const status: InspectorSectionStatus =
    row !== undefined
      ? 'ready'
      : counts.status === 'failed'
        ? 'error'
        : counts.status === 'loading'
          ? 'loading'
          : 'empty';

  const shown = engines.map(({ engine }) => ({ engine, value: engineValue(row?.engines, engine.engine_code, key) }));
  const values = shown.map((entry) => entry.value);
  const panelRows = shown.map(({ engine, value }): EnginePanelRow => {
    const { engine_code: code, label } = engine;
    const basis = words.basis(value) ?? '';
    const noneText = words.reason(value) ?? panel('noAnswers');
    // Off at once: the rows held while the next read runs still carry the cells of the period they were compared with
    const change = compare ? engineChange(row?.engines, code, key) : null;
    const input: MetricDeltaInput | null =
      change === null
        ? null
        : { value: change.points, unit: 'points', polarity: 'higher_is_better', isDetectable: change.detectable };
    const href = value.state === 'none' ? undefined : drillHref(pathname, search, topicKey, code);
    return {
      code,
      label,
      state: value.state,
      value: value.value,
      valueText: formatPercent(value.value, { decimals: 0 }),
      contextText:
        value.state !== 'ok'
          ? null
          : value.prompts === null
            ? basis
            : metric === 'sov'
              ? panel('shareContext', { answers: value.answers, prompts: value.prompts })
              : panel('context', { basis, prompts: value.prompts }),
      answers: value.answers,
      noneText,
      accessibleText:
        value.state === 'none'
          ? panel('rowNone', { engine: label, reason: noneText })
          : panel('rowName', { engine: label, value: words.inline(value), basis }),
      tip: href === undefined ? undefined : panel('rowTip', { engine: label }),
      href,
      // The drawer is already open: its rows move it on, so Close still takes it away in one step
      replace: true,
      // The tab and the engine are the address's keys the drawer reads through the inspector: a plain click writes them
      // there (the router's own navigation changed the address and left the drawer on Overview), the href serves a new tab
      onSelect: href === undefined ? undefined : () => drill(topicKey, code),
      delta: input === null ? undefined : { input, test: 'interim', text: formatMetricDelta(input).text },
    };
  });

  const lastValid = row?.last_valid_at ?? null;
  const silent = isStale(lastValid, new Date());
  return (
    <InspectorSection
      title={t('byEngine')}
      icon={ListChecks}
      status={status}
      action={
        status === 'ready' ? (
          <MetricSelect label={panel('metricLabel')} value={metric} onValueChange={setMetric} />
        ) : undefined
      }
      error={
        <InlineError
          title={prompts('summaryLoadFailed')}
          reason={prompts('loadFailedReason')}
          errorId={counts.errorId}
          onRetry={counts.retry}
          retrying={counts.retrying}
          retryLabel={common('retry')}
        />
      }
      empty={
        <EmptyState
          variant="inline"
          title={t('loadFailed')}
          reason={inspector('notFound', { type: t('noun') })}
          headingLevel={3}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <TopicEnginePanel
          caption={panel('caption', { metric: metricLabel })}
          labelHeader={panel('labelHeader')}
          valueHeader={panel('valueHeader', { metric: metricLabel })}
          contextHeader={panel('contextHeader')}
          changeHeader={panel('changeHeader')}
          rows={panelRows}
        />
        <ComparisonLine values={values} metric={key} />
        {silent && lastValid !== null ? (
          <p className="type-meta text-foreground-tertiary">
            {panel('stale', { date: formatTableDate(lastValid, timeZone) })}
          </p>
        ) : null}
        <p className="type-meta text-foreground-tertiary">{prompts('topics.weighted')}</p>
      </div>
    </InspectorSection>
  );
}
