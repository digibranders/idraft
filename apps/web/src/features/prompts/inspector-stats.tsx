'use client';

import { ChartColumn, Percent, Quote } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import type { PromptCounts } from './inspector-reads';
import type { DateRange } from './prompt-model';
import { statisticsContent, statsRow, type StatsRow } from './stats-model';
import { ConfidenceIndicator } from '@/components/app/metric/confidence-indicator';
import { SampleCount } from '@/components/app/metric/sample-count';
import { StatisticsPanel } from '@/components/app/metric/statistics-panel';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import type { ProjectEngine } from '@/lib/api/types';
import { EMPTY_VALUE, formatDateRange, formatInterval, formatPercent } from '@/lib/format';

type StatsMetric = 'mention' | 'citation';

const METRICS: readonly StatsMetric[] = ['mention', 'citation'];

/** The rate whose statistics are open: one rate of one engine, never a pool. */
interface OpenRate {
  engineCode: string;
  metric: StatsMetric;
}

/** One platform's line of a rate table. */
interface StatsLine {
  engine: ProjectEngine;
  stats: StatsRow;
}

const openKey = ({ engineCode, metric }: OpenRate): string => `${engineCode}:${metric}`;

type Words = (
  key: 'mentionTitle' | 'mentionName' | 'mentionCaption' | 'citationTitle' | 'citationName' | 'citationCaption',
) => string;

/** The words of a rate: its title, its short name for a button and the caption of its table. */
const rateWords = (drawer: Words, metric: StatsMetric): { title: string; name: string; caption: string } =>
  metric === 'mention'
    ? { title: drawer('mentionTitle'), name: drawer('mentionName'), caption: drawer('mentionCaption') }
    : { title: drawer('citationTitle'), name: drawer('citationName'), caption: drawer('citationCaption') };

export interface InspectorStatsProps {
  /** The enabled engines, in order: one row each. */
  engines: readonly ProjectEngine[];
  counts: PromptCounts;
  /** Why the summary has no row for the prompt, when it has none. */
  noCountsReason: string;
  /** The window of the rates, named in the statistics of a rate. */
  range: DateRange;
}

/**
 * The Stats tab of the prompt inspector (parity spec G100, register PR-DRAWER-10): two tables, Mention rate and
 * Citation rate, with one row for each enabled platform: its rate, the 95 percent Wilson interval on the shared
 * scale of 0% to 100% and the valid answers behind it. Fewer than `MIN_OBSERVATIONS` valid answers show the count and
 * no rate or interval; no valid answer is said so, never 0. The name of a platform opens the statistics of that one
 * rate (a panel in the tab). The interval is computed in the browser until the server sends one.
 */
