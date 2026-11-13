'use client';

import { Percent } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import type { ProjectEngine } from '@/lib/api/types';
import { EMPTY_VALUE, formatDateRange, formatInterval, formatPercent } from '@/lib/format';

type StatsMetric = 'mention' | 'citation';

interface StatsLine {
  id: StatsMetric;
  stats: StatsRow;
}

/** The rate whose statistics are open: one rate of one engine, never a pool. */
interface OpenRate {
  engineCode: string;
  metric: StatsMetric;
}

const openKey = ({ engineCode, metric }: OpenRate): string => `${engineCode}:${metric}`;

export interface InspectorStatsProps {
  /** The enabled engines, in order: one card each. */
  engines: readonly ProjectEngine[];
  counts: PromptCounts;
  /** Why the summary has no row for the prompt, when it has none. */
  noCountsReason: string;
  /** The window of the rates, named in the statistics of a rate. */
  range: DateRange;
}

/**
 * The Stats tab of the prompt inspector (parity spec G100): for each enabled engine its Mention and its Citation
 * rate over the window with the 95 percent Wilson interval (a thin range line with a dot, no track), its numbers and
 * the valid answers behind it. Fewer than `MIN_OBSERVATIONS` valid answers show the sample and no rate or interval.
 * The interval is computed in the browser until the server sends one, which the tab says.
 */
export function InspectorStats({ engines, counts, noCountsReason, range }: InspectorStatsProps): ReactElement {
  const t = useTranslations('prompts.inspector');
  const words = useTranslations('prompts.inspector.stats');
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

  /** The second line of a measure: what its interval says, or why it has none. */
  const intervalOf = ({ state, interval, value }: StatsRow): ReactElement => {
    if (state === 'none') return <span className="type-meta">{words('none')}</span>;
    if (state === 'insufficient' || interval === null) return <span className="type-meta">{words('tooFew')}</span>;
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

  if (counts.status === 'loading') {
    return (
      <>
        {engines.map((engine) => (
          <InspectorSection
            key={engine.engine.engine_code}
            title={engine.engine.label}
            icon={Percent}
            status="loading"
          />
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
  const linesOf = (engineCode: string): StatsLine[] => {
    const cells = row.engines.find((cell) => cell.engine_code === engineCode);
    return [
      { id: 'mention', stats: statsRow(cells?.mentioned) },
      { id: 'citation', stats: statsRow(cells?.cited) },
    ];
  };
  const openEngine =
    open === null ? undefined : engines.find((candidate) => candidate.engine.engine_code === open.engineCode);
  if (open !== null && openEngine !== undefined) {
    // The statistics of this one rate of this one engine, from the row its line shows
    const stats = linesOf(open.engineCode).find((line) => line.id === open.metric)?.stats ?? statsRow(undefined);
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
  return (
    <>
      {engines.map((engine) => {
        const lines = linesOf(engine.engine.engine_code);
        return (
          <InspectorSection key={engine.engine.engine_code} title={engine.engine.label} icon={Percent} status="ready">
            <ul aria-label={words('caption', { engine: engine.engine.label })} className="flex flex-col">
              {lines.map((line) => (
                <li
                  key={line.id}
                  className="flex flex-col gap-1 border-t border-border-subtle py-2 first:border-t-0 first:pt-0 last:pb-0"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="type-body-strong">{words(line.id)}</span>
                    <span className="num type-body-strong">
                      {line.stats.value === null ? EMPTY_VALUE : formatPercent(line.stats.value, { decimals: 0 })}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    {/* The valid answers the rate is a share of, then its interval */}
                    {line.stats.state === 'none' ? (
                      <SampleCount k={null} n={null} noun="answers" />
                    ) : (
                      <SampleCount k={line.stats.k} n={line.stats.n} noun="answers" />
                    )}
                    {intervalOf(line.stats)}
                  </span>
                  {line.stats.state === 'none' ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="self-start"
                      aria-label={words('openStatisticsLabel', {
                        metric: words(line.id),
                        engine: engine.engine.label,
                      })}
                      ref={(node: HTMLButtonElement | null) => {
                        const key = openKey({ engineCode: engine.engine.engine_code, metric: line.id });
                        if (node === null) openers.current.delete(key);
                        else openers.current.set(key, node);
                      }}
                      onClick={() => {
                        const rate = { engineCode: engine.engine.engine_code, metric: line.id };
                        lastOpened.current = openKey(rate);
                        setOpen(rate);
                      }}
                    >
                      {words('openStatistics')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {/* Engines are never pooled: each section says what its own rates count */}
            <p className="mt-2 type-meta">{words('aggregation', { engine: engine.engine.label })}</p>
          </InspectorSection>
        );
      })}
      <p className="type-meta">{words('method')}</p>
    </>
  );
}
