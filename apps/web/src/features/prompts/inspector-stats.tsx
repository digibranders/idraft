'use client';

import { Percent } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { PromptCounts } from './inspector-reads';
import { statsRow, type StatsRow } from './stats-model';
import { ConfidenceIndicator } from '@/components/app/metric/confidence-indicator';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import type { ProjectEngine } from '@/lib/api/types';
import { EMPTY_VALUE, formatInterval, formatPercent } from '@/lib/format';

interface StatsLine {
  id: 'mention' | 'citation';
  stats: StatsRow;
}

export interface InspectorStatsProps {
  /** The enabled engines, in order: one card each. */
  engines: readonly ProjectEngine[];
  counts: PromptCounts;
  /** Why the summary has no row for the prompt, when it has none. */
  noCountsReason: string;
}

/**
 * The Stats tab of the prompt inspector (parity spec G100): for each enabled engine its Mention and its Citation
 * rate over the window with the 95 percent Wilson interval (a thin range line with a dot, no track), its numbers and
 * the valid answers behind it. Fewer than `MIN_OBSERVATIONS` valid answers show the sample and no rate or interval.
 * The interval is computed in the browser until the server sends one, which the tab says.
 */
export function InspectorStats({ engines, counts, noCountsReason }: InspectorStatsProps): ReactElement {
  const t = useTranslations('prompts.inspector');
  const words = useTranslations('prompts.inspector.stats');
  const common = useTranslations('common');

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
  return (
    <>
      {engines.map((engine) => {
        const cells = row.engines.find((cell) => cell.engine_code === engine.engine.engine_code);
        const lines: StatsLine[] = [
          { id: 'mention', stats: statsRow(cells?.mentioned) },
          { id: 'citation', stats: statsRow(cells?.cited) },
        ];
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
                    <span className="num type-meta">
                      {line.stats.state === 'none'
                        ? EMPTY_VALUE
                        : words('sample', { k: line.stats.k, n: line.stats.n })}
                    </span>
                    {intervalOf(line.stats)}
                  </span>
                </li>
              ))}
            </ul>
          </InspectorSection>
        );
      })}
      <p className="type-meta">{words('method')}</p>
    </>
  );
}