export function InspectorStats({ engines, counts, noCountsReason, range }: InspectorStatsProps): ReactElement {
  const t = useTranslations('prompts.inspector');
  const words = useTranslations('prompts.inspector.stats');
  const drawer = useTranslations('prompts.drawer.stats');
  const common = useTranslations('common');
  const [open, setOpen] = useState<OpenRate | null>(null);
  // Focus: into the panel when it opens, back to the button that opened it when it closes (refs, no timers)
  const panelRef = useRef<HTMLDivElement>(null);
  const openers = useRef(new Map<string, HTMLButtonElement>());
  const lastOpened = useRef<string | null>(null);
  useEffect(() => {
    // StatisticsPanel has no focus hook: its Back control is the first direct button of the panel, so scope to that
    if (open !== null) {
      panelRef.current?.querySelector<HTMLButtonElement>(':scope > [data-slot="statistics-panel"] > button')?.focus();
    } else if (lastOpened.current !== null) openers.current.get(lastOpened.current)?.focus();
  }, [open]);

  if (counts.status === 'loading') {
    return (
      <>
        {METRICS.map((metric) => (
          <InspectorSection key={metric} title={rateWords(drawer, metric).title} icon={Percent} status="loading" />
        ))}
      </>
    );
  }
  if (counts.status === 'failed') {
    return (
      <InspectorSection
        title={t('tabStats')}
        icon={Percent}
        status="error"
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
      />
    );
  }
  const row = counts.row;
  if (row === undefined) {
    return (
      <InspectorSection
        title={t('tabStats')}
        icon={Percent}
        status="empty"
        empty={<EmptyState variant="inline" title={t('noCounts')} reason={noCountsReason} headingLevel={3} />}
      />
    );
  }
  const linesOf = (metric: StatsMetric): StatsLine[] =>
    engines.map((engine) => {
      const cells = row.engines.find((cell) => cell.engine_code === engine.engine.engine_code);
      return { engine, stats: statsRow(metric === 'mention' ? cells?.mentioned : cells?.cited) };
    });
  const openEngine =
    open === null ? undefined : engines.find((candidate) => candidate.engine.engine_code === open.engineCode);
  if (open !== null && openEngine !== undefined) {
    // The statistics of this one rate of this one engine, from the row its line shows
    const stats = linesOf(open.metric).find((line) => line.engine === openEngine)?.stats ?? statsRow(undefined);
    const metricName = open.metric === 'mention' ? words('metricMention') : words('metricCitation');
    return (
      <div ref={panelRef}>
        <StatisticsPanel
          placement="inspector-tab"
          state={{
            kind: 'ready',
            data: statisticsContent(stats, {
              metricName,
              engine: { code: open.engineCode, name: openEngine.engine.label },
              scopeText: formatDateRange(range.from, range.to),
              definition: open.metric === 'mention' ? words('definitionMention') : words('definitionCitation'),
              methodText: words('intervalMethod'),
            }),
          }}
          backTo={{ label: t('tabStats'), onBack: () => setOpen(null) }}
        />
      </div>
    );
  }

  /** The interval of a line, or why it has none. */
  const intervalOf = ({ state, interval, value }: StatsRow): ReactElement => {
    if (state === 'none') return <span className="type-meta">{drawer('noValid')}</span>;
    if (state === 'insufficient' || interval === null) {
      return <span className="type-meta text-foreground-tertiary">{drawer('notEnough')}</span>;
    }
    return (
      <ConfidenceIndicator
        form="text-and-bar"
        estimate={value}
        low={interval.low}
        high={interval.high}
        label={words('intervalLabel', { range: formatInterval(interval.low, interval.high) })}
      />
    );
  };
  const columnsOf = (metric: StatsMetric): PlainColumn<StatsLine>[] => [
    {
      id: 'platform',
      header: drawer('platform'),
      cell: ({ engine, stats }) => {
        const label = engine.engine.label;
        // A platform with no valid answer has no statistics to open
        if (stats.state === 'none') return label;
        const rate = { engineCode: engine.engine.engine_code, metric };
        return (
          <Button
            variant="link"
            size="sm"
            aria-label={words('openStatisticsLabel', { metric: rateWords(drawer, metric).name, engine: label })}
            ref={(node: HTMLButtonElement | null) => {
              if (node === null) openers.current.delete(openKey(rate));
              else openers.current.set(openKey(rate), node);
            }}
            onClick={() => {
              lastOpened.current = openKey(rate);
              setOpen(rate);
            }}
          >
            {label}
          </Button>
        );
      },
    },
    {
      id: 'estimate',
      header: drawer('estimate'),
      cell: ({ stats }) => (
        <span className="num">{stats.value === null ? EMPTY_VALUE : formatPercent(stats.value, { decimals: 0 })}</span>
      ),
    },
    { id: 'interval', header: drawer('interval'), wrap: true, cell: ({ stats }) => intervalOf(stats) },
    {
      id: 'sample',
      header: drawer('sample'),
      wrap: true,
      cell: ({ stats }) =>
        stats.state === 'none' ? (
          <SampleCount k={null} n={null} noun="answers" />
        ) : (
          <SampleCount k={stats.k} n={stats.n} noun="answers" />
        ),
    },
  ];
  return (
    <>
      {METRICS.map((metric) => (
        <InspectorSection
          key={metric}
          title={rateWords(drawer, metric).title}
          icon={metric === 'mention' ? ChartColumn : Quote}
          action={<span className="type-meta">{drawer('intervalNote')}</span>}
          status="ready"
        >
          {/* The table runs to the edges of its card, as in the design: a bordered table inside a card is a nested card */}
          <div className="-mx-4 -mb-4 [&>div]:rounded-none [&>div]:border-x-0 [&>div]:border-b-0">
            <PlainTable<StatsLine>
              caption={rateWords(drawer, metric).caption}
              columns={columnsOf(metric)}
              rows={linesOf(metric)}
              rowKey={(line) => line.engine.engine.engine_code}
              status="ready"
              errorState={null}
              emptyText={t('noCounts')}
            />
          </div>
        </InspectorSection>
      ))}
      <p className="type-meta">{drawer('footer')}</p>
      <p className="type-meta">{drawer('openHint')}</p>
    </>
  );
}
